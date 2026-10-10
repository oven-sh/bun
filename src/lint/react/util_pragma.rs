#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/pragma.js` of eslint-plugin-react. Each reads the settings, and the first all the
//! comments: ask once for a file, in `register`.

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

/// `settings.react[key]`, if that is a string and not empty.
fn setting<'a>(file: &'a File<'a>, key: &[u8]) -> Option<&'a [u8]> {
    let value = file.settings().get(b"react")?.get(key)?.as_str()?;
    (!value.is_empty()).then_some(value)
}

/// What `JSX_ANNOTATION_REGEX` captures in `comment`: the `a.b` of `@jsx a.b`.
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

/// `getFromContext`: `React`, or what the file or the settings have in its place.
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

/// `getCreateClassFromContext`. Where upstream throws, it is the default.
pub(crate) fn get_create_class_from_context<'a>(file: &'a File<'a>) -> &'a [u8] {
    let pragma = setting(file, b"createClass");
    pragma
        .filter(|it| is_js_identifier(it))
        .unwrap_or(b"createReactClass")
}

/// Whether the file can have a call of `create_class`: `pragma.#createClass` is one for upstream.
pub(crate) fn mentions_create_class(file: &File<'_>, create_class: &[u8]) -> bool {
    let mut private = SmallVec::<[u8; 32]>::from_slice(b"#");
    private.extend_from_slice(create_class);
    file.mentions_bit(mention_bit(create_class)) || file.mentions_bit(mention_bit(&private))
}

/// `getFragmentFromContext`. Where upstream throws, it is the default.
pub(crate) fn get_fragment_from_context<'a>(file: &'a File<'a>) -> &'a [u8] {
    let pragma = setting(file, b"fragment");
    pragma
        .filter(|it| is_js_identifier(it))
        .unwrap_or(b"Fragment")
}
