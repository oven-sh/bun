//! <https://html.spec.whatwg.org/#concept-window-open-features-tokenize>

#[derive(Default)]
pub struct WindowFeatures {
    pub noopener: bool,
    pub noreferrer: bool,
    pub is_popup: bool,
    pub left: Option<i32>,
    pub top: Option<i32>,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

fn take_while(text: &[u8], holds: fn(u8) -> bool) -> (&[u8], &[u8]) {
    text.split_at(text.iter().take_while(|it| holds(**it)).count())
}

fn is_separator(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b'=' | b',')
}

fn tokens(mut rest: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    core::iter::from_fn(move || {
        let (name, after) = take_while(take_while(rest, is_separator).1, |it| !is_separator(it));
        let value;
        (value, rest) = match after.trim_ascii_start().strip_prefix(b"=") {
            Some(it) => take_while(
                take_while(it, |it| it.is_ascii_whitespace() || it == b'=').1,
                |it| !is_separator(it),
            ),
            None => (&b""[..], after),
        };
        (!name.is_empty()).then_some((name, value))
    })
}

/// `None` for 0.
fn number(value: &[u8]) -> Option<i32> {
    let (sign, rest) = match value {
        [b'-', rest @ ..] => (-1, rest),
        [b'+', rest @ ..] | rest => (1, rest),
    };
    let add = |all: i32, it: &u8| all.saturating_mul(10).saturating_add(i32::from(it - b'0'));
    let magnitude = take_while(rest, |it| it.is_ascii_digit())
        .0
        .iter()
        .fold(0, add);
    Some(sign * magnitude).filter(|it| *it != 0)
}

impl WindowFeatures {
    pub fn parse(features: &[u8]) -> WindowFeatures {
        let features = features.to_ascii_lowercase();
        let value = |names: &[&[u8]]| {
            let found = tokens(&features).filter(|it| names.contains(&it.0));
            found.last().map(|it| it.1)
        };
        let flag = |name: &[u8]| {
            value(&[name]).map(|it| matches!(it, b"" | b"yes" | b"true") || number(it).is_some())
        };
        let is_set = |name: &[u8]| flag(name) == Some(true);
        let is_tab = (is_set(b"location") || is_set(b"toolbar"))
            && is_set(b"menubar")
            && flag(b"resizable") != Some(false)
            && is_set(b"scrollbars")
            && is_set(b"status");
        let has_others = tokens(&features).any(|it| !matches!(it.0, b"noopener" | b"noreferrer"));
        WindowFeatures {
            noopener: is_set(b"noreferrer") || is_set(b"noopener"),
            noreferrer: is_set(b"noreferrer"),
            is_popup: has_others && flag(b"popup").unwrap_or(!is_tab),
            left: value(&[b"left", b"screenx"]).map(|it| number(it).unwrap_or(0)),
            top: value(&[b"top", b"screeny"]).map(|it| number(it).unwrap_or(0)),
            width: value(&[b"width", b"innerwidth"]).and_then(number),
            height: value(&[b"height", b"innerheight"]).and_then(number),
        }
    }
}
