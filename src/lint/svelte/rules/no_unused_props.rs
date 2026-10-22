use crate::conditions::{Condition, should_run};
use bun_lint::ast::svelte::{RUNES, SVELTE_GLOBALS, SvelteTag};
use bun_lint::ast::svelte::shared::{IgnoreWarning, IgnoreWarnings};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::{ObjectFlags, TsSymbol, Type, TypeFlags};
use rustc_hash::FxHashSet;

/// Warns about defined Props properties that are unused
pub struct NoUnusedProps {
    check_imported_types: bool,
    ignore_type_patterns: Vec<Box<[u8]>>,
    ignore_property_patterns: Vec<Box<[u8]>>,
    allow_unused_nested_properties: bool,
}

const UNUSED_PROP: Message = Message::new("unusedProp", "'{{name}}' is an unused Props property.");
const UNUSED_NESTED_PROP: Message =
    Message::new("unusedNestedProp", "'{{name}}' in '{{parent}}' is an unused property.");
const UNUSED_INDEX_SIGNATURE: Message = Message::new(
    "unusedIndexSignature",
    "Index signature is unused. Consider using rest operator (...) to capture remaining properties.",
);

const CONDITIONS: &[Condition] = &[Condition {
    svelte_versions: &["5"],
    svelte_file_types: &[],
    runes: &[true],
    kit_file_types: &[],
    svelte_kit_versions: &[],
}];

const SELECTOR: &str = "VariableDeclaration > VariableDeclarator";

/// Bound the native recursion through nested property types, independently of JavaScript's stack limit.
const MAX_DEPTH: usize = 1000;

/// The options' patterns, with their regular expressions' state in this file, or what `new RegExp` threw.
pub struct State {
    patterns: Result<Patterns, Vec<u8>>,
}

struct Patterns {
    types: IgnoreWarnings,
    properties: IgnoreWarnings,
}

impl NoUnusedProps {
    fn patterns<'o>(options: &Options<'o>, name: &str) -> impl Iterator<Item = &'o [u8]> {
        let items = options.object(0).get(name).and_then(Json::as_array);
        items.unwrap_or_default().iter().filter_map(Json::as_str)
    }
}

/// A finding to report, in the order of the `context.report` calls.
enum Found<'a> {
    Prop(&'a [u8]),
    Nested(&'a [u8], Vec<u8>),
    IndexSignature,
}

/// What `checkUnusedProperties` shares across its recursion for one declarator.
struct Check<'a, 'r> {
    rule: &'r NoUnusedProps,
    patterns: &'r Patterns,
    /// `usedPropertyPaths` and `usedSpreadPropertyPaths`, each path joined by `.`.
    used: Vec<Vec<u8>>,
    spread: Vec<Vec<u8>>,
    /// The `originalName` of each of `declaredPropertyNames`.
    declared: Vec<&'a [u8]>,
    /// `checkedPropsTypes`, by `typeToString` as TypeScript 6 prints.
    checked: FxHashSet<Vec<u8>>,
    reported: FxHashSet<Vec<u8>>,
    found: Vec<Found<'a>>,
}

/// The nested-property traversal reached its recursion guard.
struct TooDeep;

impl<'a> Check<'a, '_> {
    /// `checkUnusedProperties`
    fn check(&mut self, ty: Type<'a>, parent: &[&'a [u8]]) -> Result<(), TooDeep> {
        if parent.len() > MAX_DEPTH {
            return Err(TooDeep);
        }
        if is_class_type(ty) {
            return Ok(());
        }
        let text = ty.to_text_in_insertion_order();
        if self.checked.contains(&text) {
            return Ok(());
        }
        let is_ignored = self.ignores_type(ty, &text);
        self.checked.insert(text);
        if is_ignored {
            return Ok(());
        }
        let properties = ty.get_properties_in_insertion_order();
        let bases = ty.get_base_types();
        if properties.is_empty() && bases.is_empty() {
            return Ok(());
        }
        for base in bases.iter() {
            self.check(base, parent)?;
        }
        for property in properties.iter() {
            if is_built_in(property) || !self.rule.check_imported_types && !is_internal(property) {
                continue;
            }
            let name = property.name();
            if self.patterns.properties.test(name) {
                continue;
            }
            let path = joined(parent.iter().copied().chain([name]));
            if self.reported.contains(&path) {
                continue;
            }
            let below = [&path[..], b"."].concat();
            let is_used_here = self.used.contains(&path)
                || (self.spread.iter())
                    .any(|it| it.is_empty() || *it == path || it.starts_with(&below));
            let is_used_below = self.used.iter().any(|it| it.starts_with(&below));
            if is_used_here && !is_used_below {
                continue;
            }
            let is_declared = self.declared.contains(&name);
            if !is_used_below && !is_declared {
                self.found.push(match parent.is_empty() {
                    true => Found::Prop(name),
                    false => Found::Nested(name, joined(parent.iter().copied())),
                });
                self.reported.insert(path);
                continue;
            }
            let nested: Vec<&'a [u8]> = parent.iter().copied().chain([name]).collect();
            self.check(property.get_type(), &nested)?;
        }
        if parent.is_empty() {
            let is_typed = |it: Option<Type<'a>>| it.is_some_and(|it| !it.has_flags(TypeFlags::ANY));
            let has_index_signature =
                is_typed(ty.get_string_index_type()) || is_typed(ty.get_number_index_type());
            if has_index_signature && !self.declared.is_empty() {
                self.found.push(Found::IndexSignature);
            }
        }
        Ok(())
    }

    /// `shouldIgnoreType`
    fn ignores_type(&self, ty: Type<'a>, text: &[u8]) -> bool {
        let types = &self.patterns.types;
        types.test(text)
            || ty
                .get_symbol()
                .is_some_and(|it| !it.name().is_empty() && types.test(it.name()))
    }
}

