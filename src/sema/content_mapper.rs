//! Content mappers, new in TypeScript 7.1. A content mapper is a program that turns a file TypeScript can't read, such as
//! a `.vue` file, into TypeScript. A `tsconfig.json` lists them under `contentMappers`. Errors in the generated text are
//! reported at the matching position in the original file.
//!
//! A port of `internal/contentmapper`, `internal/spanmap` and `tspath/extensionrewrite.go`.
//!
//! Nothing here starts a process. A [`Transport`] does that, and a program only has one if the person who started the
//! check asked for it. Every response is untrusted: each offset is checked against the text it points into before it's
//! used, and no allocation is sized from a number in a response.

use crate::json::Json;
use crate::resolve::{
    displayed_path, equate_string_case_insensitive, file_extension_is, is_declaration_file_name,
    is_rooted_disk_path, path_is_relative,
};
use crate::util::SharedSort;
use crate::verify::{ConfigLocation, Problem};
use bstr::ByteSlice;
use bun_core::strings;
use bun_threading::Guarded;
use std::ops::Range;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// `contentmapper.Mapper`: an entry of `contentMappers`, with what its package's `package.json` says about it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mapper {
    /// `Definition.Package`
    pub package: Vec<u8>,
    /// `Definition.Extensions`, each with its `.`.
    pub extensions: Vec<Vec<u8>>,
    /// `Definition.OutputExtensions`, sorted by source extension.
    pub output_extensions: Vec<ExtensionRewrite>,
    /// `Definition.Options`
    pub options: Option<Json>,
    /// `Manifest.Name` and `Manifest.Version`
    pub name: Vec<u8>,
    pub version: Vec<u8>,
    /// `Manifest.Exec`: the program to run and its arguments.
    pub exec: Vec<Vec<u8>>,
    /// `Manifest.DynamicConfig`
    pub dynamic_config: bool,
    /// `PackageDirectory`: the package's real directory, which the program runs in.
    pub package_directory: Vec<u8>,
}

impl Mapper {
    /// `Identity`: `name@version`, or the name if the package has no version. Mappers with the same identity share a
    /// process.
    pub fn identity(&self) -> Vec<u8> {
        match self.version.is_empty() {
            true => self.name.clone(),
            false => [&self.name[..], b"@", &self.version].concat(),
        }
    }
}

/// `supportedVirtualExtensions`
const SUPPORTED_VIRTUAL_EXTENSIONS: [&[u8]; 9] = [
    b".js", b".jsx", b".mjs", b".cjs", b".ts", b".tsx", b".mts", b".cts", b".json",
];

/// `IsValidExtension`
pub(crate) fn is_valid_extension(extension: &[u8]) -> bool {
    extension.len() > 1 && extension[0] == b'.' && !contains_path_separator(extension)
}

pub(crate) fn contains_path_separator(extension: &[u8]) -> bool {
    strings::index_of_any(extension, b"/\\").is_some()
}

/// `HasReservedSourceExtension`: true if `extension` ends with one of TypeScript's own extensions, in any case.
pub(crate) fn has_reserved_source_extension(extension: &[u8]) -> bool {
    const NATIVE: [&[u8]; 9] = SUPPORTED_VIRTUAL_EXTENSIONS;
    NATIVE.iter().any(|native| {
        extension.len() >= native.len()
            && extension[extension.len() - native.len()..].eq_ignore_ascii_case(native)
    })
}

/// `GetLongestExtensionFromPath`
fn longest_extension<'e>(
    path: &[u8],
    extensions: impl Iterator<Item = &'e [u8]>,
    is_case_sensitive: bool,
) -> &'e [u8] {
    let mut longest: &[u8] = b"";
    for extension in extensions {
        if extension.len() > longest.len()
            && path.len() >= extension.len()
            && equal(
                &path[path.len() - extension.len()..],
                extension,
                is_case_sensitive,
            )
        {
            longest = extension;
        }
    }
    longest
}

fn equal(a: &[u8], b: &[u8], is_case_sensitive: bool) -> bool {
    a == b || !is_case_sensitive && equate_string_case_insensitive(a, b)
}

/// `ContentMapperExtensions`
pub fn extensions_of(mappers: &[Mapper]) -> impl Iterator<Item = &[u8]> {
    let extensions = mappers.iter().flat_map(|mapper| &mapper.extensions);
    extensions.map(|extension| &extension[..])
}

/// `ExtensionIsOneOf(contentMapperExtensions)`: true if a mapper reads the file at `path`.
pub fn is_mapped(mappers: &[Mapper], path: &[u8]) -> bool {
    extensions_of(mappers).any(|extension| file_extension_is(path, extension))
}

/// `GetContentMapperForFileName`: returns the index of the mapper that registers the longest extension `path` ends with.
pub fn mapper_for_file_name(
    mappers: &[Mapper],
    path: &[u8],
    is_case_sensitive: bool,
) -> Option<usize> {
    let extension = longest_extension(path, extensions_of(mappers), is_case_sensitive);
    mappers.iter().position(|mapper| {
        let mut own = mapper.extensions.iter();
        own.any(|it| equal(extension, it, is_case_sensitive))
    })
}

/// `tspath.ExtensionRewrite`: files with the extension `source` are built into files with the extension `target`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExtensionRewrite {
    pub source: Vec<u8>,
    pub target: Vec<u8>,
}

/// `getContentMapperOutputExtension`
pub(crate) fn output_extension<'m>(
    mapper: &'m Mapper,
    source: &[u8],
    is_case_sensitive: bool,
) -> Option<&'m [u8]> {
    let outputs = &mapper.output_extensions;
    let exact = outputs.iter().find(|it| it.source == source);
    let found = exact.or_else(|| {
        let mut outputs = outputs.iter().filter(|_| !is_case_sensitive);
        outputs.find(|it| it.source.eq_ignore_ascii_case(source))
    });
    found.map(|it| &it.target[..])
}

/// `computeContentMapperExtensionRewrites`. Empty unless some extension maps to a different one.
pub(crate) fn extension_rewrites(
    mappers: &[Mapper],
    is_case_sensitive: bool,
) -> Vec<ExtensionRewrite> {
    let mut rewrites = Vec::new();
    let mut has_non_identity_mapping = false;
    for mapper in mappers {
        for source in &mapper.extensions {
            let target = output_extension(mapper, source, is_case_sensitive)
                .filter(|target| !equal(target, source, is_case_sensitive));
            has_non_identity_mapping |= target.is_some();
            rewrites.push(ExtensionRewrite {
                source: source.clone(),
                target: target.unwrap_or(source).to_vec(),
            });
        }
    }
    if !has_non_identity_mapping {
        return Vec::new();
    }
    // An identity entry stops a shorter mapping from claiming a longer registered extension.
    rewrites.shared_sort_by_key(|it| std::cmp::Reverse(it.source.len()));
    rewrites
}

/// `getExtensionRewrite`: returns the rewrite with the longest source extension that `path` ends with.
pub(crate) fn extension_rewrite<'r>(
    path: &[u8],
    rewrites: &'r [ExtensionRewrite],
    is_case_sensitive: bool,
) -> Option<&'r ExtensionRewrite> {
    let mut best: Option<&ExtensionRewrite> = None;
    for rewrite in rewrites {
        let length = rewrite.source.len();
        if length > best.map_or(0, |it| it.source.len())
            && path.len() > length
            && equal(
                &path[path.len() - length..],
                &rewrite.source,
                is_case_sensitive,
            )
        {
            best = Some(rewrite);
        }
    }
    best
}

/// `RewriteExtension`: returns `path` with its extension replaced. `None` if no rewrite changes it.
pub(crate) fn rewrite_extension(
    path: &[u8],
    rewrites: &[ExtensionRewrite],
    is_case_sensitive: bool,
) -> Option<Vec<u8>> {
    let rewrite = extension_rewrite(path, rewrites, is_case_sensitive)?;
    if equal(&rewrite.source, &rewrite.target, is_case_sensitive) {
        return None;
    }
    let stem = &path[..path.len() - rewrite.source.len()];
    Some([stem, &rewrite.target[..]].concat())
}

/// `ModuleSpecifier.ShouldRewriteExtension`
pub(crate) fn should_rewrite_extension(
    specifier: &[u8],
    rewrites: &[ExtensionRewrite],
    is_case_sensitive: bool,
) -> bool {
    if !path_is_relative(specifier) || is_declaration_file_name(specifier) {
        return false;
    }
    match extension_rewrite(specifier, rewrites, is_case_sensitive) {
        Some(rewrite) => !equal(&rewrite.source, &rewrite.target, is_case_sensitive),
        None => crate::resolve::has_ts_implementation_extension(specifier),
    }
}

