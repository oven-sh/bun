//! https://w3c.github.io/webvtt/#parsing

use bun_core::strings;
use bun_markup::html::entities;

use super::*;
use crate::api::core::{Atom, DomString, Element, Node, Ns, QualName, append_detached};
use crate::values::text;

#[derive(Clone, Copy)]
pub(super) struct CueSettings {
    pub(super) vertical: DirectionSetting,
    pub(super) snaps_to_lines: bool,
    pub(super) line: Option<f64>,
    pub(super) line_align: LineAlignSetting,
    pub(super) position: Option<f64>,
    pub(super) position_align: PositionAlignSetting,
    pub(super) size: f64,
    pub(super) align: AlignSetting,
}

impl Default for CueSettings {
    #[optimize(size)]
    fn default() -> CueSettings {
        CueSettings {
            vertical: DirectionSetting::Horizontal,
            snaps_to_lines: true,
            line: None,
            line_align: LineAlignSetting::Start,
            position: None,
            position_align: PositionAlignSetting::Auto,
            size: 100.0,
            align: AlignSetting::Center,
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct RegionSettings {
    pub(super) width: f64,
    pub(super) lines: u32,
    pub(super) anchor: [f64; 2],
    pub(super) viewport_anchor: [f64; 2],
    pub(super) scroll: ScrollSetting,
}

impl Default for RegionSettings {
    fn default() -> RegionSettings {
        RegionSettings {
            width: 100.0,
            lines: 3,
            anchor: [0.0, 100.0],
            viewport_anchor: [0.0, 100.0],
            scroll: ScrollSetting::None,
        }
    }
}

#[derive(Default)]
pub(super) struct ParsedCue<'s> {
    pub(super) id: &'s [u8],
    pub(super) times: [f64; 2],
    pub(super) settings: CueSettings,
    pub(super) region: Option<usize>,
    pub(super) text: &'s [u8],
}

#[derive(Default)]
pub(super) struct File<'s> {
    pub(super) regions: Vec<(&'s [u8], RegionSettings)>,
    pub(super) style_sheets: Vec<&'s [u8]>,
    pub(super) cues: Vec<ParsedCue<'s>>,
}

fn collect<'s>(input: &mut &'s [u8], matches: impl Fn(&u8) -> bool) -> &'s [u8] {
    let (collected, rest) = input.split_at(input.iter().take_while(|it| matches(it)).count());
    *input = rest;
    collected
}

fn skip(input: &mut &[u8], prefix: &[u8]) -> Option<()> {
    input.strip_prefix(prefix).map(|rest| *input = rest)
}

fn number(digits: &[u8]) -> Option<f64> {
    text(digits).parse().ok().filter(|it: &f64| it.is_finite())
}

/// https://w3c.github.io/webvtt/#collect-a-webvtt-timestamp
#[optimize(size)]
fn collect_timestamp(input: &mut &[u8]) -> Option<f64> {
    let digits = |input: &mut &[u8], count| {
        Some(collect(input, u8::is_ascii_digit))
            .filter(|it| it.len() == count)
            .and_then(number)
    };
    let first = collect(input, u8::is_ascii_digit);
    let (value1, value2) = (
        number(first)?,
        skip(input, b":").and_then(|()| digits(input, 2))?,
    );
    let [hours, minutes, seconds] =
        match first.len() != 2 || value1 > 59.0 || input.starts_with(b":") {
            true => [
                value1,
                value2,
                skip(input, b":").and_then(|()| digits(input, 2))?,
            ],
            false => [0.0, value1, value2],
        };
    let thousandths = skip(input, b".").and_then(|()| digits(input, 3))?;
    (minutes <= 59.0 && seconds <= 59.0)
        .then_some(hours * 3600.0 + minutes * 60.0 + seconds + thousandths / 1000.0)
}

fn decimal(source: &[u8]) -> Option<f64> {
    let (whole, fraction) = strings::split_once_char(source, b'.').unwrap_or((source, b"0"));
    [whole, fraction]
        .into_iter()
        .all(|it| !it.is_empty() && it.iter().all(u8::is_ascii_digit))
        .then(|| number(source))?
}

/// https://w3c.github.io/webvtt/#parse-a-percentage-string
fn percentage(source: &[u8]) -> Option<f64> {
    decimal(source.strip_suffix(b"%")?).filter(|it| *it <= 100.0)
}

