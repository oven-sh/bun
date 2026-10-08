//! ESLint's `lib/shared/naming.js`.

use super::text::has_line_break;
use bun_core::strings;
use std::borrow::Cow;

/// `name` is `prefix`, or starts with `prefix-`.
fn has_prefix(name: &[u8], prefix: &[u8]) -> bool {
    matches!(name.strip_prefix(prefix), Some([] | [b'-', ..]))
}

/// ESLint's `normalizePackageName`. `foo` becomes `eslint-plugin-foo` and `@scope/foo` becomes
/// `@scope/eslint-plugin-foo`, for the `prefix` `eslint-plugin`.
pub fn normalize_package_name<'t>(name: &'t [u8], prefix: &[u8]) -> Cow<'t, [u8]> {
    let name = match strings::contains_char(name, b'\\') {
        true => Cow::Owned(
            name.iter()
                .map(|&c| if c == b'\\' { b'/' } else { c })
                .collect(),
        ),
        false => Cow::Borrowed(name),
    };
    if name.first() != Some(&b'@') {
        return match name.strip_prefix(prefix) {
            Some([b'-', ..]) => name,
            _ => Cow::Owned([prefix, b"-", &name].concat()),
        };
    }
    let (scope, rest) = match strings::index_of_char_usize(&name, b'/') {
        Some(slash) => (&name[..slash], Some(&name[slash + 1..])),
        None => (&name[..], None),
    };
    if scope.len() == 1 {
        return name;
    }
    match rest {
        Some(rest) if !rest.is_empty() && rest != prefix => {
            let package = &rest[..strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len())];
            if has_prefix(package, prefix) || has_line_break(rest) {
                return name;
            }
            Cow::Owned([scope, b"/", prefix, b"-", rest].concat())
        }
        _ => Cow::Owned([scope, b"/", prefix].concat()),
    }
}

/// ESLint's `getShorthandName`. `eslint-plugin-foo` becomes `foo`, `@scope/eslint-plugin-foo`
/// becomes `@scope/foo` and `@scope/eslint-plugin` becomes `@scope`, for the `prefix`
/// `eslint-plugin`.
pub fn get_shorthand_name<'t>(fullname: &'t [u8], prefix: &[u8]) -> Cow<'t, [u8]> {
    if fullname.first() != Some(&b'@') {
        return Cow::Borrowed(match fullname.strip_prefix(prefix) {
            Some([b'-', rest @ ..]) => rest,
            _ => fullname,
        });
    }
    let Some(slash @ 2..) = strings::index_of_char_usize(fullname, b'/') else {
        return Cow::Borrowed(fullname);
    };
    let scope = &fullname[..slash];
    match fullname[slash + 1..].strip_prefix(prefix) {
        Some([]) => Cow::Borrowed(scope),
        Some([b'-', rest @ ..]) if !rest.is_empty() && !has_line_break(rest) => {
            Cow::Owned([scope, b"/", rest].concat())
        }
        _ => Cow::Borrowed(fullname),
    }
}

/// ESLint's `getNamespaceFromTerm`. The `@scope/` of `@scope/foo`, empty if there is none.
pub fn get_namespace_from_term(term: &[u8]) -> &[u8] {
    if term.first() != Some(&b'@') {
        return &[];
    }
    let line = super::text::lines(term).next().unwrap_or_default();
    match strings::last_index_of_char(line, b'/') {
        Some(slash) => &term[..=slash],
        None => &[],
    }
}