impl crate::resolve::Options {
    /// `rewriteModuleSpecifier` of the declaration transformer: returns `specifier` as a declaration file has it, if
    /// that isn't how it's written. It refers to what the mapped file is built into.
    pub(crate) fn rewritten_module_specifier(&self, specifier: &[u8]) -> Option<Vec<u8>> {
        let rewrites = &self.content_mapper_extension_rewrites;
        let is_case_sensitive = self.use_case_sensitive_file_names;
        (self.rewrite_relative_import_extensions
            && should_rewrite_extension(specifier, rewrites, is_case_sensitive))
        .then(|| rewrite_extension(specifier, rewrites, is_case_sensitive))?
    }
}

// ───────────────────────────── span maps ─────────────────────────────

/// `spanmap.Kind`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SegmentKind {
    /// Both spans have the same text, so a position inside one maps to the same offset inside the other.
    Verbatim,
    /// The spans correspond as a whole.
    Atom,
    /// Like `Atom`, and both texts are names for the same thing. Messages show the original name.
    Alias,
}

/// `spanmap.Segment`: the bytes `virtual_start..virtual_end` of the generated text come from the bytes
/// `original_start..original_end` of the original text.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Segment {
    pub virtual_start: u32,
    pub virtual_end: u32,
    pub original_start: u32,
    pub original_end: u32,
    pub kind: SegmentKind,
}

/// `spanmap.Fidelity`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Fidelity {
    /// The span is inside one verbatim segment.
    Exact,
    /// The span is inside one atom or alias segment, and maps to that segment's whole original span.
    Atom,
    /// The span crosses segment boundaries.
    Approximate,
    /// The span is generated text with no original counterpart.
    None,
}

/// A span of the original text.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct MappedSpan {
    pub start: u32,
    pub end: u32,
    pub fidelity: Fidelity,
}

/// `spanmap.SpanMap`: valid segments, sorted by `virtual_start`. Generated text outside every segment has no original
/// counterpart.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SpanMap {
    segments: Vec<Segment>,
}

impl SpanMap {
    /// `VirtualToOriginalSpan`
    pub fn virtual_to_original_span(&self, start: u32, end: u32) -> MappedSpan {
        let end = end.max(start);
        if start == end {
            return self.virtual_to_original_position(start);
        }
        let (first, last) = (self.segment_index_at(start), self.segment_index_at(end - 1));
        if first == last {
            return match first {
                Place::Inside(index) => {
                    let segment = &self.segments[index];
                    match segment.kind {
                        SegmentKind::Verbatim => {
                            let from = segment.interpolate(start);
                            MappedSpan {
                                start: from,
                                end: segment.interpolate(end).max(from),
                                fidelity: Fidelity::Exact,
                            }
                        }
                        _ => MappedSpan {
                            start: segment.original_start,
                            end: segment.original_end,
                            fidelity: Fidelity::Atom,
                        },
                    }
                }
                Place::After(previous) => {
                    let at = self.insertion_point(previous);
                    MappedSpan {
                        start: at,
                        end: at,
                        fidelity: Fidelity::None,
                    }
                }
            };
        }
        // `mapLow` and `mapHigh`
        let boundary = |position: u32, place: Place, is_high: bool| match place {
            Place::After(previous) => self.insertion_point(previous),
            Place::Inside(index) => {
                let segment = &self.segments[index];
                match (segment.kind, is_high) {
                    (SegmentKind::Verbatim, _) => segment.interpolate(position),
                    (_, false) => segment.original_start,
                    (_, true) => segment.original_end,
                }
            }
        };
        let from = boundary(start, first, false);
        MappedSpan {
            start: from,
            end: boundary(end, last, true).max(from),
            fidelity: Fidelity::Approximate,
        }
    }

    /// `VirtualToOriginalPosition`
    fn virtual_to_original_position(&self, position: u32) -> MappedSpan {
        let (at, fidelity) = match self.segment_index_at(position) {
            Place::After(previous) => (self.insertion_point(previous), Fidelity::None),
            Place::Inside(index) => {
                let segment = &self.segments[index];
                match segment.kind {
                    SegmentKind::Verbatim => (segment.interpolate(position), Fidelity::Exact),
                    _ => (segment.original_start, Fidelity::Atom),
                }
            }
        };
        MappedSpan {
            start: at,
            end: at,
            fidelity,
        }
    }

    /// `AliasForVirtualSpan`: returns the alias segment that covers exactly `start..end`.
    pub fn alias_for_virtual_span(&self, start: u32, end: u32) -> Option<&Segment> {
        let Place::Inside(index) = self.segment_index_at(start) else {
            return None;
        };
        let segment = &self.segments[index];
        let is_match = segment.kind == SegmentKind::Alias
            && (segment.virtual_start, segment.virtual_end) == (start, end);
        is_match.then_some(segment)
    }

    /// `segmentIndexAt`
    fn segment_index_at(&self, position: u32) -> Place {
        let after = (self.segments).partition_point(|it| it.virtual_start <= position);
        let Some(index) = after.checked_sub(1) else {
            return Place::After(None);
        };
        let segment = &self.segments[index];
        let is_last = index == self.segments.len() - 1;
        let is_inside = segment.virtual_start == position
            || position < segment.virtual_end
            || is_last && position == segment.virtual_end;
        match is_inside {
            true => Place::Inside(index),
            false => Place::After(Some(index)),
        }
    }

    /// `insertionPoint`: where generated text that follows the segment `previous` sits in the original text.
    fn insertion_point(&self, previous: Option<usize>) -> u32 {
        previous.map_or(0, |index| self.segments[index].original_end)
    }
}

impl Segment {
    /// Maps `position`, in the generated text, into this verbatim segment's original span.
    fn interpolate(&self, position: u32) -> u32 {
        let offset = position.saturating_sub(self.virtual_start);
        (self.original_start.saturating_add(offset)).clamp(self.original_start, self.original_end)
    }
}

/// Where a position of the generated text is, relative to the segments.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Place {
    Inside(usize),
    /// In the gap after this segment, or before the first one.
    After(Option<usize>),
}

/// `spanmap.MappingError`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MappingError {
    /// `MappingErrorKindOverlap`
    Overlap { virtual_position: u32 },
    /// `MappingErrorKindOutOfBounds`
    OutOfBounds { original_position: u32 },
    /// `MappingErrorKindVerbatimMismatch`
    VerbatimMismatch {
        virtual_position: u32,
        original_position: u32,
    },
    /// `MappingErrorKindKind`
    Kind { virtual_position: u32 },
    /// `MappingErrorKindFeature`
    Feature { original_position: u32 },
}

/// A segment whose positions are inside the two texts, but which `SpanMap.Validate` hasn't seen yet.
struct UncheckedSegment {
    virtual_start: u32,
    virtual_end: u32,
    original_start: u32,
    original_end: u32,
    kind: i32,
    features: i32,
}

/// `featureMask`: `FeatureAll`, which has a bit for each of the twenty language service features.
const FEATURE_MASK: i32 = (1 << 20) - 1;

/// `SpanMap.Validate`. `segments` are sorted by `virtual_start`.
fn validate(
    segments: &[UncheckedSegment],
    virtual_text: &[u8],
    original: &[u8],
) -> Result<SpanMap, MappingError> {
    let mut valid = Vec::new();
    let mut previous_virtual_end = 0;
    for s in segments {
        let (virtual_position, original_position) = (s.virtual_start, s.original_start);
        if s.virtual_start < previous_virtual_end || s.virtual_end < s.virtual_start {
            return Err(MappingError::Overlap { virtual_position });
        }
        previous_virtual_end = s.virtual_end;
        if s.original_end < s.original_start {
            return Err(MappingError::OutOfBounds {
                original_position: s.original_end,
            });
        }
        let kind = match s.kind {
            0 => SegmentKind::Verbatim,
            1 => SegmentKind::Atom,
            2 => SegmentKind::Alias,
            _ => return Err(MappingError::Kind { virtual_position }),
        };
        let generated = virtual_text.get(s.virtual_start as usize..s.virtual_end as usize);
        let source = original.get(s.original_start as usize..s.original_end as usize);
        if kind == SegmentKind::Verbatim && (generated.is_none() || generated != source) {
            return Err(MappingError::VerbatimMismatch {
                virtual_position,
                original_position,
            });
        }
        if s.features & !FEATURE_MASK != 0 {
            return Err(MappingError::Feature { original_position });
        }
        valid.push(Segment {
            virtual_start: s.virtual_start,
            virtual_end: s.virtual_end,
            original_start: s.original_start,
            original_end: s.original_end,
            kind,
        });
    }
    Ok(SpanMap { segments: valid })
}

// ───────────────────────────── the protocol ─────────────────────────────

/// `initializeTimeoutSeconds`
const INITIALIZE_TIMEOUT_SECONDS: u32 = 5;

