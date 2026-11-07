//! `lib/util/pragma.js` of eslint-plugin-react. Every function here reads the settings, and
//! `get_from_context` also scans all the comments, so call each one once per file.

use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::source::mention_bit;
use smallvec::SmallVec;

/// `JS_IDENTIFIER_REGEX`
fn is_js_identifier(name: &[u8]) -> bool {
    let is_start = |it: &u8| it.is_ascii_alphabetic() || matches!(it, b'_' | b'$');
    match name {
        [first, rest @ ..] => {
            is_start(first) && rest.iter().all(|it| is_start(it) || it.is_ascii_digit())
        }
        [] => false,
    }
}

/// `settings.react[key]`, if it's a non-empty string.
fn setting<'a>(file: &'a File<'a>, key: &[u8]) -> Option<&'a [u8]> {
    let value = file.settings().get(b"react")?.get(key)?.as_str()?;
    (!value.is_empty()).then_some(value)
}

/// `JSX_ANNOTATION_REGEX`'s capture in `comment`: the `a.b` in `@jsx a.b`.
fn jsx_annotation(mut comment: &[u8]) -> Option<&[u8]> {
    loop {
        let at = strings::index_of(comment, b"@jsx")?;
        comment = comment.get(at + 4..)?;
        let name = strings::trim_js_whitespace_start(comment);
        if name.len() == comment.len() || name.is_empty() {
            continue;
        }
        let mut end = 0;
        while name
            .get(end..)
            .is_some_and(|it| !it.is_empty() && strings::js_whitespace_len(it) == 0)
        {
            end += 1;
        }
        return name.get(..end);
    }
}

/// `getFromContext`: `React`, or the replacement set by the file or the settings.
pub(crate) fn get_from_context<'a>(file: &'a File<'a>) -> &'a [u8] {
    let annotation = || {
        let mut comments = file.comments().map(|it| it.comment_value());
        let name = comments.find_map(jsx_annotation)?;
        strings::split(name, b".").next()
    };
    let has_annotation = strings::contains(file.text(), b"@jsx");
    let pragma = has_annotation.then(annotation).flatten();
    let pragma = pragma.or_else(|| setting(file, b"pragma"));
    pragma.filter(|it| is_js_identifier(it)).unwrap_or(b"React")
}

/// `getCreateClassFromContext`. Returns the default where upstream throws.
pub(crate) fn get_create_class_from_context<'a>(file: &'a File<'a>) -> &'a [u8] {
    let pragma = setting(file, b"createClass");
    pragma
        .filter(|it| is_js_identifier(it))
        .unwrap_or(b"createReactClass")
}

/// True if the file may contain a `create_class` call. Upstream counts `pragma.#createClass` as one.
pub(crate) fn mentions_create_class(file: &File<'_>, create_class: &[u8]) -> bool {
    let mut private = SmallVec::<[u8; 32]>::from_slice(b"#");
    private.extend_from_slice(create_class);
    file.mentions_bit(mention_bit(create_class)) || file.mentions_bit(mention_bit(&private))
}

/// `getFragmentFromContext`. Returns the default where upstream throws.
pub(crate) fn get_fragment_from_context<'a>(file: &'a File<'a>) -> &'a [u8] {
    let pragma = setting(file, b"fragment");
    pragma
        .filter(|it| is_js_identifier(it))
        .unwrap_or(b"Fragment")
}
