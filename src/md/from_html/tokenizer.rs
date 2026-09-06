//! A byte-oriented HTML tokenizer that drives html5ever's tree builder.
//!
//! html5ever's own tokenizer pulls input one `char` at a time through a
//! buffer queue and pushes output one `char` at a time into tendrils; on
//! real pages that per-character overhead is about half of the whole
//! HTML→Markdown conversion. This tokenizer produces the *same token
//! stream* (same tags, attributes, text, comments, doctypes, in the same
//! order — only the chunking of character tokens differs, which the tree
//! builder is insensitive to) by scanning byte slices of the already
//! UTF-8-validated input and handing the tree builder zero-copy sub-tendrils
//! wherever no decoding is needed.
//!
//! It implements the tokenizer states of the HTML standard (§13.2.5) as
//! html5ever does, including its handling of NUL, CR/CRLF, character
//! references (named, numeric, and the attribute-value special case),
//! comments, DOCTYPEs, CDATA sections in foreign content, the RCDATA /
//! RAWTEXT / script data (with its escaped and double-escaped states) /
//! PLAINTEXT modes the tree builder switches it into, and every EOF case.
//! Where html5ever deviates from the letter of the standard (it discards a
//! BOM after every `</script>`), this follows html5ever, so the tree — and
//! therefore the Markdown — is exactly what html5ever's own tokenizer would
//! have produced. That equivalence was established by comparing the token
//! streams both deliver to the tree builder over the html5lib tokenizer and
//! tree-construction inputs (plus all their prefixes and CR/NUL variants),
//! a corpus of real pages and windows into them, and random markup.

use bun_core::strings;
use html5ever::data::{C1_REPLACEMENTS, NAMED_ENTITIES};
use html5ever::tendril::StrTendril;
use html5ever::tokenizer::states::RawKind;
use html5ever::tokenizer::{Doctype, Tag, TagKind, Token, TokenSink, TokenSinkResult};
use html5ever::{Attribute, LocalName, QualName, ns};

use super::scan;

/// Attributes per tag before duplicate detection switches from a scan of
/// the ones so far to a hash set.
const DUP_SCAN_LIMIT: usize = 32;

type NameSet = bun_collections::HashMap<LocalName, ()>;

/// Duplicate check for a tag that already has [`DUP_SCAN_LIMIT`] attributes:
/// builds (once) and consults a set of the names so far, so a tag with a
/// hundred thousand attributes is linear rather than quadratic. Out of line
/// because no real document gets here.
#[cold]
#[inline(never)]
fn is_duplicate_hashed(
    attrs: &[Attribute],
    seen: &mut Option<Box<NameSet>>,
    name: &LocalName,
) -> bool {
    let set = seen.get_or_insert_with(|| {
        let mut set = Box::new(NameSet::new());
        for a in attrs {
            set.insert(a.name.local.clone(), ());
        }
        set
    });
    set.insert(name.clone(), ()).is_some()
}

/// Internal control flow: the input ran out (in whatever state; the state's
/// EOF rule has already been applied by whoever returns this).
enum Halt {
    Eof,
}

/// How the script-data escaped states were left.
enum Escaped {
    /// `-->`: back to plain script data.
    Script,
    /// The script element ended (its end tag was emitted), or input did.
    Done(Option<Halt>),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Data,
    Raw(RawKind),
    Plaintext,
}

/// Which text state a run is decoded under: decides which bytes interrupt
/// literal text and what NUL turns into.
#[derive(Clone, Copy, PartialEq, Eq)]
enum TextMode {
    Data,
    Raw(RawKind),
    Plaintext,
}

impl TextMode {
    /// The bytes that interrupt literal text in this mode. Padded to four
    /// with a repeat so every mode scans with the same routine.
    #[inline]
    fn specials(self) -> &'static [u8; 4] {
        match self {
            TextMode::Data | TextMode::Raw(RawKind::Rcdata) => b"<&\r\0",
            TextMode::Raw(_) => b"<\r\0\0",
            TextMode::Plaintext => b"\r\0\0\0",
        }
    }
}

enum RawLt {
    /// Just a `<` character.
    Text,
    /// `<!--` in script data: the escaped states take over.
    CommentOpen,
    /// The end tag that closes the element: position after its name, name.
    EndTag(usize, LocalName),
}

/// Lets the tokenizer reuse one attribute vector for every tag instead of
/// allocating per tag; see [`super::dom::Sink::take_attr_buf`].
pub(crate) trait AttrBuf {
    fn take_attr_buf(&self) -> Vec<Attribute> {
        Vec::new()
    }
}

pub(crate) struct FastTokenizer<'t, S: TokenSink + AttrBuf> {
    src: &'t str,
    /// The same bytes as `src`, as a tendril, so text and attribute values
    /// can be handed over as shared sub-slices instead of copies.
    input: &'t StrTendril,
    sink: &'t S,
    pos: usize,
    mode: Mode,
    last_start_tag: Option<LocalName>,
    names: NameCache<'t>,
}

