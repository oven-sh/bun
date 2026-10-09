use bun_lint_oxlint::ast_util::get_identifier_name;
use crate::jsx::get_prop_value;
use crate::react::{get_component_attrs_by_name, is_jsx, link_components};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow usage of `javascript:` URLs.
pub struct JsxNoScriptUrl {
    include_from_settings: bool,
    /// The name of a component, and its props that are URLs. The last of a name counts.
    components: Vec<(Box<[u8]>, Vec<Box<[u8]>>)>,
}

const JSX_NO_SCRIPT_URL: Message = Message::new("", "React 19 disallows `javascript:` URLs as a security precaution.");

impl Rule for JsxNoScriptUrl {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-no-script-url", Kind::Problem);
    /// `settings.react.linkComponents`
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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !is_jsx(file) {
            return &[];
        }
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            let Some(component_name) = get_identifier_name(jsx).map(Name::bytes) else {
                return;
            };
            let link_props = rule.components.iter().rev().find(|it| *it.0 == *component_name).map(|it| &it.1);
            let of_settings = || get_component_attrs_by_name(cx.state, component_name);
            if link_props.is_none()
                && component_name != b"a"
                && !(rule.include_from_settings && of_settings().is_some())
            {
                return;
            }
            for attribute in jsx.attrs().iter().filter(|it| it.kind() != PropKind::Spread) {
                // Nothing after an attribute without a value is looked at.
                let Some(prop_value) = get_prop_value(attribute) else {
                    return;
                };
                let Some(name) = attribute.key().and_then(Key::name).map(Name::bytes) else {
                    continue;
                };
                if !prop_value.as_string_literal().is_some_and(|it| is_script_url(it.value)) {
                    continue;
                }
                // The `b` of `a:b`
                let name = strings::rsplit_once_char(name, b':').map_or(name, |it| it.1);
                let is_link_attribute = match link_props {
                    Some(link_props) => link_props.iter().any(|it| **it == *name),
                    None => component_name == b"a" || of_settings().is_some_and(|it| it.contains(name)),
                };
                if is_link_attribute {
                    cx.report(attribute, JSX_NO_SCRIPT_URL);
                }
            }
        });
        link_components(file)
    }
}

/// `/j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i`
fn is_script_url(value: &[u8]) -> bool {
    let mut rest = value;
    while let Some(start) = strings::index_of_any(rest, b"jJ") {
        rest = rest.get(start + 1..).unwrap_or_default();
        let mut letters = rest.iter().filter(|it| !matches!(it, b'\r' | b'\n' | b'\t'));
        if b"avascript:".iter().all(|letter| letters.next().is_some_and(|it| it.eq_ignore_ascii_case(letter))) {
            return true;
        }
    }
    false
}
