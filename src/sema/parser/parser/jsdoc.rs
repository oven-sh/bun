//! JSDoc comments: finds the comments that belong to a node (`GetJSDocCommentRanges`, `withJSDoc`), and implements the
//! calls jsdoc.go makes into the file's parser and scanner while it reads a comment ([`Syntax`]).
//!
//! `bun_sema::check::jsdoc` reads the comments. A type in a comment is parsed once while the tags are read, to find
//! where it ends and what's wrong with it, and those nodes are dropped. Where reparser.go clones it (`reparse`), it's
//! parsed a second time, into the file.
//!
//! All of this only runs with `Options::reads_jsdoc`. Without it, a node that can have comments costs one flag test.

use super::reparse::Host;
use super::stmt::{ModifiersOf, Start};
use super::{Checkpoint, ListKind, Parser, ctx, take_span};
use crate::lexer::Mark;
use crate::token::T;
use crate::{Options, Rejection};
use bun_core::strings;
use bun_sema::atom::{Atom, known};
use bun_sema::check::jsdoc::syntax::{
    self, JsDoc, Syntax, TagKind, TypeArguments, TypeExpr, TypeShape,
};
use bun_sema::check::jsdoc::{JSDocScannerState, JSDocToken};
use bun_sema::hir::*;
use bun_sema::util::SharedSort;
use smallvec::SmallVec;

/// What's known about a JSDoc comment before it's read.
mod flags {
    /// `isJSDocLikeText`
    pub(super) const JSDOC_LIKE: u8 = 1 << 0;
    /// `TokenFlagsPrecedingJSDocWithSeeOrLink`
    pub(super) const SEE_OR_LINK: u8 = 1 << 1;
    /// A comment without this flag has no `@augments` or `@extends` tag.
    pub(super) const AUGMENTS: u8 = 1 << 2;
    /// A comment without this flag has no `@param`, `@arg` or `@argument` tag.
    pub(super) const PARAM: u8 = 1 << 3;
}

/// `GetJSDocCommentRanges`: the JSDoc comments before a token.
pub(super) struct Attached<'a> {
    /// The comments that were read, with or without tags, in order.
    pub(super) docs: SmallVec<[JsDoc<'a>; 2]>,
    /// True if the last of `docs` has tags and is also the last of all the JSDoc comments.
    pub(super) last_has_tags: bool,
    /// From the start of the first JSDoc comment to the end of the last, whether they were read or not. `None` if there
    /// are none.
    pub(super) range: Option<TextRange>,
    /// `jsdocScannerInfoHasSeeOrLink`
    pub(super) has_see_or_link: bool,
}

/// How much of a reparsed node the checker visits, which determines which errors about it are reported.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Reach {
    /// `checkSourceElement` visits it.
    Checked,
    /// Only `getTypeFromTypeNode` is called for it.
    Resolved,
    /// `checkImportDeclaration` returns before it looks at it.
    Unvisited,
}

/// The parser's state for a file's JSDoc comments (`Parser::jsdoc`).
#[derive(Default)]
pub(crate) struct State {
    /// `flags`: a comment that has one of these is read. If 0, no comment is read and `Parser::reads_jsdoc` is false.
    pub(super) wanted: u8,
    /// True while the lexer is inside a comment, where nodes don't have comments.
    pub(super) is_in_comment: bool,
    /// `reparseList` for all open statement lists. Each list owns the entries past the length it saw when it began.
    pub(crate) reparsed: Vec<StmtId>,
    /// The starts of the comments whose errors were added to the file, in the order they were read.
    pub(super) attached: Vec<u32>,
    /// The type of a `@type` tag, keyed by the property's index in `Stacks::props`.
    pub(super) property_types: Vec<(u32, TypeNodeId)>,
    /// The functions that have a `FullSignature`.
    pub(super) full_signatures: bun_sema::util::FxHashSet<u32>,
    /// The functions whose `@param` tags were compared with their parameters.
    pub(super) documented_functions: bun_sema::util::FxHashSet<u32>,
}

impl State {
    /// `typescript_flags` is the result of `read_by_checker` for a file that's being parsed a second time.
    pub(crate) fn new(options: &Options, has_interner: bool, typescript_flags: u8) -> State {
        let is_script = options.is_javascript && !options.is_json;
        let is_other_dialect = is_script && (options.dialect.ecmascript || options.dialect.flow);
        let reads = options.reads_jsdoc && has_interner && !options.is_json && !is_other_dialect;
        let wanted = match reads {
            false => 0,
            true if is_script => flags::JSDOC_LIKE,
            true => typescript_flags,
        };
        State {
            wanted,
            ..State::default()
        }
    }
}

/// The lengths of the lists that a speculative parse rolls back and that `FileLens` doesn't cover.
#[derive(Copy, Clone, Default)]
pub(crate) struct Lens {
    reparsed: u32,
    attached: u32,
    property_types: u32,
    full_signatures: u32,
    documented_functions: u32,
    hosts: u32,
    types: u32,
    modifiers: u32,
    member_comments: u32,
    param_errors: u32,
    functions_with_param_tags: u32,
    unmatched_augments_tags: u32,
}

impl Lens {
    #[cold]
    #[inline(never)]
    fn of(state: &State, file: &FileBuilder) -> Lens {
        Lens {
            reparsed: state.reparsed.len() as u32,
            attached: state.attached.len() as u32,
            property_types: state.property_types.len() as u32,
            full_signatures: state.full_signatures.len() as u32,
            documented_functions: state.documented_functions.len() as u32,
            hosts: file.jsdoc_hosts.len() as u32,
            types: file.jsdoc_types.len() as u32,
            modifiers: file.jsdoc_modifiers.len() as u32,
            member_comments: file.jsdoc_member_comments.len() as u32,
            param_errors: file.jsdoc_param_errors.len() as u32,
            functions_with_param_tags: file.functions_with_param_tags.len() as u32,
            unmatched_augments_tags: file.unmatched_augments_tags.len() as u32,
        }
    }

    /// `fns` is how many functions the file had at the checkpoint.
    #[cold]
    #[inline(never)]
    fn restore(&self, state: &mut State, file: &mut FileBuilder, fns: u32) {
        let lens = self;
        state.reparsed.truncate(lens.reparsed as usize);
        state.attached.truncate(lens.attached as usize);
        state.property_types.truncate(lens.property_types as usize);
        // Anything inserted since the checkpoint is a function that was added since then.
        if state.full_signatures.len() > lens.full_signatures as usize {
            state.full_signatures.retain(|&func| func < fns);
        }
        if state.documented_functions.len() > lens.documented_functions as usize {
            state.documented_functions.retain(|&func| func < fns);
        }
        file.jsdoc_hosts.truncate(lens.hosts as usize);
        file.jsdoc_types.truncate(lens.types as usize);
        file.jsdoc_modifiers.truncate(lens.modifiers as usize);
        file.jsdoc_member_comments
            .truncate(lens.member_comments as usize);
        file.jsdoc_param_errors.truncate(lens.param_errors as usize);
        file.functions_with_param_tags
            .truncate(lens.functions_with_param_tags as usize);
        file.unmatched_augments_tags
            .truncate(lens.unmatched_augments_tags as usize);
    }
}

