//! `getCommentPragmas`, `extractPragmas`, `processPragmasIntoFields` and `parseResolutionMode` of typescript-go's internal/parser/parser.go, over `iterateCommentRanges` of its internal/scanner/scanner.go: what the comments before the first token of a file say.

use crate::strings;
use crate::syntax_errors::{
    INVALID_REFERENCE_DIRECTIVE_SYNTAX, Message,
    X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT,
};

/// `ast.KindSingleLineCommentTrivia` and `ast.KindMultiLineCommentTrivia`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommentRangeKind {
    SingleLine,
    MultiLine,
}

/// `ast.CommentRange`: a `//` comment without its line break, or a block comment with its `/*` and `*/`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommentRange {
    pub start: u32,
    pub end: u32,
    pub kind: CommentRangeKind,
    pub has_trailing_new_line: bool,
}

/// `ast.PragmaArgument`: where the value is in the source, without its quotes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PragmaArgument {
    pub start: u32,
    pub end: u32,
}

/// The name of an `ast.Pragma`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PragmaName {
    Reference,
    TsCheck,
    TsNocheck,
    Jsx,
    Jsxfrag,
    Jsximportsource,
    Jsxruntime,
}

/// `Pragma.Args`, for the names the reference reads: six of `reference`, and `factory` of a JSX pragma.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct PragmaArguments {
    pub types: Option<PragmaArgument>,
    pub lib: Option<PragmaArgument>,
    pub path: Option<PragmaArgument>,
    pub resolution_mode: Option<PragmaArgument>,
    pub preserve: Option<PragmaArgument>,
    pub no_default_lib: Option<PragmaArgument>,
    pub factory: Option<PragmaArgument>,
}

/// `ast.Pragma`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Pragma {
    pub comment_range: CommentRange,
    pub name: PragmaName,
    pub args: PragmaArguments,
}

/// `core.ResolutionMode`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ResolutionMode {
    None,
    CommonJS,
    ESM,
}

/// Which argument of `/// <reference ... />` the directive is made of.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ReferenceDirectiveKind {
    /// `SourceFile.ReferencedFiles`
    Path,
    /// `SourceFile.TypeReferenceDirectives`
    Types,
    /// `SourceFile.LibReferenceDirectives`
    Lib,
    /// `no-default-lib="true"`, which the reference reads and ignores.
    NoDefaultLib,
}

/// `ast.FileReference`: `start..end` is the value of the argument in the source, which is the file name.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ReferenceDirective {
    pub kind: ReferenceDirectiveKind,
    pub start: u32,
    pub end: u32,
    pub resolution_mode: ResolutionMode,
    pub preserve: bool,
    pub comment_range: CommentRange,
}

/// `ast.CheckJsDirective`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CheckJsDirective {
    pub enabled: bool,
    pub range: CommentRange,
}

/// What `finishSourceFile` reads from the comments before the first token.
#[derive(Default)]
pub struct Pragmas {
    /// `SourceFile.Pragmas`
    pub pragmas: Vec<Pragma>,
    /// `SourceFile.ReferencedFiles`, `TypeReferenceDirectives` and `LibReferenceDirectives` in one list, in the order of the source.
    pub reference_directives: Vec<ReferenceDirective>,
    /// `SourceFile.CheckJsDirective`
    pub check_js_directive: Option<CheckJsDirective>,
}

const _: () = assert!(core::mem::size_of::<CommentRange>() == 12);
const _: () = assert!(core::mem::size_of::<PragmaArgument>() == 8);
const _: () = assert!(core::mem::size_of::<Pragma>() == 100);
const _: () = assert!(core::mem::size_of::<ReferenceDirective>() == 24);
const _: () = assert!(core::mem::size_of::<CheckJsDirective>() == 16);

impl PragmaArgument {
    /// `PragmaArgument.Value`
    pub fn value(self, source: &[u8]) -> &[u8] {
        source
            .get(self.start as usize..self.end as usize)
            .unwrap_or(&[])
    }
}

