use bun_core::strings;

use super::tree_builder::{Builder, Content, StartTag, TextIs};
use super::{
    Attribute, AttributeNamespace, NameOf, NodeOf, Position, ShortName, Sink, Stop, Tag, TagSource,
    TextOf, entities,
};
use crate::chars::ONES;
use crate::{Chars, Text, Unit};

const MAX_ATTRIBUTES: usize = 4096;
const LOOKAHEAD: usize = 4096;
const MAX_WORDS_IN_RECALLED_TAG: usize = 24;

const SPACE: u8 = 1;
const ENDS_TAG_NAME: u8 = 2;
const ENDS_ATTRIBUTE_NAME: u8 = 4;
const ENDS_UNQUOTED: u8 = 8;
const IS_REPLACED: u8 = 16;

static CLASSES: [u8; 256] = {
    let mut classes = [0; 256];
    let mut byte = b'A';
    while byte <= b'Z' {
        classes[byte as usize] = IS_REPLACED;
        byte += 1;
    }
    classes[0] = IS_REPLACED;
    let space = SPACE | ENDS_TAG_NAME | ENDS_ATTRIBUTE_NAME | ENDS_UNQUOTED;
    (classes[9], classes[10], classes[12], classes[32]) = (space, space, space, space);
    classes[b'>' as usize] = ENDS_TAG_NAME | ENDS_ATTRIBUTE_NAME | ENDS_UNQUOTED;
    classes[b'/' as usize] = ENDS_TAG_NAME | ENDS_ATTRIBUTE_NAME;
    classes[b'=' as usize] = ENDS_ATTRIBUTE_NAME;
    classes
};

#[inline(always)]
fn class<U: Unit>(unit: U) -> u8 {
    CLASSES[unit.low() as usize]
}

#[inline(always)]
fn skip_spaces<U: Unit>(units: &[U], mut at: usize) -> usize {
    while at < units.len() && class(units[at]) & SPACE != 0 {
        at += 1;
    }
    at
}

#[inline(always)]
fn byte_at<U: Unit>(units: &[U], at: usize) -> Option<u8> {
    units.get(at).map(|it| it.low())
}

fn has_at<U: Unit>(units: &[U], at: usize, ascii: &[u8]) -> bool {
    U::chars(&units[at.min(units.len())..]).starts_with(ascii)
}

/// Whether `name` and the end of a tag name are at `at`. `None` if the input ends too early to tell.
fn has_name_at<U: Unit>(units: &[U], at: usize, name: &str) -> Option<bool> {
    let rest = &units[at.min(units.len())..];
    if !rest
        .iter()
        .zip(name.bytes())
        .all(|(a, b)| a.low().to_ascii_lowercase() == b)
    {
        return Some(false);
    }
    rest.get(name.len())
        .map(|it| class(*it) & ENDS_TAG_NAME != 0)
}

fn push_without_nul(out: &mut Text, mut text: Chars<'_>) {
    while let Some(at) = text.find(0, 0) {
        out.push(text.slice(0..at));
        out.push_unit(0xfffd);
        text = text.skip(at + 1);
    }
    out.push(text);
}

fn push_name<U: Unit>(out: &mut Text, name: &[U]) {
    for unit in name {
        match (*unit).into() {
            0 => out.push_unit(0xfffd),
            upper @ 0x41..=0x5a => out.push_byte(upper as u8 | 0x20),
            other => out.push_unit(other as u16),
        }
    }
}

/// The highest bit of each byte that is one.
#[inline(always)]
fn lowercase_and_digits(word: u64) -> u64 {
    let low = word & (ONES * 0x7f);
    let between = |first: u8, last: u8| {
        (low + ONES * u64::from(0x80 - first)) & !(low + ONES * u64::from(0x7f - last))
    };
    (between(b'a', b'z') | between(b'0', b'9')) & !word
}

