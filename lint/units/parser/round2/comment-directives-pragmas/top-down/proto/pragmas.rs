//! The pragmas of the comments before the first token: getCommentPragmas, extractPragmas and processPragmasIntoFields
//! of typescript-go's internal/parser/parser.go, over iterateCommentRanges of internal/scanner/scanner.go.

use crate::comment_directives::line_break_len;

/// ast.KindSingleLineCommentTrivia and ast.KindMultiLineCommentTrivia.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommentRangeKind {
    SingleLine,
    MultiLine,
}

/// ast.CommentRange.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommentRange {
    pub start: u32,
    pub end: u32,
    pub kind: CommentRangeKind,
    pub has_trailing_new_line: bool,
}

/// The `Name` of an ast.Pragma.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PragmaName {
    Reference,
    TsCheck,
    TsNoCheck,
    Jsx,
    JsxFrag,
    JsxImportSource,
    JsxRuntime,
}

impl PragmaName {
    /// The name as upstream spells it.
    pub const fn text(self) -> &'static [u8] {
        match self {
            PragmaName::Reference => b"reference",
            PragmaName::TsCheck => b"ts-check",
            PragmaName::TsNoCheck => b"ts-nocheck",
            PragmaName::Jsx => b"jsx",
            PragmaName::JsxFrag => b"jsxfrag",
            PragmaName::JsxImportSource => b"jsximportsource",
            PragmaName::JsxRuntime => b"jsxruntime",
        }
    }
}

/// ast.PragmaArgument: the name as it is written, in any case, and the value without its quotes. A name of no length is `factory`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PragmaArgument {
    pub name_start: u32,
    pub name_end: u32,
    pub value_start: u32,
    pub value_end: u32,
}

/// ast.Pragma: its arguments are `Pragmas::arguments[arguments_start..arguments_start + arguments_len]`, one for each name.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Pragma {
    pub comment: CommentRange,
    pub name: PragmaName,
    pub arguments_start: u32,
    pub arguments_len: u32,
}

/// core.ResolutionMode: `CommonJs` is `require`, `EsNext` is `import`.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ResolutionMode {
    None,
    CommonJs,
    EsNext,
}

/// ast.FileReference: the file name is the text at `start..end`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FileReference {
    pub start: u32,
    pub end: u32,
    pub resolution_mode: ResolutionMode,
    pub preserve: bool,
}

/// ast.CheckJsDirective.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CheckJsDirective {
    pub enabled: bool,
    pub range: CommentRange,
}

/// What finishSourceFile reads from the comments before the first token.
#[derive(Default)]
pub struct Pragmas {
    /// `SourceFile.Pragmas`, in source order.
    pub list: Vec<Pragma>,
    /// The arguments of every pragma of `list`.
    pub arguments: Vec<PragmaArgument>,
    pub referenced_files: Vec<FileReference>,
    pub type_reference_directives: Vec<FileReference>,
    pub lib_reference_directives: Vec<FileReference>,
    /// The last `@ts-check` or `@ts-nocheck`.
    pub check_js_directive: Option<CheckJsDirective>,
}

const _: () = assert!(core::mem::size_of::<CommentRange>() == 12);
const _: () = assert!(core::mem::size_of::<PragmaArgument>() == 16);
const _: () = assert!(core::mem::size_of::<Pragma>() == 24);
const _: () = assert!(core::mem::size_of::<FileReference>() == 12);

/// A diagnostic of processPragmasIntoFields. Stand-in for `Log::add_range_error_with_code`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Diagnostic {
    pub code: u32,
    pub start: u32,
    pub end: u32,
}

fn offset(pos: usize) -> u32 {
    u32::try_from(pos).unwrap_or(u32::MAX)
}

impl PragmaArgument {
    /// Whether the argument has the name `name`, which is in lower case: extractName lowers what it reads.
    fn is_named(&self, text: &[u8], name: &[u8]) -> bool {
        if self.name_start == self.name_end {
            return name == b"factory";
        }
        text.get(self.name_start as usize..self.name_end as usize)
            .is_some_and(|written| written.eq_ignore_ascii_case(name))
    }

