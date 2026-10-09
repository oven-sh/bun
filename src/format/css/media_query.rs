//! `postcss-media-query-parser` 0.2.3 (`dist/parsers.js`), and Prettier's
//! `parse/parse-media-query.js`.

use crate::text;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum MediaKind {
    QueryList,
    Query,
    Type,
    FeatureExpression,
    Feature,
    Colon,
    Value,
    Keyword,
    Url,
    /// It has no type, which Prettier calls `media-unknown`.
    Unknown,
}

#[derive(Debug)]
pub(crate) struct MediaNode<'a> {
    pub(crate) kind: MediaKind,
    pub(crate) value: &'a [u8],
    /// `None`: it is not a container.
    pub(crate) nodes: Option<Vec<MediaNode<'a>>>,
}

pub(crate) struct ParseError;

fn leaf(kind: MediaKind, value: &[u8]) -> MediaNode<'_> {
    MediaNode {
        kind,
        value,
        nodes: None,
    }
}

fn parse_media_feature(string: &[u8]) -> Result<Vec<MediaNode<'_>>, ParseError> {
    #[derive(Copy, Clone, PartialEq)]
    enum Mode {
        Normal,
        String(u8),
        Interpolation,
    }
    let mut modes = vec![Mode::Normal];
    let normalized = match string {
        [b'(', inner @ .., b')'] => inner,
        _ => string,
    };
    let mut feature_end = normalized.len();
    let mut value = None;
    for (i, &character) in normalized.iter().enumerate() {
        if matches!(character, b'\'' | b'"') {
            match *modes.last().ok_or(ParseError)? {
                Mode::Interpolation => modes.push(Mode::String(character)),
                Mode::String(quote)
                    if quote == character && (i == 0 || normalized[i - 1] != b'\\') =>
                {
                    modes.pop();
                }
                _ => {}
            }
        }
        if character == b'{' {
            modes.push(Mode::Interpolation);
        } else if character == b'}' {
            modes.pop();
        }
        if *modes.last().ok_or(ParseError)? == Mode::Normal && character == b':' {
            feature_end = i;
            value = Some(bun_core::strings::trim_js_whitespace(&normalized[i + 1..]));
            break;
        }
    }
    let mut result = vec![leaf(
        MediaKind::Feature,
        bun_core::strings::trim_js_whitespace(&normalized[..feature_end]),
    )];
    if let Some(value) = value {
        result.push(leaf(MediaKind::Colon, b":"));
        result.push(leaf(MediaKind::Value, value));
    }
    Ok(result)
}

