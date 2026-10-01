//! The pragmas of the comments before the first token: getCommentPragmas, extractPragmas, processPragmasIntoFields and parseResolutionMode of typescript-go's internal/parser/parser.go.

use bun_ast::{Range, ts};

use crate::p::P;
use crate::parse::comment_directives::{bounds, line_break_len, offset_of};
use crate::parse::syntax_errors::{
    INVALID_REFERENCE_DIRECTIVE_SYNTAX, Message,
    X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT,
};

/// Which argument of a `/// <reference ... />` comment names what it refers to.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ReferenceDirectiveKind {
    /// `path`: an entry of `SourceFile.ReferencedFiles`.
    Path,
    /// `types`: an entry of `SourceFile.TypeReferenceDirectives`.
    Types,
    /// `lib`: an entry of `SourceFile.LibReferenceDirectives`.
    Lib,
    /// `no-default-lib="true"`: the reference reads it and makes no entry.
    NoDefaultLib,
}

/// `core.ResolutionMode`: `CommonJS` is `require` and `ESM` is `import`.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ResolutionMode {
    None,
    CommonJS,
    ESM,
}

/// `ast.FileReference` and the comment it is in: the file name is the source from `start` to `end`, the text between the quotes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ReferenceDirective {
    pub start: u32,
    pub end: u32,
    pub comment_start: u32,
    pub comment_end: u32,
    pub kind: ReferenceDirectiveKind,
    /// Of `resolution-mode` beside `types`.
    pub resolution_mode: ResolutionMode,
    /// `preserve="true"`
    pub preserve: bool,
}

/// `ast.CheckJsDirective`: the comment from `start` to `end` is `// @ts-check` or `// @ts-nocheck`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CheckJsDirective {
    pub start: u32,
    pub end: u32,
    /// `@ts-check`
    pub enabled: bool,
}

const _: () = assert!(core::mem::size_of::<ReferenceDirective>() == 20);
const _: () = assert!(core::mem::size_of::<CheckJsDirective>() == 12);

/// What processPragmasIntoFields reads from the comments before the first token.
#[derive(Default)]
pub struct Pragmas {
    /// `ReferencedFiles`, `TypeReferenceDirectives` and `LibReferenceDirectives` as one list, in the order of the source.
    pub reference_directives: Vec<ReferenceDirective>,
    /// `CheckJsDirective`: the last `@ts-check` or `@ts-nocheck`.
    pub check_js_directive: Option<CheckJsDirective>,
}

impl ReferenceDirective {
    /// `FileReference.FileName`
    pub fn file_name<'s>(&self, source_text: &'s [u8]) -> &'s [u8] {
        source_text
            .get(self.start as usize..self.end as usize)
            .unwrap_or(b"")
    }
}

/// `ast.PragmaArgument`: where the value is, without its quotes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct PragmaArgument {
    start: u32,
    end: u32,
}

impl PragmaArgument {
    /// `PragmaArgument.Value`
    fn value(self, source_text: &[u8]) -> &[u8] {
        source_text
            .get(self.start as usize..self.end as usize)
            .unwrap_or(b"")
    }
}

/// The `Name` of an `ast.Pragma` of a `//` comment.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum PragmaName {
    Reference,
    TsCheck,
    TsNocheck,
}

/// `ast.Pragma.Args` of `reference`: the six names that processPragmasIntoFields reads.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
struct PragmaArguments {
    types: Option<PragmaArgument>,
    lib: Option<PragmaArgument>,
    path: Option<PragmaArgument>,
    resolution_mode: Option<PragmaArgument>,
    preserve: Option<PragmaArgument>,
    no_default_lib: Option<PragmaArgument>,
}

impl PragmaArguments {
    /// `args[argName] = ...`: a later argument of the same name takes the place of an earlier one, and a name that nothing reads is dropped.
    fn set(&mut self, arg_name: &[u8], argument: PragmaArgument) {
        let names: [(&[u8], &mut Option<PragmaArgument>); 6] = [
            (b"types", &mut self.types),
            (b"lib", &mut self.lib),
            (b"path", &mut self.path),
            (b"resolution-mode", &mut self.resolution_mode),
            (b"preserve", &mut self.preserve),
            (b"no-default-lib", &mut self.no_default_lib),
        ];
        for (name, slot) in names {
            if arg_name.eq_ignore_ascii_case(name) {
                *slot = Some(argument);
            }
        }
    }
}

/// `ast.Pragma`: the comment from `comment_start` to `comment_end` holds it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Pragma {
    comment_start: u32,
    comment_end: u32,
    name: PragmaName,
    args: PragmaArguments,
}

/// scanner.go isShebangTrivia, at position 0.
fn is_shebang_trivia(text: &[u8]) -> bool {
    text.starts_with(b"#!")
}