    /// The value: the text between the quotes, or the word after the name of a pragma of a block comment.
    pub fn value<'t>(&self, text: &'t [u8]) -> &'t [u8] {
        text.get(self.value_start as usize..self.value_end as usize).unwrap_or(b"")
    }
}

impl Pragmas {
    /// `pragma.Args[name]`, for a `name` in lower case.
    pub fn argument(&self, text: &[u8], pragma: &Pragma, name: &[u8]) -> Option<PragmaArgument> {
        let start = pragma.arguments_start as usize;
        let arguments = self.arguments.get(start..start + pragma.arguments_len as usize)?;
        arguments.iter().copied().find(|argument| argument.is_named(text, name))
    }

    /// `args[argName] = ...` for the pragma whose arguments start at `first`: an argument of the same name gets the new value.
    fn set_argument(&mut self, text: &[u8], first: usize, name: &[u8], argument: PragmaArgument) {
        let same = self.arguments.iter_mut().skip(first).find(|earlier| earlier.is_named(text, name));
        match same {
            Some(earlier) => {
                earlier.value_start = argument.value_start;
                earlier.value_end = argument.value_end;
            }
            None => self.arguments.push(argument),
        }
    }
}

/// scanner.go isShebangTrivia. Upstream panics when `pos` is not 0: the one caller passes 0.
fn is_shebang_trivia(text: &[u8]) -> bool {
    text.starts_with(b"#!")
}

/// scanner.go scanShebangTrivia.
fn scan_shebang_trivia(text: &[u8], mut pos: usize) -> usize {
    pos += 2;
    line_end_pos(text, pos)
}

/// The length of the character of stringutil.IsWhiteSpaceLike above ASCII that starts at `pos`, and whether it is a line break. 0 where none starts.
fn white_space_above_ascii(text: &[u8], pos: usize) -> (usize, bool) {
    let at = |offset: usize| text.get(pos + offset).copied().unwrap_or(0);
    match (at(0), at(1), at(2)) {
        // U+0085, U+00A0
        (0xC2, 0x85 | 0xA0, _) => (2, false),
        // U+1680
        (0xE1, 0x9A, 0x80) => (3, false),
        // U+2000 to U+200B, U+202F
        (0xE2, 0x80, 0x80..=0x8B | 0xAF) => (3, false),
        // U+2028, U+2029
        (0xE2, 0x80, 0xA8 | 0xA9) => (3, true),
        // U+205F
        (0xE2, 0x81, 0x9F) => (3, false),
        // U+3000
        (0xE3, 0x80, 0x80) => (3, false),
        // U+FEFF
        (0xEF, 0xBB, 0xBF) => (3, false),
        _ => (0, false),
    }
}