/// Returns `TokenFullStart` of the token at `token` if comments precede it, otherwise `token`.
fn full_start_before(comments: &[Comment], token: u32) -> u32 {
    let before = comments.partition_point(|comment| comment.pos < token);
    match before.checked_sub(1).and_then(|last| comments.get(last)) {
        Some(comment) if comment.next_token_start == token => comment.prev_token_end,
        _ => token,
    }
}

/// `finish_jsdoc`, for the file with the text `src` and the comments `comments`.
fn finish_jsdoc_lists(file: &mut FileBuilder, src: &[u8], comments: &[Comment]) {
    for &Comment {
        pos: start, end, ..
    } in comments
    {
        let comment = src.get(start as usize..end as usize).unwrap_or_default();
        if is_jsdoc_like(comment) && can_have_tags(comment) {
            file.jsdoc_comments.push((start, end));
        }
    }
    // A type is scanned at least twice.
    file.jsdoc_asterisks.shared_sort_unstable();
    file.jsdoc_asterisks.dedup();
    // Only `findOriginatingJSDocSatisfiesTag` reads them.
    let mut hosts = file.jsdoc_hosts.iter();
    if hosts.any(|host| host.first_satisfies_tag != u32::MAX) {
        file.jsdoc_hosts.shared_sort_by_key(|host| host.token);
        file.jsdoc_hosts.dedup_by_key(|host| host.token);
    } else {
        file.jsdoc_hosts.clear();
    }
    file.jsdoc_types.shared_sort_unstable_by_key(|it| it.0);
    file.jsdoc_modifiers.shared_sort_unstable_by_key(|it| it.0);
    file.jsdoc_member_comments
        .shared_sort_unstable_by_key(|it| it.0);
    // A type is reparsed for each node it annotates.
    if file.import_attributes.len() > 1 {
        file.import_attributes.shared_sort_by_key(|it| it.0);
        file.import_attributes.dedup_by_key(|it| it.0);
    }
}

/// The state `parseJSDocComment` saves.
struct Outer<'a> {
    mark: Mark,
    src: &'a [u8],
    comments: Vec<Comment>,
    comment_directives: usize,
    context: u32,
    lists: u32,
    errors_at: (u32, u32),
    last_nullable_type: (TypeNodeId, u32),
    parameter_question_pos: u32,
    has_top_level_await: bool,
    /// `saveDiagnosticsLength`
    diagnostics: usize,
}

/// A parse that only keeps its parse errors.
struct FirstParse {
    checkpoint: Checkpoint,
    diagnostics: usize,
}

/// The result of `parseJSDocType`.
struct JsDocType {
    /// Without the `...` and the `=`.
    ty: TypeNodeId,
    has_dots: bool,
    has_equals: bool,
    /// True if no token was consumed.
    is_missing: bool,
}

/// `isJSDocLikeText`
fn is_jsdoc_like(comment: &[u8]) -> bool {
    matches!(comment, [_, b'*', b'*', after, ..] if *after != b'/')
}

/// True if a comment that passes `isJSDocLikeText` can have tags.
fn can_have_tags(comment: &[u8]) -> bool {
    comment.ends_with(b"*/") && strings::contains_char(comment, b'@')
}

/// `scanJSDocCommentForTags`, which looks for `@see` and `@link`. This also looks for the tags the checker reads in a
/// TypeScript file.
fn scan_jsdoc_comment_for_tags(mut comment: &[u8]) -> u8 {
    let mut found = 0;
    while let Some(at) = strings::index_of_char_usize(comment, b'@') {
        comment = comment.get(at + 1..).unwrap_or_default();
        let len = comment
            .iter()
            .take_while(|c| c.is_ascii_alphabetic())
            .count();
        found |= match (comment.get(..len).unwrap_or_default(), comment.get(len)) {
            // `ScanJSDocToken` decodes an escape in a name.
            (_, Some(b'\\')) => flags::AUGMENTS | flags::PARAM,
            // `hasJSDocTag`
            (
                b"see" | b"link" | b"linkcode" | b"linkplain",
                None | Some(b' ' | b'\t' | b'\n' | b'\r' | b'}' | b'*'),
            ) => flags::SEE_OR_LINK,
            (b"augments" | b"extends", _) => flags::AUGMENTS,
            (b"param" | b"arg" | b"argument", _) => flags::PARAM,
            _ => 0,
        };
    }
    found
}

/// Returns the `flags` that select which JSDoc comments of a TypeScript file have to be read. Only the checker reads
/// their tags, in two functions. `comments` is every comment in `text`.
pub(crate) fn read_by_checker(text: &[u8], comments: &[Comment], is_declaration_file: bool) -> u8 {
    let mut found = 0;
    for &Comment {
        pos: start, end, ..
    } in comments
    {
        let comment = text.get(start as usize..end as usize).unwrap_or_default();
        if is_jsdoc_like(comment) {
            found |= scan_jsdoc_comment_for_tags(comment);
        }
    }
    // `checkUnmatchedJSDocParameters` reports nothing in TypeScript, but for a function with a `@param` tag
    // `containsArgumentsReference` resolves the identifiers named `arguments` in the body. `getAllJSDocTags` needs to
    // know whether each comment has tags.
    if found & flags::PARAM != 0
        && !is_declaration_file
        && (strings::contains(text, b"arguments") || strings::contains(text, b"\\u"))
    {
        return flags::JSDOC_LIKE;
    }
    // `checkGrammarClassDeclarationHeritageClauses`, which reads `EagerJSDoc`.
    if found & flags::AUGMENTS != 0 && found & flags::SEE_OR_LINK != 0 {
        return flags::AUGMENTS;
    }
    0
}