fn settings(input: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    strings::split_any(input, b" \t\n\x0c\r")
        .filter_map(|it| strings::split_once_char(it, b':'))
        .filter(|it| !it.0.is_empty() && !it.1.is_empty())
}

fn with_alignment(value: &[u8]) -> (&[u8], Option<&[u8]>) {
    strings::split_once_char(value, b',').map_or((value, None), |it| (it.0, Some(it.1)))
}

impl<'s> ParsedCue<'s> {
    /// https://w3c.github.io/webvtt/#collect-webvtt-cue-timings-and-settings
    #[optimize(size)]
    fn from_timings(
        id: &'s [u8],
        mut line: &[u8],
        regions: &[(&[u8], RegionSettings)],
    ) -> Option<ParsedCue<'s>> {
        let timestamp = |input: &mut &[u8]| {
            collect(input, u8::is_ascii_whitespace);
            collect_timestamp(input)
        };
        let start = timestamp(&mut line)?;
        collect(&mut line, u8::is_ascii_whitespace);
        skip(&mut line, b"-->")?;
        let mut cue = ParsedCue {
            id,
            times: [start, timestamp(&mut line)?],
            ..ParsedCue::default()
        };
        settings(line).for_each(|(name, value)| _ = cue.apply(name, value, regions));
        Some(cue)
    }

    #[optimize(size)]
    fn apply(
        &mut self,
        name: &[u8],
        value: &[u8],
        regions: &[(&[u8], RegionSettings)],
    ) -> Option<()> {
        let it = &mut self.settings;
        match name {
            b"region" => self.region = regions.iter().rposition(|it| it.0 == value),
            b"vertical" => {
                it.vertical = match value {
                    b"rl" => DirectionSetting::Rl,
                    b"lr" => DirectionSetting::Lr,
                    _ => it.vertical,
                };
                self.region = self
                    .region
                    .filter(|_| it.vertical == DirectionSetting::Horizontal);
            }
            b"line" => {
                let (line, align) = with_alignment(value);
                let is_percentage = line.ends_with(b"%");
                let line = match line.strip_prefix(b"-") {
                    _ if is_percentage => percentage(line)?,
                    Some(magnitude) => 0.0 - decimal(magnitude)?,
                    None => decimal(line)?,
                };
                it.line_align = match align {
                    Some(b"start") => LineAlignSetting::Start,
                    Some(b"center") => LineAlignSetting::Center,
                    Some(b"end") => LineAlignSetting::End,
                    Some(_) => return None,
                    None => it.line_align,
                };
                (it.line, it.snaps_to_lines, self.region) = (Some(line), !is_percentage, None);
            }
            b"position" => {
                let (position, align) = with_alignment(value);
                let position = percentage(position)?;
                it.position_align = match align {
                    Some(b"line-left") => PositionAlignSetting::LineLeft,
                    Some(b"center") => PositionAlignSetting::Center,
                    Some(b"line-right") => PositionAlignSetting::LineRight,
                    Some(_) => return None,
                    None => it.position_align,
                };
                it.position = Some(position);
            }
            b"size" => {
                it.size = percentage(value)?;
                self.region = self.region.filter(|_| it.size == 100.0);
            }
            b"align" => {
                it.align = match value {
                    b"start" => AlignSetting::Start,
                    b"center" => AlignSetting::Center,
                    b"end" => AlignSetting::End,
                    b"left" => AlignSetting::Left,
                    b"right" => AlignSetting::Right,
                    _ => return None,
                }
            }
            _ => {}
        }
        Some(())
    }
}

/// https://w3c.github.io/webvtt/#collect-webvtt-region-settings
#[optimize(size)]
fn region_from(input: &[u8]) -> (&[u8], RegionSettings) {
    let anchor = |value| {
        strings::split_once_char(value, b',')
            .and_then(|(x, y)| Some([percentage(x)?, percentage(y)?]))
    };
    let (mut id, mut region): (&[u8], _) = (b"", RegionSettings::default());
    for (name, value) in settings(input) {
        match name {
            b"id" => id = value,
            b"width" => region.width = percentage(value).unwrap_or(region.width),
            b"lines" if value.iter().all(u8::is_ascii_digit) => {
                region.lines = text(value).parse().unwrap_or(u32::MAX)
            }
            b"regionanchor" => region.anchor = anchor(value).unwrap_or(region.anchor),
            b"viewportanchor" => {
                region.viewport_anchor = anchor(value).unwrap_or(region.viewport_anchor)
            }
            b"scroll" if value == b"up" => region.scroll = ScrollSetting::Up,
            _ => {}
        }
    }
    (id, region)
}