/// `maxContentMapperFailures`: after this many failed transforms in a program, a mapper isn't used anymore.
const MAX_CONTENT_MAPPER_FAILURES: u32 = 5;

/// A request to a mapper's process.
pub struct Call<'a> {
    pub mapper: &'a Mapper,
    /// `initialize`, `openProject`, `transform` or `closeProject`
    pub method: &'static str,
    pub params: Json,
    /// How long to wait for the response. `None`: until the process answers or exits.
    pub timeout_seconds: Option<u32>,
}

/// Why a [`Call`] has no result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CallError {
    /// The process couldn't be started.
    NotStarted {
        detail: Vec<u8>,
    },
    /// The process exited without answering.
    Exited {
        code: i32,
    },
    TimedOut,
    /// The mapper answered with an error, or the connection broke.
    Failed {
        detail: Vec<u8>,
    },
}

/// The connection to the mappers' processes.
pub trait Transport: Send + Sync {
    /// Sends `call` to the process with the mapper's identity, which is started first if it isn't running, and waits for
    /// the response. Returns the response's `result`, or `None` if it has neither a result nor an error.
    fn call(&self, call: &Call) -> Result<Option<Json>, CallError>;
    /// Stops the process with the mapper's identity. Calls that are waiting for its response fail, and so do later calls.
    fn stop(&self, mapper: &Mapper);
    /// Stops every process.
    fn close(&self);
}

/// `jsonrpc.Reader`: splits what a process writes into messages. Each message follows a header that ends with an empty
/// line and has a `Content-Length`.
#[derive(Default)]
struct FrameDecoder {
    buffer: Vec<u8>,
    /// The end of the last header line or message that was read.
    consumed: usize,
    /// No line of the header ends before this offset.
    searched: usize,
    /// The `Content-Length` of the header that's being read.
    content_length: u64,
    /// The header is complete, and its message isn't.
    is_in_message: bool,
}

impl FrameDecoder {
    fn push(&mut self, bytes: &[u8]) {
        if self.consumed > self.buffer.len() / 2 {
            self.buffer.drain(..self.consumed);
            self.searched = self.searched.saturating_sub(self.consumed);
            self.consumed = 0;
        }
        self.buffer.extend_from_slice(bytes);
    }

    /// Returns the next complete message, or `None` if more bytes are needed. The buffer only grows by the bytes that
    /// arrive, whatever length a header announces. An error is the text of the original's error.
    fn next(&mut self) -> Result<Option<&[u8]>, Vec<u8>> {
        while !self.is_in_message {
            let from = self.searched.max(self.consumed);
            let Some(found) = strings::index_of_char_usize(&self.buffer[from..], b'\n') else {
                self.searched = self.buffer.len();
                return Ok(None);
            };
            let line = &self.buffer[self.consumed..=from + found];
            self.consumed += line.len();
            if line == b"\r\n" {
                if self.content_length == 0 {
                    return Err(b"jsonrpc: no content length".to_vec());
                }
                self.is_in_message = true;
                break;
            }
            let Some(colon) = strings::index_of_char_usize(line, b':') else {
                return Err([b"jsonrpc: invalid header: ", &go_quoted(line)[..]].concat());
            };
            if &line[..colon] == b"Content-Length" {
                self.content_length = parse_content_length(line[colon + 1..].trim_ascii())?;
            }
        }
        if ((self.buffer.len() - self.consumed) as u64) < self.content_length {
            return Ok(None);
        }
        let from = self.consumed;
        self.consumed += self.content_length as usize;
        (self.content_length, self.is_in_message) = (0, false);
        Ok(Some(&self.buffer[from..self.consumed]))
    }
}

/// `strconv.ParseInt`, and the errors of `jsonrpc.Reader.Read` about it.
fn parse_content_length(digits: &[u8]) -> Result<u64, Vec<u8>> {
    use std::num::IntErrorKind::{NegOverflow, PosOverflow};
    let invalid = &b"jsonrpc: invalid content length: "[..];
    let parsed = str::from_utf8(digits).map(str::parse::<i64>);
    let why: &[u8] = match parsed {
        Ok(Ok(length)) => {
            let negative = || [invalid, b"negative value ", &number(length)[..]].concat();
            return u64::try_from(length).map_err(|_| negative());
        }
        Ok(Err(error)) if matches!(error.kind(), PosOverflow | NegOverflow) => {
            b"value out of range"
        }
        _ => b"invalid syntax",
    };
    let parsing = b"parse error: strconv.ParseInt: parsing ";
    Err([invalid, parsing, &go_quoted(digits)[..], b": ", why].concat())
}

/// Go's `%q`
fn go_quoted(text: &[u8]) -> Vec<u8> {
    let mut quoted = vec![b'"'];
    for (start, end, character) in text.char_indices() {
        let bytes = &text[start..end];
        match character {
            '"' => quoted.extend_from_slice(b"\\\""),
            '\\' => quoted.extend_from_slice(b"\\\\"),
            '\n' => quoted.extend_from_slice(b"\\n"),
            '\r' => quoted.extend_from_slice(b"\\r"),
            '\t' => quoted.extend_from_slice(b"\\t"),
            // An invalid sequence decodes as U+FFFD, which is three bytes if it's really in the text.
            _ if character.is_control() || character == '\u{FFFD}' && bytes.len() != 3 => {
                for byte in bytes {
                    quoted.extend_from_slice(format!("\\x{byte:02x}").as_bytes());
                }
            }
            _ => quoted.extend_from_slice(bytes),
        }
    }
    quoted.push(b'"');
    quoted
}

/// `jsonrpc.Writer.Write`
fn frame(body: &[u8]) -> Vec<u8> {
    [
        b"Content-Length: ",
        &number(body.len())[..],
        b"\r\n\r\n",
        body,
    ]
    .concat()
}

fn member(name: &str, value: Json) -> (Vec<u8>, Json) {
    (name.as_bytes().to_vec(), value)
}

/// A call that `Connection::begin` has registered.
pub struct BegunCall {
    /// What `Connection::wait` needs.
    pub id: u64,
    /// The bytes to write to the process.
    pub request: Vec<u8>,
}

/// A call that's waiting for its response.
struct PendingCall {
    /// The `n` of the request's id, `api<n>`.
    id: u64,
    response: Option<Result<Option<Json>, CallError>>,
}

#[derive(Default)]
struct ConnectionState {
    /// `seq`
    last_id: u64,
    pending: Vec<PendingCall>,
    /// `terminal`: why no more responses will arrive.
    terminal: Option<CallError>,
}

/// `ipc.AsyncConn` over JSON-RPC: the protocol state of one process. It doesn't read or write anything itself. The
/// process's owner passes on the bytes in both directions.
#[derive(Default)]
pub struct Connection {
    state: Guarded<ConnectionState>,
    has_changed: bun_threading::Condvar,
    /// Only `receive` locks it, before `state`.
    decoder: Guarded<FrameDecoder>,
}

impl Connection {
    /// The first half of `Call`.
    pub fn begin(&self, method: &str, params: &Json) -> Result<BegunCall, CallError> {
        let id = {
            let mut state = self.state.lock();
            if let Some(terminal) = &state.terminal {
                return Err(terminal.clone());
            }
            state.last_id += 1;
            let id = state.last_id;
            state.pending.push(PendingCall { id, response: None });
            id
        };
        let mut body = [
            b"{\"jsonrpc\":\"2.0\",\"id\":\"api",
            &number(id)[..],
            b"\",\"method\":\"",
            method.as_bytes(),
            b"\",\"params\":",
        ]
        .concat();
        params.stringify(&mut body);
        body.push(b'}');
        Ok(BegunCall {
            id,
            request: frame(&body),
        })
    }