/// Maps a `Scan` token to the token kinds the JSDoc parser distinguishes.
fn token_of(token: T) -> JSDocToken {
    match token {
        T::Eof => JSDocToken::EndOfFile,
        T::At => JSDocToken::At,
        T::Asterisk => JSDocToken::Asterisk,
        T::OpenBrace => JSDocToken::OpenBrace,
        T::CloseBrace => JSDocToken::CloseBrace,
        T::OpenBracket => JSDocToken::OpenBracket,
        T::CloseBracket => JSDocToken::CloseBracket,
        T::LessThan => JSDocToken::LessThan,
        T::Equals => JSDocToken::Equals,
        T::Comma => JSDocToken::Comma,
        T::Dot => JSDocToken::Dot,
        T::DotDotDot => JSDocToken::DotDotDot,
        T::PrivateIdentifier => JSDocToken::PrivateIdentifier,
        _ if token.is_identifier_or_keyword() => JSDocToken::Identifier,
        _ => JSDocToken::Other,
    }
}

/// True for a `ScanJSDocToken` token that `Scan` wouldn't return at that position. No type or expression starts with
/// it.
fn is_jsdoc_only_token(at: JSDocScannerState) -> bool {
    !at.is_from_scan
        && matches!(
            at.token,
            JSDocToken::Unknown
                | JSDocToken::WhitespaceTrivia
                | JSDocToken::NewLineTrivia
                | JSDocToken::Backtick
                | JSDocToken::Hash
        )
}

// ───────────────────────────── calls from jsdoc.go into parser.go ─────────────────────────────

impl<const GENERAL: bool, const COMMENTS: bool> Syntax for Parser<'_, GENERAL, COMMENTS> {
    fn next_token(&mut self, from: usize) -> JSDocScannerState {
        if self.has_failed() {
            return self.rejected_state();
        }
        self.scan_from(from);
        self.take_scanner_errors();
        self.state()
    }

    fn parse_jsdoc_type(&mut self, at: JSDocScannerState) -> (TypeExpr, JSDocScannerState) {
        let pos = at.start as u32;
        let first = self.begin_first_parse();
        let parsed = self.jsdoc_type(at);
        let shape = match (parsed.has_dots, parsed.has_equals) {
            (false, false) => self.shape_of(parsed.ty, pos),
            (true, false) => TypeShape::VARIADIC,
            (false, true) => TypeShape::OPTIONAL,
            (true, true) => TypeShape::VARIADIC | TypeShape::OPTIONAL,
        };
        let mut after = self.end_first_parse(&first);
        if parsed.is_missing && !self.has_failed() {
            after = at;
        }
        let expr = TypeExpr {
            entry: at,
            pos,
            end: after.start as u32,
            shape,
        };
        (expr, after)
    }

    fn parse_type_arguments(
        &mut self,
        at: JSDocScannerState,
    ) -> (Option<TypeArguments>, JSDocScannerState) {
        if at.token != JSDocToken::LessThan {
            return (None, at);
        }
        let first = self.begin_first_parse();
        self.jsdoc_type_arguments(at);
        let after = self.end_first_parse(&first);
        (Some(TypeArguments { entry: at }), after)
    }

    fn parse_expression(&mut self, at: JSDocScannerState) -> JSDocScannerState {
        let first = self.begin_first_parse();
        self.resume(at);
        self.expression();
        self.end_first_parse(&first)
    }

    fn parse_modifiers(
        &mut self,
        at: JSDocScannerState,
        modifiers: &mut Vec<(Flags, u32)>,
    ) -> JSDocScannerState {
        self.resume(at);
        let base = self.s.modifiers.len();
        self.modifiers(ModifiersOf::TypeParameter);
        self.take_scanner_errors();
        let own_modifiers = self.s.modifiers.get(base..).unwrap_or_default();
        let has_any = !own_modifiers.is_empty();
        for modifier in own_modifiers {
            if let ModifierKind::Keyword(flag) = modifier.kind {
                modifiers.push((flag, modifier.pos));
            }
        }
        self.s.modifiers.truncate(base);
        match has_any || self.has_failed() {
            true => self.state(),
            false => at,
        }
    }

    fn parse_import_tag(&mut self, at: JSDocScannerState) -> (syntax::Import, JSDocScannerState) {
        // `parseModuleSpecifier` reports it without consuming the token.
        if is_jsdoc_only_token(at) {
            self.parse_error_at(1109, at.stale_start, at.pos, &[]);
            let import = syntax::Import {
                has_clause: false,
                entry: at,
                end: at.start as u32,
            };
            return (import, at);
        }
        let first = self.begin_first_parse();
        let (_, end, has_clause) = self.jsdoc_import(at);
        let after = self.end_first_parse(&first);
        let import = syntax::Import {
            has_clause,
            entry: at,
            end,
        };
        (import, after)
    }

    fn parse_error_at(&mut self, code: u32, start: usize, end: usize, args: &[&[u8]]) {
        // `errors_at` is keyed by the lexer's token, which doesn't move while the comment reader scans.
        self.errors_at = (u32::MAX, 0);
        let at = match start == end {
            true => (start as u32, Diagnostic::NO_LENGTH),
            false => (start as u32, end as u32),
        };
        let before = self.f.diagnostics.len();
        self.error(code, at, args);
        // `parseTypedefTag` adds this related info without a location.
        if code == 8033
            && self.f.diagnostics.len() > before
            && let Some(error) = self.f.diagnostics.last_mut()
            && error.code == code
        {
            let related = Diagnostic::new(DiagnosticKind::Parse, (0, 0), 8034, &[]);
            error.related.push(related);
        }
    }

    fn mark(&mut self) -> usize {
        self.take_scanner_errors();
        self.f.diagnostics.len()
    }

    fn rewind(&mut self, mark: usize) {
        self.lx.errors.clear();
        self.f.diagnostics.truncate(mark);
    }
}

impl<'a, const GENERAL: bool, const COMMENTS: bool> Parser<'a, GENERAL, COMMENTS> {
    /// The lexer's `ScannerState`.
    fn state(&self) -> JSDocScannerState {
        if self.has_failed() {
            return self.rejected_state();
        }
        JSDocScannerState {
            token: token_of(self.lx.token),
            full_start: self.lx.full_start as usize,
            start: self.lx.start as usize,
            stale_start: self.lx.start as usize,
            pos: self.lx.end as usize,
            has_preceding_line_break: self.lx.newline_before,
            is_from_scan: true,
        }
    }

    /// The state to return once the file is rejected. It makes the reader skip the rest of the comment.
    fn rejected_state(&self) -> JSDocScannerState {
        let end = self.lx.src.len();
        JSDocScannerState {
            token: JSDocToken::EndOfFile,
            full_start: end,
            start: end,
            stale_start: end,
            pos: end,
            has_preceding_line_break: false,
            is_from_scan: true,
        }
    }

    /// `Scan`, starting at `pos`. The lexer's current token isn't necessarily the one before `pos`.
    fn scan_from(&mut self, pos: usize) {
        self.lx.end = pos as u32;
        self.lx.has_escape = false;
        self.lx.next();
    }

