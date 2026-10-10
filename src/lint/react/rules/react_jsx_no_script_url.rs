use bun_lint_oxlint::ast_util::get_identifier_name;
use crate::jsx::get_prop_value;
use crate::react::{get_component_attrs_by_name, is_jsx, link_components};
use crate::util_link_components::get_link_component;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow usage of `javascript:` URLs
pub struct JsxNoScriptUrl {
    include_from_settings: bool,
    /// The name of a component, and its props that are URLs. The last of a name counts.
    components: Vec<(Box<[u8]>, Vec<Box<[u8]>>)>,
}

const NO_SCRIPT_URL: Message = Message::new(
    "noScriptURL",
    "A future version of React will block javascript: URLs as a security precaution. Use event handlers instead if you can. If you need to generate unsafe HTML, try using dangerouslySetInnerHTML instead.",
);
const JSX_NO_SCRIPT_URL: Message = Message::new("", "React 19 disallows `javascript:` URLs as a security precaution.");

impl Rule for JsxNoScriptUrl {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-no-script-url", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    /// `settings.react.linkComponents`, where oxlint has them.
    type State<'a> = &'a [Json];

    /// `[components, options]`, or one of the two.
    fn new(options: &Options) -> Self {
        let components = options.all().iter().find_map(Json::as_array).unwrap_or_default();
        let component = |it: &Json| {
            let props = it.get(b"props")?.as_array()?.iter().filter_map(Json::as_str).map(Box::from).collect();
            Some((Box::from(it.get(b"name")?.as_str()?), props))
        };
        JsxNoScriptUrl {
            include_from_settings: options.first_object().bool_or("includeFromSettings", false),
            components: components.iter().filter_map(component).collect(),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if file.language().is_oxlint && !is_jsx(file) {
            return None;
        }
        Some(link_components(file))
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let component_name = match jsx.tag().map(Expr::tag) {
            // oxlint has no name for it.
            Some(ExprTag::This) if !is_oxlint => Some(b"this".as_slice()),
            _ => get_identifier_name(jsx).map(Name::bytes),
        };
        let Some(component_name) = component_name else {
            return;
        };
        let link_props = self.components.iter().rev().find(|it| *it.0 == *component_name).map(|it| &it.1);
        let include_from_settings = self.include_from_settings && link_props.is_none();
        // oxlint has the components under `settings.react`, and `<a>` whatever is there.
        let of_oxlint_settings =
            || get_component_attrs_by_name(cx.state, component_name).filter(|_| include_from_settings && is_oxlint);
        let of_settings = if include_from_settings && !is_oxlint {
            get_link_component(cx.file(), component_name)
        } else {
            None
        };
        let is_a = component_name == b"a" && (is_oxlint || !include_from_settings);
        if link_props.is_none() && !is_a && of_settings.is_none() && of_oxlint_settings().is_none() {
            return;
        }
        for attribute in jsx.attrs().iter().filter(|it| it.kind() != PropKind::Spread) {
            let Some(prop_value) = get_prop_value(attribute) else {
                // oxlint looks at nothing after an attribute without a value.
                if is_oxlint {
                    return;
                }
                continue;
            };
            let Some(name) = attribute.key().and_then(Key::name).map(Name::bytes) else {
                continue;
            };
            let Some(literal) = prop_value.as_string_literal() else {
                continue;
            };
            // oxlint reads `&#58;` as it is written.
            let decoded = attribute.value().and_then(Expr::as_string).filter(|_| !is_oxlint);
            if !is_script_url(decoded.map_or(literal.value, Name::bytes), is_oxlint) {
                continue;
            }
            let name = match strings::rsplit_once_char(name, b':') {
                // For oxlint it is the `b` of `a:b`.
                Some((_, local)) if is_oxlint => local,
                Some(_) => continue,
                None => name,
            };
            let is_link_attribute = match (link_props, &of_settings) {
                (Some(link_props), _) => link_props.iter().any(|it| **it == *name),
                (None, Some(of_settings)) => of_settings.contains(&name),
                // oxlint means every attribute of `<a>`.
                (None, None) if is_a => is_oxlint || name == b"href",
                (None, None) => of_oxlint_settings().is_some_and(|it| it.contains(name)),
            };
            if is_link_attribute {
                cx.report(attribute, if is_oxlint { JSX_NO_SCRIPT_URL } else { NO_SCRIPT_URL });
            }
        }
    }
}

/// `/^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i`
/// oxlint's begins at the `j`, which can be anywhere.
fn is_script_url(value: &[u8], is_oxlint: bool) -> bool {
    let is_after_j = |rest: &[u8]| {
        let mut letters = rest.iter().filter(|it| !matches!(it, b'\r' | b'\n' | b'\t'));
        b"avascript:".iter().all(|letter| letters.next().is_some_and(|it| it.eq_ignore_ascii_case(letter)))
    };
    if !is_oxlint {
        let blanks = value.iter().take_while(|it| **it <= b' ').count();
        return matches!(value.get(blanks..), Some([b'j' | b'J', rest @ ..]) if is_after_j(rest));
    }
    let mut rest = value;
    while let Some(start) = strings::index_of_any(rest, b"jJ") {
        rest = rest.get(start + 1..).unwrap_or_default();
        if is_after_j(rest) {
            return true;
        }
    }
    false
}