/// Tag and attribute names repeat heavily within a document; interning one
/// (`LocalName::from`) hashes it with SipHash and probes the static atom
/// table (or locks the dynamic one). A small direct-mapped cache of
/// `input slice → atom` in front of that turns nearly every lookup into a
/// short byte comparison and an atom clone.
struct NameCache<'t> {
    slots: [Option<(&'t str, LocalName)>; NAME_CACHE_SLOTS],
}

const NAME_CACHE_SLOTS: usize = 256;

impl<'t> NameCache<'t> {
    fn new() -> Self {
        NameCache {
            slots: [const { None }; NAME_CACHE_SLOTS],
        }
    }

    #[inline]
    fn intern(&mut self, name: &'t str) -> LocalName {
        let b = name.as_bytes();
        // Cheap spread over the length and a few bytes; a collision only
        // costs a real intern.
        let h = (b.len().wrapping_mul(31))
            ^ (b[0] as usize).wrapping_mul(7)
            ^ (b[b.len() - 1] as usize).wrapping_mul(131)
            ^ (b[b.len() / 2] as usize).wrapping_mul(17);
        let slot = &mut self.slots[h % NAME_CACHE_SLOTS];
        if let Some((k, atom)) = slot {
            // An inline byte loop: `==` on slices is a libc `memcmp` call,
            // which for names this short costs more than the comparison.
            let k = k.as_bytes();
            if k.len() == b.len() && k.iter().zip(b).all(|(x, y)| x == y) {
                return atom.clone();
            }
        }
        let atom = LocalName::from(name);
        *slot = Some((name, atom.clone()));
        atom
    }
}

/// Byte classes for the tag-parsing loops, looked up instead of branched on.
mod class {
    /// TAB, LF, FF, SPACE, and CR (which input preprocessing turns into LF):
    /// HTML whitespace as the tokenizer sees it.
    pub(super) const WS: u8 = 1;
    /// `/` or `>`: ends a tag name or attribute name.
    pub(super) const SLASH_GT: u8 = 2;
    /// `=`: ends an attribute name (after its first byte).
    pub(super) const EQ: u8 = 4;
    /// ASCII uppercase or NUL: the name cannot be interned straight from
    /// the input slice (needs lowercasing / U+FFFD).
    pub(super) const FIXUP: u8 = 8;

    pub(super) static TABLE: [u8; 256] = {
        let mut t = [0u8; 256];
        t[b'\t' as usize] = WS;
        t[b'\n' as usize] = WS;
        t[0x0C] = WS;
        t[b' ' as usize] = WS;
        t[b'\r' as usize] = WS;
        t[b'/' as usize] = SLASH_GT;
        t[b'>' as usize] = SLASH_GT;
        t[b'=' as usize] = EQ;
        t[0] = FIXUP;
        let mut c = b'A';
        while c <= b'Z' {
            t[c as usize] = FIXUP;
            c += 1;
        }
        t
    };
}

#[inline(always)]
fn class_of(b: u8) -> u8 {
    class::TABLE[b as usize]
}

/// HTML whitespace as the tokenizer sees it after input preprocessing:
/// TAB, LF, FF, SPACE, and CR (which preprocessing turns into LF).
#[inline(always)]
fn is_ws(b: u8) -> bool {
    class_of(b) & class::WS != 0
}

impl<'t, S: TokenSink + AttrBuf> FastTokenizer<'t, S> {
    pub(crate) fn new(input: &'t StrTendril, sink: &'t S) -> Self {
        let src: &str = input;
        // Input-stream preprocessing: a leading BOM is not content.
        let pos = if src.starts_with('\u{FEFF}') { 3 } else { 0 };
        FastTokenizer {
            src,
            input,
            sink,
            pos,
            mode: Mode::Data,
            last_start_tag: None,
            names: NameCache::new(),
        }
    }

    #[inline]
    fn bytes(&self) -> &'t [u8] {
        self.src.as_bytes()
    }

    #[inline]
    fn peek(&self) -> Option<u8> {
        self.bytes().get(self.pos).copied()
    }

    // ───────────────────────── emission ─────────────────────────

    #[inline]
    fn process(&mut self, token: Token) {
        match self.sink.process_token(token, 1) {
            TokenSinkResult::Continue | TokenSinkResult::EncodingIndicator(_) => {}
            // The tree builder only redirects the tokenizer in response to
            // tags; see `emit_tag`.
            TokenSinkResult::Script(_) => {
                self.mode = Mode::Data;
                // html5ever's driver re-enters `Tokenizer::feed` after every
                // `</script>`, and `feed` discards a BOM at the front of the
                // remaining input each time. Match that so the output does
                // not depend on which tokenizer handled the document.
                if self.bytes()[self.pos..].starts_with("\u{FEFF}".as_bytes()) {
                    self.pos += 3;
                }
            }
            TokenSinkResult::Plaintext => self.mode = Mode::Plaintext,
            TokenSinkResult::RawData(kind) => self.mode = Mode::Raw(kind),
        }
    }

    /// `input[start..end]` as a tendril sharing the input's buffer.
    #[inline]
    fn slice(&self, start: usize, end: usize) -> StrTendril {
        debug_assert!(self.src.is_char_boundary(start) && self.src.is_char_boundary(end));
        // SAFETY: `start`/`end` are within bounds and on char boundaries —
        // every position this tokenizer produces is either 0, the input
        // length, or adjacent to an ASCII byte it matched — and the input is
        // valid UTF-8, so the sub-slice is too. (`subtendril` would re-derive
        // this by classifying the bytes at both ends on every call.)
        unsafe {
            self.input
                .unsafe_subtendril(start as u32, (end - start) as u32)
        }
    }

    /// Characters `start..end` of the input, verbatim (zero-copy).
    #[inline]
    fn emit_slice(&mut self, start: usize, end: usize) {
        if end > start {
            let t = self.slice(start, end);
            self.process(Token::CharacterTokens(t));
        }
    }

    #[inline]
    fn emit_str(&mut self, s: &str) {
        self.process(Token::CharacterTokens(StrTendril::from_slice(s)));
    }

    fn emit_tag(&mut self, tag: Tag) {
        if tag.kind == TagKind::StartTag {
            self.last_start_tag = Some(tag.name.clone());
        }
        // A tag always returns the tokenizer to the data state unless the
        // tree builder answers with a different one.
        self.mode = Mode::Data;
        self.process(Token::TagToken(tag));
    }

    fn emit_comment(&mut self, start: usize, end: usize) {
        // Comment text is carried for fidelity with html5ever's stream (the
        // tree builder passes it to the sink, which discards it). CR and NUL
        // are left raw: nothing downstream reads comment data.
        let t = if end > start {
            self.slice(start, end)
        } else {
            StrTendril::new()
        };
        self.process(Token::CommentToken(t));
    }

    // ───────────────────────── driver ─────────────────────────

    /// Tokenizes the whole input into the sink, EOF token included, and
    /// tells the sink the input has ended (what `Tokenizer::feed` + `end` do
    /// for html5ever's own tokenizer).
    pub(crate) fn run(mut self) {
        loop {
            let halt = match self.mode {
                Mode::Data => self.data(),
                Mode::Raw(kind) => self.raw(kind),
                Mode::Plaintext => self.plaintext(),
            };
            match halt {
                Some(Halt::Eof) => break,
                // The tree builder switched modes; dispatch again.
                None => {}
            }
        }
        self.process(Token::EOFToken);
        self.sink.end();
    }

    /// Data state. Returns when input ends, or (with `None`) when the tree
    /// builder switched the tokenizer to another mode.
    fn data(&mut self) -> Option<Halt> {
        let bytes = self.bytes();
        loop {
            let start = self.pos;
            let Some(off) = scan::find_any(&bytes[start..], b"<&\r\0") else {
                self.emit_slice(start, bytes.len());
                self.pos = bytes.len();
                return Some(Halt::Eof);
            };
            let i = start + off;
            match bytes[i] {
                b'<' => {
                    self.emit_slice(start, i);
                    self.pos = i + 1;
                    if let Some(h) = self.tag_open() {
                        return Some(h);
                    }
                    if self.mode != Mode::Data {
                        return None;
                    }
                }
                0 => {
                    // The tree builder treats NUL specially per insertion
                    // mode, so it travels as its own token.
                    self.emit_slice(start, i);
                    self.pos = i + 1;
                    self.process(Token::NullCharacterToken);
                }
                // `&` or CR: something in this run needs decoding.
                _ => self.decoded_run(start, i, TextMode::Data),
            }
        }
    }

    /// After a CR at `pos - 1`: CRLF becomes the LF (left for the next text
    /// run to pick up), a lone CR becomes LF.
    #[inline]
    fn carriage_return(&mut self) {
        if self.peek() != Some(b'\n') {
            self.emit_str("\n");
        }
    }

    /// RCDATA / RAWTEXT / script data: text until the matching end tag.
    fn raw(&mut self, kind: RawKind) -> Option<Halt> {
        let bytes = self.bytes();
        let set = TextMode::Raw(kind).specials();
        loop {
            // `start..scan` is text already known to be literal.
            let start = self.pos;
            let mut scan = start;
            loop {
                let Some(off) = scan::find_any(&bytes[scan..], set) else {
                    self.emit_slice(start, bytes.len());
                    self.pos = bytes.len();
                    return Some(Halt::Eof);
                };
                let i = scan + off;
                if bytes[i] != b'<' {
                    // `&` (RCDATA), CR or NUL: decode the rest of this run.
                    self.decoded_run(start, i, TextMode::Raw(kind));
                    break;
                }
                match self.raw_less_than(kind, i) {
                    RawLt::Text => scan = i + 1,
                    RawLt::CommentOpen => {
                        // `<!--` inside a script: the "escaped" states, where
                        // `<script>…</script>` pairs nest once. All of it is
                        // still script text; only where the element ends moves.
                        self.emit_slice(start, i + 4);
                        self.pos = i + 4;
                        match self.script_data_escaped() {
                            Escaped::Script => break,
                            Escaped::Done(halt) => return halt,
                        }
                    }
                    RawLt::EndTag(name_end, name) => {
                        self.emit_slice(start, i);
                        self.pos = name_end;
                        // From here the end tag is parsed like any tag's
                        // attribute section (attributes on an end tag are a
                        // parse error but are tokenized all the same). Then
                        // back to the data state (or wherever the tree builder
                        // sends us), or out on EOF.
                        return self.tag_rest(TagKind::EndTag, name);
                    }
                }
            }
        }
    }

    /// What a `<` at `i` means in a raw-text mode.
    #[inline]
    fn raw_less_than(&self, kind: RawKind, i: usize) -> RawLt {
        let bytes = self.bytes();
        if kind == RawKind::ScriptData && bytes[i + 1..].starts_with(b"!--") {
            return RawLt::CommentOpen;
        }
        if bytes.get(i + 1) == Some(&b'/')
            && let Some((name_end, name)) = self.appropriate_end_tag(i + 2)
        {
            return RawLt::EndTag(name_end, name);
        }
        RawLt::Text
    }

    fn plaintext(&mut self) -> Option<Halt> {
        let bytes = self.bytes();
        let start = self.pos;
        match scan::find_any(&bytes[start..], TextMode::Plaintext.specials()) {
            None => self.emit_slice(start, bytes.len()),
            Some(off) => self.decoded_run(start, start + off, TextMode::Plaintext),
        }
        self.pos = bytes.len();
        Some(Halt::Eof)
    }

    /// A text run that needs decoding somewhere: `start..first` is literal
    /// and `bytes[first]` is a character reference `&`, a CR, or (outside the
    /// data state) a NUL. Decodes from there to the end of the run — the next
    /// `<` that is markup in this mode, a NUL in the data state, or EOF — into
    /// one buffer and emits it as a single token, leaving `pos` at the
    /// terminator. (Emitting the pieces separately would be equivalent, but
    /// every extra token is a trip through the tree builder and an append
    /// that may have to copy the text node built so far.)
    fn decoded_run(&mut self, start: usize, first: usize, mode: TextMode) {
        let bytes = self.bytes();
        let set = mode.specials();
        let mut buf = StrTendril::new();
        let est = (first - start).saturating_add(64).min(bytes.len() - start);
        buf.reserve(u32::try_from(est).unwrap_or(u32::MAX));
        let mut seg = start;
        let mut i = first;
        loop {
            buf.push_slice(&self.src[seg..i]);
            self.pos = i + 1;
            match bytes[i] {
                b'&' => self.char_ref(false, &mut buf),
                b'\r' => {
                    // CRLF: the LF itself is picked up as literal text.
                    if self.peek() != Some(b'\n') {
                        buf.push_char('\n');
                    }
                }
                _ => buf.push_char('\u{FFFD}'),
            }
            seg = self.pos;
            // Extend over literal text to the next byte that needs attention.
            let stop = loop {
                match scan::find_any(&bytes[self.pos..], set) {
                    None => break None,
                    Some(off) => {
                        let j = self.pos + off;
                        match (bytes[j], mode) {
                            (b'<', TextMode::Raw(kind)) => {
                                if matches!(self.raw_less_than(kind, j), RawLt::Text) {
                                    self.pos = j + 1;
                                    continue;
                                }
                                break Some((j, true));
                            }
                            (b'<' | 0, TextMode::Data) => break Some((j, true)),
                            _ => break Some((j, false)),
                        }
                    }
                }
            };
            match stop {
                Some((j, false)) => i = j,
                _ => {
                    let end = stop.map_or(bytes.len(), |(j, _)| j);
                    buf.push_slice(&self.src[seg..end]);
                    self.pos = end;
                    self.process(Token::CharacterTokens(buf));
                    return;
                }
            }
        }
    }

    /// Script data escaped / double escaped states (html5ever's
    /// `ScriptDataEscaped*`, `ScriptDataEscapeStart(DoubleEscaped)` and
    /// `ScriptDataDoubleEscapeEnd`). Entered just past a `<!--`, which the
    /// state machine reaches in "escaped dash dash". Everything here is
    /// emitted as text; the states only decide whether `</script>` closes
    /// the element (not while double-escaped, i.e. after a nested `<script>`)
    /// and when `-->` drops back to plain script data.
    fn script_data_escaped(&mut self) -> Escaped {
        let bytes = self.bytes();
        let mut text_start = self.pos;
        let mut double = false;
        let mut dashes: u32 = 2;
        loop {
            // Skip ordinary bytes in bulk.
            if dashes == 0 {
                match scan::find_any(&bytes[self.pos..], b"-<\r\0") {
                    Some(off) => self.pos += off,
                    None => self.pos = bytes.len(),
                }
            }
            let Some(&b) = bytes.get(self.pos) else {
                self.emit_slice(text_start, self.pos);
                return Escaped::Done(Some(Halt::Eof));
            };
            match b {
                b'-' => {
                    dashes += 1;
                    self.pos += 1;
                }
                b'>' if dashes >= 2 => {
                    self.pos += 1;
                    self.emit_slice(text_start, self.pos);
                    return Escaped::Script;
                }
                b'<' => {
                    dashes = 0;
                    let next = bytes.get(self.pos + 1).copied();
                    if !double {
                        if next == Some(b'/') {
                            if let Some((name_end, name)) = self.appropriate_end_tag(self.pos + 2) {
                                self.emit_slice(text_start, self.pos);
                                self.pos = name_end;
                                return Escaped::Done(self.tag_rest(TagKind::EndTag, name));
                            }
                            // `</` + letters that do not close the script:
                            // text, and back to "escaped".
                            let mut j = self.pos + 2;
                            while j < bytes.len() && bytes[j].is_ascii_alphabetic() {
                                j += 1;
                            }
                            self.pos = j;
                        } else if next.is_some_and(|c| c.is_ascii_alphabetic()) {
                            // Double escape start: `<` + a tag-like word. If
                            // the word is "script" and is properly delimited,
                            // a nested script begins.
                            let word_start = self.pos + 1;
                            let mut j = word_start;
                            while j < bytes.len() && bytes[j].is_ascii_alphabetic() {
                                j += 1;
                            }
                            match bytes.get(j) {
                                Some(&d) if is_ws(d) || d == b'/' || d == b'>' => {
                                    double = self.src[word_start..j].eq_ignore_ascii_case("script");
                                    // The delimiter is consumed as text too — a
                                    // CR via the newline handling below.
                                    self.pos = if d == b'\r' { j } else { j + 1 };
                                }
                                _ => self.pos = j,
                            }
                        } else {
                            self.pos += 1;
                        }
                    } else if next == Some(b'/') {
                        // Double escape end: `</script` properly delimited
                        // returns to (singly) escaped.
                        let word_start = self.pos + 2;
                        let mut j = word_start;
                        while j < bytes.len() && bytes[j].is_ascii_alphabetic() {
                            j += 1;
                        }
                        match bytes.get(j) {
                            Some(&d) if is_ws(d) || d == b'/' || d == b'>' => {
                                if self.src[word_start..j].eq_ignore_ascii_case("script") {
                                    double = false;
                                }
                                self.pos = if d == b'\r' { j } else { j + 1 };
                            }
                            _ => self.pos = j,
                        }
                    } else {
                        self.pos += 1;
                    }
                }
                0 => {
                    self.emit_slice(text_start, self.pos);
                    self.pos += 1;
                    self.emit_str("\u{FFFD}");
                    text_start = self.pos;
                    dashes = 0;
                }
                b'\r' => {
                    self.emit_slice(text_start, self.pos);
                    self.pos += 1;
                    self.carriage_return();
                    text_start = self.pos;
                    dashes = 0;
                }
                _ => {
                    dashes = 0;
                    self.pos += 1;
                }
            }
        }
    }

    /// In a raw-text mode, checks whether `</` at `at - 2` starts the end tag
    /// that closes it: ASCII letters matching the last start tag name
    /// (case-insensitively) followed by whitespace, `/` or `>`. Returns the
    /// position after the name and the (lowercase) name.
    fn appropriate_end_tag(&self, at: usize) -> Option<(usize, LocalName)> {
        let last = self.last_start_tag.as_ref()?;
        let bytes = self.bytes();
        let mut end = at;
        while end < bytes.len() && bytes[end].is_ascii_alphabetic() {
            end += 1;
        }
        let delim = *bytes.get(end)?;
        if !(is_ws(delim) || delim == b'/' || delim == b'>') {
            return None;
        }
        let candidate = &self.src[at..end];
        if candidate.len() == last.len() && candidate.eq_ignore_ascii_case(last) {
            Some((end, last.clone()))
        } else {
            None
        }
    }

    // ───────────────────────── tags ─────────────────────────

    /// Tag open state; `pos` is just past `<`. `Some` only at EOF.
    fn tag_open(&mut self) -> Option<Halt> {
        match self.peek() {
            None => {
                self.emit_str("<");
                Some(Halt::Eof)
            }
            Some(b'!') => {
                self.pos += 1;
                self.markup_declaration_open()
            }
            Some(b'/') => {
                self.pos += 1;
                self.end_tag_open()
            }
            Some(b'?') => {
                // `<?...>`: bogus comment starting at the `?`.
                self.bogus_comment(self.pos)
            }
            Some(c) if c.is_ascii_alphabetic() => self.tag(TagKind::StartTag),
            Some(_) => {
                // Not a tag: the `<` was text; reconsume this character as data.
                self.emit_str("<");
                None
            }
        }
    }

    /// End tag open state; `pos` is just past `</`.
    fn end_tag_open(&mut self) -> Option<Halt> {
        match self.peek() {
            None => {
                self.emit_str("</");
                Some(Halt::Eof)
            }
            Some(b'>') => {
                // `</>` is swallowed whole. It is the one construct that yields
                // a parse error and no token, and html5ever's tree builder lets
                // a parse-error token consume the "ignore a leading newline"
                // state that `<pre>`/`<listing>`/`<textarea>` set up — so
                // report it, or `<pre></>\n` would lose a newline html5ever
                // keeps.
                self.pos += 1;
                self.process(Token::ParseError(std::borrow::Cow::Borrowed("Saw </>")));
                None
            }
            Some(c) if c.is_ascii_alphabetic() => self.tag(TagKind::EndTag),
            Some(_) => self.bogus_comment(self.pos),
        }
    }

    /// Tag name state onwards; `pos` is at the first (ASCII alpha) name byte.
    fn tag(&mut self, kind: TagKind) -> Option<Halt> {
        let bytes = self.bytes();
        let start = self.pos;
        let mut end = start;
        let mut seen = 0u8;
        while end < bytes.len() {
            let c = class_of(bytes[end]);
            if c & (class::WS | class::SLASH_GT) != 0 {
                break;
            }
            seen |= c;
            end += 1;
        }
        if end == bytes.len() {
            // EOF in tag name: the tag is dropped.
            self.pos = end;
            return Some(Halt::Eof);
        }
        // No uppercase / NUL: the name can be interned from the slice.
        let clean = seen & class::FIXUP == 0;
        let name = if clean {
            self.names.intern(&self.src[start..end])
        } else {
            LocalName::from(lowercase_with_replacement(&self.src[start..end]))
        };
        self.pos = end;
        self.tag_rest(kind, name)
    }

    /// Everything after the tag name: attributes, `/`, `>`. Emits the tag.
    /// `Some` only for EOF inside the tag (the tag is then dropped, as the
    /// spec requires).
    fn tag_rest(&mut self, kind: TagKind, name: LocalName) -> Option<Halt> {
        let bytes = self.bytes();
        let mut attrs: Vec<Attribute> = Vec::new();
        let mut seen_names: Option<Box<NameSet>> = None;
        let mut had_duplicate_attributes = false;
        let mut self_closing = false;

        // Each iteration starts in the "before attribute name" state.
        'attrs: loop {
            while self.peek().is_some_and(is_ws) {
                self.pos += 1;
            }
            match self.peek() {
                None => return Some(Halt::Eof),
                Some(b'/') => {
                    self.pos += 1;
                    // Self-closing start tag state.
                    match self.peek() {
                        None => return Some(Halt::Eof),
                        Some(b'>') => {
                            self_closing = true;
                            self.pos += 1;
                            break 'attrs;
                        }
                        // Anything else: back to "before attribute name"
                        // without consuming.
                        Some(_) => continue 'attrs,
                    }
                }
                Some(b'>') => {
                    self.pos += 1;
                    break 'attrs;
                }
                Some(_) => {}
            }

            // Attribute name state. The first byte is always part of the
            // name, even `=` (that is how `<a =x>` gets an attribute named
            // "=x"); after it, `=` ends the name.
            let name_start = self.pos;
            let mut name_end = name_start + 1;
            let mut seen = class_of(bytes[name_start]);
            while name_end < bytes.len() {
                let c = class_of(bytes[name_end]);
                if c & (class::WS | class::SLASH_GT | class::EQ) != 0 {
                    break;
                }
                seen |= c;
                name_end += 1;
            }
            let clean = seen & class::FIXUP == 0;
            // `name_start` may sit inside a multi-byte character only if the
            // byte there is a UTF-8 continuation byte, which cannot happen:
            // we arrive here at an ASCII delimiter boundary or at a byte the
            // previous loop stopped *before*.
            let attr_name = if clean {
                self.names.intern(&self.src[name_start..name_end])
            } else {
                LocalName::from(lowercase_with_replacement(&self.src[name_start..name_end]))
            };
            self.pos = name_end;

            // After attribute name / before attribute value.
            let mut value: Option<StrTendril> = None;
            loop {
                match self.peek() {
                    None => return Some(Halt::Eof),
                    Some(b) if is_ws(b) => self.pos += 1,
                    Some(b'=') => {
                        self.pos += 1;
                        match self.attribute_value() {
                            Ok(v) => value = Some(v),
                            Err(h) => return Some(h),
                        }
                        break;
                    }
                    // `/`, `>`, or the start of the next attribute: this one
                    // has no value. Leave the byte for the outer loop.
                    Some(_) => break,
                }
            }

            // Duplicate attributes are dropped (first one wins). Past a few
            // dozen attributes a hash set takes over the check so a tag with
            // a hundred thousand of them is linear, not quadratic.
            let duplicate = if attrs.len() < DUP_SCAN_LIMIT {
                attrs.iter().any(|a| a.name.local == attr_name)
            } else {
                is_duplicate_hashed(&attrs, &mut seen_names, &attr_name)
            };
            if duplicate {
                had_duplicate_attributes = true;
            } else {
                if attrs.capacity() == 0 {
                    attrs = self.sink.take_attr_buf();
                }
                attrs.push(Attribute {
                    name: QualName::new(None, ns!(), attr_name),
                    value: value.unwrap_or_default(),
                });
            }

            // After a quoted value the spec wants whitespace, `/` or `>`;
            // anything else is a parse error and is reconsumed as the start
            // of the next attribute — which is what looping does.
        }

        self.emit_tag(Tag {
            kind,
            name,
            self_closing,
            attrs,
            had_duplicate_attributes,
        });
        None
    }

    /// Before attribute value state onwards; `pos` is just past `=`.
    /// `Err` for EOF inside the value (the whole tag is dropped).
    fn attribute_value(&mut self) -> Result<StrTendril, Halt> {
        let bytes = self.bytes();
        while self.peek().is_some_and(is_ws) {
            self.pos += 1;
        }
        match self.peek() {
            // EOF here reconsumes in the unquoted state, which then hits EOF
            // in a tag: dropped either way.
            None => Err(Halt::Eof),
            Some(q @ (b'"' | b'\'')) => {
                self.pos += 1;
                let start = self.pos;
                let set: &'static [u8; 4] = if q == b'"' { b"\"&\r\0" } else { b"'&\r\0" };
                // Fast path: nothing to decode before the closing quote.
                match scan::find_any(&bytes[start..], set) {
                    None => {
                        self.pos = bytes.len();
                        Err(Halt::Eof)
                    }
                    Some(off) if bytes[start + off] == q => {
                        self.pos = start + off + 1;
                        Ok(self.slice(start, start + off))
                    }
                    Some(_) => self.attribute_value_slow(q, set),
                }
            }
            Some(b'>') => {
                // `<a href=>`: missing value; the tag ends here. Leave `>`
                // for the caller.
                Ok(StrTendril::new())
            }
            Some(_) => {
                // Unquoted: up to whitespace or `>`.
                let start = self.pos;
                match scan::find_any(&bytes[start..], b"\t\n\x0C \r>&\0") {
                    None => {
                        self.pos = bytes.len();
                        Err(Halt::Eof)
                    }
                    Some(off) if !matches!(bytes[start + off], b'&' | 0) => {
                        self.pos = start + off;
                        Ok(self.slice(start, start + off))
                    }
                    Some(_) => self.attribute_value_slow(0, b"\t\n\x0C \r>&\0"),
                }
            }
        }
    }

    /// Attribute value containing character references, CRs or NULs.
    /// `quote` is the closing quote, or 0 for an unquoted value. `pos` is at
    /// the start of the value.
    fn attribute_value_slow<const N: usize>(
        &mut self,
        quote: u8,
        set: &[u8; N],
    ) -> Result<StrTendril, Halt> {
        let bytes = self.bytes();
        let mut out = StrTendril::new();
        loop {
            let start = self.pos;
            let Some(off) = scan::find_any(&bytes[start..], set) else {
                self.pos = bytes.len();
                return Err(Halt::Eof);
            };
            let i = start + off;
            out.push_slice(&self.src[start..i]);
            let b = bytes[i];
            self.pos = i + 1;
            match b {
                b'&' => self.char_ref(true, &mut out),
                0 => out.push_char('\u{FFFD}'),
                _ if quote != 0 && b == quote => return Ok(out),
                b'\r' if quote != 0 => {
                    if self.peek() == Some(b'\n') {
                        self.pos += 1;
                    }
                    out.push_char('\n');
                }
                // Unquoted terminator (whitespace, CR included, or `>`): not
                // consumed.
                _ => {
                    self.pos = i;
                    return Ok(out);
                }
            }
        }
    }

    // ───────────────────── character references ─────────────────────

    /// Character reference state; `pos` is just past the `&`. Appends the
    /// expansion — or `&` itself when this is not a reference — to `out` and
    /// leaves `pos` after whatever was consumed. Mirrors html5ever's
    /// `CharRefTokenizer`, including where it deviates from a naive reading
    /// of the spec (e.g. overflow handling of numeric references).
    fn char_ref(&mut self, in_attribute: bool, out: &mut StrTendril) {
        let bytes = self.bytes();
        match self.peek() {
            Some(b'#') => {
                let after_hash = self.pos + 1;
                let (base, digits_start) = match bytes.get(after_hash) {
                    Some(b'x' | b'X') => (16u32, after_hash + 1),
                    _ => (10u32, after_hash),
                };
                let mut i = digits_start;
                let mut num: u32 = 0;
                let mut too_big = false;
                while let Some(d) = bytes.get(i).and_then(|&b| (b as char).to_digit(base)) {
                    num = num.wrapping_mul(base);
                    if num > 0x10FFFF {
                        too_big = true;
                    }
                    num = num.wrapping_add(d);
                    i += 1;
                }
                if i == digits_start {
                    // `&#` / `&#x` with no digits: not a reference.
                    out.push_char('&');
                    return;
                }
                if bytes.get(i) == Some(&b';') {
                    i += 1;
                }
                self.pos = i;
                out.push_char(numeric_char_ref(num, too_big));
            }
            Some(b) if b.is_ascii_alphanumeric() => {
                let name_start = self.pos;
                // The handful of references that make up nearly all of real
                // markup, matched directly. Each ends in `;`, and no entity
                // name continues past a `;`, so these are also the longest
                // matches the table walk below would find.
                let rest = &bytes[name_start..];
                let common: Option<(usize, char)> = match b {
                    b'a' if rest.starts_with(b"amp;") => Some((4, '&')),
                    b'l' if rest.starts_with(b"lt;") => Some((3, '<')),
                    b'g' if rest.starts_with(b"gt;") => Some((3, '>')),
                    b'q' if rest.starts_with(b"quot;") => Some((5, '"')),
                    b'n' if rest.starts_with(b"nbsp;") => Some((5, '\u{A0}')),
                    _ => None,
                };
                if let Some((len, c)) = common {
                    self.pos = name_start + len;
                    out.push_char(c);
                    return;
                }
                // Longest match against the entity table, which also holds
                // every proper prefix of every name (mapped to 0) so the
                // scan knows when to stop.
                let mut len = 0usize;
                let mut matched: Option<(usize, (u32, u32))> = None;
                while let Some(&b) = bytes.get(name_start + len) {
                    if !b.is_ascii() {
                        break;
                    }
                    let Some(&m) = NAMED_ENTITIES.get(&self.src[name_start..name_start + len + 1])
                    else {
                        break;
                    };
                    len += 1;
                    if m.0 != 0 {
                        matched = Some((len, m));
                    }
                }
                let Some((mlen, (c1, c2))) = matched else {
                    out.push_char('&');
                    return;
                };
                let last_matched = bytes[name_start + mlen - 1];
                let next_after = bytes.get(name_start + mlen).copied();
                // Historical attribute rule: `&not=` / `&notx` in an
                // attribute value are left alone.
                if in_attribute
                    && last_matched != b';'
                    && next_after.is_some_and(|c| c == b'=' || c.is_ascii_alphanumeric())
                {
                    out.push_char('&');
                    return;
                }
                self.pos = name_start + mlen;
                out.push_char(char::from_u32(c1).unwrap_or('\u{FFFD}'));
                if c2 != 0 {
                    out.push_char(char::from_u32(c2).unwrap_or('\u{FFFD}'));
                }
            }
            _ => out.push_char('&'),
        }
    }

    // ─────────────── comments, doctype, CDATA ───────────────

    /// Markup declaration open state; `pos` is just past `<!`.
    fn markup_declaration_open(&mut self) -> Option<Halt> {
        let rest = &self.bytes()[self.pos..];
        if rest.starts_with(b"--") {
            self.pos += 2;
            return self.comment();
        }
        if rest.len() >= 7 && rest[..7].eq_ignore_ascii_case(b"doctype") {
            self.pos += 7;
            return self.doctype();
        }
        if rest.starts_with(b"[CDATA[")
            && self
                .sink
                .adjusted_current_node_present_but_not_in_html_namespace()
        {
            self.pos += 7;
            return self.cdata_section();
        }
        self.bogus_comment(self.pos)
    }

    /// Bogus comment: everything up to the next `>` (or EOF).
    fn bogus_comment(&mut self, data_start: usize) -> Option<Halt> {
        let bytes = self.bytes();
        match scan::find_byte(&bytes[data_start..], b'>') {
            Some(off) => {
                self.emit_comment(data_start, data_start + off);
                self.pos = data_start + off + 1;
                None
            }
            None => {
                self.emit_comment(data_start, bytes.len());
                self.pos = bytes.len();
                Some(Halt::Eof)
            }
        }
    }

    /// Comment states; `pos` is just past `<!--`.
    fn comment(&mut self) -> Option<Halt> {
        let bytes = self.bytes();
        let data_start = self.pos;
        // `<!-->` and `<!--->` close immediately.
        if bytes[data_start..].starts_with(b">") {
            self.emit_comment(data_start, data_start);
            self.pos = data_start + 1;
            return None;
        }
        if bytes[data_start..].starts_with(b"->") {
            self.emit_comment(data_start, data_start);
            self.pos = data_start + 2;
            return None;
        }
        // Otherwise the comment runs to the first `--` (plus any further
        // `-`) that is followed by `>` or `!>`.
        let mut search = data_start;
        loop {
            let Some(off) = strings::index_of(&bytes[search..], b"--") else {
                self.emit_comment(
                    data_start,
                    comment_data_end_at_eof(&bytes[data_start..]) + data_start,
                );
                self.pos = bytes.len();
                return Some(Halt::Eof);
            };
            let dashes = search + off;
            let mut k = dashes + 2;
            while bytes.get(k) == Some(&b'-') {
                k += 1;
            }
            match bytes.get(k) {
                Some(b'>') => {
                    self.emit_comment(data_start, k - 2);
                    self.pos = k + 1;
                    return None;
                }
                Some(b'!') if bytes.get(k + 1) == Some(&b'>') => {
                    self.emit_comment(data_start, k - 2);
                    self.pos = k + 2;
                    return None;
                }
                None => {
                    self.emit_comment(
                        data_start,
                        comment_data_end_at_eof(&bytes[data_start..]) + data_start,
                    );
                    self.pos = bytes.len();
                    return Some(Halt::Eof);
                }
                Some(_) => search = k,
            }
        }
    }

    /// CDATA section (foreign content only); `pos` is just past `<![CDATA[`.
    fn cdata_section(&mut self) -> Option<Halt> {
        let bytes = self.bytes();
        let end = strings::index_of(&bytes[self.pos..], b"]]>").map(|off| self.pos + off);
        let stop = end.unwrap_or(bytes.len());
        // The section's text, with the same NUL / CR treatment as data.
        while self.pos < stop {
            let start = self.pos;
            match scan::find_any(&bytes[start..stop], b"\r\0") {
                None => {
                    self.emit_slice(start, stop);
                    self.pos = stop;
                }
                Some(off) => {
                    let i = start + off;
                    self.emit_slice(start, i);
                    self.pos = i + 1;
                    if bytes[i] == b'\r' {
                        self.carriage_return();
                    } else {
                        self.process(Token::NullCharacterToken);
                    }
                }
            }
        }
        match end {
            Some(e) => {
                self.pos = e + 3;
                None
            }
            None => Some(Halt::Eof),
        }
    }

    /// DOCTYPE states; `pos` is just past `<!doctype`.
    fn doctype(&mut self) -> Option<Halt> {
        let mut d = Doctype::default();
        let halt = self.doctype_into(&mut d);
        self.process(Token::DoctypeToken(d));
        halt
    }

    fn doctype_into(&mut self, d: &mut Doctype) -> Option<Halt> {
        #[derive(Clone, Copy, PartialEq)]
        enum Id {
            Public,
            System,
        }
        let eof = |d: &mut Doctype| {
            d.force_quirks = true;
            Some(Halt::Eof)
        };

        // DOCTYPE state / before DOCTYPE name state.
        match self.peek() {
            None => return eof(d),
            Some(b) if is_ws(b) => self.pos += 1,
            Some(_) => {}
        }
        while self.peek().is_some_and(is_ws) {
            self.pos += 1;
        }
        match self.peek() {
            None => return eof(d),
            Some(b'>') => {
                self.pos += 1;
                d.force_quirks = true;
                return None;
            }
            Some(_) => {}
        }
        // DOCTYPE name state.
        let mut name = String::new();
        loop {
            match self.peek() {
                None => {
                    d.name = Some(name.into());
                    return eof(d);
                }
                Some(b) if is_ws(b) => break,
                Some(b'>') => {
                    d.name = Some(name.into());
                    self.pos += 1;
                    return None;
                }
                Some(_) => self.push_lower_char(&mut name),
            }
        }
        d.name = Some(name.into());

        // After DOCTYPE name state.
        while self.peek().is_some_and(is_ws) {
            self.pos += 1;
        }
        let rest = &self.bytes()[self.pos..];
        let mut which = if rest.is_empty() {
            return eof(d);
        } else if rest[0] == b'>' {
            self.pos += 1;
            return None;
        } else if rest.len() >= 6 && rest[..6].eq_ignore_ascii_case(b"public") {
            self.pos += 6;
            Id::Public
        } else if rest.len() >= 6 && rest[..6].eq_ignore_ascii_case(b"system") {
            self.pos += 6;
            Id::System
        } else {
            d.force_quirks = true;
            return self.bogus_doctype();
        };

        loop {
            // After DOCTYPE public/system keyword state.
            let saw_ws = self.peek().is_some_and(is_ws);
            while self.peek().is_some_and(is_ws) {
                self.pos += 1;
            }
            let _ = saw_ws; // missing whitespace is only a parse error
            let quote = match self.peek() {
                None => return eof(d),
                Some(q @ (b'"' | b'\'')) => q,
                Some(b'>') => {
                    self.pos += 1;
                    d.force_quirks = true;
                    return None;
                }
                Some(_) => {
                    d.force_quirks = true;
                    return self.bogus_doctype();
                }
            };
            self.pos += 1;
            // DOCTYPE public/system identifier (quoted) state.
            let mut id = String::new();
            loop {
                match self.peek() {
                    None => {
                        set_id(d, which == Id::Public, id);
                        return eof(d);
                    }
                    Some(b) if b == quote => {
                        self.pos += 1;
                        break;
                    }
                    Some(b'>') => {
                        set_id(d, which == Id::Public, id);
                        self.pos += 1;
                        d.force_quirks = true;
                        return None;
                    }
                    Some(0) => {
                        id.push('\u{FFFD}');
                        self.pos += 1;
                    }
                    Some(b'\r') => {
                        id.push('\n');
                        self.pos += 1;
                        if self.peek() == Some(b'\n') {
                            self.pos += 1;
                        }
                    }
                    Some(_) => self.push_char(&mut id),
                }
            }
            set_id(d, which == Id::Public, id);

            // After DOCTYPE public/system identifier state.
            if which == Id::System {
                while self.peek().is_some_and(is_ws) {
                    self.pos += 1;
                }
                return match self.peek() {
                    None => eof(d),
                    Some(b'>') => {
                        self.pos += 1;
                        None
                    }
                    // No force-quirks here, per spec.
                    Some(_) => self.bogus_doctype(),
                };
            }
            // After public identifier: optional whitespace, then either `>`
            // or a system identifier.
            let saw_ws = self.peek().is_some_and(is_ws);
            while self.peek().is_some_and(is_ws) {
                self.pos += 1;
            }
            let _ = saw_ws;
            match self.peek() {
                None => return eof(d),
                Some(b'>') => {
                    self.pos += 1;
                    return None;
                }
                Some(b'"' | b'\'') => {
                    which = Id::System;
                    // Loop: parse the system identifier (quote consumed there).
                    continue;
                }
                Some(_) => {
                    d.force_quirks = true;
                    return self.bogus_doctype();
                }
            }
        }

        fn set_id(d: &mut Doctype, public: bool, id: String) {
            if public {
                d.public_id = Some(id.into());
            } else {
                d.system_id = Some(id.into());
            }
        }
    }

    /// Bogus DOCTYPE state: skip to `>`.
    fn bogus_doctype(&mut self) -> Option<Halt> {
        let bytes = self.bytes();
        match scan::find_byte(&bytes[self.pos..], b'>') {
            Some(off) => {
                self.pos += off + 1;
                None
            }
            None => {
                self.pos = bytes.len();
                Some(Halt::Eof)
            }
        }
    }

    /// Appends the character at `pos` (lowercasing ASCII, NUL → U+FFFD) and
    /// advances past it.
    fn push_lower_char(&mut self, s: &mut String) {
        let b = self.bytes()[self.pos];
        if b.is_ascii() {
            s.push(if b == 0 {
                '\u{FFFD}'
            } else {
                b.to_ascii_lowercase() as char
            });
            self.pos += 1;
        } else {
            let c = self.src[self.pos..].chars().next().unwrap();
            s.push(c);
            self.pos += c.len_utf8();
        }
    }

    fn push_char(&mut self, s: &mut String) {
        let c = self.src[self.pos..].chars().next().unwrap();
        s.push(c);
        self.pos += c.len_utf8();
    }
}

