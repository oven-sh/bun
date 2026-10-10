use bun_lint_oxlint::ast_util::is_react_component_name;
use crate::jsx::get_jsx_element_name;
use crate::react::is_jsx;
use bun_lint_oxlint::text::glob_match;
use bun_core::strings;
use bun_glob::{Options as GlobOptions, Pattern};
use bun_lint::context::interpolate_text;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use std::borrow::Cow;

type Names = Vec<Box<[u8]>>;

/// A text of the options that can be a pattern.
struct Glob {
    written: Box<[u8]>,
    minimatch: Pattern,
}

struct ForbidOption {
    /// The name of the prop, or a pattern for it.
    key: Glob,
    is_pattern: bool,
    allowed_for: Names,
    allowed_for_patterns: Vec<Glob>,
    disallowed_for: Names,
    disallowed_for_patterns: Vec<Glob>,
    message: Option<Box<[u8]>>,
}

/// Disallow certain props on components.
pub struct ForbidComponentProps {
    forbid: Vec<ForbidOption>,
    /// Upstream's `Map`, as places in `forbid`: a key stays where it came first, with what came last.
    map: Vec<usize>,
    /// `forbid: []`
    is_empty_list: bool,
}

const PROP_IS_FORBIDDEN: Message = Message::new("propIsForbidden", "Prop \"{{prop}}\" is forbidden on Components");
const CUSTOM: Message = Message::new("", "{{message}}");
const FORBID_COMPONENT_PROPS: Message = Message::new("", "Prop \"{{prop}}\" is forbidden on Components");

impl Rule for ForbidComponentProps {
    const META: Meta = Meta::plugin(Plugin::React, "forbid-component-props", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    /// `{ forbid: ["a", { propName | propNamePattern, allowedFor, allowedForPatterns, disallowedFor,
    /// disallowedForPatterns, message }] }`
    fn new(options: &Options) -> Self {
        let item = |item: &Json| {
            if let Some(name) = item.as_str() {
                return Some(ForbidOption::new(name, false));
            }
            let list = |key: &[u8]| {
                item.get(key).and_then(Json::as_array).unwrap_or_default().iter().filter_map(Json::as_str)
            };
            let prop_name = item.get(b"propName").and_then(Json::as_str);
            let key = prop_name.or_else(|| item.get(b"propNamePattern")?.as_str())?;
            Some(ForbidOption {
                allowed_for: list(b"allowedFor").map(Box::from).collect(),
                allowed_for_patterns: list(b"allowedForPatterns").map(Glob::new).collect(),
                disallowed_for: list(b"disallowedFor").map(Box::from).collect(),
                disallowed_for_patterns: list(b"disallowedForPatterns").map(Glob::new).collect(),
                message: item.get(b"message").and_then(Json::as_str).map(Box::from),
                ..ForbidOption::new(key, prop_name.is_none())
            })
        };
        let configuration = options.object(0);
        let mut forbid: Vec<ForbidOption> = configuration.array("forbid").iter().filter_map(item).collect();
        let is_empty_list = forbid.is_empty() && configuration.has("forbid");
        if forbid.is_empty() {
            forbid.extend([ForbidOption::new(b"className", false), ForbidOption::new(b"style", false)]);
        }
        let mut map: Vec<usize> = Vec::new();
        {
            let mut places: FxHashMap<&[u8], usize> = FxHashMap::default();
            for (at, it) in forbid.iter().enumerate() {
                let next = map.len();
                let place = *places.entry(&it.key.written).or_insert(next);
                match map.get_mut(place) {
                    Some(last) => *last = at,
                    None => map.push(at),
                }
            }
        }
        ForbidComponentProps { forbid, map, is_empty_list }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // oxlint takes an empty list for none.
        let has_work = if file.language().is_oxlint { is_jsx(file) } else { !self.is_empty_list };
        has_work.then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        if jsx.attrs().is_empty() || !jsx.tag().is_some_and(|name| is_component(name, is_oxlint)) {
            return;
        }
        let mut tag = None;
        for attribute in jsx.attrs().iter().filter(|it| it.kind() != PropKind::Spread) {
            let Some((key, name)) = attribute.key().and_then(|key| Some((key, key.name()?.bytes()))) else {
                continue;
            };
            let prop_name = match strings::split_once_char(name, b':') {
                None => name,
                // Of `a:b` it is `b` for oxlint. Upstream finds no text there.
                Some(it) if is_oxlint => it.1,
                Some(_) => continue,
            };
            let Some(option) = self.get_prop_options(prop_name, is_oxlint) else {
                continue;
            };
            if !option.is_forbidden(tag.get_or_insert_with(|| tag_of(jsx, is_oxlint)).as_deref(), is_oxlint) {
                continue;
            }
            // oxlint points at the name.
            let span = if is_oxlint { key.span(cx.file()) } else { attribute.span() };
            match option.message.as_deref().filter(|it| is_oxlint || !it.is_empty()) {
                Some(message) if is_oxlint => cx.report(span, CUSTOM).data("message", message.to_vec()),
                Some(message) => cx.report(span, CUSTOM).data("message", custom_message(message, prop_name)),
                None if is_oxlint => cx.report(span, FORBID_COMPONENT_PROPS).data("prop", prop_name),
                None => cx.report(span, PROP_IS_FORBIDDEN).data("prop", prop_name),
            };
        }
    }
}

impl ForbidComponentProps {
    /// `getPropOptions`
    fn get_prop_options(&self, prop: &[u8], is_oxlint: bool) -> Option<&ForbidOption> {
        let is_named = |it: &&ForbidOption| *it.key.written == *prop;
        let matches = |it: &&ForbidOption| it.is_pattern && it.key.matches(prop, is_oxlint);
        // For oxlint the first that matches counts, a name or a pattern.
        if is_oxlint {
            return self.forbid.iter().find(|it| if it.is_pattern { matches(it) } else { is_named(it) });
        }
        let entries = || self.map.iter().filter_map(|at| self.forbid.get(*at));
        entries().find(is_named).or_else(|| entries().find(matches))
    }
}

impl Glob {
    fn new(written: &[u8]) -> Glob {
        Glob { written: written.into(), minimatch: Pattern::new(written, GlobOptions::MINIMATCH_3) }
    }