/// Up to the first `>`.
#[inline(always)]
fn tag_source<U: Unit>(units: &[U], start: usize) -> Option<TagSource<'_>> {
    let mix =
        |hash: u64, word: u64| (hash.rotate_left(23) ^ word).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    let (mut at, mut hash) = (start, 0);
    for _ in 0..MAX_WORDS_IN_RECALLED_TAG {
        let word = U::word(units, at)?;
        let differs = word ^ (ONES * u64::from(b'>'));
        let found = differs.wrapping_sub(ONES) & !differs & (ONES << 7);
        if found != 0 {
            let bits = found.trailing_zeros() - 7;
            let hash = mix(hash, word & ((1 << bits) - 1));
            return Some(TagSource {
                chars: U::chars(&units[start..at + bits as usize / 8]),
                hash,
            });
        }
        (at, hash) = (at + 8, mix(hash, word));
    }
    None
}

#[derive(Clone, Copy)]
struct Scanned {
    end: usize,
    short: Option<ShortName>,
    /// The name differs from what the source has.
    is_replaced: bool,
}

/// Finds a rare character once for many tokens.
struct Rare {
    byte: u8,
    /// It is not between the last range and this.
    absent_until: usize,
}

impl Rare {
    #[inline(always)]
    fn is_in<U: Unit>(&mut self, units: &[U], start: usize, end: usize) -> bool {
        self.absent_until < end && self.look(units, start, end)
    }

    fn look<U: Unit>(&mut self, units: &[U], start: usize, end: usize) -> bool {
        let window = &units[..end.max(units.len().min(start + LOOKAHEAD))];
        self.absent_until = U::find(window, start.max(self.absent_until), self.byte);
        self.absent_until < end
    }
}

#[derive(Default)]
pub(super) struct Lines {
    line: u32,
    counted: usize,
    start_of_line: isize,
}

impl Lines {
    pub(super) fn advance<U: Unit>(&mut self, units: &[U], to: usize) {
        if to <= self.counted {
            return;
        }
        let range = &units[self.counted..to];
        if let Some(last) = strings::last_index_of_char_t(range, U::from_u8(b'\n')) {
            self.start_of_line = (self.counted + last + 1) as isize;
            self.line += match U::chars(range) {
                Chars::Latin1(bytes) => strings::count_char(bytes, b'\n'),
                Chars::Utf16(wide) => wide.iter().filter(|it| **it == 10).count(),
            } as u32;
        }
        self.counted = to;
    }

    pub(super) fn dropped(&mut self, count: usize) {
        self.counted = self.counted.saturating_sub(count);
        self.start_of_line -= count as isize;
    }

    pub(super) fn moved(&mut self, from: usize, to: usize) {
        self.counted = self.counted.max(from) + to - from;
        self.start_of_line += to as isize - from as isize;
    }

    fn position(&self) -> Position {
        Position {
            line: self.line,
            column: (self.counted as isize - self.start_of_line).max(0) as u32,
        }
    }
}

#[derive(Clone, Copy, Default, PartialEq)]
enum Escape {
    #[default]
    None,
    Single,
    Double,
}

#[derive(Default)]
pub(super) struct Tokenizer {
    pub(super) lines: Lines,
    /// How much of the text of a script is known not to end it, and the state there.
    script_scan: (usize, Escape),
    scratch: Text,
    name: Text,
}