fn parse_media_query(string: &[u8]) -> Result<Vec<MediaNode<'_>>, ParseError> {
    let mut result: Vec<(Option<MediaKind>, MediaNode<'_>)> = Vec::new();
    let mut local_level = 0i32;
    // Where the element starts that is being read, and whether it is an expression.
    let mut element: Option<(usize, bool)> = None;

    // The bytes of a character of white space that are still to be skipped.
    let mut skip = 0;
    for (i, &character) in string.iter().enumerate() {
        if skip > 0 {
            skip -= 1;
            continue;
        }
        match element {
            None => {
                if let len @ 1.. = bun_core::strings::js_whitespace_len(&string[i..]) {
                    skip = len - 1;
                    continue;
                }
                if character == b'(' {
                    local_level += 1;
                }
                element = Some((i, character == b'('));
            }
            Some(_) => {
                if matches!(character, b'{' | b'(') {
                    local_level += 1;
                }
                if matches!(character, b')' | b'}') {
                    local_level -= 1;
                }
            }
        }
        if let Some((start, is_expression)) = element
            && local_level == 0
            && (character == b')'
                || i + 1 == string.len()
                || text::starts_with_white_space(&string[i + 1..]))
        {
            let value = &string[start..=i];
            let mut kind = is_expression.then_some(MediaKind::FeatureExpression);
            if matches!(value, b"not" | b"only" | b"and") {
                kind = Some(MediaKind::Keyword);
            }
            let nodes = match kind {
                Some(MediaKind::FeatureExpression) => Some(parse_media_feature(value)?),
                _ => None,
            };
            result.push((
                kind,
                MediaNode {
                    kind: MediaKind::Unknown,
                    value,
                    nodes,
                },
            ));
            element = None;
        }
    }

    use MediaKind::{FeatureExpression, Keyword, Type};
    for i in 0..result.len() {
        if result[i].0.is_some() {
            continue;
        }
        let kind_at = |result: &[(Option<MediaKind>, MediaNode<'_>)], at: usize| {
            result.get(at).and_then(|it| it.0)
        };
        if i > 0 {
            let previous_kind = result[i - 1].0;
            let previous_value = result[i - 1].1.value;
            if previous_kind == Some(FeatureExpression) {
                result[i].0 = Some(Keyword);
            } else if matches!(previous_value, b"not" | b"only") {
                result[i].0 = Some(Type);
            } else if previous_value == b"and" {
                result[i].0 = Some(FeatureExpression);
            } else if previous_kind == Some(Type) {
                result[i].0 = Some(match result.get(i + 1) {
                    None => FeatureExpression,
                    Some(next) if next.0 == Some(FeatureExpression) => Keyword,
                    Some(_) => FeatureExpression,
                });
            }
            continue;
        }
        if result.len() == 1 || matches!(kind_at(&result, 1), Some(FeatureExpression | Keyword)) {
            result[0].0 = Some(Type);
        } else if kind_at(&result, 2) == Some(FeatureExpression) {
            result[0].0 = Some(Type);
            result[1].0 = Some(Keyword);
        } else if kind_at(&result, 2) == Some(Keyword) {
            result[0].0 = Some(Keyword);
            result[1].0 = Some(Type);
        } else if kind_at(&result, 3) == Some(FeatureExpression) {
            result[0].0 = Some(Keyword);
            result[1].0 = Some(Type);
            result[2].0 = Some(Keyword);
        }
    }
    Ok(result
        .into_iter()
        .map(|(kind, node)| MediaNode {
            kind: kind.unwrap_or(MediaKind::Unknown),
            ..node
        })
        .collect())
}

/// Prettier's `parseMediaQuery`. An error stands for `{ type: "selector-unknown", value: params }`.
pub(crate) fn parse(string: &[u8]) -> Result<MediaNode<'_>, ParseError> {
    let mut result = Vec::new();
    let mut interim_index = 0;
    let mut level = 0i32;

    // `/^(\s*)url\s*\(/`
    let after_spaces = bun_core::strings::trim_js_whitespace_start(string);
    if let Some(rest) = after_spaces.strip_prefix(b"url")
        && let Some(after_paren) =
            bun_core::strings::trim_js_whitespace_start(rest).strip_prefix(b"(")
    {
        let mut i = string.len() - after_paren.len();
        let mut parentheses = 1;
        while parentheses > 0 {
            match string.get(i).ok_or(ParseError)? {
                b'(' => parentheses += 1,
                b')' => parentheses -= 1,
                _ => {}
            }
            i += 1;
        }
        result.push(leaf(
            MediaKind::Url,
            bun_core::strings::trim_js_whitespace(&string[..i]),
        ));
        interim_index = i;
    }

    for (i, &character) in string.iter().enumerate().skip(interim_index) {
        match character {
            b'(' => level += 1,
            b')' => level -= 1,
            b',' if level == 0 => {
                result.push(media_query(&string[interim_index..i])?);
                interim_index = i + 1;
            }
            _ => {}
        }
    }
    result.push(media_query(&string[interim_index..])?);
    Ok(MediaNode {
        kind: MediaKind::QueryList,
        value: bun_core::strings::trim_js_whitespace(string),
        nodes: Some(result),
    })
}

fn media_query(string: &[u8]) -> Result<MediaNode<'_>, ParseError> {
    Ok(MediaNode {
        kind: MediaKind::Query,
        value: bun_core::strings::trim_js_whitespace(string),
        nodes: Some(parse_media_query(string)?),
    })
}