/// For a comment cut off by EOF, how much of `data` html5ever reports: a
/// trailing `-`, `--` or `--!` is still pending in the comment-end states
/// and never makes it into the comment text.
fn comment_data_end_at_eof(data: &[u8]) -> usize {
    if data.ends_with(b"--!") {
        return data.len() - 3;
    }
    let dashes = data.iter().rev().take_while(|&&b| b == b'-').count();
    data.len() - dashes.min(2)
}

/// ASCII-lowercases and maps NUL to U+FFFD.
fn lowercase_with_replacement(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        out.push(match c {
            '\0' => '\u{FFFD}',
            c => c.to_ascii_lowercase(),
        });
    }
    out
}

/// The numeric character reference end state's mapping.
fn numeric_char_ref(num: u32, too_big: bool) -> char {
    match num {
        n if n > 0x10FFFF || too_big => '\u{FFFD}',
        0x00 | 0xD800..=0xDFFF => '\u{FFFD}',
        0x80..=0x9F => {
            C1_REPLACEMENTS[(num - 0x80) as usize].unwrap_or_else(|| char::from_u32(num).unwrap())
        }
        n => char::from_u32(n).expect("range checked above"),
    }
}

/// Token-stream equivalence with html5ever's own tokenizer: both are run in
/// front of the same tree builder (so state switches come from the real
/// insertion modes) and the tokens each delivers are recorded and compared.
///
/// Miri-only (`bun run rust:miri -p bun_md`): a native `cargo test` binary
/// cannot link the highway kernels behind `bun_core::strings`, which Miri
/// replaces with scalar fallbacks. The same comparison was run natively out of
/// tree over the html5lib tokenizer and tree-construction inputs (with every
/// prefix, in every raw-text context, with CR/NUL variants), a corpus of real
/// pages and random windows into them, and millions of generated documents;
/// the generator below is that one with a Miri-sized iteration count.
#[cfg(all(test, miri))]
mod tests {
    use core::cell::RefCell;