struct Run<'a, 'b, U: Unit, S: Sink> {
    units: &'a [U],
    at: usize,
    /// No input follows.
    is_last: bool,
    counts_lines: bool,
    amp: Rare,
    nul: Rare,
    tokenizer: &'a mut Tokenizer,
    builder: &'a mut Builder<'b, S>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Input {
    Fragment,
    /// By a script.
    Written,
    PartOfDocument,
    RestOfDocument,
}

struct NeedsInput;
type Step = Result<(), NeedsInput>;

impl Tokenizer {
    pub(super) fn run<U: Unit, S: Sink>(
        &mut self,
        units: &[U],
        at: &mut usize,
        input: Input,
        builder: &mut Builder<'_, S>,
    ) -> Stop<NodeOf<S>> {
        let (amp, nul) = (
            Rare {
                byte: b'&',
                absent_until: 0,
            },
            Rare {
                byte: 0,
                absent_until: 0,
            },
        );
        let is_last = matches!(input, Input::Fragment | Input::RestOfDocument);
        let counts_lines = matches!(input, Input::PartOfDocument | Input::RestOfDocument);
        let mut run = Run {
            units,
            at: *at,
            is_last,
            counts_lines,
            amp,
            nul,
            tokenizer: self,
            builder,
        };
        let stop = run.run();
        *at = run.at.min(units.len());
        stop
    }
}

impl<'b, U: Unit, S: Sink> Run<'_, 'b, U, S> {
    fn run(&mut self) -> Stop<NodeOf<S>> {
        loop {
            if let Some(stop) = self.builder.take_stop() {
                return stop;
            }
            if self.at >= self.units.len() {
                return if self.is_last {
                    self.builder.end_of_file()
                } else {
                    Stop::NeedsInput
                };
            }
            let step = match self.builder.state.content {
                Content::Data => self.data(),
                content => self.text_only(content),
            };
            if step.is_err() {
                return Stop::NeedsInput;
            }
        }
    }

    fn require(&self, is_complete: bool) -> Step {
        if is_complete || self.is_last {
            Ok(())
        } else {
            Err(NeedsInput)
        }
    }

    /// Where a character reference starts that more input could extend.
    fn before_unfinished_reference(&self, start: usize, end: usize) -> usize {
        let is_part = |it: &&U| it.low().is_ascii_alphanumeric() || it.low() == b'#';
        let tail = self.units[start..end]
            .iter()
            .rev()
            .take_while(is_part)
            .count();
        if end - tail > start && self.units[end - tail - 1].low() == b'&' {
            end - tail - 1
        } else {
            end
        }
    }

    #[inline]
    fn data(&mut self) -> Step {
        let (units, start) = (self.units, self.at);
        let mut end = if units[start].low() == b'<' {
            start
        } else {
            U::find(units, start, b'<')
        };
        loop {
            match byte_at(units, end + 1) {
                Some(b'a'..=b'z' | b'A'..=b'Z' | b'!' | b'?') => break,
                Some(b'/') if end + 2 < units.len() => break,
                Some(b'/') | None if !self.is_last => break,
                Some(_) => end = U::find(units, end + 1, b'<'),
                None => {
                    end = units.len();
                    break;
                }
            }
        }
        if end == start {
            return self.markup(start + 1);
        }
        let mut may_continue = has_at(units, end, b"</>");
        if !self.is_last && end + 2 >= units.len() {
            may_continue = true;
            if end == units.len() {
                end = self.before_unfinished_reference(start, end);
                self.require(end > start)?;
            }
        }
        self.at = end;
        let has_nul = self.nul.is_in(units, start, end);
        if self.amp.is_in(units, start, end) {
            let scratch = &mut self.tokenizer.scratch;
            scratch.clear();
            entities::decode(&units[start..end], false, scratch);
            self.builder.text(
                scratch.chars(),
                TextIs {
                    has_nul,
                    may_continue,
                },
            );
        } else {
            self.builder.text(
                U::chars(&units[start..end]),
                TextIs {
                    has_nul,
                    may_continue,
                },
            );
        }
        Ok(())
    }

    /// After a `<`.
    #[inline]
    fn markup(&mut self, at: usize) -> Step {
        let units = self.units;
        if !self.is_last && U::find(units, at, b'>') == units.len() {
            return Err(NeedsInput);
        }
        match units[at].low() {
            b'/' => match units[at + 1].low() {
                b'a'..=b'z' | b'A'..=b'Z' => self.end_tag(at + 1),
                b'>' => {
                    self.at = at + 2;
                    Ok(())
                }
                _ => self.bogus_comment(at + 1),
            },
            b'!' => self.declaration(at + 1),
            b'?' => self.instruction(at),
            _ => self.start_tag(at),
        }
    }

