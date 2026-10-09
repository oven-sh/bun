use crate::oxlint::jsdoc::{
    JSDoc, JSDocFinder, JSDocPluginSettings, ParamInfo, ParamKind, collect_params, is_function_with_body,
    should_ignore_as_avoid, should_ignore_as_internal, should_ignore_as_private,
};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::regex_flags::rust_regex;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::borrow::Cow;
use std::collections::BTreeSet;
use std::ops::Bound;

/// Requires that all function parameters are documented with JSDoc `@param` tags.
pub struct RequireParam {
    exempted_by: Vec<Box<[u8]>>,
    check_constructors: bool,
    check_getters: bool,
    check_setters: bool,
    check_destructured_roots: bool,
    check_destructured: bool,
    check_rest_property: bool,
    check_types_pattern: CheckTypes,
    use_default_object_properties: bool,
    ignore_when_all_params_missing: bool,
    interface_exempts_params_check: bool,
}

const REQUIRE_PARAM: Message = Message::new("", "Missing JSDoc `@param` declaration for function parameters.");

enum CheckTypes {
    /// `^(?:[oO]bject|[aA]rray|PlainObject|Generic(?:Object|Array))$`
    Default,
    /// `checkTypesPattern`, if it is a pattern.
    Pattern(Option<Box<Regex>>),
}

impl Rule for RequireParam {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-param", Kind::Suggestion);
    type State<'a> = JSDocFinder<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let exempted_by = if options.has("exemptedBy") { options.strings("exemptedBy") } else { vec!["inheritdoc"] };
        let check_types_pattern = options.str("checkTypesPattern");
        RequireParam {
            exempted_by: exempted_by.iter().map(|it| it.as_bytes().into()).collect(),
            check_constructors: options.bool_or("checkConstructors", false),
            check_getters: options.bool_or("checkGetters", true),
            check_setters: options.bool_or("checkSetters", true),
            check_destructured_roots: options.bool_or("checkDestructuredRoots", true),
            check_destructured: options.bool_or("checkDestructured", true),
            check_rest_property: options.bool_or("checkRestProperty", false),
            check_types_pattern: check_types_pattern
                .map_or(CheckTypes::Default, |it| CheckTypes::Pattern(rust_regex(it, false).map(Box::new))),
            use_default_object_properties: options.bool_or("useDefaultObjectProperties", false),
            ignore_when_all_params_missing: options.bool_or("ignoreWhenAllParamsMissing", false),
            interface_exempts_params_check: options.bool_or("interfaceExemptsParamsCheck", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.funcs(Self::check);
        }
        finder
    }
}

/// The name and the type of a `@param`.
type Tag<'s> = (&'s [u8], Option<&'s [u8]>);

fn collect_tags<'s>(jsdocs: impl Iterator<Item = JSDoc<'s>>, resolved_param_tag_name: &[u8]) -> Vec<Tag<'s>> {
    let tags = jsdocs.flat_map(JSDoc::tags).filter(|tag| tag.kind.parsed() == resolved_param_tag_name);
    let named = tags.filter_map(|tag| {
        let (type_part, name_part, _) = tag.type_name_comment();
        Some((name_part?.parsed(), type_part.map(|it| it.parsed())))
    });
    // `this` is no parameter.
    named.filter(|it| it.0 != b"this").collect()
}

/// `is_name_equal(a, b)` is `without_quotes(a) == without_quotes(b)`.
fn without_quotes(name: &[u8]) -> Cow<'_, [u8]> {
    match strings::contains_char(name, b'"') {
        true => Cow::Owned(name.iter().copied().filter(|it| *it != b'"').collect()),
        false => Cow::Borrowed(name),
    }
}

/// Names, to ask whether another name starts with one of them. Of those that start with another only the shorter is kept, so that
/// the one that a name starts with is the last that is not after it.
#[derive(Default)]
struct Prefixes<'s>(BTreeSet<&'s [u8]>);

impl<'s> Prefixes<'s> {
    fn has_start_of(&self, name: &[u8]) -> bool {
        let up_to_name: (Bound<&[u8]>, Bound<&[u8]>) = (Bound::Unbounded, Bound::Included(name));
        self.0.range::<[u8], _>(up_to_name).next_back().is_some_and(|it| name.starts_with(it))
    }

    fn insert(&mut self, name: &'s [u8]) {
        if self.has_start_of(name) {
            return;
        }
        let from_name: (Bound<&[u8]>, Bound<&[u8]>) = (Bound::Included(name), Bound::Unbounded);
        while let Some(&longer) = self.0.range::<[u8], _>(from_name).next().filter(|it| it.starts_with(name)) {
            self.0.remove(longer);
        }
        self.0.insert(name);
    }
}

fn is_first_fn_param_typed(func: Func) -> bool {
    func.params().first().is_some_and(|it| !it.is_rest() && it.ty().is_some_and(|ty| ty.tag() == TypeTag::Ref))
}