    use html5ever::TokenizerResult;
    use html5ever::tendril::StrTendril;
    use html5ever::tokenizer::{
        BufferQueue, TagKind, Token, TokenSink, TokenSinkResult, Tokenizer, TokenizerOpts,
    };
    use html5ever::tree_builder::{TreeBuilder, TreeBuilderOpts};

    use super::super::{depth, dom};
    use super::FastTokenizer;

    /// Records a normalized transcript of every token (and every tokenizer
    /// state switch the tree builder requests) on its way through.
    struct Recorder<S> {
        inner: S,
        log: RefCell<Vec<String>>,
        text: RefCell<String>,
    }

    impl<S: TokenSink> Recorder<S> {
        fn new(inner: S) -> Self {
            Recorder {
                inner,
                log: RefCell::new(Vec::new()),
                text: RefCell::new(String::new()),
            }
        }
        fn flush(&self) {
            let mut t = self.text.borrow_mut();
            if !t.is_empty() {
                self.log.borrow_mut().push(format!("text {:?}", *t));
                t.clear();
            }
        }
    }

    impl<S> super::AttrBuf for Recorder<S> {}

    impl<S: TokenSink> TokenSink for Recorder<S> {
        type Handle = S::Handle;
        fn process_token(&self, token: Token, line: u64) -> TokenSinkResult<S::Handle> {
            match &token {
                // Chunking of character tokens is allowed to differ.
                Token::CharacterTokens(t) => self.text.borrow_mut().push_str(t),
                Token::NullCharacterToken => self.text.borrow_mut().push('\0'),
                Token::ParseError(_) => {}
                Token::TagToken(tag) => {
                    self.flush();
                    let mut s = format!(
                        "{} {}{}{}",
                        if tag.kind == TagKind::StartTag {
                            "start"
                        } else {
                            "end"
                        },
                        &*tag.name,
                        if tag.self_closing { " /" } else { "" },
                        if tag.had_duplicate_attributes {
                            " (dup)"
                        } else {
                            ""
                        }
                    );
                    for a in &tag.attrs {
                        s.push_str(&format!(" [{}={:?}]", &*a.name.local, &*a.value));
                    }
                    self.log.borrow_mut().push(s);
                }
                Token::CommentToken(c) => {
                    self.flush();
                    // Comment text is discarded downstream; ours leaves CR and
                    // NUL raw in it, so apply input preprocessing before
                    // comparing.
                    let mut norm = String::new();
                    let mut chars = c.chars().peekable();
                    while let Some(c) = chars.next() {
                        match c {
                            '\r' => {
                                if chars.peek() == Some(&'\n') {
                                    chars.next();
                                }
                                norm.push('\n');
                            }
                            '\0' => norm.push('\u{FFFD}'),
                            c => norm.push(c),
                        }
                    }
                    self.log.borrow_mut().push(format!("comment {norm:?}"));
                }
                Token::DoctypeToken(d) => {
                    self.flush();
                    self.log.borrow_mut().push(format!(
                        "doctype {:?} {:?} {:?} quirks={}",
                        d.name, d.public_id, d.system_id, d.force_quirks
                    ));
                }
                Token::EOFToken => {
                    self.flush();
                    self.log.borrow_mut().push("eof".into());
                }
            }
            let r = self.inner.process_token(token, line);
            match &r {
                TokenSinkResult::Continue | TokenSinkResult::EncodingIndicator(_) => {}
                TokenSinkResult::Script(_) => self.log.borrow_mut().push("-> script".into()),
                TokenSinkResult::Plaintext => self.log.borrow_mut().push("-> plaintext".into()),
                TokenSinkResult::RawData(k) => self.log.borrow_mut().push(format!("-> {k:?}")),
            }
            r
        }
        fn end(&self) {
            self.flush();
            self.inner.end();
        }
        fn adjusted_current_node_present_but_not_in_html_namespace(&self) -> bool {
            self.inner
                .adjusted_current_node_present_but_not_in_html_namespace()
        }
    }