    #[inline(always)]
    fn scan_name(&self, start: usize, ends: u8) -> Scanned {
        if let Some(word) = U::word(self.units, start) {
            let len = (!lowercase_and_digits(word) & ONES << 7).trailing_zeros() / 8;
            if !len.is_multiple_of(8) && CLASSES[usize::from((word >> (len * 8)) as u8)] & ends != 0
            {
                let short = Some(ShortName(word & ((1 << (len * 8)) - 1)));
                return Scanned {
                    end: start + len as usize,
                    short,
                    is_replaced: false,
                };
            }
        }
        let (mut end, mut seen) = (start + 1, class(self.units[start]));
        while let Some(class) = self
            .units
            .get(end)
            .map(|it| class(*it))
            .filter(|it| it & ends == 0)
        {
            (seen, end) = (seen | class, end + 1);
        }
        Scanned {
            end,
            short: None,
            is_replaced: seen & IS_REPLACED != 0,
        }
    }

    /// The name, and the builder beside it.
    #[inline(always)]
    fn name(&mut self, start: usize, scanned: Scanned) -> (Chars<'_>, &mut Builder<'b, S>) {
        let source = &self.units[start..scanned.end];
        if !scanned.is_replaced {
            return (U::chars(source), self.builder);
        }
        self.tokenizer.name.clear();
        push_name(&mut self.tokenizer.name, source);
        (self.tokenizer.name.chars(), self.builder)
    }

    fn tag_cut_off(&mut self) -> Step {
        self.require(false)?;
        self.at = self.units.len();
        Ok(())
    }

    #[inline]
    fn start_tag(&mut self, start: usize) -> Step {
        let scanned = self.scan_name(start, ENDS_TAG_NAME);
        let (name, builder) = self.name(start, scanned);
        let tag = scanned
            .short
            .map_or_else(|| Tag::from_name(name), Tag::from_short_name);
        let name = (tag == Tag::Other).then(|| builder.sink.name(name, scanned.short));
        self.builder.state.forget_attributes();
        let takes_stencil =
            byte_at(self.units, scanned.end) != Some(b'>') && self.builder.state.takes_stencil(tag);
        let source = if takes_stencil {
            tag_source(self.units, start)
        } else {
            None
        };
        if let Some(source) = source
            && let Some(stencil) = self.builder.sink.recall(source)
        {
            self.at = start + source.chars.len() + 1;
            self.builder.state.stencil = Some(stencil);
            self.builder.start_tag(StartTag {
                tag,
                name,
                is_self_closing: false,
            });
            return Ok(());
        }
        let Some((after, is_self_closing)) = self.attributes::<true>(scanned.end) else {
            return self.tag_cut_off();
        };
        self.at = after;
        if let Some(source) = source.filter(|it| start + it.chars.len() + 1 == after) {
            self.builder.state.stencil =
                self.builder
                    .sink
                    .remember(source, tag, &mut self.builder.state.attributes);
        }
        if tag == Tag::Script && self.counts_lines {
            self.tokenizer.lines.advance(self.units, after);
            self.builder.state.position = self.tokenizer.lines.position();
        }
        self.builder.start_tag(StartTag {
            tag,
            name,
            is_self_closing,
        });
        Ok(())
    }

    #[inline]
    fn end_tag(&mut self, start: usize) -> Step {
        let scanned = self.scan_name(start, ENDS_TAG_NAME);
        let Some((after, _)) = self.attributes::<false>(scanned.end) else {
            return self.tag_cut_off();
        };
        self.at = after;
        let (name, builder) = self.name(start, scanned);
        builder.end_tag(
            scanned
                .short
                .map_or_else(|| Tag::from_name(name), Tag::from_short_name),
            name,
        );
        Ok(())
    }