/// Valid UTF-8 whose only line break is the line feed.
#[optimize(size)]
pub(super) fn normalized(bytes: &[u8]) -> Vec<u8> {
    let chunks = bytes
        .strip_prefix(b"\xef\xbb\xbf")
        .unwrap_or(bytes)
        .utf8_chunks();
    let decoded = chunks
        .flat_map(|it| {
            [
                it.valid(),
                if it.invalid().is_empty() {
                    ""
                } else {
                    "\u{fffd}"
                },
            ]
        })
        .flat_map(str::bytes);
    let (mut out, mut bytes) = (Vec::with_capacity(bytes.len()), decoded.peekable());
    while let Some(byte) = bytes.next() {
        match byte {
            0 => out.extend_from_slice("\u{fffd}".as_bytes()),
            b'\r' => out.push(bytes.next_if_eq(&b'\n').unwrap_or(b'\n')),
            _ => out.push(byte),
        }
    }
    out
}

impl<'s> File<'s> {
    /// https://w3c.github.io/webvtt/#webvtt-parser-algorithm
    #[optimize(size)]
    pub(super) fn parse(input: &'s [u8]) -> Option<File<'s>> {
        input
            .strip_prefix(b"WEBVTT")?
            .first()
            .is_none_or(|it| matches!(it, b' ' | b'\t' | b'\n'))
            .then_some(())?;
        let (mut file, mut rest) = (
            File::default(),
            strings::split_once_char(input, b'\n').map_or(&[][..], |it| it.1),
        );
        file.collect_block(&mut rest, true);
        loop {
            collect(&mut rest, |it| *it == b'\n');
            if rest.is_empty() {
                return Some(file);
            }
            file.collect_block(&mut rest, false);
        }
    }

    /// https://w3c.github.io/webvtt/#collect-a-webvtt-block
    #[optimize(size)]
    fn collect_block(&mut self, input: &mut &'s [u8], is_in_header: bool) {
        let (mut from, mut length, mut has_seen_arrow, mut cue, mut keyword) =
            (*input, 0, false, None, None);
        for line_count in 1.. {
            let (line, rest) = strings::split_once_char(input, b'\n').unwrap_or((input, b""));
            if strings::contains(line, b"-->") {
                if is_in_header || line_count > 2 || has_seen_arrow {
                    break;
                }
                has_seen_arrow = true;
                cue = ParsedCue::from_timings(&from[..length], line, &self.regions);
                (from, length) = (rest, 0);
            } else if line.is_empty() {
                break;
            } else if keyword.is_none()
                && (is_in_header || line_count > 1)
                && !has_seen_arrow
                && self.cues.is_empty()
                && line.trim_ascii_end() == b"STYLE"
            {
                (keyword, from, length) = (Some(&b"STYLE"[..]), rest, 0);
            } else {
                if keyword.is_none()
                    && !is_in_header
                    && line_count == 2
                    && self.cues.is_empty()
                    && let first @ (b"REGION" | b"STYLE") = from[..length].trim_ascii_end()
                {
                    (keyword, from) = (Some(first), *input);
                }
                length = from.len() - input.len() + line.len();
            }
            *input = rest;
        }
        match (cue, keyword) {
            (Some(cue), _) => self.cues.push(ParsedCue {
                text: &from[..length],
                ..cue
            }),
            (None, Some(b"STYLE")) => self.style_sheets.push(&from[..length]),
            (None, Some(_)) => self.regions.push(region_from(&from[..length])),
            (None, None) => {}
        }
    }
}

fn decoded(units: &[u16]) -> DomString {
    let mut out = bun_markup::Text::default();
    entities::decode(units, false, &mut out);
    DomString::from_chars(out.chars())
}

fn split(units: &[u16], at: impl Fn(u8) -> bool) -> (&[u16], &[u16]) {
    let end = units
        .iter()
        .position(|it| u8::try_from(*it).is_ok_and(&at))
        .unwrap_or(units.len());
    (&units[..end], units.get(end + 1..).unwrap_or_default())
}

pub(super) fn timestamp_of(node: &Node) -> Option<f64> {
    node.as_character_data()
        .filter(|_| node.as_text().is_none())
        .and_then(|it| collect_timestamp(&mut it.data().latin1()?))
}

/// https://w3c.github.io/webvtt/#webvtt-cue-text-parsing-rules and https://w3c.github.io/webvtt/#dom-construction-rules,
/// or the nodes that `::cue()` selects of the element that they are `shown_on`.
#[optimize(size)]
pub(super) fn append_cue_text<'a>(
    cx: Cx<'_, 'a>,
    root: &'a Node,
    source: &DomString,
    shown_on: Option<&'a Element>,
) {
    const NAMES: [&str; 8] = ["c", "i", "b", "u", "ruby", "rt", "v", "lang"];
    const MAX_DEPTH: usize = 512;
    let (units, document): (Vec<u16>, _) = (source.units().collect(), root.doc());
    let (mut rest, mut current, mut open) = (&units[..], root, Vec::new());
    while !rest.is_empty() {
        let (string, after) = split(rest, |it| it == b'<');
        let has_tag = string.len() < rest.len();
        if !string.is_empty() {
            append_detached(current, document.create_text(&cx.heap, decoded(string)));
        }
        let tag;
        (tag, rest) = split(after, |it| it == b'>');
        let is = |units: &[u16], name: &str| units.iter().copied().eq(name.bytes().map(u16::from));
        match tag.first().and_then(|it| u8::try_from(*it).ok()) {
            _ if !has_tag => {}
            Some(b'/') => {
                let closed = match open.last() {
                    Some(name) if is(&tag[1..], name) => 1,
                    Some(&"rt") if is(&tag[1..], "ruby") => 2,
                    _ => 0,
                };
                open.truncate(open.len() - closed);
                current = current.inclusive_ancestors().nth(closed).unwrap_or(root);
            }
            Some(b'0'..=b'9') => {
                let value = String::from_utf16_lossy(tag);
                let mut value = value.as_bytes();
                if let Some(time) = collect_timestamp(&mut value)
                    .filter(|_| value.is_empty())
                    .map(|it| (it * 1000.0).round())
                {
                    let [hours, minutes, seconds] = [
                        time / 3_600_000.0,
                        time / 60_000.0 % 60.0,
                        time / 1000.0 % 60.0,
                    ]
                    .map(f64::floor);
                    let data = format!("{hours:02}:{minutes:02}:{seconds:02}.{:03}", time % 1000.0);
                    append_detached(
                        current,
                        document.create_pi(
                            &cx.heap,
                            Atom::new("timestamp"),
                            DomString::from_utf8(&data),
                        ),
                    );
                }
            }
            _ if open.len() == MAX_DEPTH => {}
            _ => {
                let (head, annotation) = split(tag, |it| matches!(it, b'\t' | b'\n' | 0xc | b' '));
                let (name, classes) = split(head, |it| it == b'.');
                let Some(name) = NAMES
                    .into_iter()
                    .find(|it| is(name, it) && (*it != "rt" || open.last() == Some(&"ruby")))
                else {
                    continue;
                };
                let local = if shown_on.is_none() && matches!(name, "c" | "v" | "lang") {
                    "span"
                } else {
                    name
                };
                let element = document.create_plain(
                    &cx.heap,
                    QualName {
                        ns: if shown_on.is_some() {
                            Ns::None
                        } else {
                            Ns::Html
                        },
                        prefix: None,
                        local: Atom::new(local),
                    },
                );
                let words = |all: DomString, ends: &[u8]| {
                    let joined = strings::split_any(all.to_utf8().as_bytes(), ends)
                        .filter(|it| !it.is_empty())
                        .collect::<Vec<_>>()
                        .join(&b' ');
                    DomString::from_utf8(core::str::from_utf8(&joined).unwrap_or_default())
                };
                let classes = words(DomString::from_utf16(classes), b".");
                if !classes.is_empty() {
                    element.set_attr(cx, atom!("class"), classes);
                }
                if let "v" | "lang" = name {
                    let attribute = if name == "lang" {
                        name
                    } else if shown_on.is_some() {
                        "voice"
                    } else {
                        "title"
                    };
                    element.set_attr(
                        cx,
                        Atom::new(attribute),
                        words(decoded(annotation), b"\t\n\x0c\r "),
                    );
                }
                shown_on
                    .into_iter()
                    .for_each(|it| element.set_pseudo("-internal-cue-node", it));
                append_detached(current, element);
                open.push(name);
                current = element;
            }
        }
    }
}