/// scanner.go scanShebangTrivia.
fn scan_shebang_trivia(text: &[u8], mut pos: usize) -> usize {
    pos += 2;
    while pos < text.len() {
        if line_break_len(text, pos) != 0 {
            break;
        }
        pos += 1;
    }
    pos.min(text.len())
}

/// The length of the character of stringutil.IsWhiteSpaceLike above ASCII that starts at `pos`, 0 where none starts.
fn white_space_like_len(text: &[u8], pos: usize) -> usize {
    let at = |offset: usize| text.get(pos + offset).copied().unwrap_or(0);
    match (at(0), at(1), at(2)) {
        // U+0085, U+00A0
        (0xC2, 0x85 | 0xA0, _) => 2,
        // U+1680
        (0xE1, 0x9A, 0x80) => 3,
        // U+2000 to U+200B, U+2028, U+2029, U+202F
        (0xE2, 0x80, 0x80..=0x8B | 0xA8 | 0xA9 | 0xAF) => 3,
        // U+205F
        (0xE2, 0x81, 0x9F) => 3,
        // U+3000
        (0xE3, 0x80, 0x80) => 3,
        // U+FEFF
        (0xEF, 0xBB, 0xBF) => 3,
        _ => 0,
    }
}

/// scanner.GetLeadingCommentRanges at position 0, over the comments that the lexer read: those of `comments` that only white space, other comments and a `#!` line stand before.
fn get_leading_comment_ranges<'c>(text: &[u8], comments: &'c [Range]) -> &'c [Range] {
    let mut pos = 0;
    if is_shebang_trivia(text) {
        pos = scan_shebang_trivia(text, pos);
    }
    let mut count = 0;
    while let Some(&ch) = text.get(pos) {
        match ch {
            b'\r' | b'\n' | b'\t' | 0x0B | 0x0C | b' ' => pos += 1,
            b'/' => {
                let Some((start, end)) = comments
                    .get(count)
                    .and_then(|comment| bounds(text, *comment))
                else {
                    break;
                };
                if start != pos || end <= pos {
                    break;
                }
                pos = end;
                count += 1;
            }
            _ => {
                let size = white_space_like_len(text, pos);
                if size == 0 {
                    break;
                }
                pos += size;
            }
        }
    }
    comments.get(..count).unwrap_or(comments)
}

/// parser.go getCommentPragmas: `comments` holds every comment before the first token of `source_text`, in the order of the source, and may hold those after it.
fn get_comment_pragmas(source_text: &[u8], comments: &[Range]) -> Vec<Pragma> {
    let mut pragmas = Vec::new();
    for comment_range in get_leading_comment_ranges(source_text, comments) {
        let Some((pos, end)) = bounds(source_text, *comment_range) else {
            continue;
        };
        let comment = source_text.get(pos..end).unwrap_or(b"");
        extract_pragmas(pos, comment, &mut pragmas);
    }
    pragmas
}

/// parser.go extractPragmas: `text` is the comment, which starts at `comment_pos` of the source.
fn extract_pragmas(comment_pos: usize, text: &[u8], pragmas: &mut Vec<Pragma>) {
    let comment_start = offset_of(comment_pos);
    let comment_end = offset_of(comment_pos + text.len());
    if text.starts_with(b"//") {
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
            let mut args = PragmaArguments::default();
            loop {
                pos = skip_blanks(text, pos);
                if match_(text, pos, b"/>") {
                    break;
                }
                let arg_name = extract_name(text, pos);
                if arg_name.is_empty() {
                    break;
                }
                pos = skip_blanks(text, pos + arg_name.len());
                if !match_(text, pos, b"=") {
                    break;
                }
                pos = skip_blanks(text, pos + 1);
                let Some(value) = extract_quoted_string(text, pos) else {
                    break;
                };
                args.set(
                    arg_name,
                    PragmaArgument {
                        start: offset_of(comment_pos + pos + 1),
                        end: offset_of(comment_pos + pos + 1 + value.len()),
                    },
                );
                pos += value.len() + 2;
            }
            pragmas.push(Pragma {
                comment_start,
                comment_end,
                name: PragmaName::Reference,
                args,
            });
            return;
        }
        if match_(text, pos, b"@") {
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
                comment_start,
                comment_end,
                name,
                args: PragmaArguments::default(),
            });
        }
    }
    // A block comment holds @jsx, @jsxfrag, @jsximportsource and @jsxruntime alone, and those the lexer reads: `Lexer::jsx_pragma`.
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