    fn opts() -> TreeBuilderOpts {
        TreeBuilderOpts {
            scripting_enabled: true,
            drop_doctype: true,
            ..Default::default()
        }
    }

    fn reference_stream(html: &str) -> Vec<String> {
        let arena = dom::Arenas::with_capacity(64);
        let rec = Recorder::new(depth::DepthLimiter::new(TreeBuilder::new(
            dom::Sink::new(&arena),
            opts(),
        )));
        let tok = Tokenizer::new(rec, TokenizerOpts::default());
        let q = BufferQueue::default();
        q.push_back(StrTendril::from(html));
        while !matches!(tok.feed(&q), TokenizerResult::Done) {}
        tok.end();
        tok.sink.log.take()
    }

    fn our_stream(html: &str) -> Vec<String> {
        let arena = dom::Arenas::with_capacity(64);
        let rec = Recorder::new(depth::DepthLimiter::new(TreeBuilder::new(
            dom::Sink::new(&arena),
            opts(),
        )));
        let input = StrTendril::from(html);
        FastTokenizer::new(&input, &rec).run();
        rec.log.take()
    }

    #[track_caller]
    fn assert_same(html: &str) {
        let reference = reference_stream(html);
        let ours = our_stream(html);
        assert_eq!(reference, ours, "token streams differ for input {html:?}");
    }