    /// Where the tag ends, and whether it does with `/>`.
    #[inline]
    fn attributes<const KEEPS: bool>(&mut self, mut at: usize) -> Option<(usize, bool)> {
        let units = self.units;
        loop {
            at = skip_spaces(units, at);
            match byte_at(units, at)? {
                b'>' => return Some((at + 1, false)),
                b'/' if byte_at(units, at + 1)? == b'>' => return Some((at + 2, true)),
                b'/' => {
                    at += 1;
                    continue;
                }
                _ => {}
            }
            let (name_start, scanned) = (at, self.scan_name(at, ENDS_ATTRIBUTE_NAME));
            at = skip_spaces(units, scanned.end);
            let mut value = at..at;
            if byte_at(units, at)? == b'=' {
                at = skip_spaces(units, at + 1);
                if let quote @ (b'"' | b'\'') = byte_at(units, at)? {
                    value = at + 1..U::find(units, at + 1, quote);
                    at = value.end + 1;
                } else {
                    value = at..at
                        + units[at..]
                            .iter()
                            .take_while(|it| class(**it) & ENDS_UNQUOTED == 0)
                            .count();
                    at = value.end;
                }
            }
            if at >= units.len() {
                return None;
            }
            if KEEPS && self.builder.state.attributes.len() < MAX_ATTRIBUTES {
                let (name, builder) = self.name(name_start, scanned);
                let name = builder.sink.name(name, scanned.short);
                if !self
                    .builder
                    .state
                    .attributes
                    .iter()
                    .any(|it| it.name == name)
                {
                    let value = self.attribute_value(&name, value.start, value.end);
                    self.builder.state.attributes.push(Attribute {
                        name,
                        namespace: AttributeNamespace::None,
                        value,
                    });
                } else {
                    self.builder.state.had_duplicate_attributes = true;
                }
            }
        }
    }

    #[inline]
    fn attribute_value(&mut self, name: &NameOf<S>, start: usize, end: usize) -> TextOf<S> {
        if self.amp.is_in(self.units, start, end) | self.nul.is_in(self.units, start, end) {
            self.decode_without_nul(start, end, true);
            return self
                .builder
                .sink
                .value(name, self.tokenizer.scratch.chars());
        }
        self.builder
            .sink
            .value(name, U::chars(&self.units[start..end]))
    }

    /// Into `scratch`.
    fn decode_without_nul(&mut self, mut start: usize, end: usize, in_attribute: bool) {
        let (units, scratch) = (&self.units[..end], &mut self.tokenizer.scratch);
        scratch.clear();
        loop {
            let nul = U::find(units, start, 0);
            entities::decode(&units[start..nul], in_attribute, scratch);
            if nul == end {
                return;
            }
            scratch.push_unit(0xfffd);
            start = nul + 1;
        }
    }

    fn comment(&mut self, start: usize, end: usize) {
        let scratch = &mut self.tokenizer.scratch;
        scratch.clear();
        push_without_nul(scratch, U::chars(&self.units[start..end]));
        self.builder.comment(None, scratch.chars());
    }

    fn bogus_comment(&mut self, start: usize) -> Step {
        let end = U::find(self.units, start, b'>');
        self.at = end + 1;
        self.comment(start, end);
        Ok(())
    }