    /// Makes `at` the lexer's current token.
    fn resume(&mut self, at: JSDocScannerState) {
        if self.has_failed() {
            return;
        }
        // Scan from the token's start, not its full start. Whether a `*` in the preceding trivia was skipped depends on
        // what `skips_jsdoc_asterisks` was when the token was first scanned.
        self.scan_from(at.start);
        self.lx.full_start = at.full_start as u32;
        self.lx.newline_before = at.has_preceding_line_break;
        if at.is_from_scan || self.has_failed() || self.lx.end as usize == at.pos {
            return;
        }
        // Keep the token that `ScanJSDocToken` returned. Its words can contain `-`, and such a word isn't a keyword.
        // Its punctuation tokens are one character long.
        self.lx.token = match at.token {
            JSDocToken::Identifier => T::Identifier,
            JSDocToken::Dot => T::Dot,
            JSDocToken::LessThan => T::LessThan,
            JSDocToken::Equals => T::Equals,
            JSDocToken::Asterisk => T::Asterisk,
            _ => return,
        };
        self.lx.end = at.pos as u32;
        if at.token == JSDocToken::Identifier {
            let src = self.lx.src;
            let word = src.get(at.start..at.pos).unwrap_or_default();
            self.lx.atom = self.atom(&bun_sema::check::spans::unescaped_identifier(word));
        }
    }

    fn begin_first_parse(&mut self) -> FirstParse {
        let checkpoint = self.checkpoint();
        FirstParse {
            checkpoint,
            diagnostics: self.f.diagnostics.len(),
        }
    }

    /// Drops what was built since `begin_first_parse`. Returns the lexer's state at the end of the parse.
    fn end_first_parse(&mut self, first: &FirstParse) -> JSDocScannerState {
        self.lx.skips_jsdoc_asterisks = false;
        self.take_scanner_errors();
        let after = self.state();
        let from = first.diagnostics.min(self.f.diagnostics.len());
        let mut reported = self.f.diagnostics.split_off(from);
        // `checkTypeReferenceNode`: `A.<T>` is `A<T>` in a JSDoc comment.
        reported.retain(|it| it.kind == DiagnosticKind::Parse && it.code != 8020);
        self.rollback(&first.checkpoint);
        self.f.diagnostics.append(&mut reported);
        // `rollback` moved the lexer, so put the token back at the end of the text.
        if let Some(why) = self.lx.rejection {
            self.lx.reject(why);
        }
        after
    }

    /// Filters the diagnostics reported since the file had `from` of them, which are about reparsed nodes. Keeps only
    /// the ones the checker reports.
    fn keep_checker_errors(&mut self, from: usize, reach: Reach) {
        self.take_scanner_errors();
        if self.f.diagnostics.len() <= from {
            return;
        }
        let mut reported = self.f.diagnostics.split_off(from);
        reported.retain(|it| {
            it.code != 8020
                && match it.kind {
                    DiagnosticKind::Grammar => reach == Reach::Checked,
                    DiagnosticKind::Checker => reach != Reach::Unvisited,
                    DiagnosticKind::Parse
                    | DiagnosticKind::Js
                    | DiagnosticKind::JsDoc
                    | DiagnosticKind::Oxc
                    | DiagnosticKind::OxcFatal
                    | DiagnosticKind::OxcSemantic
                    | DiagnosticKind::OxcSecondReading => false,
                }
        });
        self.f.diagnostics.append(&mut reported);
    }

    /// `parseJSDocType`, at the token `at`.
    fn jsdoc_type(&mut self, at: JSDocScannerState) -> JsDocType {
        // `parseTypeReference` at a token that can't start a type, or at the end: the name is missing
        // (`createIdentifierWithDiagnostic`), and the token isn't consumed.
        let is_at_end = !at.is_from_scan && at.token == JSDocToken::EndOfFile;
        if is_jsdoc_only_token(at) || is_at_end {
            match is_at_end {
                true => self.parse_error_at(1110, at.full_start, at.full_start, &[]),
                false => self.parse_error_at(1110, at.stale_start, at.pos, &[]),
            }
            let pos = at.full_start as u32;
            let name = self.f.entity_name(std::iter::once((known::empty, pos)));
            let args = IdList::EMPTY;
            return JsDocType {
                ty: self.add_type(TypeNodeKind::Ref { name, args }, pos, pos),
                has_dots: false,
                has_equals: false,
                is_missing: true,
            };
        }
        self.lx.skips_jsdoc_asterisks = true;
        self.resume(at);
        let has_dots = self.eat(T::DotDotDot);
        let ty = self.type_or_type_predicate();
        self.lx.skips_jsdoc_asterisks = false;
        JsDocType {
            ty,
            has_dots,
            has_equals: self.eat(T::Equals),
            is_missing: false,
        }
    }