/// scanner.go iterateCommentRanges: `each` gets every comment range that follows `pos`.
fn iterate_comment_ranges(text: &[u8], mut pos: usize, trailing: bool, each: &mut dyn FnMut(CommentRange)) {
    let mut pending: Option<CommentRange> = None;
    let mut collecting = trailing;
    if pos == 0 {
        collecting = true;
        if is_shebang_trivia(text) {
            pos = scan_shebang_trivia(text, pos);
        }
    }
    while let Some(&ch) = text.get(pos) {
        match ch {
            b'\r' | b'\n' => {
                if ch == b'\r' && text.get(pos + 1) == Some(&b'\n') {
                    pos += 1;
                }
                pos += 1;
                if trailing {
                    break;
                }

                collecting = true;
                if let Some(pending) = &mut pending {
                    pending.has_trailing_new_line = true;
                }

                continue;
            }
            b'\t' | 0x0B | 0x0C | b' ' => {
                pos += 1;
                continue;
            }
            b'/' => {
                let next_char = text.get(pos + 1).copied().unwrap_or(0);
                let mut has_trailing_new_line = false;
                if next_char == b'/' || next_char == b'*' {
                    let kind = if next_char == b'/' {
                        CommentRangeKind::SingleLine
                    } else {
                        CommentRangeKind::MultiLine
                    };

                    let start_pos = pos;
                    pos += 2;
                    if next_char == b'/' {
                        pos = line_end_pos(text, pos);
                        has_trailing_new_line = pos < text.len();
                    } else {
                        pos = match text.get(pos..).and_then(|rest| index_of(rest, b"*/")) {
                            Some(i) => pos + i + 2,
                            None => text.len(),
                        };
                    }

                    if collecting {
                        if let Some(pending) = pending.take() {
                            each(pending);
                        }

                        pending = Some(CommentRange {
                            start: offset(start_pos),
                            end: offset(pos),
                            kind,
                            has_trailing_new_line,
                        });
                    }

                    continue;
                }
                break;
            }
            _ => {
                let (size, is_line_break) = white_space_above_ascii(text, pos);
                if size != 0 {
                    if is_line_break && let Some(pending) = &mut pending {
                        pending.has_trailing_new_line = true;
                    }
                    pos += size;
                    continue;
                }
                break;
            }
        }
    }

    if let Some(pending) = pending {
        each(pending);
    }
}

/// Stand-in for `bun_core::strings::index_of`.
fn index_of(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    (0..=haystack.len() - needle.len()).find(|&i| haystack[i..].starts_with(needle))
}

/// parser.go getCommentPragmas.
pub fn get_comment_pragmas(source_text: &[u8]) -> Pragmas {
    let mut pragmas = Pragmas::default();
    iterate_comment_ranges(source_text, 0, false, &mut |comment_range| {
        let comment = source_text
            .get(comment_range.start as usize..comment_range.end as usize)
            .unwrap_or(b"");
        extract_pragmas(source_text, comment_range, comment, &mut pragmas);
    });
    pragmas
}

/// parser.go extractPragmas: `text` is the comment, and the pragmas go to `pragmas`.
fn extract_pragmas(source_text: &[u8], comment_range: CommentRange, mut text: &[u8], pragmas: &mut Pragmas) {
    let comment_pos = comment_range.start as usize;
    if comment_range.kind == CommentRangeKind::SingleLine {
        let mut pos = 2;
        let triple_slash = match_(text, pos, b"/");
        if triple_slash {
            pos += 1;
        }
        pos = skip_blanks(text, pos);
        if triple_slash && match_(text, pos, b"<") {
            let tag_name = extract_name(text, pos + 1);
            if !tag_name.eq_ignore_ascii_case(b"reference") {
                return;
            }
            pos += 10;
            let first = pragmas.arguments.len();
            loop {
                pos = skip_blanks(text, pos);
                if match_(text, pos, b"/>") {
                    break;
                }
                let arg_name = extract_name(text, pos);
                if arg_name.is_empty() {
                    break;
                }
                let name_pos = pos;
                pos = skip_blanks(text, pos + arg_name.len());
                if !match_(text, pos, b"=") {
                    break;
                }
                pos = skip_blanks(text, pos + 1);
                let Some(value) = extract_quoted_string(text, pos) else {
                    break;
                };
                pragmas.set_argument(
                    source_text,
                    first,
                    arg_name,
                    PragmaArgument {
                        name_start: offset(comment_pos + name_pos),
                        name_end: offset(comment_pos + name_pos + arg_name.len()),
                        value_start: offset(comment_pos + pos + 1),
                        value_end: offset(comment_pos + pos + 1 + value.len()),
                    },
                );
                pos += value.len() + 2;
            }
            pragmas.list.push(Pragma {
                comment: comment_range,
                name: PragmaName::Reference,
                arguments_start: offset(first),
                arguments_len: offset(pragmas.arguments.len() - first),
            });
            return;
        }
        if match_(text, pos, b"@") {
            pos += 1;
            let pragma_name = extract_name(text, pos);
            let name = if pragma_name.eq_ignore_ascii_case(b"ts-check") {
                PragmaName::TsCheck
            } else if pragma_name.eq_ignore_ascii_case(b"ts-nocheck") {
                PragmaName::TsNoCheck
            } else {
                return;
            };
            pragmas.list.push(Pragma {
                comment: comment_range,
                name,
                arguments_start: offset(pragmas.arguments.len()),
                arguments_len: 0,
            });
            return;
        }
    }
    if comment_range.kind == CommentRangeKind::MultiLine {
        text = text.strip_suffix(b"*/").unwrap_or(text);
        let mut pos = 2;
        loop {
            let Some(at) = skip_to(text, pos, b"@") else {
                break;
            };
            pos = at;
            // Mirrors the /@(\S+)(\s+(?:\S.*)?)?$/gm pragma regex used by TypeScript: only the first '@'-token on a line is considered.
            let name_pos = pos + 1;
            let name_end = skip_non_blanks(text, name_pos);
            if name_end == name_pos {
                pos += 1;
                continue;
            }
            let line_end = line_end_pos(text, pos);
            let pragma_name = text.get(name_pos..name_end).unwrap_or(b"");
            if let Some(name) = block_pragma_name(pragma_name) {
                let start = skip_blanks(text, name_end);
                let arg_end = skip_non_blanks(text, start);
                if arg_end != start {
                    pragmas.list.push(Pragma {
                        comment: comment_range,
                        name,
                        arguments_start: offset(pragmas.arguments.len()),
                        arguments_len: 1,
                    });
                    pragmas.arguments.push(PragmaArgument {
                        name_start: 0,
                        name_end: 0,
                        value_start: offset(comment_pos + start),
                        value_end: offset(comment_pos + arg_end),
                    });
                }
            }
            pos = line_end;
        }
    }
}