    /// At the `?`.
    fn instruction(&mut self, at: usize) -> Step {
        let units = self.units;
        let is_part = |it: &&U| it.low().is_ascii_alphanumeric() || matches!(it.low(), b'_' | b'-');
        let target_end = at + 1 + units[at + 1..].iter().take_while(is_part).count();
        let target = U::chars(&units[at + 1..target_end]);
        let Some(first) = byte_at(units, at + 1) else {
            return self.tag_cut_off();
        };
        let is_valid = (first.is_ascii_alphabetic() || first == b'_')
            && units
                .get(target_end)
                .is_none_or(|it| class(*it) & ENDS_UNQUOTED != 0 || it.low() == b'?')
            && !target.is_ignoring_case(b"xml")
            && !target.is_ignoring_case(b"xml-stylesheet");
        if !is_valid {
            return self.bogus_comment(at);
        }
        let start = skip_spaces(units, target_end);
        let end = U::find(units, start, b'>');
        self.at = end + 1;
        if end < units.len() {
            let end = end - usize::from(end > start && units[end - 1].low() == b'?');
            let scratch = &mut self.tokenizer.scratch;
            scratch.clear();
            push_without_nul(scratch, U::chars(&units[start..end]));
            self.builder.comment(Some(target), scratch.chars());
        }
        Ok(())
    }

    /// After `<!`.
    fn declaration(&mut self, at: usize) -> Step {
        let units = self.units;
        if has_at(units, at, b"--") {
            return self.proper_comment(at + 2);
        }
        if U::chars(&units[at..]).starts_with_ignoring_case(b"doctype") {
            let end = U::find(units, at, b'>');
            self.at = end + 1;
            self.doctype(&units[at + 7..end], end == units.len());
            return Ok(());
        }
        if !has_at(units, at, b"[CDATA[") || !self.builder.allows_cdata() {
            return self.bogus_comment(at);
        }
        let start = at + 7;
        let mut close = U::find(units, start, b'>');
        while close < units.len() && !(close >= start + 2 && has_at(units, close - 2, b"]]")) {
            close = U::find(units, close + 1, b'>');
        }
        self.require(close < units.len())?;
        self.at = close + 1;
        let end = if close < units.len() {
            close - 2
        } else {
            close
        };
        if end > start {
            let has_nul = self.nul.is_in(units, start, end);
            self.builder.text(
                U::chars(&units[start..end]),
                TextIs {
                    has_nul,
                    may_continue: false,
                },
            );
        }
        Ok(())
    }

    fn proper_comment(&mut self, start: usize) -> Step {
        let units = self.units;
        for abrupt in [&b">"[..], b"->"] {
            if has_at(units, start, abrupt) {
                self.at = start + abrupt.len();
                self.comment(start, start);
                return Ok(());
            }
        }
        let suffix = |end: usize, options: &[&[u8]]| {
            options
                .iter()
                .find(|it| U::chars(&units[start..end]).ends_with(it))
                .map(|it| it.len())
        };
        let mut close = U::find(units, start, b'>');
        while close < units.len() {
            if let Some(len) = suffix(close, &[b"--", b"--!"]) {
                self.at = close + 1;
                self.comment(start, close - len);
                return Ok(());
            }
            close = U::find(units, close + 1, b'>');
        }
        self.require(false)?;
        self.at = close;
        self.comment(
            start,
            close - suffix(close, &[b"--!", b"--", b"-"]).unwrap_or(0),
        );
        Ok(())
    }

    fn doctype(&mut self, source: &[U], is_cut_off: bool) {
        let name_start = skip_spaces(source, 0);
        let name_end = name_start
            + source[name_start..]
                .iter()
                .take_while(|it| class(**it) & SPACE == 0)
                .count();
        let (mut name, mut ids) = (Text::default(), [Text::default(), Text::default()]);
        push_name(&mut name, &source[name_start..name_end]);
        let mut at = skip_spaces(source, name_end);
        let keyword = U::chars(&source[at..]);
        let first = match () {
            () if keyword.starts_with_ignoring_case(b"public") => 0,
            () if keyword.starts_with_ignoring_case(b"system") => 1,
            () => 2,
        };
        let mut forces_quirks = is_cut_off || (first == 2 && !keyword.is_empty());
        at += 6;
        for index in first..2 {
            at = skip_spaces(source, at);
            let Some(quote @ (b'"' | b'\'')) = byte_at(source, at) else {
                forces_quirks |= index == first || at < source.len();
                break;
            };
            let end = U::find(source, at + 1, quote);
            push_without_nul(&mut ids[index], U::chars(&source[at + 1..end]));
            forces_quirks |= end == source.len();
            at = end + 1;
            if index == 1 && skip_spaces(source, at) < source.len() {
                forces_quirks = false;
            }
        }
        self.builder
            .doctype(name.chars(), ids[0].chars(), ids[1].chars(), forces_quirks);
    }