    /// Returns the facts that are kept about the node `ty`, which `parseJSDocType` parsed starting at `pos`, with no
    /// `...` and no `=`.
    fn shape_of(&self, ty: TypeNodeId, pos: u32) -> TypeShape {
        let Some(&node) = self.f.types.get(ty.idx()) else {
            return TypeShape::empty();
        };
        let mut shape = TypeShape::empty();
        match node.kind {
            TypeNodeKind::Array(_) => shape |= TypeShape::ARRAY,
            TypeNodeKind::Ref { name, args } if name.len() == 1 => {
                match self.f.texts(name).next() {
                    Some(known::Array | known::ReadonlyArray) => {
                        shape |= TypeShape::ARRAY_REFERENCE;
                    }
                    // A `ParenthesizedType` has no node of its own. It starts before its type's node.
                    Some(known::r#const) if args.is_empty() && node.pos == pos => {
                        shape |= TypeShape::CONST;
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        // `isObjectOrObjectArrayTypeReference`
        let mut element = node;
        while let TypeNodeKind::Array(inner) = element.kind {
            match self.f.types.get(inner.idx()) {
                Some(&inner) => element = inner,
                None => return shape,
            }
        }
        let is_object = match element.kind {
            TypeNodeKind::Keyword(Keyword::Object) => true,
            TypeNodeKind::Ref { name, args } => {
                args.is_empty() && self.f.texts(name).eq([known::Object])
            }
            _ => false,
        };
        if is_object {
            shape |= TypeShape::OBJECT_OR_OBJECT_ARRAY;
        }
        shape
    }

    /// `parseTypeArguments` between the two `SetSkipJSDocLeadingAsterisks` calls, at the `<` token `at`.
    fn jsdoc_type_arguments(&mut self, at: JSDocScannerState) -> IdList<TypeNodeId> {
        self.lx.skips_jsdoc_asterisks = true;
        self.resume(at);
        let list = self.type_arguments();
        self.lx.skips_jsdoc_asterisks = false;
        list
    }

    /// `parseImportTag`, from `afterImportTagPos` to `tryParseImportAttributes`, at the token `at`. Returns the
    /// declaration (not yet added to the file), the start of the token after it, and `importClause != nil`.
    fn jsdoc_import(&mut self, at: JSDocScannerState) -> (Import, u32, bool) {
        let clause_start = at.start as u32;
        let imports = self.f.imports.len();
        self.resume(at);
        let (mut default, mut default_pos) = (Atom::NONE, 0);
        if self.is_identifier() {
            (default, default_pos) = (self.lx.atom, self.pos());
            self.next_after_name();
        }
        let (mut namespace, mut namespace_pos, mut namespace_start) = (Atom::NONE, 0, 0);
        let (mut has_named_imports, mut clause_end) = (false, 0);
        let specs = self.s.import_specs.len();
        // `tryParseImportClause`
        let has_clause = default.is_some() || matches!(self.token(), T::Asterisk | T::OpenBrace);
        if has_clause {
            // `parseImportClause`
            if default.is_none() || self.eat(T::Comma) {
                self.lx.skips_jsdoc_asterisks = true;
                if self.token() == T::Asterisk {
                    // `parseNamespaceImport`
                    namespace_start = self.pos();
                    self.next();
                    self.expect(T::As);
                    (namespace, namespace_pos) = self.identifier_of_declaration();
                } else {
                    has_named_imports = true;
                    self.jsdoc_named_imports();
                }
                self.lx.skips_jsdoc_asterisks = false;
            }
            clause_end = self.prev_end();
            self.expect(T::From);
        }
        // `parseModuleSpecifier`
        let specifier = self.pos();
        let mut spec = Atom::NONE;
        if self.token() == T::String {
            spec = self.lx.atom;
            self.next();
        } else {
            let expression = self.expression();
            if !self.has_failed() {
                self.string_literal_expected(expression, specifier);
                self.f.specifier_expressions.push(expression);
            }
        }
        let mode = self.import_attributes_of_declaration(false);
        self.lx.skips_jsdoc_asterisks = false;
        // The specifiers store the index the declaration was expected to get.
        if self.f.imports.len() != imports {
            self.reject(Rejection::Unsupported);
        }
        if spec.is_some() {
            self.f.specifier_uses.push(SpecifierUse {
                spec,
                pos: specifier,
                kind: SpecifierKind::Import,
                mode,
            });
        }
        let declaration = Import {
            spec,
            default,
            default_pos,
            namespace,
            namespace_pos,
            clause_start,
            clause_end,
            namespace_start,
            named: take_span!(self, import_specs, specs),
            has_named_imports,
            type_only: true,
            is_deferred: false,
            mode,
            stmt: StmtId::NONE,
        };
        (declaration, self.pos(), has_clause)
    }

    /// `parseNamedImports`: pushes the specifiers on their stack. They belong to the next declaration that's added.
    fn jsdoc_named_imports(&mut self) {
        let declaration = ImportId(self.f.imports.len() as u32);
        if !self.expect(T::OpenBrace) {
            return;
        }
        let lists = self.enter_list(ListKind::ImportOrExportSpecifiers);
        while self.is_in_list(T::CloseBrace)
            && self.is_at_element(ListKind::ImportOrExportSpecifiers)
        {
            let element = self.full_start();
            let specifier = self.import_or_export_specifier();
            let name = specifier.name;
            let mut imported = specifier.property_name.unwrap_or(name);
            if name.token != T::Identifier {
                self.unusual_name_of_import_specifier(&specifier, &mut imported);
            }
            // An identifier with empty text represents a string.
            if name.token != T::String && name.text != known::empty && name.text.is_some() {
                self.s.import_specs.push(ImportSpec {
                    start: specifier.start,
                    imported: imported.text,
                    local: name.text,
                    pos: name.pos,
                    type_only: specifier.is_type_only,
                    imported_pos: imported.pos,
                    end: name.pos + self.lx.text_of(name.text).len() as u32,
                    import: declaration,
                });
            }
            if !self.eat(T::Comma)
                && !self.continues_without_comma(ListKind::ImportOrExportSpecifiers, element)
            {
                break;
            }
        }
        self.leave_list(lists);
        self.expect(T::CloseBrace);
    }

    // ───────────────────────────── entering and leaving a comment ─────────────────────────────

    /// The first half of `parseJSDocComment`. `cut` is the position of the comment's `*/`.
    fn enter_comment(&mut self, cut: u32) -> Outer<'a> {
        // An error about the file's current token doesn't belong to the comment.
        self.take_scanner_errors();
        let outer = Outer {
            mark: self.lx.mark(),
            src: self.lx.src,
            // `Lexer::reset` drops the comments after a mark, which would drop real comments for a mark taken inside
            // this one.
            comments: std::mem::take(&mut self.lx.comments),
            comment_directives: self.lx.comment_directives.len(),
            context: self.context,
            lists: self.lists,
            errors_at: self.errors_at,
            last_nullable_type: self.last_nullable_type,
            parameter_question_pos: self.parameter_question_pos,
            has_top_level_await: self.has_top_level_await,
            diagnostics: self.f.diagnostics.len(),
        };
        self.lx
            .set_src(outer.src.get(..cut as usize).unwrap_or(outer.src));
        // The top level isn't an await context until the file is known to be a module.
        let inherited = match self.has_context(ctx::TOP_LEVEL) {
            true => ctx::YIELD | ctx::AMBIENT | ctx::TOP_LEVEL,
            false => ctx::YIELD | ctx::AMBIENT | ctx::AWAIT,
        };
        self.context = self.context & inherited | ctx::TYPE;
        // `PCJSDocComment`: like `PCJsxChildren`, every token is an element of it, so no list skips a token.
        self.lists = 1 << ListKind::JsxChildren as u32;
        self.errors_at = (u32::MAX, 0);
        self.jsdoc.is_in_comment = true;
        outer
    }

    /// The second half of `parseJSDocComment`, without the diagnostics.
    fn leave_comment(&mut self, outer: Outer<'a>) {
        self.lx.skips_jsdoc_asterisks = false;
        self.lx.set_src(outer.src);
        self.lx.reset(outer.mark);
        self.lx.comments = outer.comments;
        self.lx
            .comment_directives
            .truncate(outer.comment_directives);
        self.context = outer.context;
        self.lists = outer.lists;
        self.errors_at = outer.errors_at;
        self.last_nullable_type = outer.last_nullable_type;
        self.parameter_question_pos = outer.parameter_question_pos;
        self.has_top_level_await = outer.has_top_level_await;
        self.jsdoc.is_in_comment = false;
        match self.lx.rejection {
            None => {}
            // `Syntax` would only end the speculation in progress, and an error in a comment says nothing about that
            // speculation.
            Some(Rejection::Syntax) => self.reject(Rejection::Reported),
            // Put the token back at the end of the whole text.
            Some(why) => self.lx.reject(why),
        }
    }

    /// `enter_comment` for the comment that contains `pos`. Returns `None` if the file is rejected.
    fn enter_comment_containing(&mut self, pos: usize) -> Option<Outer<'a>> {
        if self.has_failed() {
            return None;
        }
        let comments = &self.lx.comments;
        let started = comments.partition_point(|comment| comment.pos as usize <= pos);
        let containing = started.checked_sub(1).and_then(|index| comments.get(index));
        match containing {
            Some(&Comment { end, .. }) if pos + 2 <= end as usize => {
                Some(self.enter_comment(end - 2))
            }
            _ => {
                self.reject(Rejection::Unsupported);
                None
            }
        }
    }

    /// `parseJSDocComment`, for the comment from `start` to `end`, which is terminated.
    fn read_comment(&mut self, start: u32, end: u32) -> JsDoc<'a> {
        let source: &'a [u8] = self.lx.src;
        let stack_check = self.lx.stack_check;
        let was_low = std::cell::Cell::new(false);
        let is_stack_low = || {
            let is_low = !stack_check.is_safe_to_recurse();
            was_low.set(was_low.get() | is_low);
            is_low
        };
        let outer = self.enter_comment(end.saturating_sub(2));
        let doc = syntax::read(source, start as usize, end as usize, self, &is_stack_low);
        // "move jsdoc diagnostics to jsdocDiagnostics -- for JS files only". Done once, no matter how many nodes the
        // comment is attached to.
        if self.f.diagnostics.len() > outer.diagnostics {
            if self.f.is_js && !self.jsdoc.attached.contains(&start) {
                self.jsdoc.attached.push(start);
                for error in self.f.diagnostics.iter_mut().skip(outer.diagnostics) {
                    error.kind = DiagnosticKind::JsDoc;
                }
            } else {
                self.f.diagnostics.truncate(outer.diagnostics);
            }
        }
        self.leave_comment(outer);
        if was_low.get() {
            self.reject(Rejection::TooDeep);
        }
        doc
    }

    // ───────────────────────────── reparsing ─────────────────────────────

    /// `addDeepCloneReparse` for a type expression's type. Returns `NONE` only if the file is rejected.
    pub(super) fn reparse_jsdoc_type(&mut self, expr: TypeExpr, reach: Reach) -> TypeNodeId {
        let Some(outer) = self.enter_comment_containing(expr.entry.start) else {
            return TypeNodeId::NONE;
        };
        let parsed = self.jsdoc_type(expr.entry);
        self.keep_checker_errors(outer.diagnostics, reach);
        self.leave_comment(outer);
        let mut ty = parsed.ty;
        let Some(&TypeNode { end, .. }) = self.f.types.get(ty.idx()) else {
            return TypeNodeId::NONE;
        };
        if self.has_failed() {
            return TypeNodeId::NONE;
        }
        // `parseJSDocType`
        if expr.shape.contains(TypeShape::VARIADIC) {
            let kind = TypeNodeKind::JSDoc {
                ty,
                kind: JSDocTypeKind::Variadic,
                is_postfix: false,
            };
            ty = self.add_type(kind, expr.pos, end);
        }
        if expr.shape.contains(TypeShape::OPTIONAL) {
            let kind = TypeNodeKind::JSDoc {
                ty,
                kind: JSDocTypeKind::Optional,
                is_postfix: true,
            };
            ty = self.add_type(kind, expr.pos, end);
        }
        ty
    }

    /// The same for the type arguments after a class name.
    pub(super) fn reparse_jsdoc_type_arguments(
        &mut self,
        args: TypeArguments,
    ) -> IdList<TypeNodeId> {
        let Some(outer) = self.enter_comment_containing(args.entry.start) else {
            return IdList::EMPTY;
        };
        let list = self.jsdoc_type_arguments(args.entry);
        self.keep_checker_errors(outer.diagnostics, Reach::Checked);
        self.leave_comment(outer);
        list
    }

    /// `NewJSImportDeclaration` for an `@import` tag that has a clause. `tag` is `node.Loc`. Returns `NONE` only if the
    /// file is rejected.
    pub(super) fn reparse_jsdoc_import(
        &mut self,
        import: syntax::Import,
        tag: TextRange,
        reach: Reach,
    ) -> StmtId {
        let Some(outer) = self.enter_comment_containing(import.entry.start) else {
            return StmtId::NONE;
        };
        let (declaration, ..) = self.jsdoc_import(import.entry);
        self.keep_checker_errors(outer.diagnostics, reach);
        self.leave_comment(outer);
        if self.has_failed() {
            return StmtId::NONE;
        }
        let declaration = self.f.add_import(declaration);
        let statement = self.f.stmt(StmtKind::Import(declaration), tag.pos);
        self.f[statement].loc = tag;
        statement
    }

    // ───────────────────────────── a node's comments ─────────────────────────────

    /// Returns the JSDoc comments of the node whose first token is at `token` and whose full start is `full_start`.
    /// `with_trailing` includes the comments on the previous token's line (`GetTrailingCommentRanges`).
    fn jsdoc_before(&mut self, token: u32, full_start: u32, with_trailing: bool) -> Attached<'a> {
        let src = self.lx.src;
        let mut attached = Attached {
            docs: SmallVec::new(),
            last_has_tags: false,
            range: None,
            has_see_or_link: false,
        };
        // `GetLeadingCommentRanges`: the comments after the first line break, or after the start of the file.
        let mut is_collecting = with_trailing || full_start == 0;
        let is_before = |comment: &Comment| comment.pos < full_start;
        let mut index = self.lx.comments.partition_point(is_before);
        // The end of the previous comment, or of the previous token.
        let mut before = full_start as usize;
        while let Some(&Comment {
            pos: start, end, ..
        }) = self.lx.comments.get(index)
            && start < token
            && !self.has_failed()
        {
            index += 1;
            let comment = src.get(start as usize..end as usize).unwrap_or_default();
            is_collecting |= strings::contains_js_line_break(
                src.get(before..start as usize).unwrap_or_default(),
            );
            before = end as usize;
            let is_jsdoc = is_jsdoc_like(comment);
            // In JavaScript every comment is read, and nothing needs `SEE_OR_LINK`.
            let found = match is_jsdoc && !self.f.is_js {
                true => flags::JSDOC_LIKE | scan_jsdoc_comment_for_tags(comment),
                false => flags::JSDOC_LIKE,
            };
            attached.has_see_or_link |= found & flags::SEE_OR_LINK != 0;
            if !is_collecting || !is_jsdoc {
                // A line comment ends with its line.
                is_collecting |= comment.starts_with(b"//");
                continue;
            }
            attached.range = Some(TextRange {
                pos: attached.range.map_or(start, |range| range.pos),
                end,
            });
            attached.last_has_tags = false;
            if found & self.jsdoc.wanted != 0 && can_have_tags(comment) {
                let doc = self.read_comment(start, end);
                attached.last_has_tags = !doc.tags.is_empty();
                attached.docs.push(doc);
            }
        }
        attached
    }