/// `isClassType`
fn is_class_type(ty: Type<'_>) -> bool {
    ty.object_flags().contains(ObjectFlags::CLASS)
        || !ty.get_construct_signatures().is_empty()
        || ty
            .get_symbol()
            .is_some_and(|it| it.members().iter().any(|it| it.name() == b"prototype"))
}

/// `isBuiltInProperty`: true if its first declaration is in a TypeScript library.
fn is_built_in(property: TsSymbol<'_>) -> bool {
    let first = property.declarations().next();
    first.is_some_and(|it| it.get_source_file().is_default_library())
}

/// `isInternalProperty`: true if it's declared, and only in the component.
fn is_internal(property: TsSymbol<'_>) -> bool {
    let mut declarations = property.declarations();
    declarations.len() > 0 && declarations.all(|it| it.get_source_file().is_linted_file())
}

fn joined<'a>(parts: impl Iterator<Item = &'a [u8]>) -> Vec<u8> {
    let mut out = Vec::new();
    for (part, at) in parts.zip(0..) {
        if at > 0 {
            out.push(b'.');
        }
        out.extend_from_slice(part);
    }
    out
}

/// `getUsedNestedPropertyPathsArray`: adds the paths of the properties read from the variable that `binding` declares,
/// each after `prefix`, to `used`, and the spread ones to `spread`.
fn used_paths<'a>(
    binding: Pat<'a>,
    prefix: Option<&'a [u8]>,
    used: &mut Vec<Vec<&'a [u8]>>,
    spread: &mut Vec<Vec<&'a [u8]>>,
) {
    let file = binding.file();
    let Some(symbol) = binding.symbol() else {
        return;
    };
    let view = file.view();
    let is_seen = |e: &Expr<'_>| view.is_none_or(|it| !it.hides(e.span().start));
    let declared_at = binding.span().start;
    let mut references: Vec<Expr<'a>> = (symbol.references())
        .filter_map(|it| it.expr())
        .filter(|it| it.span().start != declared_at && is_seen(it))
        .collect();
    // `analyzeStoreScope`: svelte-eslint-parser has each `$x` that isn't a Svelte global as a reference to `x`. The
    // program declares `$x` in glue.
    let store = [&b"$"[..], symbol.name().bytes()].concat();
    let is_synthesized = |it: &Symbol<'a>| {
        (it.declarations().filter_map(|it| it.name_span()))
            .all(|it| view.is_some_and(|view| view.hides(it.start)))
    };
    // `getGlobalsForSvelte` with runes, where the rule runs.
    let is_global = SVELTE_GLOBALS.iter().chain(&RUNES).any(|it| it.as_bytes() == store);
    let is_store = !is_global && symbol.scope() == file.top_level_scope();
    let store_symbol = is_store.then(|| file.top_level_scope().get_bytes(&store)).flatten();
    if let Some(store_symbol) = store_symbol.filter(is_synthesized) {
        let more = store_symbol.references().filter_map(|it| it.expr());
        references.extend(more.filter(is_seen));
    }
    for reference in references {
        let (path, is_spread) = property_path(reference);
        let path = prefix.into_iter().chain(path).collect();
        match is_spread {
            true => spread.push(path),
            false => used.push(path),
        }
    }
}