impl ReferenceDirective {
    /// `FileReference.FileName`
    pub fn file_name(self, source: &[u8]) -> &[u8] {
        source
            .get(self.start as usize..self.end as usize)
            .unwrap_or(&[])
    }
}

impl PragmaArguments {
    /// `args[argName]` for a name that `processPragmasIntoFields` reads; `extractName` lowers the letters.
    fn of_reference(&mut self, arg_name: &[u8]) -> Option<&mut Option<PragmaArgument>> {
        let names: [(&[u8], &mut Option<PragmaArgument>); 6] = [
            (b"types", &mut self.types),
            (b"lib", &mut self.lib),
            (b"path", &mut self.path),
            (b"resolution-mode", &mut self.resolution_mode),
            (b"preserve", &mut self.preserve),
            (b"no-default-lib", &mut self.no_default_lib),
        ];
        names
            .into_iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(arg_name))
            .map(|(_, argument)| argument)
    }
}

impl Pragmas {
    /// `ast.GetPragmaFromSourceFile`: the last pragma with the name `name`.
    pub fn get_pragma(&self, name: PragmaName) -> Option<&Pragma> {
        self.pragmas.iter().rfind(|pragma| pragma.name == name)
    }

    /// The directives of one list of the reference, in its order.
    pub fn references_of(
        &self,
        kind: ReferenceDirectiveKind,
    ) -> impl Iterator<Item = &ReferenceDirective> {
        self.reference_directives
            .iter()
            .filter(move |directive| directive.kind == kind)
    }

    /// The part of `finishSourceFile` that reads the header of `source_text`. `report` gets the range and the diagnostic of each error.
    #[cold]
    pub(crate) fn read(source_text: &[u8], report: &mut dyn FnMut(u32, u32, Message)) -> Pragmas {
        let mut context = Pragmas {
            pragmas: get_comment_pragmas(source_text),
            ..Default::default()
        };
        context.process_pragmas_into_fields(source_text, report);
        context
    }

    /// processPragmasIntoFields
    fn process_pragmas_into_fields(
        &mut self,
        source_text: &[u8],
        report: &mut dyn FnMut(u32, u32, Message),
    ) {
        self.check_js_directive = None;
        self.reference_directives.clear();
        for pragma in &self.pragmas {
            match pragma.name {
                PragmaName::Reference => {
                    let args = pragma.args;
                    let is_true = |argument: Option<PragmaArgument>| {
                        argument.is_some_and(|argument| argument.value(source_text) == b"true")
                    };
                    let preserve = is_true(args.preserve);
                    let directive = match args {
                        PragmaArguments {
                            no_default_lib: Some(no_default_lib),
                            ..
                        } if no_default_lib.value(source_text) == b"true" => {
                            // Ignored.
                            Some((
                                ReferenceDirectiveKind::NoDefaultLib,
                                no_default_lib,
                                ResolutionMode::None,
                            ))
                        }
                        PragmaArguments {
                            types: Some(types), ..
                        } => {
                            let mut parsed = ResolutionMode::None;
                            if let Some(resolution_mode) = args.resolution_mode {
                                parsed =
                                    parse_resolution_mode(resolution_mode, source_text, report);
                            }
                            Some((ReferenceDirectiveKind::Types, types, parsed))
                        }
                        PragmaArguments { lib: Some(lib), .. } => {
                            Some((ReferenceDirectiveKind::Lib, lib, ResolutionMode::None))
                        }
                        PragmaArguments {
                            path: Some(path), ..
                        } => Some((ReferenceDirectiveKind::Path, path, ResolutionMode::None)),
                        _ => {
                            report(
                                pragma.comment_range.start,
                                pragma.comment_range.end,
                                INVALID_REFERENCE_DIRECTIVE_SYNTAX,
                            );
                            None
                        }
                    };
                    if let Some((kind, argument, resolution_mode)) = directive {
                        self.reference_directives.push(ReferenceDirective {
                            kind,
                            start: argument.start,
                            end: argument.end,
                            resolution_mode,
                            preserve,
                            comment_range: pragma.comment_range,
                        });
                    }
                }
                PragmaName::TsCheck | PragmaName::TsNocheck => {
                    // _last_ of either nocheck or check in a file is the "winner"
                    if self
                        .check_js_directive
                        .is_none_or(|directive| pragma.comment_range.start > directive.range.start)
                    {
                        self.check_js_directive = Some(CheckJsDirective {
                            enabled: pragma.name == PragmaName::TsCheck,
                            range: pragma.comment_range,
                        });
                    }
                }
                PragmaName::Jsx
                | PragmaName::Jsxfrag
                | PragmaName::Jsximportsource
                | PragmaName::Jsxruntime => {
                    // Nothing to do here
                }
            }
        }
    }
}