    /// The second half of `Call`: blocks until the call `id` has a response, the connection has ended, or the time is
    /// up.
    pub fn wait(&self, id: u64, timeout: Option<Duration>) -> Result<Option<Json>, CallError> {
        let deadline = timeout.map(|it| Instant::now() + it);
        let mut state = self.state.lock();
        loop {
            let Some(at) = state.pending.iter().position(|it| it.id == id) else {
                return Err(closed());
            };
            if state.pending[at].response.is_some() || state.terminal.is_some() {
                let call = state.pending.swap_remove(at);
                let terminal = state.terminal.clone().unwrap_or_else(closed);
                return call.response.unwrap_or(Err(terminal));
            }
            let Some(deadline) = deadline else {
                self.has_changed.wait_guarded(&mut state);
                continue;
            };
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                state.pending.swap_remove(at);
                return Err(CallError::TimedOut);
            }
            let nanoseconds = u64::try_from(left.as_nanos()).unwrap_or(u64::MAX);
            let _ = (self.has_changed).timed_wait_guarded(&mut state, nanoseconds);
        }
    }

    /// `Run`, for `bytes` that the process wrote. `parse_json` is `Host::parse_json`. Returns the bytes to write to the
    /// process in reply. Fails if the process broke the protocol. The connection has ended then, and the process should
    /// be stopped.
    pub fn receive(
        &self,
        bytes: &[u8],
        parse_json: &dyn Fn(&[u8]) -> Option<Json>,
    ) -> Result<Vec<u8>, CallError> {
        if let Some(terminal) = &self.state.lock().terminal {
            return Err(terminal.clone());
        }
        let mut decoder = self.decoder.lock();
        decoder.push(bytes);
        let mut replies = Vec::new();
        let cause = loop {
            let message = match decoder.next() {
                Ok(Some(message)) => parse_json(message),
                Ok(None) => return Ok(replies),
                Err(cause) => break cause,
            };
            let handled = message.ok_or(Malformed).and_then(|message| {
                handle_message(message, &mut self.state.lock().pending, &mut replies)
            });
            self.has_changed.notify_all();
            if handled.is_err() {
                break b"jsonrpc: invalid message".to_vec();
            }
        };
        let terminal = CallError::Failed {
            detail: [b"ipc: connection closed\n", &cause[..]].concat(),
        };
        self.end(terminal.clone());
        Err(terminal)
    }

    /// `closePendingCalls`: no more responses will arrive, because of `error`. The first error counts.
    pub fn end(&self, error: CallError) {
        self.state.lock().terminal.get_or_insert(error);
        self.has_changed.notify_all();
    }
}

/// `ErrConnClosed`
fn closed() -> CallError {
    CallError::Failed {
        detail: b"ipc: connection closed".to_vec(),
    }
}

/// What `AsyncConn.Run` does with one message. A reply, if the message needs one, is added to `replies`.
fn handle_message(
    message: Json,
    pending: &mut [PendingCall],
    replies: &mut Vec<u8>,
) -> Result<(), Malformed> {
    message.as_object().ok_or(Malformed)?;
    let fields = Fields::of(&message)?;
    let version = message.get(b"jsonrpc");
    if version.is_some_and(|it| it.as_str() != Some(b"2.0")) {
        return Err(Malformed);
    }
    let method = fields.string(b"method")?;
    let error = match fields.get(b"error") {
        Some(error) => {
            let error = Fields::of(error)?;
            let (code, text) = (error.int32(b"code")?, error.string(b"message")?);
            Some(CallError::Failed {
                detail: [b"ipc: remote error [", &number(code)[..], b"]: ", text].concat(),
            })
        }
        None => None,
    };
    let Some(id) = fields.get(b"id") else {
        return Ok(());
    };
    if id.as_str().is_none() {
        int32(id)?;
    }
    // The protocol has no requests from a mapper.
    if !method.is_empty() {
        let text = [b"content mapper sent an unexpected request: ", method].concat();
        let error = Json::Object(vec![
            member("code", Json::Number(-32603.0)),
            member("message", Json::String(text)),
        ]);
        let mut body = Vec::new();
        Json::Object(vec![
            member("jsonrpc", Json::String(b"2.0".to_vec())),
            member("id", id.clone()),
            member("error", error),
        ])
        .stringify(&mut body);
        replies.extend(frame(&body));
        return Ok(());
    }
    // A response that no call is waiting for is dropped.
    let call_id = id.as_str().and_then(|it| it.strip_prefix(b"api"));
    let call_id = call_id.and_then(|it| str::from_utf8(it).ok()?.parse::<u64>().ok());
    let call = pending.iter_mut().find(|it| Some(it.id) == call_id);
    if let Some(call) = call.filter(|it| it.response.is_none()) {
        call.response = Some(match error {
            Some(error) => Err(error),
            None => {
                let mut members = message.into_object().unwrap_or_default();
                let result = members.iter().rposition(|it| it.0 == b"result");
                Ok(result.map(|at| members.swap_remove(at).1))
            }
        });
    }
    Ok(())
}

/// `PositionEncoding`: the unit of the offsets in a mapper's responses.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum PositionEncoding {
    Utf8,
    Utf16,
}

/// `InitializeError`
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InitializeError {
    ProcessStart { command: Vec<u8>, detail: Vec<u8> },
    ProcessExit { code: i32 },
    NoResponse,
    InvalidResponse { detail: &'static [u8] },
    Request { detail: Vec<u8> },
    PositionEncoding(Vec<u8>),
    EmptyDiagnosticSource,
    ReservedDiagnosticSource(Vec<u8>),
}

/// `ProjectError`, or `Failed` for an `openProject` request that has no result.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ProjectError {
    Failed,
    MalformedResponse,
    MissingConfigIdentity,
    NonAbsoluteWatchedFile,
    UnexpectedConfigIdentity,
    UnexpectedWatchedFiles,
}

/// `DiagnosticDirectiveErrorKind`
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum DirectiveErrorKind {
    InvalidRange,
    InvalidPolicy(u8),
    ExpectMissingUnusedDiagnostic,
    InvalidUnusedDiagnosticIndex,
    Overlap,
}

/// `TransformError`, `spanmap.MappingError` and `SupplementalFileCollisionError`
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TransformError {
    Initialize(InitializeError),
    Project(ProjectError),
    Request,
    /// The response can't be decoded, or an offset in it is outside the text.
    Response,
    /// `InvalidVirtualExtensionError`
    VirtualExtension(Vec<u8>),
    /// `DiagnosticDirectiveError`
    Directive {
        kind: DirectiveErrorKind,
        index: usize,
        /// `SupplementalIndex`
        supplemental: Option<usize>,
    },
    Mappings(MappingError),
    SupplementalFileCollision(Vec<u8>),
}

fn number(value: impl std::fmt::Display) -> Vec<u8> {
    value.to_string().into_bytes()
}

impl InitializeError {
    /// `ContentMapperInitializationDiagnostic`. `label` is the mapper's name.
    fn problem(&self, label: &[u8]) -> Problem {
        let problem = Problem::new(18099, &[label], ConfigLocation::Nowhere);
        match self {
            InitializeError::ProcessStart { command, detail } => {
                problem.with(1, 18100, &[command, detail])
            }
            InitializeError::ProcessExit { code } => problem.with(1, 18101, &[&number(code)]),
            InitializeError::NoResponse => {
                problem.with(1, 18102, &[&number(INITIALIZE_TIMEOUT_SECONDS)])
            }
            InitializeError::InvalidResponse { detail } => problem.with(1, 18103, &[detail]),
            InitializeError::Request { detail } => problem.with(1, 18104, &[detail]),
            InitializeError::PositionEncoding(encoding) => problem.with(1, 18087, &[encoding]),
            InitializeError::EmptyDiagnosticSource => problem.with(1, 18088, &[]),
            InitializeError::ReservedDiagnosticSource(source) => problem.with(1, 18089, &[source]),
        }
    }
}

impl TransformError {
    /// `contentMapperTransformDiagnostic` and `contentMapperMappingDiagnostic`: the error reported at the start of the
    /// file. `label` is the mapper's name.
    fn problem(&self, label: &[u8]) -> Problem {
        let new = |code: u32, args: &[&[u8]]| Problem::new(code, args, ConfigLocation::Nowhere);
        let failed = || new(18069, &[label]);
        match self {
            // `parseContentMappedFile` reports these once for the program instead.
            TransformError::Initialize(_) => failed().with(1, 18084, &[]),
            TransformError::Project(error) => {
                let code = match error {
                    ProjectError::Failed => 18091,
                    ProjectError::MalformedResponse => 18090,
                    ProjectError::MissingConfigIdentity => 18092,
                    ProjectError::NonAbsoluteWatchedFile => 18093,
                    ProjectError::UnexpectedConfigIdentity => 18094,
                    ProjectError::UnexpectedWatchedFiles => 18095,
                };
                failed().with(1, code, &[])
            }
            TransformError::Request => failed().with(1, 18085, &[]),
            TransformError::Response => failed().with(1, 18086, &[]),
            TransformError::VirtualExtension(extension) => failed().with(1, 18098, &[extension]),
            TransformError::Directive {
                kind,
                index,
                supplemental,
            } => {
                let index = number(index);
                let problem = match kind {
                    DirectiveErrorKind::InvalidRange => failed().with(1, 18105, &[&index]),
                    DirectiveErrorKind::InvalidPolicy(policy) => {
                        failed().with(1, 18106, &[&number(policy)])
                    }
                    DirectiveErrorKind::ExpectMissingUnusedDiagnostic => {
                        failed().with(1, 18107, &[&index])
                    }
                    DirectiveErrorKind::InvalidUnusedDiagnosticIndex => {
                        failed().with(1, 18110, &[&index])
                    }
                    DirectiveErrorKind::Overlap => failed().with(1, 18108, &[]),
                };
                match supplemental {
                    Some(output) => problem.with(2, 18109, &[&number(output)]),
                    None => problem,
                }
            }
            TransformError::Mappings(error) => match *error {
                MappingError::Overlap { virtual_position } => {
                    new(18081, &[label, &number(virtual_position)])
                }
                MappingError::OutOfBounds { original_position } => {
                    new(18072, &[label, &number(original_position)])
                }
                MappingError::VerbatimMismatch {
                    virtual_position,
                    original_position,
                } => new(
                    18073,
                    &[label, &number(virtual_position), &number(original_position)],
                ),
                MappingError::Kind { virtual_position } => {
                    new(18083, &[label, &number(virtual_position)])
                }
                MappingError::Feature { original_position } => {
                    new(18082, &[label, &number(original_position)])
                }
            },
            TransformError::SupplementalFileCollision(file_name) => {
                failed().with(1, 18096, &[&displayed_path(file_name)])
            }
        }
    }
}