/// `getPropertyPath`: the names of the members read from `e`, each from the previous one, and whether the result is
/// spread.
fn property_path<'a>(e: Expr<'a>) -> (Vec<&'a [u8]>, bool) {
    // ESLint has `TSQualifiedName` here, not `MemberExpression`. Keep the reference's empty path.
    if e.is_in_type_query() {
        return (Vec::new(), false);
    }
    let file = e.file();
    let mut path = Vec::new();
    let mut current = e;
    loop {
        // ESLint has a `ChainExpression` around it.
        if current != e && current.is_chain_root() {
            return (path, false);
        }
        // Its parent is a component node.
        if let Some((owner, code)) = file.svelte_owner(Node::Expr(current))
            && code.node() == Some(Node::Expr(current))
        {
            return (path, owner.tag() == SvelteTag::SpreadAttribute);
        }
        let parent = match Node::Expr(current).parent() {
            Node::Expr(parent) => parent,
            Node::Prop(prop) => return (path, prop.kind() == PropKind::Spread),
            _ => return (path, false),
        };
        match parent.kind() {
            ExprKind::Dot { obj, name, .. } if obj == current => {
                if !name.bytes().starts_with(b"#") {
                    path.push(name.bytes());
                }
            }
            ExprKind::Index { obj, index, .. } if obj == current => match index.kind() {
                ExprKind::Ident(name) | ExprKind::String(name) => path.push(name.bytes()),
                _ => {}
            },
            ExprKind::Spread(_) => return (path, true),
            _ => return (path, false),
        }
        current = parent;
    }
}

/// `normalizeUsedPaths`, each path joined by `.`: without the paths that a shorter one is a prefix of.
fn normalized(mut paths: Vec<Vec<&[u8]>>, allow_unused_nested: bool) -> Vec<Vec<u8>> {
    bun_lint::utils::sort::sort_by_key(&mut paths, Vec::len);
    let mut kept: Vec<Vec<&[u8]>> = Vec::new();
    for path in paths {
        let starts = |it: &Vec<&[u8]>| it.len() <= path.len() && it.iter().zip(&path).all(|(a, b)| a == b);
        if !kept.iter().any(starts) {
            kept.push(path);
        }
    }
    let join = |it: &Vec<&[u8]>| match allow_unused_nested {
        true => it.first().map(|it| it.to_vec()).unwrap_or_default(),
        false => joined(it.iter().copied()),
    };
    kept.iter().map(join).collect()
}

/// `getUsedPropertyNamesFromPattern`: the `originalName` of each property in the pattern `props`, and the binding of
/// each one that binds a name. `None` if a rest element takes all the others.
fn declared_names<'a>(props: List<'a, PatProp<'a>>) -> Option<(Vec<&'a [u8]>, Vec<Pat<'a>>)> {
    let mut names = Vec::new();
    let mut bindings = Vec::new();
    for prop in props.iter() {
        let key = prop.key()?;
        let value = prop.value();
        let is_name = value.as_ident().is_some();
        // ESLint's `value` is an `Identifier`, not an `AssignmentPattern`.
        let is_plain_name = is_name && prop.default().is_none();
        let original = match key.kind() {
            KeyKind::Ident(name) => Some(name.bytes()),
            KeyKind::Computed(e) => e.as_ident().map(|it| it.bytes()),
            KeyKind::String(name) => is_plain_name.then_some(name.bytes()),
            // `["a"]`, which ESLint has as a `Literal`, not `` [`a`] ``.
            KeyKind::ComputedString(name) => {
                let key = prop.computed_key();
                let is_literal = key.is_some_and(|it| matches!(it.kind(), ExprKind::String(_)));
                (is_literal && is_plain_name).then_some(name.bytes())
            }
            _ => None,
        };
        names.extend(original);
        if is_name {
            bindings.push(value);
        }
    }
    Some((names, bindings))
}

