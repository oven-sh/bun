use crate::jsx::get_jsx_element_name;
use bun_lint_oxlint::text::glob_match;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce PascalCase for user-defined JSX components.
pub struct JsxPascalCase {
    allow_all_caps: bool,
    allow_namespace: bool,
    allow_leading_underscore: bool,
    ignore: Vec<Box<[u8]>>,
}

const PASCAL_CASE: Message = Message::new("", "JSX component {{component_name}} must be in PascalCase");
const PASCAL_CASE_OR_ALL_CAPS: Message =
    Message::new("", "JSX component {{component_name}} must be in PascalCase or SCREAMING_SNAKE_CASE");

impl Rule for JsxPascalCase {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-pascal-case", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        JsxPascalCase {
            allow_all_caps: options.bool_or("allowAllCaps", false),
            allow_namespace: options.bool_or("allowNamespace", false),
            allow_leading_underscore: options.bool_or("allowLeadingUnderscore", false),
            ignore: options.strings("ignore").into_iter().map(|it| it.as_bytes().into()).collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            let separator: &[u8] = match jsx.tag().map(Expr::tag) {
                Some(ExprTag::Ident | ExprTag::String) => b":",
                Some(ExprTag::Dot) => b".",
                _ => return,
            };
            let name = get_jsx_element_name(jsx);
            // Most are plain names in Pascal case.
            if chars(&name).next().is_none_or(char::is_lowercase) || name.len() > 1 && check_pascal_case(&name) {
                return;
            }
            let check_names = strings::split(&name, separator);
            for split_name in check_names {
                if split_name.len() == 1 {
                    return;
                }
                let check_name = match rule.allow_leading_underscore {
                    true => split_name.strip_prefix(b"_").unwrap_or(split_name),
                    false => split_name,
                };
                if !check_pascal_case(check_name)
                    && !(rule.allow_all_caps && check_all_caps(check_name))
                    && !rule.ignore.iter().any(|entry| **entry == *split_name || glob_match(entry, split_name))
                {
                    let message = if rule.allow_all_caps { PASCAL_CASE_OR_ALL_CAPS } else { PASCAL_CASE };
                    cx.report(jsx.opening_span(), message).data("component_name", split_name.to_vec());
                }
                // Only the first part is looked at.
                if rule.allow_namespace {
                    return;
                }
            }
        });
    }
}

fn chars(text: &[u8]) -> impl Iterator<Item = char> {
    text::code_points(text).filter_map(|it| char::from_u32(it.1))
}

/// The index of the last letter is taken to be the number of bytes less one.
fn check_all_caps(check_name: &[u8]) -> bool {
    chars(check_name).enumerate().all(|(idx, letter)| {
        letter.is_uppercase() || letter.is_ascii_digit() || letter == '_' && idx != 0 && idx + 1 != check_name.len()
    })
}

fn check_pascal_case(check_name: &[u8]) -> bool {
    let mut chars = chars(check_name);
    if !chars.next().is_some_and(char::is_uppercase) {
        return false;
    }
    let mut has_lower_or_digit = false;
    chars.all(|c| {
        has_lower_or_digit |= c.is_lowercase() || c.is_ascii_digit();
        c.is_alphanumeric()
    }) && has_lower_or_digit
}