/// `ast.NewExternalDiagnostic`: an error that a mapper wrote. It's printed as `<source><code>: <text>`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalDiagnostic {
    /// Byte offsets in the original text.
    pub start: u32,
    pub end: u32,
    pub source: Vec<u8>,
    pub code: i32,
    pub text: Vec<u8>,
}

/// `ast.MappedDiagnosticDirective`: the mapper's equivalent of `@ts-ignore` and `@ts-expect-error`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiagnosticDirective {
    /// `VirtualRange`: the checker's errors that start in these bytes of the generated text aren't reported.
    pub virtual_start: u32,
    pub virtual_end: u32,
    /// `MappedDiagnosticDirectivePolicyExpect`: the error to report if the directive suppresses nothing.
    pub if_unused: Option<ExternalDiagnostic>,
}

/// `MappedResult`: generated text, and how it relates to the original text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MappedOutput {
    pub text: Vec<u8>,
    /// One of `SUPPORTED_VIRTUAL_EXTENSIONS`. The text is parsed like a file with this extension.
    pub virtual_extension: &'static [u8],
    pub span_map: SpanMap,
    pub directives: Vec<DiagnosticDirective>,
}

/// `contentmapper.Result`
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transformed {
    pub canonical: MappedOutput,
    /// `Diagnostics`: the mapper's syntax errors in the original text.
    pub diagnostics: Vec<ExternalDiagnostic>,
    /// More files that the same original file produces. The compiler picks their names.
    pub supplemental: Vec<MappedOutput>,
}

/// `OptionDiagnostic`: an error that a mapper reports about its `options` in the configuration file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OptionDiagnostic {
    /// The mapper's index among the entries of `contentMappers` that are in use. `GetContentMapperOptionDiagnosticLocation`
    /// looks up the entry with that index in the list as it's written, which is another entry if one before it is dropped.
    pub mapper: usize,
    /// The property names and array indices that lead from `options` to the value.
    pub path: Vec<OptionPathSegment>,
    pub source: Vec<u8>,
    pub code: i32,
    pub text: Vec<u8>,
}

/// `OptionPathSegment`
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OptionPathSegment {
    Property(Vec<u8>),
    Index(usize),
}

/// What a mapper chose in its response to `initialize`.
#[derive(Clone)]
struct Initialized {
    encoding: PositionEncoding,
    diagnostic_source: Vec<u8>,
}

/// `mapperConn`
struct Handshake {
    identity: Vec<u8>,
    initialized: Result<Initialized, InitializeError>,
}

/// `contentmapper.host`: the mappers' processes, which all programs of a request share. Creating one is what allows a
/// program to run the mappers its configuration file lists.
pub struct Processes {
    transport: Box<dyn Transport>,
    /// `conns`: how `initialize` went for each identity. It's sent once per process.
    connections: Guarded<Vec<Handshake>>,
    /// `nextProjectID`
    next_project: AtomicU64,
}

impl Processes {
    pub fn new(transport: Box<dyn Transport>) -> Processes {
        Processes {
            transport,
            connections: Guarded::new(Vec::new()),
            next_project: AtomicU64::new(0),
        }
    }

    /// `Close`
    pub fn close(&self) {
        self.transport.close();
    }

    /// `connFor`. The lock is held during `initialize`, so other threads that need the same process wait for it.
    fn connection_for(&self, mapper: &Mapper) -> Result<Initialized, InitializeError> {
        let identity = mapper.identity();
        let mut connections = self.connections.lock();
        if let Some(known) = connections.iter().find(|it| it.identity == identity) {
            return known.initialized.clone();
        }
        let initialized = self.initialize(mapper);
        // `dialFunc`: `rwc.Close()`
        if initialized.is_err() {
            self.transport.stop(mapper);
        }
        connections.push(Handshake {
            identity,
            initialized: initialized.clone(),
        });
        initialized
    }

    /// `handshake`, and the part of `dialFunc` that classifies its errors.
    fn initialize(&self, mapper: &Mapper) -> Result<Initialized, InitializeError> {
        let encodings = [&b"utf-8"[..], b"utf-16"].map(|it| Json::String(it.to_vec()));
        let response = self.transport.call(&Call {
            mapper,
            method: "initialize",
            params: Json::Object(vec![(
                b"positionEncodings".to_vec(),
                Json::Array(encodings.into()),
            )]),
            timeout_seconds: Some(INITIALIZE_TIMEOUT_SECONDS),
        });
        let response = response.map_err(|error| match error {
            CallError::NotStarted { detail } => InitializeError::ProcessStart {
                command: mapper.exec.first().cloned().unwrap_or_default(),
                detail,
            },
            CallError::Exited { code } => InitializeError::ProcessExit { code },
            CallError::TimedOut => InitializeError::NoResponse,
            CallError::Failed { detail } => InitializeError::Request { detail },
        })?;
        let response = response.ok_or(InitializeError::InvalidResponse {
            detail: b"jsontext: unexpected EOF",
        })?;
        let invalid = InitializeError::InvalidResponse {
            detail: b"it isn't an object with the expected properties",
        };
        let fields = Fields::of(&response).map_err(|_| invalid.clone())?;
        let encoding = fields.string(b"positionEncoding");
        let encoding = encoding.map_err(|_| invalid.clone())?;
        let source = fields.string(b"diagnosticSource").map_err(|_| invalid)?;
        let encoding = match encoding {
            b"utf-8" => PositionEncoding::Utf8,
            b"utf-16" => PositionEncoding::Utf16,
            _ => return Err(InitializeError::PositionEncoding(encoding.to_vec())),
        };
        if source.trim_with(char::is_whitespace).is_empty() {
            return Err(InitializeError::EmptyDiagnosticSource);
        }
        let is_source = |reserved: &[u8]| source.eq_ignore_ascii_case(reserved);
        let mut native = SUPPORTED_VIRTUAL_EXTENSIONS.iter();
        if is_source(b"typescript")
            || is_source(b"tsc")
            || [&b"d.ts"[..], b"d.cts", b"d.mts"]
                .into_iter()
                .any(is_source)
            || native.any(|extension| is_source(&extension[1..]))
        {
            return Err(InitializeError::ReservedDiagnosticSource(source.to_vec()));
        }
        Ok(Initialized {
            encoding,
            diagnostic_source: source.to_vec(),
        })
    }
}

/// `projectEntry`
#[derive(Default)]
struct ProjectEntry {
    /// `projectHandle`. Empty until the first `openProject`.
    handle: Vec<u8>,
    is_open: bool,
    option_diagnostics: Vec<OptionDiagnostic>,
}

/// The bookkeeping of `fileLoader` about one mapper.
#[derive(Default, Clone)]
struct Failures {
    /// `contentMapperFailures`
    count: u32,
    /// `contentMapperInitFailed`
    has_failed_to_initialize: bool,
}

/// The errors of a [`Project`] that aren't about a source file.
#[derive(Default)]
pub struct Closed {
    /// `contentMapperDiagnostics`: the mappers that couldn't be started, or that were given up on. They have no
    /// location.
    pub diagnostics: Vec<Problem>,
    /// `Project.Diagnostics`
    pub option_diagnostics: Vec<OptionDiagnostic>,
}

/// What `Project::transform` returns for a file.
pub enum Outcome {
    Transformed(Box<Transformed>),
    /// The file is loaded as an empty file. `error` is `None` if the mapper was already given up on.
    Failed {
        error: Option<Problem>,
    },
}