/// parseResolutionMode
fn parse_resolution_mode(
    mode: PragmaArgument,
    source_text: &[u8],
    report: &mut dyn FnMut(u32, u32, Message),
) -> ResolutionMode {
    match mode.value(source_text) {
        b"import" => ResolutionMode::ESM,
        b"require" => ResolutionMode::CommonJS,
        _ => {
            report(
                mode.start,
                mode.end,
                X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT,
            );
            ResolutionMode::None
        }
    }
}

/// getCommentPragmas
fn get_comment_pragmas(source_text: &[u8]) -> Vec<Pragma> {
    let mut pragmas = Vec::new();
    for comment_range in get_leading_comment_ranges(source_text) {
        let comment = source_text
            .get(comment_range.start as usize..comment_range.end as usize)
            .unwrap_or(&[]);
        extract_pragmas(comment_range, comment, &mut pragmas);
    }
    pragmas
}

/// `scanner.GetLeadingCommentRanges(text, 0)`: `iterateCommentRanges` from the start of the file, where `trailing` is false and a `#!` line is passed.
pub(crate) fn get_leading_comment_ranges(text: &[u8]) -> Vec<CommentRange> {
    let mut ranges = Vec::new();
    let mut pending: Option<CommentRange> = None;
    let mut pos = 0;
    // isShebangTrivia, scanShebangTrivia
    if text.starts_with(b"#!") {
        pos = line_end_pos(text, 2);
    }
    while let Some(&ch) = text.get(pos) {
        match ch {
            b'\r' | b'\n' => {
                if ch == b'\r' && text.get(pos + 1) == Some(&b'\n') {
                    pos += 1;
                }
                pos += 1;
                if let Some(pending) = &mut pending {
                    pending.has_trailing_new_line = true;
                }
            }
            b'\t' | 0x0B | 0x0C | b' ' => pos += 1,
            b'/' => {
                let kind = match text.get(pos + 1) {
                    Some(b'/') => CommentRangeKind::SingleLine,
                    Some(b'*') => CommentRangeKind::MultiLine,
                    _ => break,
                };
                let start_pos = pos;
                pos += 2;
                let mut has_trailing_new_line = false;
                if kind == CommentRangeKind::SingleLine {
                    pos = line_end_pos(text, pos);
                    has_trailing_new_line = pos < text.len();
                } else {
                    pos = match skip_to(text, pos, b"*/") {
                        Some(close) => close + 2,
                        None => text.len(),
                    };
                }
                ranges.extend(pending.take());
                pending = Some(CommentRange {
                    start: offset(start_pos),
                    end: offset(pos),
                    kind,
                    has_trailing_new_line,
                });
            }
            _ => {
                // ch > unicode.MaxASCII && stringutil.IsWhiteSpaceLike(ch)
                let Some((size, is_line_break)) = white_space_like_above_ascii(text, pos) else {
                    break;
                };
                if is_line_break && let Some(pending) = &mut pending {
                    pending.has_trailing_new_line = true;
                }
                pos += size;
            }
        }
    }
    ranges.extend(pending);
    ranges
}