fn is_parent_fn_typed(func: Func) -> bool {
    matches!(func.owner(), Node::Expr(e) if !e.is_parenthesized()
        && matches!(e.parent(), Node::VarDecl(declarator) if declarator.ty().is_some()))
}

impl RequireParam {
    fn is_checked_type(&self, r#type: &[u8]) -> bool {
        match &self.check_types_pattern {
            CheckTypes::Default => matches!(
                r#type,
                b"object" | b"Object" | b"array" | b"Array" | b"PlainObject" | b"GenericObject" | b"GenericArray"
            ),
            CheckTypes::Pattern(pattern) => pattern.as_ref().is_some_and(|it| it.test(r#type)),
        }
    }

    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !is_function_with_body(func)
            || func.params().is_empty()
            || self.interface_exempts_params_check && (is_parent_fn_typed(func) || is_first_fn_param_typed(func))
        {
            return;
        }
        let Some(func_def_node) = cx.state.get_function_nearest_jsdoc_node(func) else {
            return;
        };
        let is_checked_kind = func_def_node.method_definition.is_none_or(|it| match it.kind() {
            MemberKind::Getter => self.check_getters,
            MemberKind::Setter => self.check_setters,
            _ if it.is_constructor() => self.check_constructors,
            _ => true,
        });
        let jsdocs = cx.state.get_all_by_node(func_def_node);
        let settings = JSDocPluginSettings::new(cx.file());
        let is_ignored = |jsdoc: JSDoc| {
            should_ignore_as_avoid(jsdoc, &settings, &self.exempted_by)
                || should_ignore_as_private(jsdoc, &settings)
                || should_ignore_as_internal(jsdoc, &settings)
        };
        // With a `@type` for the function no `@param` is needed.
        let has_type_tag = || jsdocs.clone().flat_map(JSDoc::tags).any(|tag| tag.kind.parsed() == b"type");
        if !is_checked_kind || has_type_tag() || jsdocs.clone().all(is_ignored) {
            return;
        }
        let tags_to_check = collect_tags(jsdocs, settings.resolve_tag_name("param"));
        if self.ignore_when_all_params_missing && tags_to_check.is_empty() {
            return;
        }
        let longest_name = tags_to_check.iter().map(|it| it.0.len()).max().unwrap_or(0);
        // Two quotes, and a byte more than any tag has.
        let params_to_check = collect_params(func, self.use_default_object_properties, longest_name + 3);
        let names: FxHashSet<&[u8]> = tags_to_check.iter().map(|it| it.0).collect();
        // With a number for each name.
        let mut by_name_without_quotes: FxHashMap<Cow<[u8]>, (usize, SmallVec<[Tag; 1]>)> = FxHashMap::default();
        if params_to_check.iter().any(|it| matches!(it, ParamKind::Nested(_))) {
            for tag in &tags_to_check {
                let number = by_name_without_quotes.len();
                by_name_without_quotes.entry(without_quotes(tag.0)).or_insert_with(|| (number, SmallVec::new())).1.push(*tag);
            }
        }
        let mut shallow_tags = tags_to_check.iter().filter(|it| !strings::contains_char(it.0, b'.'));
        let is_skipped = |param: &ParamInfo| !self.check_rest_property && param.is_rest;
        let mut violations: Vec<Span> = Vec::new();
        for param in &params_to_check {
            // The n-th tag without a `.` is about the n-th parameter.
            let matched_param_tag = shallow_tags.next();
            match param {
                ParamKind::Single(param) => {
                    if !is_skipped(param) && !names.contains(&*param.name) {
                        violations.push(param.span);
                    }
                }
                ParamKind::Nested(params) => {
                    if !self.check_destructured_roots
                        || !self.check_destructured
                        || matched_param_tag.and_then(|it| it.1).is_some_and(|it| !self.is_checked_type(it))
                    {
                        continue;
                    }
                    let root_name = matched_param_tag.map_or(&b""[..], |it| it.0);
                    // The names of the tags whose type says that what is in it is not looked at.
                    let mut not_checking_names = Prefixes::default();
                    let mut seen_names: FxHashSet<usize> = FxHashSet::default();
                    for param in params.iter().filter(|it| !is_skipped(it)) {
                        let full_param_name = [root_name, &b"."[..], param.name.as_slice()].concat();
                        let tags = by_name_without_quotes.get(&*without_quotes(&full_param_name));
                        for &(name, r#type) in tags.filter(|it| seen_names.insert(it.0)).into_iter().flat_map(|it| &it.1) {
                            if r#type.is_some_and(|it| !self.is_checked_type(it)) {
                                not_checking_names.insert(name);
                            }
                        }
                        let is_in_unchecked = not_checking_names.has_start_of(&full_param_name);
                        if !is_in_unchecked && tags.is_none() {
                            violations.push(param.span);
                        }
                    }
                }
            }
        }
        if let Some((first, others)) = violations.split_first() {
            others.iter().fold(cx.report(*first, REQUIRE_PARAM), |report, span| report.label(*span, ""));
        }
    }
}