/// `contentmapper.Project` for one program, with the failure accounting of `fileLoader`.
pub struct Project<'a> {
    processes: &'a Processes,
    mappers: &'a [Mapper],
    /// `ProjectSpec.ConfigFileName`. Empty if there's no configuration file.
    config_file_name: &'a [u8],
    /// `ProjectSpec.CompilerOptions`, as `json.Marshal` writes them.
    compiler_options: &'a Json,
    /// One for each of `mappers`.
    entries: Vec<Guarded<ProjectEntry>>,
    failures: Guarded<Vec<Failures>>,
    /// `contentMapperDiagnostics`
    diagnostics: Guarded<Vec<Problem>>,
}

impl<'a> Project<'a> {
    pub fn new(
        processes: &'a Processes,
        mappers: &'a [Mapper],
        config_file_name: &'a [u8],
        compiler_options: &'a Json,
    ) -> Project<'a> {
        Project {
            processes,
            mappers,
            config_file_name,
            compiler_options,
            entries: mappers.iter().map(|_| Guarded::default()).collect(),
            failures: Guarded::new(vec![Failures::default(); mappers.len()]),
            diagnostics: Guarded::new(Vec::new()),
        }
    }

    /// `parseContentMappedFile`: transforms the file at `file_name`, whose text is `content`, with `mappers[mapper]`.
    /// `file_exists` is asked about the names that the supplemental files would get.
    pub fn transform(
        &self,
        mapper: usize,
        file_name: &[u8],
        content: &[u8],
        file_exists: &dyn Fn(&[u8]) -> bool,
    ) -> Outcome {
        let label = &self.mappers[mapper].name[..];
        {
            let failures = &self.failures.lock()[mapper];
            if failures.has_failed_to_initialize || failures.count >= MAX_CONTENT_MAPPER_FAILURES {
                return Outcome::Failed { error: None };
            }
        }
        let transformed = self.request_transform(mapper, file_name, content);
        let transformed = transformed.and_then(|transformed| {
            // `CheckSupplementalFileNameCollisions`
            let outputs = transformed.supplemental.iter().enumerate();
            let mut names = outputs.map(|(index, output)| {
                supplemental_file_name(file_name, index, output.virtual_extension)
            });
            match names.find(|name| file_exists(name)) {
                Some(taken) => Err(TransformError::SupplementalFileCollision(taken)),
                None => Ok(transformed),
            }
        });
        let error = match transformed {
            Ok(transformed) => return Outcome::Transformed(Box::new(transformed)),
            Err(error) => error,
        };
        let failures = &mut self.failures.lock()[mapper];
        if let TransformError::Initialize(error) = &error {
            // `recordContentMapperInitializationFailure`
            if !std::mem::replace(&mut failures.has_failed_to_initialize, true) {
                self.diagnostics.lock().push(error.problem(label));
            }
            return Outcome::Failed { error: None };
        }
        // `recordContentMapperFailure`
        if failures.count >= MAX_CONTENT_MAPPER_FAILURES {
            return Outcome::Failed { error: None };
        }
        failures.count += 1;
        if failures.count == MAX_CONTENT_MAPPER_FAILURES {
            let times = number(MAX_CONTENT_MAPPER_FAILURES);
            let gave_up = Problem::new(18070, &[label, &times], ConfigLocation::Nowhere);
            self.diagnostics.lock().push(gave_up);
        }
        Outcome::Failed {
            error: Some(error.problem(label)),
        }
    }

    /// `TransformAndParse`, up to the parsing.
    fn request_transform(
        &self,
        mapper_index: usize,
        file_name: &[u8],
        content: &[u8],
    ) -> Result<Transformed, TransformError> {
        let mapper = &self.mappers[mapper_index];
        let opened = self.open(mapper_index);
        // `project.Identity` opens the project of a mapper with `dynamicConfig`, and whatever fails there counts as a
        // project error.
        let OpenProject {
            handle,
            initialized,
        } = opened.map_err(|error| match error {
            TransformError::Initialize(_) if mapper.dynamic_config => {
                TransformError::Project(ProjectError::Failed)
            }
            error => error,
        })?;
        let response = self.processes.transport.call(&Call {
            mapper,
            method: "transform",
            params: Json::Object(vec![
                (b"fileName".to_vec(), path_value(file_name)),
                (b"content".to_vec(), Json::String(content.to_vec())),
                (b"projectHandle".to_vec(), Json::String(handle)),
            ]),
            timeout_seconds: None,
        });
        let response = response.map_err(|_| TransformError::Request)?;
        let response = response.ok_or(TransformError::Response)?;
        decode_transform_result(&response, content, &initialized)
    }

    /// `openProjectLocked`: sends `openProject` unless the project is open.
    fn open(&self, mapper_index: usize) -> Result<OpenProject, TransformError> {
        let mapper = &self.mappers[mapper_index];
        let mut entry = self.entries[mapper_index].lock();
        let initialized = self.processes.connection_for(mapper);
        let initialized = initialized.map_err(TransformError::Initialize)?;
        if entry.is_open {
            return Ok(OpenProject {
                handle: entry.handle.clone(),
                initialized,
            });
        }
        if entry.handle.is_empty() {
            let id = self.processes.next_project.fetch_add(1, Ordering::Relaxed);
            entry.handle = [&mapper.identity()[..], b":", &number(id)].concat();
        }
        let mut params = vec![
            (
                b"configFileName".to_vec(),
                path_value(self.config_file_name),
            ),
            (
                b"projectHandle".to_vec(),
                Json::String(entry.handle.clone()),
            ),
        ];
        params.extend(mapper.options.clone().map(|it| (b"options".to_vec(), it)));
        params.push((b"compilerOptions".to_vec(), self.compiler_options.clone()));
        let response = self.processes.transport.call(&Call {
            mapper,
            method: "openProject",
            params: Json::Object(params),
            timeout_seconds: None,
        });
        let response = response.map_err(|_| TransformError::Project(ProjectError::Failed))?;
        let response = response.ok_or(TransformError::Project(ProjectError::MalformedResponse))?;
        let source = &initialized.diagnostic_source;
        entry.option_diagnostics =
            decode_open_project_result(&response, mapper, mapper_index, source)
                .map_err(TransformError::Project)?;
        entry.is_open = true;
        Ok(OpenProject {
            handle: entry.handle.clone(),
            initialized,
        })
    }

    /// `Close`: tells the mappers that no more requests for this program follow.
    pub fn close(self) -> Closed {
        let mut option_diagnostics = Vec::new();
        for (mapper, entry) in self.mappers.iter().zip(&self.entries) {
            let mut entry = entry.lock();
            if !entry.is_open {
                continue;
            }
            option_diagnostics.append(&mut entry.option_diagnostics);
            let handle = Json::String(std::mem::take(&mut entry.handle));
            // Nothing depends on the answer, so this doesn't wait for it. The original does, after it has printed
            // the errors, and never exits if the mapper doesn't answer.
            let _ = self.processes.transport.call(&Call {
                mapper,
                method: "closeProject",
                params: Json::Object(vec![(b"projectHandle".to_vec(), handle)]),
                timeout_seconds: Some(0),
            });
        }
        Closed {
            diagnostics: std::mem::take(&mut *self.diagnostics.lock()),
            option_diagnostics,
        }
    }
}

/// Returns the name of the `index`-th supplemental file of the file at `file_name`: `a.vue.0.ts`.
pub fn supplemental_file_name(file_name: &[u8], index: usize, virtual_extension: &[u8]) -> Vec<u8> {
    [file_name, b".", &number(index), virtual_extension].concat()
}

/// Returns `path`, which is in the checker's format, as mappers see it.
fn path_value(path: &[u8]) -> Json {
    Json::String(displayed_path(path).into_owned())
}

// ───────────────────────────── decoding ─────────────────────────────

/// A response, or a part of one, doesn't have the expected type.
struct Malformed;

/// The members of a JSON object, read the way `json.Unmarshal` fills a struct: a missing or `null` member is the zero
/// value, and a member of the wrong type is an error.
struct Fields<'j>(&'j [(Vec<u8>, Json)]);

impl<'j> Fields<'j> {
    fn of(value: &'j Json) -> Result<Fields<'j>, Malformed> {
        match value {
            Json::Null => Ok(Fields(&[])),
            _ => value.as_object().map(Fields).ok_or(Malformed),
        }
    }

    fn get(&self, name: &[u8]) -> Option<&'j Json> {
        let member = self.0.iter().rfind(|member| member.0 == name);
        member.map(|it| &it.1).filter(|it| **it != Json::Null)
    }

    fn string(&self, name: &[u8]) -> Result<&'j [u8], Malformed> {
        self.get(name)
            .map_or(Ok(b""), |it| it.as_str().ok_or(Malformed))
    }

    fn list(&self, name: &[u8]) -> Result<&'j [Json], Malformed> {
        self.get(name)
            .map_or(Ok(&[]), |it| it.as_array().ok_or(Malformed))
    }

    fn integer(&self, name: &[u8]) -> Result<i64, Malformed> {
        self.get(name).map_or(Ok(0), integer)
    }

    fn int32(&self, name: &[u8]) -> Result<i32, Malformed> {
        self.get(name).map_or(Ok(0), int32)
    }
}