    /// The `<` of the end tag. If there is none, where one could start.
    fn end_of_raw_text(&self, tag: Tag) -> Result<usize, usize> {
        let units = self.units;
        let mut at = U::find(units, self.at, b'<');
        while at < units.len() {
            match byte_at(units, at + 1) {
                None => return Err(at),
                Some(b'/') => match has_name_at(units, at + 2, tag.name()) {
                    Some(true) => return Ok(at),
                    None => return Err(at),
                    Some(false) => {}
                },
                Some(_) => {}
            }
            at = U::find(units, at + 1, b'<');
        }
        Err(at)
    }

    fn end_of_script(&mut self) -> Option<usize> {
        let units = self.units;
        let (scanned, mut escape) = core::mem::take(&mut self.tokenizer.script_scan);
        let mut at = self.at + scanned;
        loop {
            if escape == Escape::None {
                at = U::find(units, at, b'<');
            } else {
                at += units[at..]
                    .iter()
                    .take_while(|it| !matches!(it.low(), b'<' | b'-'))
                    .count();
            }
            if !self.is_last && at + "</script>".len() > units.len() {
                self.tokenizer.script_scan = (at - self.at, escape);
                return None;
            }
            match (byte_at(units, at)?, byte_at(units, at + 1)?) {
                (b'-', _) if has_at(units, at, b"-->") => escape = Escape::None,
                (b'<', b'!') if escape == Escape::None && has_at(units, at, b"<!--") => {
                    escape = Escape::Single
                }
                (b'<', b'/') if has_name_at(units, at + 2, "script") == Some(true) => {
                    if escape != Escape::Double {
                        return Some(at);
                    }
                    escape = Escape::Single;
                }
                (b'<', _)
                    if escape == Escape::Single
                        && has_name_at(units, at + 1, "script") == Some(true) =>
                {
                    escape = Escape::Double;
                }
                _ => {}
            }
            at += 1;
        }
    }

    fn text_only(&mut self, content: Content) -> Step {
        let (units, start) = (self.units, self.at);
        let found = match content {
            Content::Script => self.end_of_script().ok_or(start),
            Content::Rcdata(tag) | Content::Rawtext(tag) if tag != Tag::Other => {
                self.end_of_raw_text(tag)
            }
            _ => Err(units.len()),
        };
        let has_references = matches!(content, Content::Rcdata(_));
        let end = match found {
            Ok(end) => {
                self.builder.state.content = Content::Data;
                end
            }
            Err(_) if self.is_last => units.len(),
            Err(end) => {
                let end = if has_references {
                    self.before_unfinished_reference(start, end)
                } else {
                    end
                };
                self.require(end > start)?;
                end
            }
        };
        self.at = end;
        if end == start {
            return Ok(());
        }
        let has_nul = self.nul.is_in(units, start, end);
        if has_references && (has_nul || self.amp.is_in(units, start, end)) {
            self.decode_without_nul(start, end, false);
        } else if has_nul {
            self.tokenizer.scratch.clear();
            push_without_nul(&mut self.tokenizer.scratch, U::chars(&units[start..end]));
        } else {
            self.builder
                .text(U::chars(&units[start..end]), TextIs::default());
            return Ok(());
        }
        self.builder
            .text(self.tokenizer.scratch.chars(), TextIs::default());
        Ok(())
    }
}