/// The pragma of a block comment whose name strings.ToLower makes of `name`.
fn block_pragma_name(name: &[u8]) -> Option<PragmaName> {
    [
        PragmaName::Jsx,
        PragmaName::JsxFrag,
        PragmaName::JsxImportSource,
        PragmaName::JsxRuntime,
    ]
    .into_iter()
    .find(|pragma| lower_equals(name, pragma.text()))
}

/// `strings.ToLower(name) == lower`: Go lowers U+0130 to `i`, and no other character above ASCII to a letter of a pragma name.
fn lower_equals(name: &[u8], lower: &[u8]) -> bool {
    let mut at = 0;
    for &expected in lower {
        match name.get(at) {
            Some(byte) if byte.to_ascii_lowercase() == expected => at += 1,
            Some(0xC4) if expected == b'i' && name.get(at + 1) == Some(&0xB0) => at += 2,
            _ => return false,
        }
    }
    at == name.len()
}

/// parser.go match.
fn match_(text: &[u8], pos: usize, s: &[u8]) -> bool {
    text.get(pos..).is_some_and(|rest| rest.starts_with(s))
}

/// parser.go skipBlanks.
fn skip_blanks(text: &[u8], mut pos: usize) -> usize {
    while matches!(text.get(pos), Some(b' ' | b'\t')) {
        pos += 1;
    }
    pos
}

/// parser.go skipNonBlanks.
fn skip_non_blanks(text: &[u8], mut pos: usize) -> usize {
    while text.get(pos).is_some_and(|byte| !matches!(byte, b' ' | b'\t' | b'\r' | b'\n')) {
        pos += 1;
    }
    pos
}

/// parser.go skipTo.
fn skip_to(text: &[u8], pos: usize, s: &[u8]) -> Option<usize> {
    if pos >= text.len() {
        return None;
    }
    index_of(text.get(pos..)?, s).map(|i| pos + i)
}

/// parser.go lineEndPos.
fn line_end_pos(text: &[u8], mut pos: usize) -> usize {
    while pos < text.len() {
        if line_break_len(text, pos) != 0 {
            return pos;
        }
        pos += 1;
    }
    text.len()
}