    /// `withJSDoc` for the node `host` whose first token is at `token` and whose full start is `full_start`.
    pub(super) fn with_jsdoc(
        &mut self,
        token: u32,
        full_start: u32,
        with_trailing: bool,
        host: &mut Host,
    ) {
        // The shortest JSDoc comment is `/***/`.
        if self.jsdoc.is_in_comment || self.has_failed() || token.saturating_sub(full_start) < 5 {
            return;
        }
        let trivia = self.lx.src.get(full_start as usize..token as usize);
        if !strings::contains_char(trivia.unwrap_or_default(), b'/') {
            return;
        }
        if self.is_too_deep() {
            return;
        }
        let attached = self.jsdoc_before(token, full_start, with_trailing);
        if self.f.is_js
            && let Some(comments) = attached.range
        {
            let mut tags = attached.docs.iter().flat_map(|doc| &doc.tags);
            let first_satisfies_tag = tags.find(|tag| matches!(tag.kind, TagKind::Satisfies(_)));
            self.f.jsdoc_hosts.push(JsDocHost {
                token,
                comments,
                first_satisfies_tag: first_satisfies_tag.map_or(u32::MAX, |tag| tag.name_pos),
            });
        }
        if !attached.docs.is_empty() {
            self.reparse_tags(host, &attached);
        }
    }