/// parser.go extractName: the name as it is written. The reference lowers it, so a reader compares it without case.
fn extract_name(text: &[u8], mut pos: usize) -> &[u8] {
    let start = pos;
    while text
        .get(pos)
        .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'-')
    {
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

/// parser.go processPragmasIntoFields: `report` gets each diagnostic and the offsets that it marks.
fn process_pragmas_into_fields(
    source_text: &[u8],
    pragmas: &[Pragma],
    context: &mut Pragmas,
    report: &mut dyn FnMut(Message, u32, u32),
) {
    context.check_js_directive = None;
    context.reference_directives.clear();
    for pragma in pragmas {
        match pragma.name {
            PragmaName::Reference => {
                let types = pragma.args.types;
                let lib = pragma.args.lib;
                let path = pragma.args.path;
                let resolution_mode = pragma.args.resolution_mode;
                let preserve = pragma.args.preserve;
                let no_default_lib = pragma.args.no_default_lib;
                let mut file_reference =
                    |kind: ReferenceDirectiveKind,
                     argument: PragmaArgument,
                     parsed: ResolutionMode| {
                        context.reference_directives.push(ReferenceDirective {
                            start: argument.start,
                            end: argument.end,
                            comment_start: pragma.comment_start,
                            comment_end: pragma.comment_end,
                            kind,
                            resolution_mode: parsed,
                            preserve: preserve
                                .is_some_and(|preserve| preserve.value(source_text) == b"true"),
                        });
                    };
                if let Some(no_default_lib) =
                    no_default_lib.filter(|argument| argument.value(source_text) == b"true")
                {
                    // Ignored.
                    file_reference(
                        ReferenceDirectiveKind::NoDefaultLib,
                        no_default_lib,
                        ResolutionMode::None,
                    );
                } else if let Some(types) = types {
                    let mut parsed = ResolutionMode::None;
                    if let Some(resolution_mode) = resolution_mode {
                        parsed = parse_resolution_mode(
                            resolution_mode.value(source_text),
                            resolution_mode.start,
                            resolution_mode.end,
                            report,
                        );
                    }
                    file_reference(ReferenceDirectiveKind::Types, types, parsed);
                } else if let Some(lib) = lib {
                    file_reference(ReferenceDirectiveKind::Lib, lib, ResolutionMode::None);
                } else if let Some(path) = path {
                    file_reference(ReferenceDirectiveKind::Path, path, ResolutionMode::None);
                } else {
                    report(
                        INVALID_REFERENCE_DIRECTIVE_SYNTAX,
                        pragma.comment_start,
                        pragma.comment_end,
                    );
                }
            }
            PragmaName::TsCheck | PragmaName::TsNocheck => {
                // _last_ of either nocheck or check in a file is the "winner"
                if context
                    .check_js_directive
                    .is_none_or(|directive| pragma.comment_start > directive.start)
                {
                    context.check_js_directive = Some(CheckJsDirective {
                        start: pragma.comment_start,
                        end: pragma.comment_end,
                        enabled: pragma.name == PragmaName::TsCheck,
                    });
                }
            }
        }
    }
}

/// parser.go parseResolutionMode.
fn parse_resolution_mode(
    mode: &[u8],
    pos: u32,
    end: u32,
    report: &mut dyn FnMut(Message, u32, u32),
) -> ResolutionMode {
    if mode == b"import" {
        return ResolutionMode::ESM;
    }
    if mode == b"require" {
        return ResolutionMode::CommonJS;
    }
    report(
        X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT,
        pos,
        end,
    );
    ResolutionMode::None
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// finishSourceFile, for the pragmas: the lexer is on the first token, so it has read every comment that can hold one.
    #[cold]
    pub(crate) fn read_pragmas_for_lint(&mut self) {
        let source_text = self.lexer.contents;
        let pragmas = get_comment_pragmas(source_text, &self.lexer.all_comments);
        let mut context = Pragmas::default();
        process_pragmas_into_fields(
            source_text,
            &pragmas,
            &mut context,
            &mut |message, start, end| {
                self.syntax_error_as(ts::range(start, end), message, b"");
            },
        );
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.pragmas = context;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ReferenceDirectiveKind::{Lib, NoDefaultLib, Path, Types};
    use super::ResolutionMode::{CommonJS, ESM, None as NoMode};
    use super::*;
    use crate::defines::Define;
    use crate::parse::comment_directives::CommentDirectiveKind;
    use crate::parse::parse_entry::{Options, ParsedForLint, Parser};
    use crate::parse::syntax_errors::SyntaxErrors;
    use bun_alloc::Arena;
    use bun_ast::{Loader, Loc, Log, Source};

    /// A reference directive as kind, start and end of the value, resolution mode, preserve, start and end of the comment.
    type Reference = (
        ReferenceDirectiveKind,
        u32,
        u32,
        ResolutionMode,
        bool,
        u32,
        u32,
    );
    /// The `@ts-check` or `@ts-nocheck` that wins, as enabled, start and end.
    type Check = Option<(bool, u32, u32)>;
    /// A diagnostic as message, start and end.
    type Diagnostic = (Message, u32, u32);

    const TS1084: Message = INVALID_REFERENCE_DIRECTIVE_SYNTAX;
    const TS1453: Message = X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT;

    /// What the header of `text` says, whose comments `comments` names by start and end.
    fn header(text: &[u8], comments: &[(i32, i32)]) -> (Vec<Reference>, Check, Vec<Diagnostic>) {
        let comments: Vec<Range> = comments
            .iter()
            .map(|&(start, end)| Range {
                loc: Loc { start },
                len: end - start,
            })
            .collect();
        let pragmas = get_comment_pragmas(text, &comments);
        let mut context = Pragmas::default();
        let mut diagnostics = Vec::new();
        process_pragmas_into_fields(text, &pragmas, &mut context, &mut |message, start, end| {
            diagnostics.push((message, start, end));
        });
        let references = context
            .reference_directives
            .iter()
            .map(|reference| {
                (
                    reference.kind,
                    reference.start,
                    reference.end,
                    reference.resolution_mode,
                    reference.preserve,
                    reference.comment_start,
                    reference.comment_end,
                )
            })
            .collect();
        let check = context
            .check_js_directive
            .map(|directive| (directive.enabled, directive.start, directive.end));
        (references, check, diagnostics)
    }

    #[test]
    fn a_triple_slash_reference_names_a_path_types_or_a_lib() {
        let cases: [(&[u8], &[(i32, i32)], &[Reference]); 16] = [
            (
                b"/// <reference path=\"a.ts\" />\nx;",
                &[(0, 29)],
                &[(Path, 21, 25, NoMode, false, 0, 29)],
            ),
            (
                b"/// <reference types=\"node\" />\nx;",
                &[(0, 30)],
                &[(Types, 22, 26, NoMode, false, 0, 30)],
            ),
            (
                b"/// <reference lib=\"es2015\" />\nx;",
                &[(0, 30)],
                &[(Lib, 20, 26, NoMode, false, 0, 30)],
            ),
            (
                b"/// <reference lib='dom' />\nx;",
                &[(0, 27)],
                &[(Lib, 20, 23, NoMode, false, 0, 27)],
            ),
            (
                b"/// <reference types=\"a\" resolution-mode=\"import\" />\nx;",
                &[(0, 52)],
                &[(Types, 22, 23, ESM, false, 0, 52)],
            ),
            (
                b"/// <reference types=\"a\" resolution-mode=\"require\" />\nx;",
                &[(0, 53)],
                &[(Types, 22, 23, CommonJS, false, 0, 53)],
            ),
            (
                b"/// <reference path=\"a.ts\" preserve=\"true\" />\nx;",
                &[(0, 45)],
                &[(Path, 21, 25, NoMode, true, 0, 45)],
            ),
            (
                b"/// <reference lib=\"dom\" preserve=\"false\" />\nx;",
                &[(0, 44)],
                &[(Lib, 20, 23, NoMode, false, 0, 44)],
            ),
            (
                b"/// <reference no-default-lib=\"true\" />\nx;",
                &[(0, 39)],
                &[(NoDefaultLib, 31, 35, NoMode, false, 0, 39)],
            ),
            (
                b"/// <reference no-default-lib=\"true\" types=\"a\" />\nx;",
                &[(0, 49)],
                &[(NoDefaultLib, 31, 35, NoMode, false, 0, 49)],
            ),
            (
                b"/// <reference path=\"p\" lib=\"l\" types=\"t\" />\nx;",
                &[(0, 44)],
                &[(Types, 39, 40, NoMode, false, 0, 44)],
            ),
            (
                b"/// <REFERENCE PATH=\"a.ts\" />\nx;",
                &[(0, 29)],
                &[(Path, 21, 25, NoMode, false, 0, 29)],
            ),
            (
                b"///<reference path = \"a.ts\"/>\nx;",
                &[(0, 29)],
                &[(Path, 22, 26, NoMode, false, 0, 29)],
            ),
            (
                b"/// <reference path=\"\" />\nx;",
                &[(0, 25)],
                &[(Path, 21, 21, NoMode, false, 0, 25)],
            ),
            (
                b"/// <reference path=\"\xC3\xA9\xE4\xB8\xAD.ts\" />\nx;",
                &[(0, 33)],
                &[(Path, 21, 29, NoMode, false, 0, 33)],
            ),
            (
                b"/// <reference path=\"a\" resolution-mode=\"bad\" />\nx;",
                &[(0, 48)],
                &[(Path, 21, 22, NoMode, false, 0, 48)],
            ),
        ];
        for (text, comments, expected) in cases {
            let (references, check, diagnostics) = header(text, comments);
            assert_eq!(references, expected, "{}", bstr::BStr::new(text));
            assert_eq!(check, None, "{}", bstr::BStr::new(text));
            assert_eq!(diagnostics, &[], "{}", bstr::BStr::new(text));
        }
        let text: &[u8] = b"/// <reference path=\"a.ts\" />\nx;";
        let pragmas = get_comment_pragmas(
            text,
            &[Range {
                loc: Loc { start: 0 },
                len: 29,
            }],
        );
        let mut context = Pragmas::default();
        process_pragmas_into_fields(text, &pragmas, &mut context, &mut |_, _, _| {});
        let names: Vec<&[u8]> = context
            .reference_directives
            .iter()
            .map(|reference| reference.file_name(text))
            .collect();
        assert_eq!(names, [&b"a.ts"[..]]);
    }

    #[test]
    fn a_reference_without_a_file_is_an_error() {
        let cases: [(&[u8], &[(i32, i32)], &[Reference], &[Diagnostic]); 7] = [
            (
                b"/// <reference />\nx;",
                &[(0, 17)],
                &[],
                &[(TS1084, 0, 17)],
            ),
            (
                b"/// <reference no-default-lib=\"false\" />\nx;",
                &[(0, 40)],
                &[],
                &[(TS1084, 0, 40)],
            ),
            (
                b"/// <reference foo=\"bar\" />\nx;",
                &[(0, 27)],
                &[],
                &[(TS1084, 0, 27)],
            ),
            (
                b"/// <reference path=a.ts />\nx;",
                &[(0, 27)],
                &[],
                &[(TS1084, 0, 27)],
            ),
            (
                b"/// <reference path=\"a.ts />\nx;",
                &[(0, 28)],
                &[],
                &[(TS1084, 0, 28)],
            ),
            (
                b"/// <reference path='a.ts\" />\nx;",
                &[(0, 29)],
                &[],
                &[(TS1084, 0, 29)],
            ),
            (
                b"/// <reference />\n/// <reference foo=\"1\" />\nx;",
                &[(0, 17), (18, 43)],
                &[],
                &[(TS1084, 0, 17), (TS1084, 18, 43)],
            ),
        ];
        for (text, comments, expected, expected_diagnostics) in cases {
            let (references, check, diagnostics) = header(text, comments);
            assert_eq!(references, expected, "{}", bstr::BStr::new(text));
            assert_eq!(check, None, "{}", bstr::BStr::new(text));
            assert_eq!(
                diagnostics,
                expected_diagnostics,
                "{}",
                bstr::BStr::new(text)
            );
        }
    }

    #[test]
    fn the_last_of_ts_check_and_ts_nocheck_wins() {
        let cases: [(&[u8], &[(i32, i32)], Check); 13] = [
            (
                b"// @ts-nocheck\n// @ts-check\nx;",
                &[(0, 14), (15, 27)],
                Some((true, 15, 27)),
            ),
            (
                b"// @ts-check\n// @ts-nocheck\nx;",
                &[(0, 12), (13, 27)],
                Some((false, 13, 27)),
            ),
            (b"// @ts-nocheck\nx;", &[(0, 14)], Some((false, 0, 14))),
            (b"//@ts-check\nx;", &[(0, 11)], Some((true, 0, 11))),
            (b"//\t@ts-check\nx;", &[(0, 12)], Some((true, 0, 12))),
            (b"/// @ts-nocheck\nx;", &[(0, 15)], Some((false, 0, 15))),
            (
                b"// @ts-nocheck: because\nx;",
                &[(0, 23)],
                Some((false, 0, 23)),
            ),
            (b"// @TS-NOCHECK\nx;", &[(0, 14)], Some((false, 0, 14))),
            (
                b"/* a */ // @ts-nocheck\nx;",
                &[(0, 7), (8, 22)],
                Some((false, 8, 22)),
            ),
            (b"// @ts-nocheckx\nx;", &[(0, 15)], None),
            (b"// use @ts-check\nx;", &[(0, 16)], None),
            (b"/* @ts-nocheck */\nx;", &[(0, 17)], None),
            (b"//// @ts-nocheck\nx;", &[(0, 16)], None),
        ];
        for (text, comments, expected) in cases {
            let (references, check, diagnostics) = header(text, comments);
            assert_eq!(check, expected, "{}", bstr::BStr::new(text));
            assert_eq!(references, &[], "{}", bstr::BStr::new(text));
            assert_eq!(diagnostics, &[], "{}", bstr::BStr::new(text));
        }
    }

    #[test]
    fn only_the_comments_before_the_first_token_hold_pragmas() {
        let cases: [(&[u8], &[(i32, i32)], &[Reference], Check); 12] = [
            (
                b"x;\n/// <reference path=\"a.ts\" />\n// @ts-nocheck\n",
                &[(3, 32), (33, 47)],
                &[],
                None,
            ),
            (
                b"#!/usr/bin/env bun\n/// <reference types=\"bun\" />\n// @ts-check\nx;",
                &[(19, 48), (49, 61)],
                &[(Types, 41, 44, NoMode, false, 19, 48)],
                Some((true, 49, 61)),
            ),
            (
                b"#!/usr/bin/env bun\r\n/// <reference lib=\"dom\" />\r\nx;",
                &[(20, 47)],
                &[(Lib, 40, 43, NoMode, false, 20, 47)],
                None,
            ),
            (b"#!/usr/bin/env bun // @ts-nocheck\nx;", &[], &[], None),
            (
                b"\n#!/usr/bin/env bun\n// @ts-nocheck\nx;",
                &[(20, 34)],
                &[],
                None,
            ),
            (
                b"/// <reference path=\"a.ts\" />\r\n// @ts-nocheck\r\nx;\r\n",
                &[(0, 29), (31, 45)],
                &[(Path, 21, 25, NoMode, false, 0, 29)],
                Some((false, 31, 45)),
            ),
            (
                b"\n\n// a\n/* b */\n/// <reference path=\"a.ts\" />\nx;",
                &[(2, 6), (7, 14), (15, 44)],
                &[(Path, 36, 40, NoMode, false, 15, 44)],
                None,
            ),
            (
                b"/* c */ /// <reference path=\"a.ts\" />\nx;",
                &[(0, 7), (8, 37)],
                &[(Path, 29, 33, NoMode, false, 8, 37)],
                None,
            ),
            (
                b"/// <reference path=\"a.ts\" />\xE2\x80\xA8// @ts-nocheck\nx;",
                &[(0, 29), (32, 46)],
                &[(Path, 21, 25, NoMode, false, 0, 29)],
                Some((false, 32, 46)),
            ),
            (
                b"\xEF\xBB\xBF/// <reference path=\"a.ts\" />\nx;",
                &[(3, 32)],
                &[(Path, 24, 28, NoMode, false, 3, 32)],
                None,
            ),
            (
                b"/// <reference path=\"a.ts\" />",
                &[(0, 29)],
                &[(Path, 21, 25, NoMode, false, 0, 29)],
                None,
            ),
            (b"-->\n// @ts-check\nx;", &[(4, 16)], &[], None),
        ];
        for (text, comments, expected, expected_check) in cases {
            let (references, check, diagnostics) = header(text, comments);
            assert_eq!(references, expected, "{}", bstr::BStr::new(text));
            assert_eq!(check, expected_check, "{}", bstr::BStr::new(text));
            assert_eq!(diagnostics, &[], "{}", bstr::BStr::new(text));
        }
    }

    #[test]
    fn a_comment_that_is_no_pragma_says_nothing() {
        let cases: [(&[u8], &[(i32, i32)]); 9] = [
            (b"// <reference path=\"a.ts\" />\nx;", &[(0, 28)]),
            (b"//// <reference path=\"a.ts\" />\nx;", &[(0, 30)]),
            (b"/* <reference path=\"a.ts\" /> */\nx;", &[(0, 31)]),
            (b"/// <referencepath=\"a.ts\" />\nx;", &[(0, 28)]),
            (b"/// <amd-module name=\"m\" />\nx;", &[(0, 27)]),
            (
                b"/** @jsx h */\n/* @jsxFrag Fragment */\nx;",
                &[(0, 13), (14, 37)],
            ),
            (b"// @jsx h\nx;", &[(0, 9)]),
            (b"// @ts-ignore\nx;", &[(0, 13)]),
            (b"", &[]),
        ];
        for (text, comments) in cases {
            let (references, check, diagnostics) = header(text, comments);
            assert_eq!(references, &[], "{}", bstr::BStr::new(text));
            assert_eq!(check, None, "{}", bstr::BStr::new(text));
            assert_eq!(diagnostics, &[], "{}", bstr::BStr::new(text));
        }
    }

    #[test]
    fn a_reference_is_read_as_typescript_go_reads_it_where_tsc_differs() {
        // tsc wants the closing "/>" and takes the first argument of a name; it marks the value of `types` for a wrong mode.
        let cases: [(&[u8], &[(i32, i32)], &[Reference], &[Diagnostic]); 10] = [
            (
                b"/// <reference path=\"a.ts\"\nx;",
                &[(0, 26)],
                &[(Path, 21, 25, NoMode, false, 0, 26)],
                &[],
            ),
            (b"/// <reference\nx;", &[(0, 14)], &[], &[(TS1084, 0, 14)]),
            (b"/// <reference/>\nx;", &[(0, 16)], &[], &[(TS1084, 0, 16)]),
            (
                b"/// <reference path=\"a.ts\" path=\"b.ts\" />\nx;",
                &[(0, 41)],
                &[(Path, 33, 37, NoMode, false, 0, 41)],
                &[],
            ),
            (
                b"/// <reference garbage path=\"a.ts\" />\nx;",
                &[(0, 37)],
                &[],
                &[(TS1084, 0, 37)],
            ),
            (
                b"///\xC2\xA0<reference path=\"a.ts\" />\nx;",
                &[(0, 30)],
                &[],
                &[],
            ),
            (
                b"/// <reference PRESERVE=\"true\" Path=\"a\" />\nx;",
                &[(0, 42)],
                &[(Path, 37, 38, NoMode, true, 0, 42)],
                &[],
            ),
            (
                b"/// <reference types=\"a\" resolution-mode=\"node\" />\nx;",
                &[(0, 50)],
                &[(Types, 22, 23, NoMode, false, 0, 50)],
                &[(TS1453, 42, 46)],
            ),
            (
                b"/// <reference types=\"a\" resolution-mode=\"IMPORT\" />\nx;",
                &[(0, 52)],
                &[(Types, 22, 23, NoMode, false, 0, 52)],
                &[(TS1453, 42, 48)],
            ),
            (
                b"/// <reference types=\"\" resolution-mode=\"x\" />\nx;",
                &[(0, 46)],
                &[(Types, 22, 22, NoMode, false, 0, 46)],
                &[(TS1453, 41, 42)],
            ),
        ];
        for (text, comments, expected, expected_diagnostics) in cases {
            let (references, check, diagnostics) = header(text, comments);
            assert_eq!(references, expected, "{}", bstr::BStr::new(text));
            assert_eq!(check, None, "{}", bstr::BStr::new(text));
            assert_eq!(
                diagnostics,
                expected_diagnostics,
                "{}",
                bstr::BStr::new(text)
            );
        }
    }

    #[test]
    fn a_list_that_is_not_the_comments_of_the_text_ends_the_header() {
        let text: &[u8] = b"// a\n// @ts-nocheck\nx;";
        // The first comment is missing, is short, is long, starts early, or is no comment at all.
        let cases: [&[(i32, i32)]; 7] = [
            &[(5, 19)],
            &[(0, 2), (5, 19)],
            &[(0, 30), (5, 19)],
            &[(-1, 4), (5, 19)],
            &[(0, 0), (5, 19)],
            &[(9, 4), (5, 19)],
            &[(40, 50)],
        ];
        for comments in cases {
            let (references, check, diagnostics) = header(text, comments);
            assert_eq!(references, &[], "{:?}", comments);
            assert_eq!(check, None, "{:?}", comments);
            assert_eq!(diagnostics, &[], "{:?}", comments);
        }
        let (_, check, _) = header(text, &[(0, 4), (5, 19), (40, 50)]);
        assert_eq!(check, Some((false, 5, 19)));
        let (references, _, diagnostics) = header(b"///<", &[(0, 4)]);
        assert_eq!((references, diagnostics), (vec![], vec![]));
        let (references, _, diagnostics) = header(b"/// <reference", &[(0, 14)]);
        assert_eq!((references, diagnostics), (vec![], vec![(TS1084, 0, 14)]));
        let (references, _, diagnostics) = header(b"/// <reference path=\"", &[(0, 21)]);
        assert_eq!((references, diagnostics), (vec![], vec![(TS1084, 0, 21)]));
    }

    /// A message of the log as the number of its diagnostic, its offset, its length, its text, and the start and end that the table of the parse has for it.
    type Logged = (Option<u32>, usize, usize, Vec<u8>, Option<(u32, u32)>);

    /// What `read` makes of the lint parse of `text`, `None` where the parse fails, and the messages that it left. The lexer keeps its comments as it does for a build that minifies names.
    fn lint_parse<R>(
        text: &'static [u8],
        read: impl FnOnce(&ParsedForLint<'_, '_>) -> R,
    ) -> (Option<R>, Vec<Logged>) {
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = Source::init_path_string(&b"/a.ts"[..], text);
        let mut options = Options::init(Default::default(), Loader::Ts);
        options.features.no_macros = true;
        options.features.dont_bundle_twice = true;
        options.features.minify_identifiers = true;
        let define = Define::default();
        let mut log = Log::init();
        let mut errors = SyntaxErrors::default();
        let parsed = match Parser::init(options, &mut log, &source, &define, &arena) {
            Ok(parser) => parser.parse_for_lint_with_codes(&mut errors, read).ok(),
            Err(_) => None,
        };
        let logged = log
            .msgs
            .iter()
            .enumerate()
            .map(|(index, msg)| {
                let (offset, length) = msg
                    .data
                    .location
                    .as_ref()
                    .map_or((0, 0), |location| (location.offset, location.length));
                let marked = errors.get(index).map(|entry| (entry.start, entry.end));
                (msg.code(), offset, length, msg.data.text.to_vec(), marked)
            })
            .collect();
        (parsed, logged)
    }

    #[test]
    fn a_lint_parse_keeps_what_the_header_says() {
        let text: &[u8] = b"#!/usr/bin/env bun\n/// <reference types=\"bun\" />\n// @ts-nocheck\n// @ts-check\nlet x = 1;\n/// <reference path=\"late.ts\" />\n// @ts-nocheck\n";
        let (read, logged) = lint_parse(text, |parsed| {
            let pragmas = &parsed.sidecar.pragmas;
            let references: Vec<(ReferenceDirectiveKind, &[u8], u32, u32)> = pragmas
                .reference_directives
                .iter()
                .map(|reference| {
                    (
                        reference.kind,
                        reference.file_name(text),
                        reference.comment_start,
                        reference.comment_end,
                    )
                })
                .collect();
            assert_eq!(references, [(Types, &b"bun"[..], 19, 48)]);
            let check = pragmas.check_js_directive;
            assert_eq!(
                check.map(|check| (check.enabled, check.start, check.end)),
                Some((true, 64, 76))
            );
        });
        assert_eq!((read, logged), (Some(()), vec![]));
    }

    #[test]
    fn a_lint_parse_keeps_the_directives_of_its_comments_once() {
        let text: &[u8] = b"// @ts-ignore\nlet x: number = 'a';\nlet r = a < /* @ts-ignore */ b > /* @ts-expect-error */ c;\nlet s = c ? (a) /* @ts-ignore */ : b => d /* @ts-expect-error */ : e;\nlet t = '// @ts-ignore';\n/*\n * @ts-expect-error */\n";
        let (read, logged) = lint_parse(text, |parsed| {
            parsed
                .sidecar
                .comment_directives
                .iter()
                .map(|directive| (directive.kind, directive.start, directive.end))
                .collect::<Vec<_>>()
        });
        let expected = [
            (CommentDirectiveKind::Ignore, 0, 13),
            (CommentDirectiveKind::Ignore, 47, 63),
            (CommentDirectiveKind::ExpectError, 68, 90),
            (CommentDirectiveKind::Ignore, 110, 126),
            (CommentDirectiveKind::ExpectError, 136, 158),
            (CommentDirectiveKind::ExpectError, 192, 214),
        ];
        assert_eq!((read, logged), (Some(expected.to_vec()), vec![]));
    }

    #[test]
    fn a_pragma_that_the_reference_reports_is_an_error_with_its_code_and_the_parse_goes_on() {
        let invalid = "Invalid 'reference' directive syntax.";
        let mode = "`resolution-mode` should be either `require` or `import`.";
        let cases: [(&'static [u8], &[&[u8]], &[(u32, usize, usize, &str)]); 3] = [
            (
                b"/// <reference />\nlet x = 1;",
                &[],
                &[(1084, 0, 17, invalid)],
            ),
            (
                b"/// <reference types=\"a\" resolution-mode=\"node\" />\n/// <reference foo=\"1\" />\nx;",
                &[b"a"],
                &[(1453, 42, 4, mode), (1084, 51, 25, invalid)],
            ),
            (
                b"#!/bin/sh\n\n/// <reference no-default-lib=\"false\"/>\n/// <reference lib=\"dom\"/>\n",
                &[b"dom"],
                &[(1084, 11, 39, invalid)],
            ),
        ];
        for (text, expected_names, expected) in cases {
            let expected: Vec<Logged> = expected
                .iter()
                .map(|&(code, offset, length, said)| {
                    let marked = (offset as u32, (offset + length) as u32);
                    (
                        Some(code),
                        offset,
                        length,
                        said.as_bytes().to_vec(),
                        Some(marked),
                    )
                })
                .collect();
            let (names, logged) = lint_parse(text, |parsed| {
                parsed
                    .sidecar
                    .pragmas
                    .reference_directives
                    .iter()
                    .map(|reference| reference.file_name(text).to_vec())
                    .collect::<Vec<_>>()
            });
            let expected_names: Vec<Vec<u8>> =
                expected_names.iter().map(|name| name.to_vec()).collect();
            assert_eq!(names, Some(expected_names), "{}", bstr::BStr::new(text));
            assert_eq!(logged, expected, "{}", bstr::BStr::new(text));
        }
    }

    #[test]
    fn a_syntax_error_after_a_pragma_error_fails_the_parse() {
        let (read, logged) = lint_parse(b"/// <reference />\nlet x = ;", |_| ());
        assert_eq!(read, None);
        let places: Vec<(usize, usize, Option<(u32, u32)>)> = logged
            .iter()
            .map(|&(_, offset, length, _, marked)| (offset, length, marked))
            .collect();
        assert_eq!(places, [(0, 17, Some((0, 17))), (26, 1, Some((26, 27)))]);
        assert_eq!(logged.first().and_then(|first| first.0), Some(1084));
    }
}