/// parser.go extractName: the name as it is written. Upstream lowers it, so a reader compares it without case.
fn extract_name(text: &[u8], mut pos: usize) -> &[u8] {
    let start = pos;
    while text.get(pos).is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'-') {
        pos += 1;
    }
    text.get(start..pos).unwrap_or(b"")
}

/// parser.go extractQuotedString.
fn extract_quoted_string(text: &[u8], mut pos: usize) -> Option<&[u8]> {
    let quote = *text.get(pos)?;
    if quote != b'\'' && quote != b'"' {
        return None;
    }
    pos += 1;
    let start = pos;
    while text.get(pos).is_some_and(|byte| *byte != quote) {
        pos += 1;
    }
    if pos >= text.len() {
        return None;
    }
    text.get(start..pos)
}

/// parser.go processPragmasIntoFields.
pub fn process_pragmas_into_fields(pragmas: &mut Pragmas, text: &[u8], report: &mut dyn FnMut(Diagnostic)) {
    pragmas.check_js_directive = None;
    pragmas.referenced_files.clear();
    pragmas.type_reference_directives.clear();
    pragmas.lib_reference_directives.clear();
    for index in 0..pragmas.list.len() {
        let Some(&pragma) = pragmas.list.get(index) else {
            break;
        };
        match pragma.name {
            PragmaName::Reference => {
                let types = pragmas.argument(text, &pragma, b"types");
                let lib = pragmas.argument(text, &pragma, b"lib");
                let path = pragmas.argument(text, &pragma, b"path");
                let resolution_mode = pragmas.argument(text, &pragma, b"resolution-mode");
                let preserve = pragmas
                    .argument(text, &pragma, b"preserve")
                    .is_some_and(|preserve| preserve.value(text) == b"true");
                let no_default_lib = pragmas.argument(text, &pragma, b"no-default-lib");
                if no_default_lib.is_some_and(|argument| argument.value(text) == b"true") {
                    // Ignored.
                } else if let Some(types) = types {
                    let parsed = match resolution_mode {
                        Some(mode) => parse_resolution_mode(mode.value(text), mode.value_start, mode.value_end, report),
                        None => ResolutionMode::None,
                    };
                    pragmas.type_reference_directives.push(FileReference {
                        start: types.value_start,
                        end: types.value_end,
                        resolution_mode: parsed,
                        preserve,
                    });
                } else if let Some(lib) = lib {
                    pragmas.lib_reference_directives.push(FileReference {
                        start: lib.value_start,
                        end: lib.value_end,
                        resolution_mode: ResolutionMode::None,
                        preserve,
                    });
                } else if let Some(path) = path {
                    pragmas.referenced_files.push(FileReference {
                        start: path.value_start,
                        end: path.value_end,
                        resolution_mode: ResolutionMode::None,
                        preserve,
                    });
                } else {
                    report(Diagnostic { code: 1084, start: pragma.comment.start, end: pragma.comment.end });
                }
            }
            PragmaName::TsCheck | PragmaName::TsNoCheck => {
                // _last_ of either nocheck or check in a file is the "winner"
                if pragmas
                    .check_js_directive
                    .is_none_or(|directive| pragma.comment.start > directive.range.start)
                {
                    pragmas.check_js_directive = Some(CheckJsDirective {
                        enabled: pragma.name == PragmaName::TsCheck,
                        range: pragma.comment,
                    });
                }
            }
            // Nothing to do here
            PragmaName::Jsx | PragmaName::JsxFrag | PragmaName::JsxImportSource | PragmaName::JsxRuntime => {}
        }
    }
}

/// parser.go parseResolutionMode.
fn parse_resolution_mode(mode: &[u8], pos: u32, end: u32, report: &mut dyn FnMut(Diagnostic)) -> ResolutionMode {
    if mode == b"import" {
        return ResolutionMode::EsNext;
    }
    if mode == b"require" {
        return ResolutionMode::CommonJs;
    }
    report(Diagnostic { code: 1453, start: pos, end });
    ResolutionMode::None
}