    /// One input per tokenizer corner (the out-of-tree runs also fed every
    /// prefix of each, inside every raw-text context).
    const CASES: &[&str] = &[
        "<p class=a id='b' data-x=\"c\">text</p>",
        "<A HREF=X>Y</A><br/><img src=i alt>",
        "<a b='1' b=2 c d=>e</a>",
        "<a =x==y z= w/>",
        "<a\tb\nc\x0cd e\rf>",
        "<a b='x\r\ny' c=\"&amp;&noti&notin;&#x41;&#65&#;&#xZ\">",
        "<a href='?x=1&lang=en&copy=2&notit;'>",
        "&amp; &amp &AMP &lt;&LT&gt &notin; &notit; &noti; &xyz; &; & &#38; &#x26;",
        "&#0;&#128;&#x9F;&#xD800;&#xDFFF;&#x10FFFF;&#x110000;&#99999999999;&#xFDD0;&#11;",
        "a\r\nb\rc\n\rd\0e",
        "<!DOCTYPE html><html><head><title>t&amp;<b></title></head><body>x</body></html>",
        "<!doctype HTML PUBLIC \"-//W3C//DTD HTML 4.01//EN\" 'http://www.w3.org/TR/html4/strict.dtd'>",
        "<!DOCTYPE html SYSTEM \"about:legacy-compat\"><!DOCTYPE><!DOCTYPE >x<!DOCTYPEhtml>",
        "<!DOCTYPE html PUBLIC><!DOCTYPE html PUBLIC \"x\">< !DOCTYPE html publicx><!DOCTYPE a b>",
        "<!DOCTYPE html PUBLIC 'a' 'b' c><!DOCTYPE html system 'a'b><!DOCTYPE \0n\0 PUBLIC '\0'>",
        "<!-- c --><!--><!---><!----><!-----><!-- --!><!-- --!x --><!--<!---->x",
        "<!-- a <!-- b --> c --><!-x><!><?php x ?><? ><//><</p></3></ >",
        "<script>a<b</script ><script>x</script/><script>y</script z=1>",
        "<script><!-- <script> </script> </script> --> </script>x",
        "<script><!-- a --></script><script><!--- b ---!></script><script><!--</script>",
        "<script><!-- <script></script </script><script <!-- </script>-></script>x",
        "<script><!--<sCrIpT>a</SCRIPT>b--></script>c<script>'</scrip </scriptx </script >",
        "<script>\0<!--\0-\0-->\r\n</script>",
        "<style>a<b>&amp;</style><xmp><a></xmp><iframe><x></iframe><noembed>n</noembed><noframes>f</noframes>",
        "<textarea>&lt;<b>\r\n</textareax></textarea ><title></title/>x</title>",
        "<noscript><p>&amp;</noscript><plaintext><b>&amp;\0</plaintext>never",
        "<svg><![CDATA[a<b&c]]>d<![CDATA[]]]]>]]><![CDATA[x\0y\r\nz</svg><![CDATA[q]]>",
        "<math><mi><![CDATA[x]]></mi><mtext><![CDATA[y]]></mtext></math>",
        "<svg><script>a<b</script><style>&amp;</style><title>&lt;</title></svg>",
        "<table><tr><td>a<td>b</table><select><option>x<optgroup><select>y",
        "<template>a<b>b</template><frameset><frame></frameset>",
        "\u{feff}<p>\u{feff}x</p><script></script>\u{feff}y",
        "<p>caf\u{e9} <\u{e9}l\u{e9}ment attr\u{e9}=1>日本語</\u{e9}>",
        "<a b=`c` d='e'f=g\"h>i</a j>",
        "<br/><br /><br/ ><wbr><input type=checkbox checked><img src='a b' />",
        "</",
        "<",
        "<a",
        "</a",
        "<!",
        "<!-",
        "<!--",
        "&",
        "&#",
        "&#x",
        "&am",
        "<a b",
        "<a b=",
        "<a b='",
    ];