impl Rule for NoUnusedProps {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-unused-props", Kind::Suggestion)
        .recommended()
        .uses_types();
    const ON: On = On::new().var_decls().finish();
    type State<'a> = State;

    fn new(options: &Options) -> Self {
        let flag = |name: &str| options.object(0).bool(name).unwrap_or(false);
        let patterns = |name: &str| Self::patterns(options, name).map(Into::into).collect();
        NoUnusedProps {
            check_imported_types: flag("checkImportedTypes"),
            ignore_type_patterns: patterns("ignoreTypePatterns"),
            ignore_property_patterns: patterns("ignorePropertyPatterns"),
            allow_unused_nested_properties: flag("allowUnusedNestedProperties"),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State> {
        if file.svelte().is_none() || file.types().is_none() || !should_run(file, CONDITIONS) {
            return None;
        }
        let compile = |patterns: &[Box<[u8]>]| -> Result<IgnoreWarnings, Vec<u8>> {
            let all = patterns.iter().map(|it| IgnoreWarning::of(it));
            Ok(IgnoreWarnings(all.collect::<Result<_, _>>()?))
        };
        let patterns = compile(&self.ignore_type_patterns).and_then(|types| {
            let properties = compile(&self.ignore_property_patterns)?;
            Ok(Patterns { types, properties })
        });
        Some(State { patterns })
    }

    fn var_decl<'a>(&self, declarator: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let Ok(patterns) = &cx.state.patterns else {
            return;
        };
        // `$props?.()` is a `ChainExpression`.
        let init = (declarator.init()).filter(|it| !it.is_chain_root()).and_then(|it| it.as_call());
        let is_props = init.is_some_and(|it| it.callee().as_ident().is_some_and(|it| it.is("$props")));
        let is_declaration =
            matches!(declarator.parent(), Node::Stmt(it) if matches!(it.kind(), StmtKind::Var(_)));
        let (true, true, Some(annotation)) = (is_props, is_declaration, declarator.ty()) else {
            return;
        };
        let pat = declarator.pat();
        let (mut used, mut spread) = (Vec::new(), Vec::new());
        let declared = match pat.kind() {
            PatKind::Object(props) => {
                let Some((declared, bindings)) = declared_names(props) else {
                    return;
                };
                if declared.is_empty() {
                    return;
                }
                for binding in bindings {
                    let name = binding.as_ident().map(|it| it.bytes());
                    used_paths(binding, name, &mut used, &mut spread);
                }
                declared
            }
            PatKind::Ident(_) => {
                used_paths(pat, None, &mut used, &mut spread);
                Vec::new()
            }
            _ => Vec::new(),
        };
        let allow = self.allow_unused_nested_properties;
        let mut check = Check {
            rule: self,
            patterns,
            used: normalized(used, allow),
            spread: normalized(spread, allow),
            declared,
            checked: FxHashSet::default(),
            reported: FxHashSet::default(),
            found: Vec::new(),
        };
        let at = declarator.binding_span();
        if check.check(annotation.ty(), &[]).is_err() {
            cx.throw(at, "RangeError", "Maximum call stack size exceeded");
            return;
        }
        for found in check.found {
            let report = match found {
                Found::Prop(name) => cx.report(at, UNUSED_PROP).data("name", name),
                Found::Nested(name, parent) => {
                    (cx.report(at, UNUSED_NESTED_PROP).data("name", name)).data("parent", parent)
                }
                Found::IndexSignature => cx.report(at, UNUSED_INDEX_SIGNATURE),
            };
            report.listened_on(declarator).by_selector(SELECTOR);
        }
    }

    /// Upstream compiles the options' patterns when it's created for a file with types.
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        if let Err(message) = &cx.state.patterns {
            cx.throw_on_creation(message.clone());
        }
    }
}
