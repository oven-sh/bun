use bun_lint_oxlint::ast_util::is_react_component_name;
use crate::jsx::get_jsx_element_name;
use crate::react::is_jsx;
use bun_lint_oxlint::text::glob_match;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

type Names = Vec<Box<[u8]>>;

#[derive(Default)]
struct ForbidOption {
    /// The name of the prop, or a pattern for it.
    key: Box<[u8]>,
    is_pattern: bool,
    allowed_for: Names,
    allowed_for_patterns: Names,
    disallowed_for: Names,
    disallowed_for_patterns: Names,
    message: Option<Box<[u8]>>,
}

/// Disallow specific props on components.
pub struct ForbidComponentProps {
    /// The first that matches counts.
    forbid: Vec<ForbidOption>,
}

const CUSTOM: Message = Message::new("", "{{message}}");
const FORBID_COMPONENT_PROPS: Message = Message::new("", "Prop \"{{prop}}\" is forbidden on Components");

impl Rule for ForbidComponentProps {
    const META: Meta = Meta::oxlint(Plugin::React, "forbid-component-props", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    /// `{ forbid: ["a", { propName | propNamePattern, allowedFor, allowedForPatterns, disallowedFor,
    /// disallowedForPatterns, message }] }`
    fn new(options: &Options) -> Self {
        let plain = |name: &[u8]| ForbidOption { key: name.into(), ..ForbidOption::default() };
        let item = |item: &Json| {
            if let Some(name) = item.as_str() {
                return Some(plain(name));
            }
            let names = |key: &[u8]| -> Names {
                item.get(key)
                    .and_then(Json::as_array)
                    .unwrap_or_default()
                    .iter()
                    .filter_map(Json::as_str)
                    .map(Box::from)
                    .collect()
            };
            let prop_name = item.get(b"propName").and_then(Json::as_str);
            Some(ForbidOption {
                key: prop_name.or_else(|| item.get(b"propNamePattern")?.as_str())?.into(),
                is_pattern: prop_name.is_none(),
                allowed_for: names(b"allowedFor"),
                allowed_for_patterns: names(b"allowedForPatterns"),
                disallowed_for: names(b"disallowedFor"),
                disallowed_for_patterns: names(b"disallowedForPatterns"),
                message: item.get(b"message").and_then(Json::as_str).map(Box::from),
            })
        };
        let mut forbid: Vec<ForbidOption> = options.object(0).array("forbid").iter().filter_map(item).collect();
        if forbid.is_empty() {
            forbid.extend([plain(b"className"), plain(b"style")]);
        }
        ForbidComponentProps { forbid }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        is_jsx(file).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        if jsx.attrs().is_empty() || !jsx.tag().and_then(get_component_name).is_some_and(is_react_component_name) {
            return;
        }
        let mut tag = None;
        for attribute in jsx.attrs().iter().filter(|it| it.kind() != PropKind::Spread) {
            let Some((key, name)) = attribute.key().and_then(|key| Some((key, key.name()?.bytes()))) else {
                continue;
            };
            // Of `a:b` it is `b`.
            let prop_name = strings::split_once_char(name, b':').map_or(name, |it| it.1);
            let matches = |it: &&ForbidOption| {
                if it.is_pattern { glob_match(&it.key, prop_name) } else { *it.key == *prop_name }
            };
            let Some(option) = self.forbid.iter().find(matches) else {
                continue;
            };
            if option.is_forbidden(tag.get_or_insert_with(|| get_jsx_element_name(jsx))) {
                let span = key.span(cx.file());
                match &option.message {
                    Some(message) => cx.report(span, CUSTOM).data("message", message.to_vec()),
                    None => cx.report(span, FORBID_COMPONENT_PROPS).data("prop", prop_name),
                };
            }
        }
    }
}

impl ForbidOption {
    fn is_forbidden(&self, tag: &[u8]) -> bool {
        let is_in = |names: &Names| names.iter().any(|it| **it == *tag);
        let matches_any = |patterns: &Names| patterns.iter().any(|it| glob_match(it, tag));
        if self.disallowed_for.is_empty() && self.disallowed_for_patterns.is_empty() {
            !is_in(&self.allowed_for) && !matches_any(&self.allowed_for_patterns)
        } else {
            is_in(&self.disallowed_for) || matches_any(&self.disallowed_for_patterns)
        }
    }
}

/// The last name of the name of an element: by it one sees whether it is a component.
fn get_component_name(name: Expr<'_>) -> Option<&[u8]> {
    match name.kind() {
        ExprKind::Ident(name) => Some(name.bytes()),
        ExprKind::String(name) => Some(strings::split_once_char(name.bytes(), b':').map_or_else(|| name.bytes(), |it| it.1)),
        ExprKind::Dot { name, .. } => Some(name.bytes()),
        _ => None,
    }
}