    // ───────────────────────────── the nodes that have comments ─────────────────────────────

    /// `parseSourceFileWorker`: the end of the file can have comments too. `reparsed` is the `from` of `list_reparsed`.
    #[cold]
    #[inline(never)]
    pub(crate) fn end_of_file_jsdoc(&mut self, reparsed: usize) {
        let (token, full_start) = (self.f.source_len, self.full_start());
        self.with_jsdoc(token, full_start, false, &mut Host::Other);
        self.list_reparsed(reparsed);
    }

    /// `withJSDoc` for a statement.
    #[cold]
    #[inline(never)]
    pub(crate) fn statement_jsdoc(&mut self, id: StmtId) {
        let Some(&Stmt {
            kind, start, loc, ..
        }) = self.f.stmts.get(id.idx())
        else {
            return;
        };
        let mut host = match kind {
            StmtKind::Var(decls) => Host::VariableStatement(decls),
            // `parseExpressionOrLabeledStatement`: "do not parse the same jsdoc twice"
            StmtKind::Expr(_) if self.lx.src.get(start as usize) == Some(&b'(') => return,
            StmtKind::Expr(_) => Host::ExpressionStatement(id),
            StmtKind::Return(_) => Host::ReturnStatement(id),
            StmtKind::Fn(func) => Host::Function(func),
            StmtKind::Class(class) => Host::Class(class),
            StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => Host::ExportAssignment(id),
            _ => Host::Other,
        };
        self.with_jsdoc(start, loc.pos, false, &mut host);
    }

    /// `parseCaseClause`, `parseDefaultClause`: for the clause that starts at `pos`.
    #[cold]
    #[inline(never)]
    pub(crate) fn clause_jsdoc(&mut self, pos: u32) {
        let full_start = full_start_before(&self.lx.comments, pos);
        self.with_jsdoc(pos, full_start, false, &mut Host::Other);
    }

    /// `parseVariableDeclarationWorker`
    #[cold]
    #[inline(never)]
    pub(crate) fn variable_declaration_jsdoc(&mut self, id: VarDeclId) {
        let Some(&VarDecl { pat, loc, .. }) = self.f.var_decls.get(id.idx()) else {
            return;
        };
        let Some(&Pat { pos, .. }) = self.f.pats.get(pat.idx()) else {
            return;
        };
        self.with_jsdoc(pos, loc.pos, true, &mut Host::VariableDeclaration(id));
    }

    /// The same for each declaration in a list.
    #[cold]
    #[inline(never)]
    pub(crate) fn variable_declarations_jsdoc(&mut self, decls: Span<VarDeclId>) {
        for id in decls.iter() {
            self.variable_declaration_jsdoc(id);
        }
    }

    /// `parseParameterEx`, for each parameter in a list. The checker doesn't read a parameter's tags.
    #[cold]
    #[inline(never)]
    pub(crate) fn parameters_jsdoc(&mut self, params: Span<ParamId>) {
        if !self.f.is_js || self.jsdoc.is_in_comment {
            return;
        }
        for id in params.iter() {
            if let Some(&Param { pos, loc, .. }) = self.f.params.get(id.idx()) {
                self.with_jsdoc(pos, loc.pos, true, &mut Host::Parameter(id));
            }
        }
    }

    /// `parseClassElement`, for `member`, which isn't on the member stack yet. Its modifiers are on the modifier stack
    /// from `first_modifier` on.
    #[cold]
    #[inline(never)]
    pub(crate) fn member_jsdoc(&mut self, member: &mut Member, first_modifier: usize) {
        let (first_overload, modifiers_end) = (self.s.members.len(), self.s.modifiers.len());
        let mut host = Host::ClassMember(*member);
        self.with_jsdoc(member.start, member.loc.pos, false, &mut host);
        if let Host::ClassMember(documented) = host {
            *member = documented;
        }
        let overloads = self.s.members.len().saturating_sub(first_overload);
        if overloads == 0 {
            return;
        }
        // An overload gets the keyword modifiers from the source, but not the ones from tags, and no decorators.
        let source_modifiers = self.s.modifiers.get(first_modifier..modifiers_end);
        let source_modifiers = source_modifiers.unwrap_or_default();
        let is_keyword = |it: &&Modifier| matches!(it.kind, ModifierKind::Keyword(_));
        let keywords: SmallVec<[Modifier; 4]> = source_modifiers
            .iter()
            .filter(is_keyword)
            .copied()
            .collect();
        let decorators = source_modifiers.len() - keywords.len();
        let list = match keywords.is_empty() {
            true => Span::EMPTY,
            false => self.f.add_modifiers(&keywords),
        };
        for overload in self.s.members.iter_mut().skip(first_overload) {
            overload.modifiers = list;
        }
        // The member's decorators are recorded under its index, which now belongs to the first overload.
        let first_decorator = self.s.decorators.len().saturating_sub(decorators);
        for decorator in self.s.decorators.iter_mut().skip(first_decorator) {
            decorator.0 += overloads as u32;
        }
    }