/// The size of the code point above ASCII at `pos` that `stringutil.IsWhiteSpaceLike` takes, and whether `stringutil.IsLineBreak` takes it.
fn white_space_like_above_ascii(text: &[u8], pos: usize) -> Option<(usize, bool)> {
    match text.get(pos..)? {
        // U+0085, U+00A0
        [0xC2, 0x85 | 0xA0, ..] => Some((2, false)),
        // U+1680
        [0xE1, 0x9A, 0x80, ..] => Some((3, false)),
        // U+2028, U+2029
        [0xE2, 0x80, 0xA8 | 0xA9, ..] => Some((3, true)),
        // U+2000 to U+200B, U+202F
        [0xE2, 0x80, 0x80..=0x8B | 0xAF, ..] => Some((3, false)),
        // U+205F
        [0xE2, 0x81, 0x9F, ..] => Some((3, false)),
        // U+3000
        [0xE3, 0x80, 0x80, ..] => Some((3, false)),
        // U+FEFF
        [0xEF, 0xBB, 0xBF, ..] => Some((3, false)),
        _ => None,
    }
}

/// extractPragmas: `text` is the comment at `comment_range`.
fn extract_pragmas(comment_range: CommentRange, text: &[u8], pragmas: &mut Vec<Pragma>) {
    if comment_range.kind == CommentRangeKind::SingleLine {
        let mut pos = 2;
        let triple_slash = is_match(text, pos, b"/");
        if triple_slash {
            pos += 1;
        }
        pos = skip_blanks(text, pos);
        if triple_slash && is_match(text, pos, b"<") {
            let tag_name = extract_name(text, pos + 1);
            if !tag_name.eq_ignore_ascii_case(b"reference") {
                return;
            }
            pos += 10;
            let mut args = PragmaArguments::default();
            loop {
                pos = skip_blanks(text, pos);
                if is_match(text, pos, b"/>") {
                    break;
                }
                let arg_name = extract_name(text, pos);
                if arg_name.is_empty() {
                    break;
                }
                pos = skip_blanks(text, pos + arg_name.len());
                if !is_match(text, pos, b"=") {
                    break;
                }
                pos = skip_blanks(text, pos + 1);
                let Some(value) = extract_quoted_string(text, pos) else {
                    break;
                };
                // An argument with another name is read and not kept: nothing reads it.
                if let Some(argument) = args.of_reference(arg_name) {
                    *argument = Some(PragmaArgument {
                        start: comment_range.start.saturating_add(offset(pos + 1)),
                        end: comment_range
                            .start
                            .saturating_add(offset(pos + 1 + value.len())),
                    });
                }
                pos += value.len() + 2;
            }
            pragmas.push(Pragma {
                comment_range,
                name: PragmaName::Reference,
                args,
            });
            return;
        }
        if is_match(text, pos, b"@") {
            pos += 1;
            let pragma_name = extract_name(text, pos);
            let name = if pragma_name.eq_ignore_ascii_case(b"ts-check") {
                PragmaName::TsCheck
            } else if pragma_name.eq_ignore_ascii_case(b"ts-nocheck") {
                PragmaName::TsNocheck
            } else {
                return;
            };
            pragmas.push(Pragma {
                comment_range,
                name,
                args: PragmaArguments::default(),
            });
        }
        return;
    }
    let text = text.strip_suffix(b"*/").unwrap_or(text);
    let mut pos = 2;
    while let Some(at) = skip_to(text, pos, b"@") {
        pos = at;
        // The '@' must be immediately followed by a non-whitespace pragma name, and only the first '@'-token on a line is considered.
        let name_pos = pos + 1;
        let name_end = skip_non_blanks(text, name_pos);
        if name_end == name_pos {
            pos += 1;
            continue;
        }
        let line_end = line_end_pos(text, pos);
        let pragma_name = text.get(name_pos..name_end).unwrap_or(&[]);
        let names: [(&[u8], PragmaName); 4] = [
            (b"jsx", PragmaName::Jsx),
            (b"jsxfrag", PragmaName::Jsxfrag),
            (b"jsximportsource", PragmaName::Jsximportsource),
            (b"jsxruntime", PragmaName::Jsxruntime),
        ];
        let name = names
            .into_iter()
            .find(|(lower, _)| is_to_lower(pragma_name, lower));
        if let Some((_, name)) = name {
            let start = skip_blanks(text, name_end);
            let arg_end = skip_non_blanks(text, start);
            if arg_end != start {
                pragmas.push(Pragma {
                    comment_range,
                    name,
                    args: PragmaArguments {
                        factory: Some(PragmaArgument {
                            start: comment_range.start.saturating_add(offset(start)),
                            end: comment_range.start.saturating_add(offset(arg_end)),
                        }),
                        ..Default::default()
                    },
                });
            }
        }
        pos = line_end;
    }
}