/// Returns `value` if it's a whole number that a `f64` represents exactly. Every valid offset is one.
fn integer(value: &Json) -> Result<i64, Malformed> {
    const LIMIT: f64 = (1u64 << 53) as f64;
    match value {
        Json::Number(number) if number.fract() == 0.0 && number.abs() <= LIMIT => {
            Ok(*number as i64)
        }
        _ => Err(Malformed),
    }
}

fn int32(value: &Json) -> Result<i32, Malformed> {
    i32::try_from(integer(value)?).map_err(|_| Malformed)
}

/// A project that a mapper knows about.
struct OpenProject {
    /// `projectHandle`
    handle: Vec<u8>,
    initialized: Initialized,
}

struct WideCharacter {
    /// The UTF-16 offset of its end.
    utf16_end: u32,
    /// By how much the byte offset of its end exceeds that.
    extra_bytes: u32,
}

/// `positionNormalizer`: converts offsets in a text from a mapper's unit to bytes.
struct PositionNormalizer<'t> {
    text: &'t [u8],
    /// `ast.PositionMap`, for UTF-16 offsets in a text that isn't all ASCII: its characters of more than one byte.
    wide_characters: Option<Vec<WideCharacter>>,
    /// The text's length in the mapper's unit.
    length: i64,
}

impl<'t> PositionNormalizer<'t> {
    /// Returns `None` if the text is too long for 32-bit offsets.
    fn new(text: &'t [u8], encoding: PositionEncoding) -> Option<PositionNormalizer<'t>> {
        u32::try_from(text.len()).ok()?;
        if encoding == PositionEncoding::Utf8 || text.is_ascii() {
            return Some(PositionNormalizer {
                text,
                wide_characters: None,
                length: text.len() as i64,
            });
        }
        let (mut wide_characters, mut delta, mut at) = (Vec::new(), 0u32, 0);
        while at < text.len() {
            if text[at] < 0x80 {
                at += 1;
                continue;
            }
            let (character, size) = bun_core::lexer::char_and_size(text, at);
            at += size;
            delta += size as u32 - if character >= 0x10000 { 2 } else { 1 };
            wide_characters.push(WideCharacter {
                utf16_end: at as u32 - delta,
                extra_bytes: delta,
            });
        }
        Some(PositionNormalizer {
            text,
            wide_characters: Some(wide_characters),
            length: i64::from(text.len() as u32 - delta),
        })
    }

    /// `normalize`: returns the byte offset of `position`. Fails if it's outside the text or inside a character.
    fn normalize(&self, position: i64) -> Result<u32, Malformed> {
        if position < 0 || position > self.length {
            return Err(Malformed);
        }
        let position = position as u32;
        let byte_position = match &self.wide_characters {
            None => position,
            Some(wide_characters) => {
                let before = wide_characters.partition_point(|it| it.utf16_end <= position);
                let last = before.checked_sub(1).map(|at| &wide_characters[at]);
                position + last.map_or(0, |it| it.extra_bytes)
            }
        };
        match self.text.get(byte_position as usize) {
            Some(byte) if byte & 0xC0 == 0x80 => Err(Malformed),
            _ => Ok(byte_position),
        }
    }

    /// Returns the byte offsets of the range that begins at `start` and is `length` long.
    fn normalize_range(&self, start: i64, length: i64) -> Result<Range<u32>, Malformed> {
        if length < 0 {
            return Err(Malformed);
        }
        let end = start.checked_add(length).ok_or(Malformed)?;
        Ok(self.normalize(start)?..self.normalize(end)?)
    }
}

/// `OptionDiagnosticResult`
struct RawOptionDiagnostic<'j> {
    path: &'j [Json],
    text: &'j [u8],
    code: i32,
}

/// `Diagnostic`, with its range in the mapper's unit.
struct RawDiagnostic<'j> {
    start: i64,
    length: i64,
    code: i32,
    text: &'j [u8],
}

/// `openProjectLocked`, after the request. Returns the response's `optionDiagnostics`.
fn decode_open_project_result(
    response: &Json,
    mapper: &Mapper,
    mapper_index: usize,
    diagnostic_source: &[u8],
) -> Result<Vec<OptionDiagnostic>, ProjectError> {
    let malformed = |_: Malformed| ProjectError::MalformedResponse;
    let fields = Fields::of(response).map_err(malformed)?;
    let config_identity = fields.string(b"configIdentity").map_err(malformed)?;
    let watched_files = fields.list(b"watchedFiles").map_err(malformed)?;
    let option_diagnostics = fields.list(b"optionDiagnostics").map_err(malformed)?;
    if watched_files.iter().any(|it| it.as_str().is_none()) {
        return Err(ProjectError::MalformedResponse);
    }
    let mut decoded = Vec::new();
    for diagnostic in option_diagnostics {
        let fields = Fields::of(diagnostic).map_err(malformed)?;
        decoded.push(RawOptionDiagnostic {
            path: fields.list(b"path").map_err(malformed)?,
            text: fields.string(b"messageText").map_err(malformed)?,
            code: fields.int32(b"code").map_err(malformed)?,
        });
    }
    if mapper.dynamic_config && config_identity.is_empty() {
        return Err(ProjectError::MissingConfigIdentity);
    }
    if !mapper.dynamic_config && !config_identity.is_empty() {
        return Err(ProjectError::UnexpectedConfigIdentity);
    }
    if !mapper.dynamic_config && !watched_files.is_empty() {
        return Err(ProjectError::UnexpectedWatchedFiles);
    }
    let mut names = watched_files.iter().filter_map(Json::as_str);
    if !names.all(is_rooted_disk_path) {
        return Err(ProjectError::NonAbsoluteWatchedFile);
    }
    let decoded = decoded
        .into_iter()
        .map(|RawOptionDiagnostic { path, text, code }| {
            let path = path.iter().map(|segment| match segment {
                Json::String(property) => Ok(OptionPathSegment::Property(property.clone())),
                Json::Number(_) => {
                    let index = integer(segment)
                        .ok()
                        .and_then(|it| usize::try_from(it).ok());
                    index.map(OptionPathSegment::Index).ok_or(Malformed)
                }
                _ => Err(Malformed),
            });
            Ok(OptionDiagnostic {
                mapper: mapper_index,
                path: path.collect::<Result<_, _>>().map_err(malformed)?,
                source: diagnostic_source.to_vec(),
                code,
                text: text.to_vec(),
            })
        });
    decoded.collect()
}

/// `decodeTransformResult`, followed by the checks of `ParseResult`. `original` is the text that was sent.
fn decode_transform_result(
    response: &Json,
    original: &[u8],
    initialized: &Initialized,
) -> Result<Transformed, TransformError> {
    let malformed = |_: Malformed| TransformError::Response;
    let original_positions = PositionNormalizer::new(original, initialized.encoding);
    let original_positions = original_positions.ok_or(TransformError::Response)?;
    let fields = Fields::of(response).map_err(malformed)?;
    // `json.Unmarshal` fails on a member of the wrong type before anything else is looked at.
    let supplemental = fields.list(b"supplemental").map_err(malformed)?;
    let reported = fields.list(b"diagnostics").map_err(malformed)?;
    let raw = RawOutput::of(&fields).map_err(malformed)?;
    let raw_supplemental = supplemental.iter().map(|output| {
        let fields = Fields::of(output)?;
        RawOutput::of(&fields)
    });
    let raw_supplemental: Vec<RawOutput> =
        (raw_supplemental.collect::<Result<_, _>>()).map_err(malformed)?;
    let mut raw_diagnostics = Vec::new();
    for diagnostic in reported {
        let fields = Fields::of(diagnostic).map_err(malformed)?;
        raw_diagnostics.push(RawDiagnostic {
            start: fields.integer(b"start").map_err(malformed)?,
            length: fields.integer(b"length").map_err(malformed)?,
            code: fields.int32(b"code").map_err(malformed)?,
            text: fields.string(b"messageText").map_err(malformed)?,
        });
    }
    let canonical = raw.normalize(&original_positions, initialized)?;
    let mut outputs = Vec::new();
    for (index, raw) in raw_supplemental.iter().enumerate() {
        let output = raw.normalize(&original_positions, initialized);
        outputs.push(output.map_err(|error| match error {
            TransformError::Directive {
                kind, index: at, ..
            } => TransformError::Directive {
                kind,
                index: at,
                supplemental: Some(index),
            },
            error => error,
        })?);
    }
    let mut diagnostics = Vec::new();
    for RawDiagnostic {
        start,
        length,
        code,
        text,
    } in raw_diagnostics
    {
        let range = original_positions.normalize_range(start, length);
        let Range { start, end } = range.map_err(malformed)?;
        diagnostics.push(ExternalDiagnostic {
            start,
            end,
            source: initialized.diagnostic_source.clone(),
            code,
            text: text.to_vec(),
        });
    }
    let checked = |output: NormalizedOutput| output.validate(original);
    Ok(Transformed {
        canonical: checked(canonical).map_err(TransformError::Mappings)?,
        diagnostics,
        supplemental: (outputs.into_iter().map(checked).collect::<Result<_, _>>())
            .map_err(TransformError::Mappings)?,
    })
}