    fn matches(&self, name: &[u8], is_oxlint: bool) -> bool {
        // oxlint has the crate `fast-glob`.
        if is_oxlint { glob_match(&self.written, name) } else { self.minimatch.matches(name) }
    }
}

impl ForbidOption {
    fn new(key: &[u8], is_pattern: bool) -> ForbidOption {
        ForbidOption {
            key: Glob::new(key),
            is_pattern,
            allowed_for: Vec::new(),
            allowed_for_patterns: Vec::new(),
            disallowed_for: Vec::new(),
            disallowed_for_patterns: Vec::new(),
            message: None,
        }
    }

    /// `tag` is `None` for what is like no text.
    fn is_forbidden(&self, tag: Option<&[u8]>, is_oxlint: bool) -> bool {
        let is_in = |names: &Names| tag.is_some_and(|tag| names.iter().any(|it| **it == *tag));
        let matches_any =
            |patterns: &[Glob]| tag.is_some_and(|tag| patterns.iter().any(|it| it.matches(tag, is_oxlint)));
        if self.disallowed_for.is_empty() && self.disallowed_for_patterns.is_empty() {
            !is_in(&self.allowed_for) && !matches_any(&self.allowed_for_patterns)
        } else {
            is_in(&self.disallowed_for) || matches_any(&self.disallowed_for_patterns)
        }
    }
}

/// Whether the element with that name is a component.
fn is_component(name: Expr<'_>, is_oxlint: bool) -> bool {
    // oxlint asks for a capital of ASCII.
    if is_oxlint {
        return get_component_name(name).is_some_and(is_react_component_name);
    }
    // `componentName[0] !== componentName[0].toUpperCase()`. Half of a surrogate pair has no case.
    let is_dom_node = |name: &[u8]| {
        let (first, size) = strings::wtf8_codepoint_at(name, 0);
        first <= 0xFFFF && name.get(..size).is_some_and(|it| !text::is_upper_case(it))
    };
    match name.kind() {
        // Upstream finds no text there.
        ExprKind::String(name) if strings::contains_char(name.bytes(), b':') => true,
        _ => get_component_name(name).is_some_and(|it| !is_dom_node(it)),
    }
}

/// What the lists of the options are asked for.
fn tag_of(jsx: Jsx<'_>, is_oxlint: bool) -> Option<Cow<'_, [u8]>> {
    match jsx.tag()?.kind() {
        // Upstream has a node for `<a:b>`,
        ExprKind::String(name) if !is_oxlint && strings::contains_char(name.bytes(), b':') => None,
        // and reads the `name` of an `object` that has none.
        ExprKind::Dot { obj, name, .. } if !is_oxlint && obj.tag() == ExprTag::Dot => {
            Some(Cow::Owned([&b"undefined."[..], name.bytes()].concat()))
        }
        _ => Some(get_jsx_element_name(jsx)),
    }
}

/// ESLint puts `data` into a text of the options as well.
#[cold]
fn custom_message(message: &[u8], prop: &[u8]) -> Vec<u8> {
    match std::str::from_utf8(message) {
        Ok(message) => interpolate_text(message, |name| (name == "prop").then_some(prop)),
        Err(_) => message.to_vec(),
    }
}

/// The last name of the name of an element: by it one sees whether it is a component.
fn get_component_name(name: Expr<'_>) -> Option<&[u8]> {
    match name.kind() {
        ExprKind::Ident(name) => Some(name.bytes()),
        ExprKind::String(name) => {
            Some(strings::split_once_char(name.bytes(), b':').map_or_else(|| name.bytes(), |it| it.1))
        }
        ExprKind::Dot { name, .. } => Some(name.bytes()),
        _ => None,
    }
}