/// `strings.ToLower(name) == lower`, where `lower` is ASCII. Above ASCII only U+0130 lowers to a letter that a pragma name has, to "i".
fn is_to_lower(name: &[u8], lower: &[u8]) -> bool {
    let mut rest = name;
    for &expected in lower {
        rest = match rest {
            [0xC4, 0xB0, rest @ ..] if expected == b'i' => rest,
            [byte, rest @ ..] if byte.to_ascii_lowercase() == expected => rest,
            _ => return false,
        };
    }
    rest.is_empty()
}

/// match
fn is_match(text: &[u8], pos: usize, s: &[u8]) -> bool {
    text.get(pos..).is_some_and(|rest| rest.starts_with(s))
}

/// skipBlanks
fn skip_blanks(text: &[u8], mut pos: usize) -> usize {
    while matches!(text.get(pos), Some(b' ' | b'\t')) {
        pos += 1;
    }
    pos
}

/// skipNonBlanks
fn skip_non_blanks(text: &[u8], mut pos: usize) -> usize {
    while text
        .get(pos)
        .is_some_and(|byte| !matches!(byte, b' ' | b'\t' | b'\r' | b'\n'))
    {
        pos += 1;
    }
    pos
}

/// skipTo: where `s` is at or after `pos`.
fn skip_to(text: &[u8], pos: usize, s: &[u8]) -> Option<usize> {
    let rest = text.get(pos..)?;
    strings::index_of(rest, s).map(|at| pos + at)
}

/// lineEndPos: where the line of `pos` ends. A line ends at a line feed, a carriage return, U+2028 or U+2029.
fn line_end_pos(text: &[u8], mut pos: usize) -> usize {
    while let Some(rest) = text.get(pos..) {
        match rest {
            [] | [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..] => break,
            _ => pos += 1,
        }
    }
    pos.min(text.len())
}

/// extractName: the letters and dashes at `pos`, as written. The reference lowers them, and the callers compare without case.
fn extract_name(text: &[u8], pos: usize) -> &[u8] {
    let rest = text.get(pos..).unwrap_or(&[]);
    let len = rest
        .iter()
        .position(|byte| !(byte.is_ascii_alphabetic() || *byte == b'-'))
        .unwrap_or(rest.len());
    rest.get(..len).unwrap_or(&[])
}

/// extractQuotedString: the text between the quote at `pos` and the next quote of its kind.
fn extract_quoted_string(text: &[u8], pos: usize) -> Option<&[u8]> {
    let quote = *text.get(pos)?;
    if quote != b'\'' && quote != b'"' {
        return None;
    }
    let rest = text.get(pos + 1..)?;
    let len = strings::index_of_char_usize(rest, quote)?;
    rest.get(..len)
}

/// An offset into a source as the side table holds it.
fn offset(pos: usize) -> u32 {
    u32::try_from(pos).unwrap_or(u32::MAX)
}
