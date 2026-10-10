use crate::jsx::get_jsx_element_name;
use crate::util_jsx::is_dom_component;
use bun_core::strings;
use bun_glob::{Options as GlobOptions, Pattern};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::text::glob_match;

/// Enforce PascalCase for user-defined JSX components
pub struct JsxPascalCase {
    allow_all_caps: bool,
    allow_namespace: bool,
    allow_leading_underscore: bool,
    ignore: Vec<Ignored>,
}

struct Ignored {
    entry: Box<[u8]>,
    minimatch: Pattern,
}

const USE_PASCAL_CASE: Message =
    Message::new("usePascalCase", "Imported JSX component {{name}} must be in PascalCase");
const USE_PASCAL_OR_SNAKE_CASE: Message = Message::new(
    "usePascalOrSnakeCase",
    "Imported JSX component {{name}} must be in PascalCase or SCREAMING_SNAKE_CASE",
);
const OXLINT_PASCAL_CASE: Message = Message::new("", "JSX component {{name}} must be in PascalCase");
const OXLINT_PASCAL_CASE_OR_ALL_CAPS: Message =
    Message::new("", "JSX component {{name}} must be in PascalCase or SCREAMING_SNAKE_CASE");

impl Rule for JsxPascalCase {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-pascal-case", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let ignored = |entry: &str| Ignored {
            entry: entry.as_bytes().into(),
            minimatch: Pattern::new(entry.as_bytes(), GlobOptions { noglobstar: true, ..GlobOptions::MINIMATCH_3 }),
        };
        JsxPascalCase {
            allow_all_caps: options.bool_or("allowAllCaps", false),
            allow_namespace: options.bool_or("allowNamespace", false),
            allow_leading_underscore: options.bool_or("allowLeadingUnderscore", false),
            ignore: options.strings("ignore").into_iter().map(ignored).collect(),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let separator: &[u8] = match jsx.tag().map(Expr::tag) {
            Some(ExprTag::Ident | ExprTag::String) => b":",
            Some(ExprTag::Dot) => b".",
            _ => return,
        };
        let is_oxlint = cx.language().is_oxlint;
        let name = get_jsx_element_name(jsx);
        // For oxlint every small letter makes a tag of the DOM.
        let is_compat_tag = match is_oxlint {
            true => characters(&name, is_oxlint).next().is_none_or(|it| it == Character::LowerCase),
            false => is_dom_component(jsx),
        };
        // Most are plain names in Pascal case.
        if is_compat_tag || name.len() > 1 && test_pascal_case(&name, is_oxlint) {
            return;
        }
        for split_name in strings::split(&name, separator) {
            // oxlint counts bytes.
            let length = if is_oxlint { split_name.len() } else { strings::wtf8_len_utf16(split_name) as usize };
            if length == 1 {
                return;
            }
            let check_name = match self.allow_leading_underscore {
                true => split_name.strip_prefix(b"_").unwrap_or(split_name),
                false => split_name,
            };
            if !test_pascal_case(check_name, is_oxlint)
                && !(self.allow_all_caps && test_all_caps(check_name, is_oxlint))
                && !self.ignore.iter().any(|it| it.matches(split_name, is_oxlint))
            {
                let message = match (is_oxlint, self.allow_all_caps) {
                    (false, false) => USE_PASCAL_CASE,
                    (false, true) => USE_PASCAL_OR_SNAKE_CASE,
                    (true, false) => OXLINT_PASCAL_CASE,
                    (true, true) => OXLINT_PASCAL_CASE_OR_ALL_CAPS,
                };
                cx.report(jsx.opening_span(), message).data("name", split_name.to_vec());
                // oxlint goes on to the next part.
                if !is_oxlint {
                    return;
                }
            }
            // Only the first part is looked at.
            if self.allow_namespace {
                return;
            }
        }
    }
}

impl Ignored {
    /// upstream's `ignoreCheck`
    fn matches(&self, name: &[u8], is_oxlint: bool) -> bool {
        // oxlint has the crate `fast-glob`.
        *self.entry == *name || if is_oxlint { glob_match(&self.entry, name) } else { self.minimatch.matches(name) }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Character {
    UpperCase,
    LowerCase,
    Digit,
    /// Another letter or number.
    Alphanumeric,
    Underscore,
    Other,
}

/// upstream's `testUpperCase`, `testLowerCase`, `testDigit`: by what `toUpperCase` and `toLowerCase` make of a UTF-16
/// code unit; what both leave alone is not alphanumeric. oxlint goes by the properties of Unicode.
fn characters(name: &[u8], is_oxlint: bool) -> impl Iterator<Item = Character> {
    strings::wtf8_codepoints(name).map(move |(_, code_point)| match char::from_u32(code_point) {
        Some('A'..='Z') => Character::UpperCase,
        Some('a'..='z') => Character::LowerCase,
        Some('0'..='9') => Character::Digit,
        Some('_') => Character::Underscore,
        Some(c) if c.is_ascii() => Character::Other,
        Some(c) if is_oxlint && c.is_uppercase() => Character::UpperCase,
        Some(c) if is_oxlint && c.is_lowercase() => Character::LowerCase,
        Some(c) if is_oxlint && c.is_alphanumeric() => Character::Alphanumeric,
        Some(c) if !is_oxlint && c.len_utf16() == 1 => {
            let mut bytes = [0; 4];
            let character = c.encode_utf8(&mut bytes).as_bytes();
            match (text::is_upper_case(character), text::is_lower_case(character)) {
                (true, false) => Character::UpperCase,
                (false, true) => Character::LowerCase,
                (false, false) => Character::Alphanumeric,
                (true, true) => Character::Other,
            }
        }
        _ => Character::Other,
    })
}

/// `testAllCaps`
fn test_all_caps(name: &[u8], is_oxlint: bool) -> bool {
    // oxlint takes the number of bytes for the number of characters.
    let length = if is_oxlint { name.len() } else { strings::wtf8_codepoint_count(name) };
    characters(name, is_oxlint).enumerate().all(|(index, it)| match it {
        Character::UpperCase | Character::Digit => true,
        Character::Underscore => index != 0 && index + 1 != length,
        _ => false,
    })
}

/// `testPascalCase`
fn test_pascal_case(name: &[u8], is_oxlint: bool) -> bool {
    let mut characters = characters(name, is_oxlint);
    if characters.next() != Some(Character::UpperCase) {
        return false;
    }
    let mut has_lower_case_or_digit = false;
    characters.all(|it| {
        has_lower_case_or_digit |= matches!(it, Character::LowerCase | Character::Digit);
        !matches!(it, Character::Underscore | Character::Other)
    }) && has_lower_case_or_digit
}