/// `MappedDiagnosticDirective`, as sent.
struct RawDirective {
    original_start: i64,
    original_length: i64,
    virtual_start: i64,
    virtual_end: i64,
    policy: u8,
    unused_expect_directive_index: Option<i64>,
}

/// `UnusedExpectDirectiveDiagnostic`
struct UnusedExpectDirectiveDiagnostic<'j> {
    code: i32,
    text: &'j [u8],
}

/// `MappedOutput`, with members of the right types whose values haven't been looked at.
struct RawOutput<'j> {
    text: &'j [u8],
    extension: &'j [u8],
    /// `json.Value`: it's decoded after `extension` is checked.
    mappings: Option<&'j Json>,
    unused_expect_directive_diagnostics: Vec<UnusedExpectDirectiveDiagnostic<'j>>,
    directives: Vec<RawDirective>,
}

/// `MappedResult` before `SpanMap.Validate`.
struct NormalizedOutput<'j> {
    text: &'j [u8],
    virtual_extension: &'static [u8],
    segments: Vec<UncheckedSegment>,
    directives: Vec<DiagnosticDirective>,
}

impl<'j> RawOutput<'j> {
    fn of(fields: &Fields<'j>) -> Result<RawOutput<'j>, Malformed> {
        let (mut unused, mut directives) = (Vec::new(), Vec::new());
        if let Some(all) = fields.get(b"diagnosticDirectives") {
            let all = Fields::of(all)?;
            for diagnostic in all.list(b"unusedExpectDirectiveDiagnostics")? {
                let fields = Fields::of(diagnostic)?;
                unused.push(UnusedExpectDirectiveDiagnostic {
                    code: fields.int32(b"code")?,
                    text: fields.string(b"messageText")?,
                });
            }
            for tuple in all.list(b"directives")? {
                let (Some([a, b, c, d, policy]), index) = (match tuple
                    .as_array()
                    .ok_or(Malformed)?
                {
                    [first @ .., index] if first.len() == 5 => (first.first_chunk(), Some(index)),
                    all => (all.first_chunk().filter(|_| all.len() == 5), None),
                }) else {
                    return Err(Malformed);
                };
                directives.push(RawDirective {
                    original_start: integer(a)?,
                    original_length: integer(b)?,
                    virtual_start: integer(c)?,
                    virtual_end: integer(d)?,
                    policy: u8::try_from(integer(policy)?).map_err(|_| Malformed)?,
                    unused_expect_directive_index: index.map(integer).transpose()?,
                });
            }
        }
        Ok(RawOutput {
            text: fields.string(b"text")?,
            extension: fields.string(b"extension")?,
            mappings: fields.get(b"mappings"),
            unused_expect_directive_diagnostics: unused,
            directives,
        })
    }

    /// `decodeMappedOutput`
    fn normalize(
        &self,
        original_positions: &PositionNormalizer,
        initialized: &Initialized,
    ) -> Result<NormalizedOutput<'j>, TransformError> {
        let mut supported = SUPPORTED_VIRTUAL_EXTENSIONS.into_iter();
        let Some(virtual_extension) = supported.find(|it| *it == self.extension) else {
            return Err(TransformError::VirtualExtension(self.extension.to_vec()));
        };
        let virtual_positions = PositionNormalizer::new(self.text, initialized.encoding);
        let virtual_positions = virtual_positions.ok_or(TransformError::Response)?;
        // `spanmap.Unmarshal` and `normalizeMappings`
        let tuples = self.mappings.map_or(Some(&[][..]), Json::as_array);
        let segments = tuples.ok_or(TransformError::Response)?.iter().map(|tuple| {
            let tuple = tuple.as_array().ok_or(Malformed)?;
            if tuple.len() != 5 && tuple.len() != 6 {
                return Err(Malformed);
            }
            // Without a sixth number, every feature is on.
            let mut numbers = [0, 0, 0, 0, 0, FEATURE_MASK];
            for (number, value) in numbers.iter_mut().zip(tuple) {
                *number = int32(value)?;
            }
            let [
                virtual_start,
                virtual_length,
                original_start,
                original_length,
                kind,
                features,
            ] = numbers.map(i64::from);
            Ok(UncheckedSegment {
                virtual_start: virtual_positions.normalize(virtual_start)?,
                virtual_end: virtual_positions.normalize(virtual_start + virtual_length)?,
                original_start: original_positions.normalize(original_start)?,
                original_end: original_positions.normalize(original_start + original_length)?,
                kind: kind as i32,
                features: features as i32,
            })
        });
        let segments: Result<Vec<UncheckedSegment>, Malformed> = segments.collect();
        let mut segments = segments.map_err(|_| TransformError::Response)?;
        segments.shared_sort_by_key(|it| it.virtual_start);
        Ok(NormalizedOutput {
            text: self.text,
            virtual_extension,
            segments,
            directives: self.normalize_directives(
                &virtual_positions,
                original_positions,
                &initialized.diagnostic_source,
            )?,
        })
    }

    /// `normalizeDiagnosticDirectives`
    fn normalize_directives(
        &self,
        virtual_positions: &PositionNormalizer,
        original_positions: &PositionNormalizer,
        diagnostic_source: &[u8],
    ) -> Result<Vec<DiagnosticDirective>, TransformError> {
        let error = |kind: DirectiveErrorKind, index: usize| TransformError::Directive {
            kind,
            index,
            supplemental: None,
        };
        let unused_diagnostics = &self.unused_expect_directive_diagnostics;
        let mut normalized = Vec::new();
        for (index, directive) in self.directives.iter().enumerate() {
            let unused = match directive.policy {
                0 => None,
                1 => {
                    let at = match directive.unused_expect_directive_index {
                        Some(at) => at,
                        None if unused_diagnostics.len() == 1 => 0,
                        None => {
                            let kind = DirectiveErrorKind::ExpectMissingUnusedDiagnostic;
                            return Err(error(kind, index));
                        }
                    };
                    let found = usize::try_from(at)
                        .ok()
                        .and_then(|at| unused_diagnostics.get(at));
                    let kind = DirectiveErrorKind::InvalidUnusedDiagnosticIndex;
                    Some(found.ok_or_else(|| error(kind, index))?)
                }
                policy => return Err(error(DirectiveErrorKind::InvalidPolicy(policy), index)),
            };
            let invalid_range = |_: Malformed| error(DirectiveErrorKind::InvalidRange, index);
            if directive.virtual_end < directive.virtual_start {
                return Err(invalid_range(Malformed));
            }
            let virtual_start = virtual_positions.normalize(directive.virtual_start);
            let virtual_end = virtual_positions.normalize(directive.virtual_end);
            let original = original_positions
                .normalize_range(directive.original_start, directive.original_length);
            let (virtual_start, virtual_end) = (
                virtual_start.map_err(invalid_range)?,
                virtual_end.map_err(invalid_range)?,
            );
            // Only an `expect` directive reports something at its original range.
            let if_unused = match unused {
                None => None,
                Some(unused) => {
                    let Range { start, end } = original.map_err(invalid_range)?;
                    Some(ExternalDiagnostic {
                        start,
                        end,
                        source: diagnostic_source.to_vec(),
                        code: unused.code,
                        text: unused.text.to_vec(),
                    })
                }
            };
            normalized.push(DiagnosticDirective {
                virtual_start,
                virtual_end,
                if_unused,
            });
        }
        let mut sorted: Vec<usize> = (0..normalized.len()).collect();
        sorted.shared_sort_by_key(|&at| normalized[at].virtual_start);
        for (&previous, &next) in sorted.iter().zip(sorted.iter().skip(1)) {
            if normalized[next].virtual_start < normalized[previous].virtual_end {
                return Err(error(DirectiveErrorKind::Overlap, next));
            }
        }
        Ok(normalized)
    }
}

impl NormalizedOutput<'_> {
    fn validate(self, original: &[u8]) -> Result<MappedOutput, MappingError> {
        Ok(MappedOutput {
            span_map: validate(&self.segments, self.text, original)?,
            text: self.text.to_vec(),
            virtual_extension: self.virtual_extension,
            directives: self.directives,
        })
    }
}