    /// The same for the static block that starts at `start`. Tags don't change it.
    #[cold]
    #[inline(never)]
    pub(crate) fn static_block_jsdoc(&mut self, start: Start) {
        let mut host = Host::ClassMember(Member {
            kind: MemberKind::StaticBlock,
            key: PropKey::None,
            flags: Flags::STATIC,
            ty: TypeNodeId::NONE,
            init: ExprId::NONE,
            func: FnId::NONE,
            name_pos: start.pos,
            start: start.pos,
            loc: TextRange {
                pos: start.full,
                end: self.prev_end(),
            },
            modifiers: Span::EMPTY,
        });
        self.with_jsdoc(start.pos, start.full, false, &mut host);
    }

    /// `parseClassElement`: a `;` is a member and has its own comments. The `;` is the previous token.
    #[cold]
    #[inline(never)]
    pub(crate) fn semicolon_jsdoc(&mut self) {
        let semicolon = self.prev_end().saturating_sub(1);
        let full_start = full_start_before(&self.lx.comments, semicolon);
        self.with_jsdoc(semicolon, full_start, false, &mut Host::Other);
    }

    /// `parseParenthesizedExpression`, for `expression` after the `(` at `open`. Returns the expression that's inside
    /// the parentheses afterwards. The checker doesn't read its tags.
    #[cold]
    #[inline(never)]
    pub(crate) fn parenthesized_jsdoc(&mut self, open: u32, expression: ExprId) -> ExprId {
        if !self.f.is_js {
            return expression;
        }
        let full_start = full_start_before(&self.lx.comments, open);
        let mut host = Host::Parenthesized(expression);
        self.with_jsdoc(open, full_start, true, &mut host);
        match host {
            Host::Parenthesized(inside) => inside,
            _ => expression,
        }
    }

    /// `withJSDoc` for the function expression or arrow function that starts at `start`.
    #[cold]
    #[inline(never)]
    pub(crate) fn function_jsdoc(&mut self, func: FnId, start: u32) {
        let full_start = full_start_before(&self.lx.comments, start);
        self.with_jsdoc(start, full_start, true, &mut Host::Function(func));
    }

    /// `withJSDoc` for the class expression that starts at `start`, which is its first decorator if it has one.
    #[cold]
    #[inline(never)]
    pub(crate) fn class_jsdoc(&mut self, class: ClassId, start: u32) {
        let full_start = full_start_before(&self.lx.comments, start);
        self.with_jsdoc(start, full_start, false, &mut Host::Class(class));
    }

    /// `parseObjectLiteralElement`, for `prop`, which is about to be pushed on the property stack.
    #[cold]
    #[inline(never)]
    pub(crate) fn property_jsdoc(&mut self, prop: Prop) -> Prop {
        let full_start = full_start_before(&self.lx.comments, prop.start);
        let mut host = Host::Property(prop, TypeNodeId::NONE);
        self.with_jsdoc(prop.start, full_start, false, &mut host);
        let Host::Property(documented, ty) = host else {
            return prop;
        };
        if ty.is_some() {
            let index = self.s.props.len() as u32;
            self.jsdoc.property_types.push((index, ty));
        }
        documented
    }

    /// Call once the properties on the stack from `base` on have become `props`. Moves their `@type` types into the
    /// file.
    #[cold]
    #[inline(never)]
    pub(crate) fn take_property_types(&mut self, base: usize, props: Span<PropId>) {
        while let Some(&(index, ty)) = self.jsdoc.property_types.last()
            && let Some(index) = (index as usize).checked_sub(base)
        {
            self.jsdoc.property_types.pop();
            if index < props.len() {
                let owner = JsDocTypeOwner::Prop(props.at(index));
                self.f.jsdoc_types.push((owner, ty));
            }
        }
    }

    // ───────────────────────────── statements created from tags ─────────────────────────────

    /// `parseListIndex`: statements created from tags while a statement was parsed go before it in its list. `from` is
    /// how many there were when the list began.
    #[cold]
    #[inline(never)]
    pub(crate) fn list_reparsed(&mut self, from: usize) {
        let created = self.jsdoc.reparsed.get(from..).unwrap_or_default();
        self.s
            .ids
            .extend(created.iter().map(|statement| statement.0));
        self.jsdoc.reparsed.truncate(from);
    }

    /// The same for `PCSwitchClauseStatements`: type aliases and imports are left for the list that contains the
    /// `switch`.
    #[cold]
    #[inline(never)]
    pub(crate) fn list_reparsed_of_clause(&mut self, from: usize) {
        let (file, ids) = (&self.f, &mut self.s.ids);
        let mut index = 0;
        self.jsdoc.reparsed.retain(|&statement| {
            index += 1;
            let is_left_for_outer_list = matches!(
                file.stmts.get(statement.idx()),
                Some(Stmt {
                    kind: StmtKind::TypeAlias(_) | StmtKind::Import(_),
                    ..
                })
            );
            if index > from && !is_left_for_outer_list {
                ids.push(statement.0);
                return false;
            }
            true
        });
    }

    // ───────────────────────────── speculation and finishing ─────────────────────────────

    /// Used by `checkpoint`.
    #[inline(always)]
    pub(crate) fn jsdoc_lens(&self) -> Lens {
        match self.reads_jsdoc() {
            true => Lens::of(&self.jsdoc, &self.f),
            false => Lens::default(),
        }
    }

    /// Used by `rollback`.
    #[inline(always)]
    pub(crate) fn rollback_jsdoc(&mut self, to: &Checkpoint) {
        to.jsdoc.restore(&mut self.jsdoc, &mut self.f, to.file.fns);
    }

    /// Call once the file is parsed. Sorts the lists about its comments.
    #[cold]
    #[inline(never)]
    pub(crate) fn finish_jsdoc(&mut self) {
        if self.f.is_js {
            self.f.jsdoc_asterisks = std::mem::take(&mut self.lx.jsdoc_asterisks);
            finish_jsdoc_lists(&mut self.f, self.lx.src, &self.lx.comments);
        }
    }
}