    #[test]
    fn matches_html5ever_on_corner_cases() {
        for case in CASES {
            assert_same(case);
        }
    }

    #[test]
    fn matches_html5ever_on_generated_markup() {
        const PIECES: &[&str] = &[
            "<",
            ">",
            "/",
            "!",
            "-",
            "--",
            "?",
            "&",
            "#",
            "x",
            ";",
            "=",
            "\"",
            "'",
            "`",
            " ",
            "\n",
            "\r",
            "\t",
            "\x0c",
            "\0",
            "a",
            "Z",
            "1",
            "\u{e9}",
            "\u{feff}",
            "script",
            "SCRIPT",
            "style",
            "textarea",
            "title",
            "xmp",
            "noscript",
            "plaintext",
            "svg",
            "math",
            "mi",
            "desc",
            "table",
            "td",
            "select",
            "template",
            "p",
            "[CDATA[",
            "]]>",
            "DOCTYPE",
            "public",
            "system",
            "amp",
            "amp;",
            "lt;",
            "notin;",
            "not",
            "#x41;",
            "#65",
            "#xD800;",
            "<!--",
            "-->",
            "--!>",
            "</",
            "<script>",
            "</script>",
            "</script ",
            "<svg>",
            "href",
            "=\"",
            "='",
            " = ",
        ];
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut buf = String::new();
        for _ in 0..40 {
            buf.clear();
            let len = (next() % 96) as usize + 1;
            while buf.len() < len {
                buf.push_str(PIECES[(next() % PIECES.len() as u64) as usize]);
            }
            assert_same(&buf);
        }
    }
}
