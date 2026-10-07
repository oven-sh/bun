//! Errors that block declaration emit: `Program.GetDeclarationDiagnostics`.
//!
//! tsgo runs the declaration transformer (`transformers/declarations`) over a file and collects its
//! diagnostics. The transformer visits the exports of the file. An annotated type is visited for
//! the names in it. An inferred type is serialized to syntax by the node builder
//! (`checker/nodebuilderimpl.go`, `nodecopy.go`), which notifies the transformer's `SymbolTracker`
//! of each symbol it references and of anything it cannot serialize. The same traversal is done
//! here, and the same queries are made (`checker/symbolaccessibility.go`,
//! `checker/emitresolver.go`). The text of the declaration file is only produced for a project that
//! another project references (`Options::writes_declaration_files`).

use super::enclosing_declaration::Enclosing;
use super::errors_isolated_declarations::Emit;
use super::print::{
    DECLARATION_EMIT_NODE_BUILDER_FLAGS, Report, SymbolTracker,
    WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL, Written, YieldModuleSymbol, push_access,
};
use super::sink::held;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind};
use crate::config::compare_strings_case_insensitive;
use crate::json::Json;
use crate::program::source_file_may_be_emitted;
use crate::resolve::{
    JsxEmit, contains_path, ensure_path_is_non_module_name, get_relative_path_from_directory,
    get_root_length, is_declaration_file_name, is_relative, is_rooted_disk_path, join,
    known_extension, node_module_path_parts, path_is_relative, remove_file_extension,
};
use bstr::ByteSlice;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{dirname, relative_normalized};
use std::rc::Rc;

mod commonjs;

/// `endOfChain` of `getSymbolChain`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum EndOfChain {
    No,
    Yes,
}

/// The meaning a name is resolved with.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(super) enum Meaning {
    /// `SymbolFlagsNone`
    #[cfg(feature = "baselines")]
    None,
    Value,
    /// `SymbolFlagsValue | SymbolFlagsExportValue`, which `getQualifiedLeftMeaning` does not treat
    /// as `SymbolFlagsValue`.
    ValueOfName,
    Type,
    Namespace,
}

impl Meaning {
    /// Of `SymFlags::TYPE`, `NAMESPACE` or `VALUE`. `with_export_value`: `SymbolFlagsValue | SymbolFlagsExportValue`.
    pub(super) fn of(meaning: SymFlags, with_export_value: bool) -> Meaning {
        if meaning == SymFlags::TYPE {
            Meaning::Type
        } else if meaning == SymFlags::NAMESPACE {
            Meaning::Namespace
        } else if with_export_value {
            Meaning::ValueOfName
        } else {
            Meaning::Value
        }
    }

    fn flags(self) -> SymFlags {
        match self {
            #[cfg(feature = "baselines")]
            Meaning::None => SymFlags::empty(),
            Meaning::Value | Meaning::ValueOfName => SymFlags::VALUE,
            Meaning::Type => SymFlags::TYPE,
            Meaning::Namespace => SymFlags::NAMESPACE,
        }
    }

    /// `getQualifiedLeftMeaning`
    fn left(self) -> Meaning {
        if self == Meaning::Value {
            Meaning::Value
        } else {
            Meaning::Namespace
        }
    }
}

/// `symbolTableID`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Table {
    Locals(FileId, ScopeId),
    /// The members of a class or an interface that are types: the type parameters of all its declarations.
    TypeMembers(Sym),
    Exports(Sym),
    ResolvedExports(Sym),
    Globals,
}

/// `ignoreQualification` and `isLocalNameLookup` of `getAccessibleSymbolChainFromSymbolTable`
#[derive(Copy, Clone)]
struct TableLookup {
    ignores_qualification: bool,
    is_local_name_lookup: bool,
}

/// `printer.SymbolAccessibility`
#[derive(PartialEq, Eq)]
enum Accessibility {
    /// With `AliasesToMakeVisible`.
    Accessible(Vec<(FileId, StmtId)>),
    NotAccessible,
    CannotBeNamed,
    NotResolved,
}

/// `printer.SymbolAccessibilityResult`
pub(super) struct Access {
    accessibility: Accessibility,
    symbol_name: Vec<u8>,
    module_name: Vec<u8>,
    /// `ErrorNode`: its span.
    error_node: Option<(u32, u32)>,
}

impl Access {
    fn accessible(aliases: Vec<(FileId, StmtId)>) -> Access {
        Access {
            accessibility: Accessibility::Accessible(aliases),
            symbol_name: Vec::new(),
            module_name: Vec::new(),
            error_node: None,
        }
    }

    pub(super) fn is_accessible(&self) -> bool {
        matches!(self.accessibility, Accessibility::Accessible(_))
    }
}

/// `GetSymbolAccessibilityDiagnostic`, identified by how it is created.
#[derive(Copy, Clone)]
enum Context {
    /// `createGetSymbolAccessibilityDiagnosticForNode`. With `NONE`, no diagnostic is reported.
    ForNode(Node),
    /// `createGetSymbolAccessibilityDiagnosticForNodeName`
    ForNodeName(Node),
    /// `transformExportAssignment`: 4082 at the statement.
    DefaultExport(Node),
    /// `transformClassDeclaration` for a class that extends an expression that is not a name: 4020
    /// at the `ExpressionWithTypeArguments`.
    ExtendsClause(Node),
}

/// An error.
struct Found {
    start: u32,
    end: u32,
    code: u32,
    args: Vec<Vec<u8>>,
    related: Vec<Reported>,
}

/// `SymbolTrackerImpl` with its `SymbolTrackerSharedState` (tracker.go), which are separate there
/// so that the transformer can hold a pointer to the second. The checker is passed to it.
struct SymbolTrackerImpl {
    current_source_file: FileId,
    diagnostics: Vec<Found>,
    get_symbol_accessibility_diagnostic: Context,
    error_name_node: Node,
    fallback_stack: Vec<Node>,
    late_marked_statements: Vec<StmtId>,
    watched_class_symbol: Option<Sym>,
    class_symbol_tracked: bool,
    /// `state.isolatedDeclarations`, with the inputs and the results of
    /// `getIsolatedDeclarationError`.
    isolated_declarations: Option<Emit>,
}

/// What `ensureType` and `ensureNoInitializer` emit after the name of a declaration.
enum Ensured {
    Nothing,
    Type(Vec<u8>),
    /// `CreateLiteralConstValue`
    Initializer(Vec<u8>),
}

impl Ensured {
    fn text(&self) -> Vec<u8> {
        match self {
            Ensured::Nothing => Vec::new(),
            Ensured::Type(ty) => [b": ", &ty[..]].concat(),
            Ensured::Initializer(value) => [b" = ", &value[..]].concat(),
        }
    }
}

/// The statement kinds the transformer distinguishes after they are created.
#[derive(Copy, Clone, PartialEq, Eq)]
enum StatementKind {
    Import,
    ImportEquals,
    ExportDeclaration,
    ExportAssignment,
    /// `IsAmbientModule`
    AmbientModule,
    /// `KindJSTypeAliasDeclaration`, which is not `CanHaveModifiers`.
    JsTypeAlias,
    Other,
}

/// A statement of the declaration file. The transformer edits it after it is created
/// (`stripExportModifiers`), so its modifiers are stored separately.
#[derive(Clone)]
struct Statement {
    kind: StatementKind,
    /// Its leading comments, with the separator that follows them.
    comments: Vec<u8>,
    /// In source order.
    modifiers: Vec<Flags>,
    /// The text after the modifiers.
    text: Vec<u8>,
}

impl Statement {
    fn new(kind: StatementKind, text: Vec<u8>) -> Statement {
        Statement {
            kind,
            comments: Vec::new(),
            modifiers: Vec::new(),
            text,
        }
    }

    fn is_exported(&self) -> bool {
        self.modifiers.contains(&Flags::EXPORT)
    }

    /// `IsAnyImportOrReExport`
    fn is_any_import_or_re_export(&self) -> bool {
        matches!(
            self.kind,
            StatementKind::Import | StatementKind::ImportEquals | StatementKind::ExportDeclaration
        )
    }

    /// `needsScopeMarker`
    fn needs_scope_marker(&self) -> bool {
        !self.is_any_import_or_re_export()
            && !self.is_exported()
            && !matches!(
                self.kind,
                StatementKind::ExportAssignment | StatementKind::AmbientModule
            )
    }

    /// `IsExternalModuleIndicator`
    fn is_external_module_indicator(&self) -> bool {
        self.is_any_import_or_re_export()
            || self.is_exported()
            || self.kind == StatementKind::ExportAssignment
    }

    /// `isScopeMarker`
    fn is_scope_marker(&self) -> bool {
        matches!(
            self.kind,
            StatementKind::ExportAssignment | StatementKind::ExportDeclaration
        )
    }

    /// `createEmptyExports`
    fn empty_exports() -> Statement {
        Statement::new(StatementKind::ExportDeclaration, b"export {};".to_vec())
    }
}

/// The result of `visit` for a statement.
enum Visited {
    Statements(Vec<Statement>),
    /// "Don't actually transform yet; just leave as original node - will be elided/swapped by late pass"
    Late(StmtId),
}

/// `CreateModifiersFromModifierFlags`: the modifiers in the order it creates them.
const MODIFIERS: [(Flags, &[u8]); 15] = [
    (Flags::EXPORT, b"export"),
    (Flags::AMBIENT, b"declare"),
    (Flags::DEFAULT, b"default"),
    (Flags::CONST, b"const"),
    (Flags::PUBLIC, b"public"),
    (Flags::PRIVATE, b"private"),
    (Flags::PROTECTED, b"protected"),
    (Flags::ABSTRACT, b"abstract"),
    (Flags::STATIC, b"static"),
    (Flags::OVERRIDE, b"override"),
    (Flags::READONLY, b"readonly"),
    (Flags::ACCESSOR, b"accessor"),
    (Flags::ASYNC, b"async"),
    (Flags::IN, b"in"),
    (Flags::OUT, b"out"),
];

/// `IsNonContextualKeyword`: the reserved words, and those of strict mode.
fn is_non_contextual_keyword(word: &[u8]) -> bool {
    matches!(
        word,
        b"break"
            | b"case"
            | b"catch"
            | b"class"
            | b"const"
            | b"continue"
            | b"debugger"
            | b"default"
            | b"delete"
            | b"do"
            | b"else"
            | b"enum"
            | b"export"
            | b"extends"
            | b"false"
            | b"finally"
            | b"for"
            | b"function"
            | b"if"
            | b"import"
            | b"in"
            | b"instanceof"
            | b"new"
            | b"null"
            | b"return"
            | b"super"
            | b"switch"
            | b"this"
            | b"throw"
            | b"true"
            | b"try"
            | b"typeof"
            | b"var"
            | b"void"
            | b"while"
            | b"with"
            | b"implements"
            | b"interface"
            | b"let"
            | b"package"
            | b"private"
            | b"protected"
            | b"public"
            | b"static"
            | b"yield"
    )
}

/// `emitComments`, with `commentSeparatorAfter`, for those of `comments` that pass
/// `shouldWriteComment` under `OnlyPrintJSDocStyle`. They are emitted at the start of a line
/// indented by `indent` levels, and so is the text that follows them.
pub(super) fn comments_text(text: &[u8], comments: Vec<(usize, usize)>, indent: usize) -> Vec<u8> {
    let mut written = Vec::new();
    for (start, end) in comments {
        if !should_write_comment(&text[start..end]) {
            continue;
        }
        write_comment_range(text, start, end, indent, &mut written);
        if has_trailing_new_line(text, end) {
            written.push(b'\n');
            written.extend_from_slice(&b"    ".repeat(indent));
        } else {
            written.push(b' ');
        }
    }
    written
}

/// `shouldWriteComment`, under `OnlyPrintJSDocStyle`: `isJSDocLikeText`, `IsPinnedComment`.
fn should_write_comment(comment: &[u8]) -> bool {
    comment.starts_with(b"/*") && comment.len() >= 5 && comment[2] == b'*' && comment[3] != b'/'
        || is_pinned_comment(comment)
}

/// `IsPinnedComment`
fn is_pinned_comment(comment: &[u8]) -> bool {
    comment.starts_with(b"/*") && comment.len() > 5 && comment[2] == b'!'
}

/// `CommentRange.HasTrailingNewLine` for a comment that ends at `end`.
fn has_trailing_new_line(text: &[u8], end: usize) -> bool {
    let after = text[end..].iter().find(|&&b| b != b' ' && b != b'\t');
    matches!(after, Some(b'\n' | b'\r'))
}

/// `Body` of the namespace `m`, if it is a `ModuleDeclaration`: the `B` of `namespace A.B`.
fn nested_module_declaration(hir: &File, m: ModuleId) -> Option<StmtId> {
    // `global { }` and a namespace of `wrapInJSDocNamespace` start with their names too, but they
    // are in a block.
    hir.nested_namespace(m).filter(|&inner| {
        matches!(hir[inner].kind, StmtKind::Module(it)
            if hir[it].name != ModuleName::Global && !hir[it].flags.contains(Flags::REPARSED))
    })
}

/// `PositionsAreOnSameLine`
fn positions_are_on_same_line(text: &[u8], pos1: usize, pos2: usize) -> bool {
    (pos1.min(pos2)..pos1.max(pos2)).all(|at| super::spans::line_break_len(text, at) == 0)
}

/// An element of a list. `range`: `Pos()` and `End()` of the node it is emitted for, which locate
/// its comments.
pub(super) struct Element {
    pub(super) range: Option<(usize, usize)>,
    pub(super) text: Vec<u8>,
}

/// `ListFormat`, as far as `emitListItems` depends on it.
#[derive(Copy, Clone)]
pub(super) struct ListFormat {
    /// `LFMultiLine | LFIndented`, else `LFSingleLine | LFSpaceBetweenSiblings`.
    pub(super) is_multi_line: bool,
    /// `LFAllowTrailingComma`, for a list that has one.
    pub(super) has_trailing_comma: bool,
}

impl ListFormat {
    pub(super) const SINGLE_LINE: ListFormat = ListFormat {
        is_multi_line: false,
        has_trailing_comma: false,
    };
    pub(super) const MULTI_LINE: ListFormat = ListFormat {
        is_multi_line: true,
        has_trailing_comma: false,
    };
}

/// The subset of `EmitTextWriter` that a list with comments needs. `source`: the source text of the
/// file that contains the comments.
pub(super) struct Writer<'a> {
    source: &'a [u8],
    text: Vec<u8>,
    indent: usize,
    is_at_start_of_line: bool,
    /// `LFSpaceBetweenSiblings` of a list on several lines.
    pub(super) space_between_siblings: bool,
}

impl<'a> Writer<'a> {
    /// Its output continues a line indented by `indent` levels.
    pub(super) fn new(source: &'a [u8], indent: usize) -> Writer<'a> {
        Writer {
            source,
            text: Vec::new(),
            indent,
            is_at_start_of_line: false,
            space_between_siblings: false,
        }
    }

    pub(super) fn into_text(self) -> Vec<u8> {
        self.text
    }

    pub(super) fn write(&mut self, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        if std::mem::take(&mut self.is_at_start_of_line) {
            self.text.extend_from_slice(&b"    ".repeat(self.indent));
        }
        self.text.extend_from_slice(text);
    }

    pub(super) fn write_line(&mut self) {
        if !self.is_at_start_of_line {
            self.text.push(b'\n');
            self.is_at_start_of_line = true;
        }
    }

    /// `emitComment`
    fn emit_comment(&mut self, (start, end): (usize, usize)) {
        let mut written = Vec::new();
        write_comment_range(self.source, start, end, self.indent, &mut written);
        self.write(&written);
    }

    /// `emitLeadingComments`
    fn emit_leading_comments(&mut self, pos: usize) {
        let mut has_source_comment = false;
        for comment in super::spans::get_leading_comment_ranges(self.source, pos) {
            if !should_write_comment(&self.source[comment.0..comment.1]) {
                continue;
            }
            // `emitNewLineBeforeLeadingCommentOfPosition`
            if !std::mem::replace(&mut has_source_comment, true)
                && bun_core::strings::contains_char(&self.source[pos..comment.0], b'\n')
            {
                self.write_line();
            }
            self.emit_comment(comment);
            if has_trailing_new_line(self.source, comment.1) {
                self.write_line();
            } else {
                self.write(b" ");
            }
        }
    }

    /// `emitTrailingComments`, and `emitTrailingCommentsOfPosition` with `prefixSpace`. The scan for
    /// trailing comments stops at the line break, so a `/* */` has no `HasTrailingNewLine`.
    fn emit_trailing_comments(&mut self, end: usize) {
        for comment in super::spans::get_trailing_comment_ranges(self.source, end) {
            if !should_write_comment(&self.source[comment.0..comment.1]) {
                continue;
            }
            if !self.is_at_start_of_line {
                self.write(b" ");
            }
            self.emit_comment(comment);
        }
    }

    /// `emitTrailingCommentsOfPosition`, without `prefixSpace`: it writes every kind of comment.
    fn emit_trailing_comments_of_position(&mut self, pos: usize, force_no_newline: bool) {
        for comment in super::spans::get_trailing_comment_ranges(self.source, pos) {
            self.emit_comment(comment);
            let is_single_line = self.source[comment.0..].starts_with(b"//");
            if force_no_newline {
                if is_single_line {
                    self.write_line();
                }
            } else if is_single_line && has_trailing_new_line(self.source, comment.1) {
                self.write_line();
            } else {
                self.write(b" ");
            }
        }
    }

    /// `emitListItems`, between the opening and the closing token of the list. `delimiter`:
    /// `writeDelimiter`, `,` or ` |` or ` &`. `parent_end`: `End()` of the node that contains the
    /// list.
    pub(super) fn emit_list_items(
        &mut self,
        elements: &[Element],
        delimiter: &[u8],
        format: ListFormat,
        parent_end: usize,
    ) {
        let ListFormat {
            is_multi_line,
            has_trailing_comma,
        } = format;
        let mut should_emit_intervening_comments = !is_multi_line;
        if is_multi_line {
            self.write_line();
            self.indent += 1;
        }
        let mut previous: Option<(usize, usize)> = None;
        for (i, child) in elements.iter().enumerate() {
            if i != 0 {
                if let Some((_, end)) = previous.filter(|it| it.1 != parent_end) {
                    self.emit_leading_comments(end);
                }
                self.write(delimiter);
                if is_multi_line {
                    if should_emit_intervening_comments && let Some((pos, _)) = child.range {
                        if self.space_between_siblings {
                            self.emit_trailing_comments(pos);
                        } else {
                            self.emit_trailing_comments_of_position(pos, true);
                        }
                    }
                    self.write_line();
                    should_emit_intervening_comments = false;
                } else {
                    self.write(b" ");
                }
            }
            match child.range {
                Some((pos, _)) if should_emit_intervening_comments => {
                    self.emit_trailing_comments_of_position(pos, false);
                }
                _ => should_emit_intervening_comments = true,
            }
            if let Some((pos, _)) = child.range {
                self.emit_leading_comments(pos);
            }
            self.write(&child.text);
            if let Some((_, end)) = child.range.filter(|it| it.1 != parent_end) {
                self.emit_trailing_comments(end);
            }
            previous = child.range;
        }
        if has_trailing_comma {
            self.write(b",");
        } else if let Some((_, end)) = previous.filter(|it| it.1 != parent_end) {
            self.emit_leading_comments(end);
        }
        if is_multi_line {
            self.indent -= 1;
            self.write_line();
        }
    }

    /// `emitListItems` for `LFParameters` that are synthesized, as is their parent. `range` is the
    /// `CommentRange` of an element: `End()` of each is that of the parent, -1.
    pub(super) fn emit_synthesized_parameters(&mut self, elements: &[Element]) {
        for (i, child) in elements.iter().enumerate() {
            if i != 0 {
                self.write(b", ");
            }
            if let Some((pos, _)) = child.range {
                self.emit_trailing_comments_of_position(pos, false);
                self.emit_leading_comments(pos);
            }
            self.write(&child.text);
            if let Some((_, end)) = child.range {
                self.emit_trailing_comments(end);
            }
        }
    }
}

/// `writeCommentRangeWorker`, of a `/* */`.
fn write_comment_range(
    text: &[u8],
    start: usize,
    end: usize,
    indent: usize,
    written: &mut Vec<u8>,
) {
    // `calculateIndent`
    let indent_of = |line: &[u8]| {
        let mut indent = 0;
        for &b in line.iter().take_while(|&&b| b == b' ' || b == b'\t') {
            indent += if b == b'\t' { 4 - indent % 4 } else { 1 };
        }
        indent as isize
    };
    let line_start = strings::last_index_of_char(&text[..start], b'\n').map_or(0, |at| at + 1);
    let first_line_indent = indent_of(&text[line_start..start]);
    for (i, line) in bun_core::strings::split(&text[start..end], b"\n").enumerate() {
        if i != 0 {
            written.push(b'\n');
            let spaces = indent as isize * 4 - first_line_indent + indent_of(line);
            written.extend_from_slice(&b" ".repeat(spaces.max(0) as usize));
        }
        written.extend_from_slice(line.trim_ascii());
    }
}

/// `node.Pos()`, computed from the start of the node's first token: the end of the previous token,
/// or of a comment that trails that token.
pub(super) fn pos_before(text: &[u8], start: usize) -> usize {
    let mut at = start.min(text.len());
    loop {
        while at > 0 && text[at - 1].is_ascii_whitespace() {
            at -= 1;
        }
        if text[..at].ends_with(b"*/")
            && let Some(open) = strings::last_index_of(&text[..at - 2], b"/*")
        {
            at = open;
            continue;
        }
        // A line that contains only a comment.
        let line_start = strings::last_index_of_char(&text[..at], b'\n').map_or(0, |it| it + 1);
        let line = &text[line_start..at];
        match strings::index_of(line, b"//") {
            Some(slashes) if line[..slashes].trim_ascii().is_empty() => at = line_start + slashes,
            _ => return at,
        }
    }
}

/// Each with a space after it.
fn modifiers_text(modifiers: &[Flags]) -> Vec<u8> {
    let mut text = Vec::new();
    for modifier in modifiers {
        if let Some((_, word)) = MODIFIERS.iter().find(|it| it.0 == *modifier) {
            text.extend_from_slice(word);
            text.push(b' ');
        }
    }
    text
}

/// What `ensureModifierFlags` reads of the node whose modifiers it is given.
#[derive(Copy, Clone)]
enum ModifiedNode {
    /// `parentIsFile`
    InFile {
        /// `isAlwaysType`: it is an interface.
        is_always_type: bool,
    },
    Nested,
}

impl ModifiedNode {
    /// A node that is not an interface.
    fn new(parent_is_file: bool) -> Self {
        match parent_is_file {
            true => ModifiedNode::InFile {
                is_always_type: false,
            },
            false => ModifiedNode::Nested,
        }
    }
}

/// Whether the declaration file text is requested, not only the diagnostics.
#[derive(Copy, Clone, Default)]
enum Writes {
    /// All text is empty.
    #[default]
    No,
    Yes {
        /// `detachedCommentsInfo`: `nodePos`, `detachedCommentEndPos`.
        detached_comments: Option<(usize, usize)>,
    },
}

/// `DeclarationTransformer`
struct DeclarationEmit<'c, 'p, 's> {
    c: &'c mut Checker<'p, 's>,
    tracker: SymbolTrackerImpl,
    enclosing: Enclosing,
    suppresses_new_contexts: bool,
    in_class_expression: bool,
    /// `lateStatementReplacementMap`: the statements that have emitted output, and that output.
    written: FxHashMap<StmtId, Vec<Statement>>,
    writes: Writes,
    needs_declare: bool,
    needs_scope_fix_marker: bool,
    result_has_scope_marker: bool,
    result_has_external_module_indicator: bool,
    /// Current indentation level of the output.
    indent: usize,
    /// `generatedNames`
    generated_names: Vec<Vec<u8>>,
    /// `tempFlags & tempFlagsCountMask`
    temp_count: u32,
    cjs_export_assignment: Vec<Statement>,
    cjs_export_assignment_name: Option<Vec<u8>>,
    cjs_export_members: Vec<Statement>,
    witnessed_cjs_exports: Vec<Vec<u8>>,
    /// `expandoHosts` for the variables that are emitted as functions, keyed by statement.
    expando_hosts: FxHashMap<StmtId, Vec<Statement>>,
    /// `expandoMembers`, keyed by the statement of the host.
    expando_members: FxHashMap<StmtId, Vec<Statement>>,
}

impl Checker<'_, '_> {
    /// `shouldStripInternal` for a node of `file` that is not a parameter. `pos`: `node.Pos()`.
    pub(super) fn should_strip_internal(&self, file: FileId, pos: u32) -> bool {
        if !self.files().options.strips_internal_declarations {
            return false;
        }
        // `isInternalDeclaration`, `hasInternalAnnotation`
        let text = &self.hir(file).text[..];
        super::spans::get_leading_comment_ranges(text, pos as usize)
            .into_iter()
            .any(|(start, end)| strings::contains(&text[start..end], b"@internal"))
    }

    /// `shouldStripInternal` for the parameter `p` of `file`. `previous_sibling`: the parameter
    /// before it.
    fn should_strip_internal_parameter(
        &self,
        file: FileId,
        p: ParamId,
        previous_sibling: Option<ParamId>,
    ) -> bool {
        if !self.files().options.strips_internal_declarations {
            return false;
        }
        let hir = self.hir(file);
        let text = &hir.text[..];
        let pos = hir[p].loc.pos as usize;
        // `SkipTriviaEx`, with `StopAtComments`
        let mut trailing_pos = previous_sibling.map_or(pos, |it| hir[it].loc.end as usize + 1);
        let is_white_space = |b: &u8| matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C);
        while text.get(trailing_pos).is_some_and(is_white_space) {
            trailing_pos += 1;
        }
        let mut comments = super::spans::get_trailing_comment_ranges(text, trailing_pos);
        // "to handle `... parameters, /** @internal */ public param: string`"
        if previous_sibling.is_some() {
            comments.extend(super::spans::get_leading_comment_ranges(text, pos));
        }
        comments
            .last()
            .is_some_and(|&(start, end)| strings::contains(&text[start..end], b"@internal"))
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `getDeclarationDiagnosticsForFile`
    pub(super) fn check_declaration_emit(&mut self, file: FileId) {
        self.transform_declarations(file, false);
    }

    /// `emitDeclarationFile`: the text of the declaration file of `file`. `None`: there is none,
    /// because none is emitted for such a file (`sourceFileMayBeEmitted`) or because the
    /// transformer found a blocking error (`declBlocked`), which is reported.
    pub fn emit_declaration_file(&mut self, file: FileId) -> Option<Vec<u8>> {
        self.transform_declarations(file, true)
    }

    fn transform_declarations(&mut self, file: FileId, writes: bool) -> Option<Vec<u8>> {
        let files = self.files();
        let module = files.module(file);
        // `getDeclarationDiagnostics`: `getSourceFilesToEmit`, `isSourceFileNotJson`.
        if module.hir.kind == FileKind::Json
            || !source_file_may_be_emitted(files.options, module, files.is_case_sensitive)
        {
            return None;
        }
        // The `declarationLinks` of a new `EmitResolver`: what an earlier run of the transformer
        // painted (`addVisibleAlias`) is not visible when this one starts.
        self.emit_resolver_links.visibility.clear();
        // All these queries run after everything is checked: a cycle through here is not reported
        // as an error.
        let saved = self.relation_too_complex;
        self.eager.push(self.stack.len());
        let (text, found, isolated_declarations) = {
            let mut emit = DeclarationEmit::new(self, file);
            if writes {
                emit.writes = Writes::Yes {
                    detached_comments: None,
                };
            }
            let text = Some(emit.transform_source_file());
            (
                text,
                emit.tracker.diagnostics,
                emit.tracker.isolated_declarations,
            )
        };
        self.eager.pop();
        self.relation_too_complex = saved;
        // `emitDeclarationFile`: `emitSkipped`, if the transformer has diagnostics.
        let mut is_skipped = !found.is_empty();
        if let Some(isolated_declarations) = isolated_declarations {
            is_skipped |= isolated_declarations.has_diagnostics();
            self.finish_isolated_declarations(isolated_declarations);
        }
        self.declaration_indent = None;
        let mut text = text.filter(|_| writes && !is_skipped);
        // `getSourceMappingURL`, without `mapRoot`. Nothing follows it, not a line break either.
        if files.options.writes_declaration_maps
            && let Some(text) = &mut text
            && let Some(output) =
                crate::resolve::output_declaration_file_name(module.file_name(), None)
        {
            let name =
                &output[strings::last_index_of_char(&output, b'/').map_or(0, |slash| slash + 1)..];
            text.extend_from_slice(&[b"//# sourceMappingURL=", name, b".map"].concat());
        }
        for error in found {
            let Found {
                start,
                end,
                code,
                args,
                related,
            } = error;
            self.add_diagnostic(Reported::new((file, start, end), code, held(args)))
                .related_information = related;
        }
        text
    }
}

impl<'c, 'p, 's> DeclarationEmit<'c, 'p, 's> {
    fn new(c: &'c mut Checker<'p, 's>, file: FileId) -> DeclarationEmit<'c, 'p, 's> {
        let top = Enclosing::at_scope(file, ScopeId(0));
        let isolated_declarations = c.new_isolated_declarations(file);
        DeclarationEmit {
            c,
            tracker: SymbolTrackerImpl {
                current_source_file: file,
                diagnostics: Vec::new(),
                get_symbol_accessibility_diagnostic: Context::ForNode(Node::NONE),
                error_name_node: Node::NONE,
                fallback_stack: Vec::new(),
                late_marked_statements: Vec::new(),
                watched_class_symbol: None,
                class_symbol_tracked: false,
                isolated_declarations,
            },
            enclosing: top,
            suppresses_new_contexts: false,
            in_class_expression: false,
            written: FxHashMap::default(),
            writes: Writes::No,
            needs_declare: true,
            needs_scope_fix_marker: false,
            result_has_scope_marker: false,
            result_has_external_module_indicator: false,
            indent: 0,
            generated_names: Vec::new(),
            temp_count: 0,
            cjs_export_assignment: Vec::new(),
            cjs_export_assignment_name: None,
            cjs_export_members: Vec::new(),
            witnessed_cjs_exports: Vec::new(),
            expando_hosts: FxHashMap::default(),
            expando_members: FxHashMap::default(),
        }
    }

    fn file(&self) -> FileId {
        self.tracker.current_source_file
    }

    fn writes(&self) -> bool {
        matches!(self.writes, Writes::Yes { .. })
    }
}

/// What `isDeclarationVisible`, `getAccessibleSymbolChain`, `getAlternativeContainingModules`, `getExportsOfSymbol`,
/// `getSymbolTableAliases` and `getSpecifierForModuleSymbol` memoize.
#[derive(Default)]
pub(super) struct EmitResolverLinks {
    /// `declarationLinks.isVisible`
    visibility: FxHashMap<(FileId, Decl), bool>,

    // `symbolContainerLinks`, `symbolTableAliasCache`
    chains: FxHashMap<(Sym, FileId, ScopeId, Meaning), Rc<Vec<Sym>>>,
    containing_modules: FxHashMap<(Sym, FileId), Rc<Vec<Sym>>>,
    variable_matches: FxHashMap<(Sym, FileId, ScopeId), Rc<Vec<Sym>>>,
    exports: FxHashMap<Sym, Rc<Vec<(Atom, Sym)>>>,
    global_aliases: Option<Rc<Vec<(Atom, Sym)>>>,
    /// The locals of the blocks `enterNewScope` has pushed in front of the enclosing declaration,
    /// innermost first, for the duration of one symbol chain lookup from there. No symbol: it was
    /// created by `instantiateSymbol`.
    fake_locals: Vec<(Atom, SymFlags, Option<Sym>)>,
    /// `specifierCache`
    specifiers: FxHashMap<(Sym, FileId, ResolutionMode), Vec<u8>>,
}

impl EmitResolverLinks {
    /// `addVisibleAlias`
    pub(super) fn paint_visible(&mut self, file: FileId, decl: Decl) {
        let decl = match decl {
            Decl::Param(pat) | Decl::Require(pat) => Decl::Var(pat),
            decl => decl,
        };
        self.visibility.insert((file, decl), true);
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `lookupSymbolChain` for a symbol that is not a type parameter: whether the chain starts with
    /// `globalThis`, and the rest of it.
    /// `fake_locals`: the locals of the synthetic blocks `enterNewScope` has created around `at`.
    pub(super) fn lookup_symbol_chain_at(
        &mut self,
        symbol: Sym,
        is_value: bool,
        yield_module_symbol: YieldModuleSymbol,
        at: Enclosing,
        fake_locals: Vec<(Atom, SymFlags, Option<Sym>)>,
    ) -> (bool, Vec<Sym>) {
        let meaning = if is_value {
            Meaning::Value
        } else {
            Meaning::Type
        };
        // A nested query has its own locals.
        let outer = std::mem::replace(&mut self.emit_resolver_links.fake_locals, fake_locals);
        let mut chain =
            self.symbol_chain_ex(symbol, at, meaning, yield_module_symbol, EndOfChain::Yes);
        self.emit_resolver_links.fake_locals = outer;
        let starts_with_global_this =
            chain.len() > 1 && chain[0] == self.files().global_this_symbol;
        if starts_with_global_this {
            chain.remove(0);
        }
        (starts_with_global_this, chain)
    }

    /// `lookup_symbol_chain_at` for the symbol `cloneTypeAsModuleType` created for
    /// `originating_import`, with the value meaning.
    pub(super) fn lookup_symbol_chain_of_module_clone_at(
        &mut self,
        originating_import: Sym,
        yield_module_symbol: YieldModuleSymbol,
        at: Enclosing,
    ) -> (bool, Vec<Sym>) {
        let symbol = self.module_clone(originating_import);
        self.lookup_symbol_chain_at(symbol, true, yield_module_symbol, at, Vec::new())
    }

    /// `IsTypeSymbolAccessible`
    pub(super) fn is_type_symbol_accessible_at(&mut self, symbol: Sym, at: Enclosing) -> bool {
        self.is_any_symbol_accessible(&[symbol], at, symbol, Meaning::Type, false)
            .is_some_and(|access| access.is_accessible())
    }
}

// ───────────────────────────── symbols ─────────────────────────────

impl<'p, 's> Checker<'p, 's> {
    /// `IsSymbolAccessible(symbol, enclosingDeclaration, meaning, false)`. `meaning`, `with_export_value`: see `Meaning::of`.
    pub(super) fn is_symbol_accessible_at(
        &mut self,
        symbol: Sym,
        meaning: SymFlags,
        with_export_value: bool,
        at: Enclosing,
    ) -> bool {
        let meaning = Meaning::of(meaning, with_export_value);
        self.is_symbol_accessible(symbol, at, meaning, false)
            .is_accessible()
    }

    /// `isTriviallySerializableComputedName` for the computed property name `[name]` in `file`.
    pub(super) fn is_trivially_serializable_computed_name_at(
        &mut self,
        file: FileId,
        name: ExprId,
        at: Enclosing,
    ) -> bool {
        if !is_entity_name_expression(self.hir(file), name) {
            return false;
        }
        let Some((first, _)) = self.first_identifier(file, name) else {
            return false;
        };
        self.is_entity_name_visible(first, None, Meaning::ValueOfName, at, false)
            .is_accessible()
    }

    /// `exportTypeLinks.Get(symbol).target` of a symbol created by `cloneTypeAsModuleType`, which
    /// has the flags, the name, the declarations, the parent and the exports of its target. Any
    /// other symbol is returned unchanged.
    fn target_of_module_clone(&self, symbol: Sym) -> Sym {
        self.files()
            .target_of_module_clone(symbol)
            .unwrap_or(symbol)
    }

    /// The result of `resolveESModuleSymbol` for `originating_import`, the alias of an `import * as
    /// ns` that does not resolve to the module symbol itself.
    pub(super) fn module_clone(&self, originating_import: Sym) -> Sym {
        self.files()
            .module_clone(originating_import)
            .unwrap_or(originating_import)
    }

    pub(super) fn flags_of(&self, symbol: Sym) -> SymFlags {
        self.files().flags(self.target_of_module_clone(symbol))
    }

    fn decls_of(&self, symbol: Sym) -> Vec<(FileId, Decl)> {
        self.files().decls(self.target_of_module_clone(symbol))
    }

    fn name_of(&self, symbol: Sym) -> Atom {
        self.files()
            .symbol(self.target_of_module_clone(symbol))
            .name
    }

    /// `symbolToString`
    fn symbol_text(&mut self, symbol: Sym) -> Vec<u8> {
        if symbol == self.files().global_this_symbol {
            return b"globalThis".to_vec();
        }
        let symbol = self.target_of_module_clone(symbol);
        self.symbol_to_string(symbol)
    }

    /// `symbolToStringEx(symbol, enclosingDeclaration, meaning, SymbolFormatFlagsAllowAnyNodeKind)`
    fn symbol_to_string_ex(&mut self, symbol: Sym, at: Enclosing, meaning: Meaning) -> Vec<u8> {
        // `lookupSymbolChainWorker`
        let chain = if self.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER) {
            vec![symbol]
        } else {
            self.symbol_chain_ex(symbol, at, meaning, YieldModuleSymbol::No, EndOfChain::Yes)
        };
        // "add neverAsciiEscape for GH#39027"
        let escapes_non_ascii = self.node_of_enclosing_declaration(at) != Node::FILE;
        // `createExpressionFromSymbolChain`
        let mut expression = self.symbol_text(chain[0]);
        for &part in &chain[1..] {
            let name = self.symbol_text(part);
            let is_enum_member = self.flags_of(part).contains(SymFlags::ENUM_MEMBER);
            push_access(&mut expression, &name, is_enum_member, escapes_non_ascii);
        }
        expression
    }

    /// `enclosingDeclaration`, if it is one of the nodes of `isEnclosingDeclaration` that the
    /// source has.
    fn node_of_enclosing_declaration(&self, at: Enclosing) -> Node {
        if at.fake_scope != 0 || at.scope.is_none() {
            return Node::NONE;
        }
        let hir = self.hir(at.file);
        if at.variable.is_some() {
            return hir.node(at.variable);
        }
        match self.bound(at.file).scopes[at.scope.idx()].kind {
            ScopeKind::File => Node::FILE,
            ScopeKind::Module(m) => hir.node(m),
            ScopeKind::Fn(f) => hir.node(f),
            ScopeKind::Class(c) => hir.node(c),
            ScopeKind::Interface(i) => hir.node(i),
            ScopeKind::TypeAlias(a) => hir.node(a),
            _ => Node::NONE,
        }
    }

    /// `getParentOfSymbol`
    fn parent_of_symbol(&self, symbol: Sym) -> Option<Sym> {
        self.files()
            .parent_of_symbol(self.target_of_module_clone(symbol))
    }

    /// `core.Some(symbol.Declarations, hasNonGlobalAugmentationExternalModuleSymbol)`
    pub(super) fn is_external_module_symbol(&self, symbol: Sym) -> bool {
        self.files()
            .parts(self.target_of_module_clone(symbol))
            .iter()
            .any(|&part| self.is_external_module_part(part))
    }

    /// `is_external_module_symbol` for the symbol bound by a single file.
    fn is_external_module_part(&self, part: Sym) -> bool {
        let files = self.files();
        files.symbol(part).decls.iter().any(|&decl| match decl {
            // `IsExternalOrCommonJSModule`, which a JSON file is not.
            Decl::File => {
                files.module(part.file).is_module() && self.hir(part.file).kind != FileKind::Json
            }
            Decl::Module(m) => matches!(self.hir(part.file)[m].name, ModuleName::String(_)),
            _ => false,
        })
    }

    /// `getMergedSymbol(symbol.ExportSymbol)`
    fn export_symbol_of(&self, symbol: Sym) -> Option<Sym> {
        let id = self.files().symbol(symbol).export_symbol;
        id.is_some().then(|| self.files().sym(symbol.file, id))
    }

    /// `GetSourceFileOfModule`
    fn source_file_of_module(&self, symbol: Sym) -> Option<FileId> {
        if symbol == self.files().global_this_symbol {
            return None;
        }
        let files = self.files();
        let parts = files.parts(self.target_of_module_clone(symbol));
        let declares = |meaning: SymFlags| {
            parts
                .iter()
                .find(|&&part| files.symbol(part).flags.intersects(meaning))
        };
        // `SetValueDeclaration`: other kinds of value declarations take precedence over modules.
        declares(SymFlags::VALUE.difference(SymFlags::VALUE_MODULE))
            .or_else(|| declares(SymFlags::VALUE_MODULE))
            // `GetNonAugmentationDeclaration`
            .or_else(|| {
                parts
                    .iter()
                    .find(|&&part| !self.is_external_module_part(part))
            })
            .map(|part| part.file)
    }

    /// `core.FirstNonNil(symbol.Declarations, c.getExternalModuleContainer)`
    fn external_module_container_of_symbol(&self, symbol: Sym) -> Option<Sym> {
        if symbol == self.files().global_this_symbol {
            return None;
        }
        let declarations = self.files().decls_of(self.target_of_module_clone(symbol));
        declarations.iter().find_map(|&(file, decl)| {
            let scope = self.bound(file).scope_of_declaration(self.hir(file), decl);
            self.external_module_container(file, scope)
        })
    }

    /// `getExternalModuleContainer`
    fn external_module_container(&self, file: FileId, mut scope: ScopeId) -> Option<Sym> {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            if let ScopeKind::Module(m) = s.kind
                && !matches!(hir[m].name, ModuleName::Ident(_))
                && s.symbol.is_some()
            {
                return Some(files.sym(file, s.symbol));
            }
            scope = s.parent;
        }
        files
            .module(file)
            .is_module()
            .then(|| files.file_symbol(file))
    }

    /// `getSymbolIfSameReference(a, b) != nil`
    pub(super) fn is_same_reference(&mut self, a: Sym, b: Sym) -> bool {
        self.merged_resolved_symbol(a) == self.merged_resolved_symbol(b)
    }

    /// `compareSymbols`: by the position of their first declaration.
    pub(super) fn compare_symbols_of_chain(&self, a: Sym, b: Sym) -> std::cmp::Ordering {
        let place = |symbol: Sym| match self.decls_of(symbol).first() {
            Some(&(file, decl)) => {
                let start = self.declaration_name_start(file, decl).unwrap_or(0);
                (0, self.place_in_program_order(file, start))
            }
            None => (1, (false, 0, 0)),
        };
        place(a).cmp(&place(b)).then(a.cmp(&b))
    }

    fn compare_symbol_chains(&self, a: &[Sym], b: &[Sym]) -> std::cmp::Ordering {
        let mut order = a.len().cmp(&b.len());
        for (&x, &y) in a.iter().zip(b) {
            order = order.then_with(|| self.compare_symbols_of_chain(x, y));
        }
        order
    }

    /// `GetFirstIdentifier`: the name and its position.
    fn first_identifier(&self, file: FileId, e: ExprId) -> Option<(Atom, u32)> {
        let hir = self.hir(file);
        let first = &hir[first_identifier(hir, e)];
        match first.kind {
            ExprKind::Ident(name) => Some((name, first.pos)),
            _ => None,
        }
    }
}

// ───────────────────────────── visibility ─────────────────────────────

impl<'p, 's> Checker<'p, 's> {
    /// The statement of the declaration `decl`, or the statement that contains an import or an
    /// export specifier.
    fn statement_of(&self, file: FileId, decl: Decl) -> Option<StmtId> {
        let hir = self.hir(file);
        match decl {
            Decl::ImportDefault(i) | Decl::ImportNamespace(i) => hir[i].stmt.some(),
            Decl::ImportSpec(s) => hir[hir[s].import].stmt.some(),
            Decl::ExportSpec(s) => hir[hir[s].export].stmt.some(),
            Decl::ExportExpr(_) | Decl::UmdGlobal(_) => None,
            _ => self.files().statement_of_declaration(file, decl),
        }
    }

    /// `isDeclarationVisible` for a statement container: a file, the block of a namespace, or
    /// anything else.
    fn is_container_visible(&mut self, file: FileId, container: Parent) -> bool {
        match container {
            Parent::File => true,
            Parent::Module(m) => self.is_declaration_visible(file, Decl::Module(m)),
            _ => false,
        }
    }

    /// `isDeclarationVisible`
    /// `IsImplicitlyExportedJSDocDeclaration` for a type alias or a namespace with `flags` in
    /// `container`.
    fn is_implicitly_exported_jsdoc_declaration(
        &self,
        file: FileId,
        flags: Flags,
        container: Parent,
    ) -> bool {
        let module = self.files().module(file);
        flags.contains(Flags::REPARSED)
            && container == Parent::File
            && (module.is_module() || module.is_commonjs())
    }

    pub(super) fn is_declaration_visible(&mut self, file: FileId, decl: Decl) -> bool {
        // One cache entry per binding name, whichever kind of declaration it is.
        let decl = match decl {
            Decl::Param(pat) | Decl::Require(pat) => Decl::Var(pat),
            decl => decl,
        };
        if let Some(&known) = self.emit_resolver_links.visibility.get(&(file, decl)) {
            return known;
        }
        let is_visible = self.determine_if_declaration_is_visible(file, decl);
        self.emit_resolver_links
            .visibility
            .insert((file, decl), is_visible);
        is_visible
    }

    /// `determineIfDeclarationIsVisible`
    fn determine_if_declaration_is_visible(&mut self, file: FileId, decl: Decl) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (flags, container) = match decl {
            Decl::File | Decl::UmdGlobal(_) | Decl::TypeParam(_) => return true,
            Decl::Var(pat) => match bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => {
                    return self.is_declaration_visible(file, Decl::Var(outer));
                }
                PatParent::Param(p) => {
                    return self.is_function_visible(file, bound.param_fn[p.idx()]);
                }
                PatParent::None => return false,
                PatParent::Var(d) => {
                    let is_empty = match hir[pat].kind {
                        PatKind::Object(props) => props.is_empty(),
                        PatKind::Array(elems) => elems.is_empty(),
                        _ => false,
                    };
                    let statement = bound.var_stmt[d.idx()];
                    if is_empty || statement.is_none() {
                        return false;
                    }
                    // `GetDeclarationContainer`: the declarations in a loop header belong to the
                    // container of the loop.
                    let container = match bound.stmt_parent[statement.idx()] {
                        Parent::Stmt(around)
                            if matches!(
                                hir[around].kind,
                                StmtKind::For { .. }
                                    | StmtKind::ForIn { .. }
                                    | StmtKind::ForOf { .. }
                            ) =>
                        {
                            bound.stmt_parent[around.idx()]
                        }
                        container => container,
                    };
                    (hir[d].flags, container)
                }
            },
            Decl::Fn(_)
            | Decl::Class(_)
            | Decl::Interface(_)
            | Decl::Alias(_)
            | Decl::Enum(_)
            | Decl::Module(_)
            | Decl::ImportEquals(_) => {
                let Some(statement) = self.statement_of(file, decl) else {
                    return false;
                };
                let flags = match decl {
                    Decl::Fn(f) => hir[f].flags,
                    Decl::Class(c) => hir[c].flags,
                    Decl::Interface(i) => hir[i].flags,
                    Decl::Alias(a) => hir[a].flags,
                    Decl::Enum(e) => hir[e].flags,
                    Decl::Module(m) => hir[m].flags,
                    Decl::ImportEquals(i) => hir[i].flags,
                    _ => Flags::empty(),
                };
                (flags, bound.stmt_parent[statement.idx()])
            }
            Decl::ExportSpec(_) => {
                let Some(statement) = self.statement_of(file, decl) else {
                    return false;
                };
                let StmtKind::ExportNamed(export) = hir[statement].kind else {
                    return false;
                };
                return !hir[export].has_module_specifier
                    && self.is_container_visible(file, bound.stmt_parent[statement.idx()]);
            }
            _ => return false,
        };
        let is_module = self.files().module(file).is_module();
        if self.is_implicitly_exported_jsdoc_declaration(file, flags, container) {
            return true;
        }
        if let Decl::Module(m) = decl
            && self.is_external_module_augmentation(file, m)
        {
            return true;
        }
        let is_in_ambient_block = matches!(container, Parent::Module(around)
            if hir[around].flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration);
        if !flags.contains(Flags::EXPORT)
            && !(is_in_ambient_block && !matches!(decl, Decl::ImportEquals(_)))
        {
            // `IsGlobalSourceFile`
            return container == Parent::File && !is_module;
        }
        self.is_container_visible(file, container)
    }

    /// `isDeclarationVisible` for a function-like node. A type node is assumed to be in a visible
    /// position.
    fn is_function_visible(&mut self, file: FileId, f: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.fns[f.idx()].owner {
            FnOwner::Stmt(_) => self.is_declaration_visible(file, Decl::Fn(f)),
            FnOwner::Member(m) => {
                let is_signature = matches!(
                    hir[m].kind,
                    MemberKind::Constructor
                        | MemberKind::CallSignature
                        | MemberKind::ConstructSignature
                        | MemberKind::IndexSignature
                );
                if !is_signature && hir[m].flags.intersects(Flags::PRIVATE | Flags::PROTECTED) {
                    return false;
                }
                match bound.member_owner[m.idx()] {
                    MemberOwner::Class(c) => self.is_declaration_visible(file, Decl::Class(c)),
                    MemberOwner::Interface(i) => {
                        self.is_declaration_visible(file, Decl::Interface(i))
                    }
                    MemberOwner::TypeLiteral(_) => true,
                    MemberOwner::None => false,
                }
            }
            FnOwner::Type(_) => true,
            FnOwner::Expr(_) | FnOwner::None => false,
        }
    }

    /// `hasVisibleDeclarations`: `None` if some declaration of `symbol` is not and cannot be made
    /// visible, or else the statements that must be emitted to make it visible. `paints`:
    /// `shouldComputeAliasToMakeVisible`.
    pub(super) fn has_visible_declarations(
        &mut self,
        symbol: Sym,
        paints: bool,
    ) -> Option<Vec<(FileId, StmtId)>> {
        let mut aliases: Vec<(FileId, StmtId)> = Vec::new();
        let flags = self.flags_of(symbol);
        for (file, decl) in self.decls_of(symbol) {
            if self.is_declaration_visible(file, decl) {
                continue;
            }
            let (hir, bound) = (self.hir(file), self.bound(file));
            let statement = match decl {
                // `getAnyImportSyntax`, `IsLateVisibilityPaintedStatement`
                Decl::ImportDefault(_)
                | Decl::ImportNamespace(_)
                | Decl::ImportSpec(_)
                | Decl::ImportEquals(_)
                | Decl::Fn(_)
                | Decl::Class(_)
                | Decl::Interface(_)
                | Decl::Alias(_)
                | Decl::Enum(_)
                | Decl::Module(_) => {
                    let is_exported = match decl {
                        Decl::ImportEquals(i) => hir[i].flags,
                        Decl::Fn(f) => hir[f].flags,
                        Decl::Class(c) => hir[c].flags,
                        Decl::Interface(i) => hir[i].flags,
                        Decl::Alias(a) => hir[a].flags,
                        Decl::Enum(e) => hir[e].flags,
                        Decl::Module(m) => hir[m].flags,
                        _ => Flags::empty(),
                    }
                    .contains(Flags::EXPORT);
                    if is_exported {
                        return None;
                    }
                    self.statement_of(file, decl)?
                }
                Decl::Var(pat) | Decl::Require(pat) => {
                    // `WalkUpBindingElementsAndPatterns`
                    let root = root_pattern(bound, pat);
                    let PatParent::Var(d) = bound.pat_parent[root.idx()] else {
                        return None;
                    };
                    let is_element = root != pat;
                    // `const { a } = require("m")` in JavaScript
                    let is_import_like = flags.contains(SymFlags::ALIAS)
                        && hir.is_js
                        && matches!(bound.pat_parent[pat.idx()], PatParent::Prop(outer, _) | PatParent::Elem(outer, _)
                            if outer == root)
                        && !hir[d].flags.contains(Flags::EXPORT);
                    if is_element
                        && !is_import_like
                        && !flags.contains(SymFlags::BLOCK_SCOPED_VARIABLE)
                    {
                        return None;
                    }
                    let statement = bound.var_stmt[d.idx()];
                    // `ast.IsVariableStatement`: not a loop header, and not a catch variable.
                    if statement.is_none()
                        || !matches!(hir[statement].kind, StmtKind::Var(_))
                        || matches!(bound.stmt_parent[statement.idx()], Parent::Stmt(around)
                        if matches!(
                            hir[around].kind,
                            StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. }
                        ))
                    {
                        return None;
                    }
                    if hir[d].flags.contains(Flags::EXPORT) {
                        if is_element {
                            continue;
                        }
                        return None;
                    }
                    statement
                }
                _ => return None,
            };
            if !self.is_container_visible(file, bound.stmt_parent[statement.idx()]) {
                return None;
            }
            if paints {
                self.emit_resolver_links.paint_visible(file, decl);
                if !aliases.contains(&(file, statement)) {
                    aliases.push((file, statement));
                }
            }
        }
        Some(aliases)
    }

    /// `isEntityNameVisible` for a name that starts with the identifier `first`. `start`: its
    /// position in the file of `at`, for `ErrorNode`.
    pub(super) fn is_entity_name_visible(
        &mut self,
        first: Atom,
        start: Option<u32>,
        meaning: Meaning,
        at: Enclosing,
        should_compute_alias_to_make_visible: bool,
    ) -> Access {
        let found = self
            .resolve(at.file, at.scope, first, meaning.flags(), false)
            .unwrap_or(None);
        let mut result = Access {
            accessibility: Accessibility::NotResolved,
            symbol_name: self.atom_text(first),
            module_name: Vec::new(),
            error_node: start.map(|start| (start, self.end_of_name_at(at.file, start))),
        };
        let Some(symbol) = found else {
            return result;
        };
        if meaning == Meaning::Type && self.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER) {
            return Access::accessible(Vec::new());
        }
        match self.has_visible_declarations(symbol, should_compute_alias_to_make_visible) {
            Some(aliases) => Access::accessible(aliases),
            None => {
                result.accessibility = Accessibility::NotAccessible;
                result
            }
        }
    }

    /// `IsImportRequiredByAugmentation`
    fn is_import_required_by_augmentation(&self, file: FileId, i: ImportId) -> bool {
        let (import, files) = (&self.hir(file)[i], self.files());
        if !files.module(file).is_module() {
            return false;
        }
        let mode = files.mode_of_import(file, import.mode);
        let Some(module) = files.module_of_specifier_as(file, import.spec, mode) else {
            return false;
        };
        // `GetExternalModuleFileFromDeclaration`
        let target = files
            .decls_of(module)
            .iter()
            .find(|(_, decl)| matches!(decl, Decl::File))
            .map(|&(of, _)| of);
        let Some(target) = target.filter(|&target| target != file) else {
            return false;
        };
        // `file.Symbol` is the symbol the binder created. The exports an `export *` adds come from
        // the table of a merged module, which holds the merged symbols themselves.
        let bound = self.bound(file);
        bound
            .table(bound.symbols[bound.file_symbol.idx()].exports)
            .iter()
            .any(|&(_, id)| {
                let merged = files.sym(file, id);
                merged != (Sym { file, id })
                    && files.decls_of(merged).iter().any(|&(of, _)| of == target)
            })
    }
}

// ───────────────────────────── symbol accessibility ─────────────────────────────

impl<'p, 's> Checker<'p, 's> {
    /// `getExportsOfSymbol`
    pub(super) fn exports_of_symbol(&mut self, symbol: Sym) -> Rc<Vec<(Atom, Sym)>> {
        let symbol = self.target_of_module_clone(symbol);
        if let Some(known) = self.emit_resolver_links.exports.get(&symbol) {
            return Rc::clone(known);
        }
        let files = self.files();
        let exports = if symbol == files.global_this_symbol {
            Vec::new()
        } else if files.flags(symbol).intersects(SymFlags::MODULE) {
            // `getExportsOfModuleWorker`
            files.exports_of_module(symbol).to_vec()
        } else {
            files.exports(symbol)
        };
        let exports = Rc::new(exports);
        self.emit_resolver_links
            .exports
            .insert(symbol, Rc::clone(&exports));
        exports
    }

    /// `someSymbolTableInScope`: the tables, innermost first.
    fn tables_in_scope(&self, at: Enclosing) -> Vec<Table> {
        if at.is_none() {
            return vec![Table::Globals];
        }
        let files = self.files();
        let (hir, bound) = (self.hir(at.file), self.bound(at.file));
        let mut tables = Vec::new();
        let mut scope = at.scope;
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            // `bindFunctionExpression`: the name of a function expression is in no table. Here it
            // is alone in a scope around that of the function.
            let only = match bound.table(s.locals) {
                &[(_, only)] => bound.symbols[only.idx()].decls.first(),
                _ => None,
            };
            let holds_function_name =
                matches!(only, Some(&Decl::Fn(f)) if hir[f].kind == FnKind::Expr);
            match s.kind {
                // `IsGlobalSourceFile`: the declarations of a script are global.
                ScopeKind::File if s.symbol.is_none() => {}
                ScopeKind::Block if holds_function_name => {}
                ScopeKind::File | ScopeKind::Module(_) => {
                    tables.push(Table::Locals(at.file, scope));
                    if s.symbol.is_some() {
                        tables.push(Table::Exports(files.sym(at.file, s.symbol)));
                    }
                }
                ScopeKind::Enum(_) => {}
                // "Type parameters are bound into `members` lists so they can merge across declarations"
                ScopeKind::Class(class) => {
                    let symbol = bound.class_symbol[class.idx()];
                    // `getClassExpressionNameTable`: the locals of the scope around that of a named
                    // class expression, which comes next.
                    tables.push(Table::TypeMembers(files.sym(at.file, symbol)));
                }
                ScopeKind::Interface(interface) => {
                    let symbol = bound.interface_symbol[interface.idx()];
                    tables.push(Table::TypeMembers(files.sym(at.file, symbol)));
                }
                _ => tables.push(Table::Locals(at.file, scope)),
            }
            scope = s.parent;
        }
        tables.push(Table::Globals);
        tables
    }

    /// `symbols[name]` exactly as stored in the table: `mergeSymbol` merges into a clone, and a
    /// table that is not merged still holds the original.
    fn lookup(&mut self, table: Table, name: Atom) -> Option<Sym> {
        if name.is_none() {
            return None;
        }
        let files = self.files();
        match table {
            Table::Locals(file, scope) => {
                let bound = self.bound(file);
                bound
                    .lookup(bound.scopes[scope.idx()].locals, name)
                    .map(|id| Sym { file, id })
            }
            Table::TypeMembers(_) => {
                let parameters = self.symbols_in_table(table);
                let found = parameters.iter().find(|parameter| parameter.0 == name);
                found.map(|parameter| parameter.1)
            }
            // `bindClassLikeDeclaration`: `symbol.Exports[prototypeSymbol.Name] = prototypeSymbol`,
            // and `mergeSymbol` does not merge a value of a namespace with it.
            Table::Exports(symbol)
                if name == known::prototype && files.flags(symbol).contains(SymFlags::CLASS) =>
            {
                Some(files.prototype_symbol)
            }
            Table::Exports(symbol) => files.export_in_table(symbol, name),
            Table::ResolvedExports(symbol) if symbol != files.global_this_symbol => self
                .exports_of_symbol(symbol)
                .iter()
                .find(|export| export.0 == name)
                .map(|export| export.1),
            Table::ResolvedExports(_) | Table::Globals => files.globals.get(name).copied(),
        }
    }

    /// `symbols[symbol.Name]`
    fn lookup_symbol(&mut self, table: Table, symbol: Sym) -> Option<Sym> {
        self.lookup(table, self.name_of(symbol))
    }

    /// The symbols of `table`, each with its name in the table.
    fn symbols_in_table(&mut self, table: Table) -> Vec<(Atom, Sym)> {
        let files = self.files();
        match table {
            Table::Locals(file, scope) => {
                let bound = self.bound(file);
                bound
                    .table(bound.scopes[scope.idx()].locals)
                    .iter()
                    .map(|&(name, id)| (name, files.sym(file, id)))
                    .collect()
            }
            Table::TypeMembers(symbol) => {
                let mut parameters = Vec::new();
                for (file, decl) in self.decls_of(symbol) {
                    let hir = self.hir(file);
                    let Some(type_params) = decl.type_params_of_class_or_interface(hir) else {
                        continue;
                    };
                    for parameter in type_params.iter() {
                        let id = self.bound(file).type_param_symbol[parameter.idx()];
                        if id.is_some() {
                            parameters.push((hir[parameter].name, Sym { file, id }));
                        }
                    }
                }
                parameters
            }
            Table::Exports(symbol) => files.each_export(symbol).collect(),
            Table::ResolvedExports(symbol) if symbol != files.global_this_symbol => {
                self.exports_of_symbol(symbol).to_vec()
            }
            Table::ResolvedExports(_) | Table::Globals => files.globals.to_vec(),
        }
    }

    /// `getSymbolTableAliases`, each with its name in the table.
    fn aliases_in_table(&mut self, table: Table) -> Rc<Vec<(Atom, Sym)>> {
        let files = self.files();
        let is_globals = match table {
            Table::ResolvedExports(symbol) => symbol == files.global_this_symbol,
            table => table == Table::Globals,
        };
        if is_globals && let Some(known) = &self.emit_resolver_links.global_aliases {
            return Rc::clone(known);
        }
        let mut aliases = self.symbols_in_table(table);
        aliases.retain(|entry| files.flags(entry.1).contains(SymFlags::ALIAS));
        let aliases = Rc::new(aliases);
        if is_globals {
            self.emit_resolver_links.global_aliases = Some(Rc::clone(&aliases));
        }
        aliases
    }

    /// `getAccessibleSymbolChain`. Empty: there is none.
    fn accessible_symbol_chain(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
    ) -> Rc<Vec<Sym>> {
        let mut visited = Vec::new();
        self.accessible_symbol_chain_ex(symbol, at, meaning, &mut visited)
    }

    /// `getAccessibleSymbolChainEx`. `visited`: `visitedSymbolTablesMap`.
    fn accessible_symbol_chain_ex(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        visited: &mut Vec<(Sym, Table)>,
    ) -> Rc<Vec<Sym>> {
        // A result found past the locals of a synthetic block is valid for that block only.
        let is_cached = self.emit_resolver_links.fake_locals.is_empty();
        let key = (symbol, at.file, at.scope, meaning);
        if is_cached && let Some(known) = self.emit_resolver_links.chains.get(&key) {
            return Rc::clone(known);
        }
        let mut result = Vec::new();
        let lookup = TableLookup {
            ignores_qualification: false,
            is_local_name_lookup: true,
        };
        for table in self.tables_in_scope(at) {
            result = self.chain_from_table(symbol, at, meaning, table, lookup, visited);
            if !result.is_empty() {
                break;
            }
        }
        let result = Rc::new(result);
        if is_cached {
            self.emit_resolver_links
                .chains
                .insert(key, Rc::clone(&result));
        }
        result
    }

    /// `getAccessibleSymbolChainFromSymbolTable`
    fn chain_from_table(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        table: Table,
        lookup: TableLookup,
        visited: &mut Vec<(Sym, Table)>,
    ) -> Vec<Sym> {
        // `symbolTableIDFromMembers` and the like, then `symId`.
        if let Table::TypeMembers(of) | Table::Exports(of) | Table::ResolvedExports(of) = table {
            self.get_symbol_id(of);
        }
        self.get_symbol_id(symbol);
        if visited.contains(&(symbol, table)) {
            return Vec::new();
        }
        visited.push((symbol, table));
        let result = self.try_symbol_table(symbol, at, meaning, table, lookup, visited);
        visited.retain(|&entry| entry != (symbol, table));
        result
    }

    /// `trySymbolTable`
    fn try_symbol_table(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        table: Table,
        lookup: TableLookup,
        visited: &mut Vec<(Sym, Table)>,
    ) -> Vec<Sym> {
        let ignores_qualification = lookup.ignores_qualification;
        let res = self.lookup_symbol(table, symbol);
        if let Some(res) = res
            && self.is_accessible(
                symbol,
                at,
                meaning,
                res,
                None,
                ignores_qualification,
                visited,
            )
        {
            return vec![symbol];
        }
        let mut candidates: Vec<Vec<Sym>> = Vec::new();
        if let Some(export_symbol) = res.and_then(|res| self.export_symbol_of(res))
            && self.is_accessible(
                symbol,
                at,
                meaning,
                export_symbol,
                None,
                ignores_qualification,
                visited,
            )
        {
            candidates.push(vec![symbol]);
        }
        for alias in self.aliases_to_try(table, at, lookup) {
            let Some(resolved) = self.resolve_alias_or_unknown(alias) else {
                continue;
            };
            let candidate = self.candidate_list_for_symbol(
                symbol,
                at,
                meaning,
                alias,
                resolved,
                ignores_qualification,
                visited,
            );
            if !candidate.is_empty() {
                candidates.push(candidate);
            }
        }
        if !candidates.is_empty() {
            // The first of the shortest chains.
            candidates.sort_by(|a, b| self.compare_symbol_chains(a, b));
            return candidates.swap_remove(0);
        }
        if table == Table::Globals {
            let global_this = self.files().global_this_symbol;
            return self.candidate_list_for_symbol(
                symbol,
                at,
                meaning,
                global_this,
                global_this,
                ignores_qualification,
                visited,
            );
        }
        Vec::new()
    }

    /// The aliases of `table` that `trySymbolTable` resolves.
    fn aliases_to_try(&mut self, table: Table, at: Enclosing, lookup: TableLookup) -> Vec<Sym> {
        let TableLookup {
            ignores_qualification,
            is_local_name_lookup,
        } = lookup;
        let is_in_module = !at.is_none() && self.hir(at.file).has_module_syntax;
        let mut aliases = Vec::new();
        for &(name, alias) in self.aliases_in_table(table).iter() {
            if name == known::export_equals || name == known::default {
                continue;
            }
            let decls = self.decls_of(alias);
            // `isUMDExportSymbol`
            if is_in_module && matches!(decls.first(), Some((_, Decl::UmdGlobal(_)))) {
                continue;
            }
            // `isNamespaceReexportDeclaration`
            if is_local_name_lookup && decls.iter().any(|d| matches!(d.1, Decl::ExportStarAs(_))) {
                continue;
            }
            if !ignores_qualification && decls.iter().any(|d| matches!(d.1, Decl::ExportSpec(_))) {
                continue;
            }
            aliases.push(alias);
        }
        aliases
    }

    /// `getAccessibleSymbolChain(property, enclosingDeclaration, SymbolFlagsNone, ..)`. A property is in no table, so the chain is
    /// an alias that resolves to it.
    #[cfg(feature = "baselines")]
    pub(super) fn accessible_alias_of_property(
        &mut self,
        property: &Prop,
        at: Enclosing,
    ) -> Option<Sym> {
        // `isPropertyOrMethodDeclarationSymbol`
        let is_property_or_method_declaration = match &property.source {
            PropSource::Symbol(symbol) => {
                let list = self.members_of_symbol(*symbol);
                !list.is_empty()
                    && list.iter().all(|&(file, member)| {
                        let is_in_class = matches!(
                            self.bound(file).member_owner[member.idx()],
                            MemberOwner::Class(_)
                        );
                        match self.hir(file)[member].kind {
                            MemberKind::Getter | MemberKind::Setter => true,
                            MemberKind::Property | MemberKind::Method => is_in_class,
                            _ => false,
                        }
                    })
            }
            PropSource::Literal(file, written) => matches!(
                self.hir(*file)[*written].kind,
                PropKind::Method | PropKind::Getter | PropKind::Setter
            ),
            _ => false,
        };
        if is_property_or_method_declaration {
            return None;
        }
        let lookup = TableLookup {
            ignores_qualification: false,
            is_local_name_lookup: true,
        };
        for table in self.tables_in_scope(at) {
            let mut candidates = Vec::new();
            for alias in self.aliases_to_try(table, at, lookup) {
                if self.property_of_alias(alias) == Some(property)
                    && self.can_qualify_symbol(at, alias, Meaning::None, &mut Vec::new())
                {
                    candidates.push(alias);
                }
            }
            candidates.sort_by(|&a, &b| self.compare_symbols_of_chain(a, b));
            if let Some(&first) = candidates.first() {
                return Some(first);
            }
        }
        None
    }

    /// `resolveAlias`. `None`: a property, which has no `Sym`.
    fn resolve_alias_or_unknown(&mut self, alias: Sym) -> Option<Sym> {
        match self.resolve_alias(alias) {
            AliasTarget::Symbol(target) => Some(target),
            AliasTarget::Property(..) => None,
            AliasTarget::Unknown => Some(self.files().unknown_symbol),
        }
    }

    /// `getCandidateListForSymbol`
    fn candidate_list_for_symbol(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        from_table: Sym,
        resolved: Sym,
        ignores_qualification: bool,
        visited: &mut Vec<(Sym, Table)>,
    ) -> Vec<Sym> {
        if self.is_accessible(
            symbol,
            at,
            meaning,
            from_table,
            Some(resolved),
            ignores_qualification,
            visited,
        ) {
            return vec![from_table];
        }
        let from_exports = self.chain_from_table(
            symbol,
            at,
            meaning,
            Table::ResolvedExports(resolved),
            TableLookup {
                ignores_qualification: true,
                is_local_name_lookup: false,
            },
            visited,
        );
        if from_exports.is_empty()
            || !self.can_qualify_symbol(at, from_table, meaning.left(), visited)
        {
            return Vec::new();
        }
        let mut chain = vec![from_table];
        chain.extend(from_exports);
        chain
    }

    /// `isAccessible`
    fn is_accessible(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        from_table: Sym,
        resolved: Option<Sym>,
        ignores_qualification: bool,
        visited: &mut Vec<(Sym, Table)>,
    ) -> bool {
        let merged = self.files().canonical(from_table);
        if symbol != merged && Some(symbol) != resolved {
            return false;
        }
        !self.is_external_module_symbol(from_table)
            && (ignores_qualification || self.can_qualify_symbol(at, merged, meaning, visited))
    }

    /// `canQualifySymbol`
    fn can_qualify_symbol(
        &mut self,
        at: Enclosing,
        from_table: Sym,
        meaning: Meaning,
        visited: &mut Vec<(Sym, Table)>,
    ) -> bool {
        if !self.needs_qualification(from_table, at, meaning) {
            return true;
        }
        match self.parent_of_symbol(from_table) {
            Some(parent) => !self
                .accessible_symbol_chain_ex(parent, at, meaning.left(), visited)
                .is_empty(),
            None => false,
        }
    }

    /// `needsQualification`
    fn needs_qualification(&mut self, symbol: Sym, at: Enclosing, meaning: Meaning) -> bool {
        let name = self.name_of(symbol);
        for &(local, flags, found) in &self.emit_resolver_links.fake_locals {
            if local == name && found == Some(symbol) {
                return false;
            }
            if local == name && flags.intersects(meaning.flags()) {
                return true;
            }
        }
        for table in self.tables_in_scope(at) {
            let Some(found) = self.lookup_symbol(table, symbol) else {
                continue;
            };
            let found = self.files().canonical(found);
            if found == symbol {
                return false;
            }
            let flags = self.flags_of(found);
            let resolves_alias = flags.contains(SymFlags::ALIAS)
                && !self
                    .decls_of(found)
                    .iter()
                    .any(|d| matches!(d.1, Decl::ExportSpec(_)));
            // `getSymbolFlags(resolveAlias(symbolFromSymbolTable))`: what is merged with the alias
            // does not count. `unknownSymbol` is a property.
            let flags = if resolves_alias {
                self.flags_of_alias_target(found)
                    .unwrap_or(SymFlags::PROPERTY)
            } else {
                flags
            };
            if flags.intersects(meaning.flags()) {
                return true;
            }
        }
        false
    }

    /// `getAliasForSymbolInContainer`
    fn alias_for_symbol_in_container(&mut self, container: Sym, symbol: Sym) -> Option<Sym> {
        if Some(container) == self.parent_of_symbol(symbol) {
            return Some(symbol);
        }
        if container == self.files().global_this_symbol {
            return None;
        }
        if let Some(equals) = self.files().export(container, known::export_equals)
            && self.is_same_reference(equals, symbol)
        {
            return Some(container);
        }
        let exports = self.exports_of_symbol(container);
        let name = self.name_of(symbol);
        if let Some(quick) = exports.iter().find(|export| export.0 == name)
            && self.is_same_reference(quick.1, symbol)
        {
            return Some(quick.1);
        }
        let mut same = Vec::new();
        for &(_, exported) in exports.iter() {
            if self.is_same_reference(exported, symbol) {
                same.push(exported);
            }
        }
        same.into_iter()
            .min_by(|&a, &b| self.compare_symbols_of_chain(a, b))
    }

    /// `getAlternativeContainingModules`
    fn alternative_containing_modules(&mut self, symbol: Sym, at: Enclosing) -> Rc<Vec<Sym>> {
        if let Some(known) = self
            .emit_resolver_links
            .containing_modules
            .get(&(symbol, at.file))
        {
            return Rc::clone(known);
        }
        let files = self.files();
        let mut results = Vec::new();
        // `resolveExternalModuleName(enclosingDeclaration, importRef)`: the location is not a
        // specifier, so the module is resolved in the default mode of the file. An import that was
        // resolved in another mode (`module: commonjs` with `bundler`) is not found.
        let mode = self.files().default_resolution_mode_for_file(at.file);
        for &specifier in &self.bound(at.file).specifiers {
            if let Some(module) = files.module_of_specifier_as(at.file, specifier, mode)
                && self.alias_for_symbol_in_container(module, symbol).is_some()
            {
                results.push(module);
            }
        }
        if results.is_empty() {
            // `c.program.SourceFiles()`
            for &file in files.order {
                let module = files.module(file);
                // A leaf file exports no alias. The task that checks it frees its HIR
                // (`Files::free_tree`). Test `is_leaf`, which is immutable after loading, before
                // reading `hir`.
                if module.is_leaf && self.task.file != Some(file) {
                    continue;
                }
                if !module.hir.has_module_syntax {
                    continue;
                }
                let module = files.file_symbol(file);
                if self.alias_for_symbol_in_container(module, symbol).is_some() {
                    results.push(module);
                }
            }
        }
        let results = Rc::new(results);
        self.emit_resolver_links
            .containing_modules
            .insert((symbol, at.file), Rc::clone(&results));
        results
    }

    /// "look for a variable in scope with the container's type which may be acting like a namespace (eg, `Symbol` acts like a namespace
    /// when looking up `Symbol.toStringTag`)"
    fn variable_matches(
        &mut self,
        container: Sym,
        at: Enclosing,
        meaning: Meaning,
    ) -> Rc<Vec<Sym>> {
        let flags = self.flags_of(container);
        if meaning != Meaning::Value
            || flags.intersects(SymFlags::VALUE)
            || !flags.intersects(SymFlags::TYPE)
        {
            return Rc::default();
        }
        let key = (container, at.file, at.scope);
        if let Some(known) = self.emit_resolver_links.variable_matches.get(&key) {
            return Rc::clone(known);
        }
        let declared = self.declared_type(container);
        let mut matches = Vec::new();
        if self.is_object_type(declared) {
            for table in self.tables_in_scope(at) {
                for (_, symbol) in self.symbols_in_table(table) {
                    if self.flags_of(symbol).intersects(SymFlags::VALUE)
                        && self.type_of_symbol(symbol) == declared
                    {
                        matches.push(symbol);
                    }
                }
                if !matches.is_empty() {
                    break;
                }
            }
            matches.sort_by(|&a, &b| self.compare_symbols_of_chain(a, b));
        }
        let matches = Rc::new(matches);
        self.emit_resolver_links
            .variable_matches
            .insert(key, Rc::clone(&matches));
        matches
    }

    /// `getWithAlternativeContainers`
    fn with_alternative_containers(
        &mut self,
        container: Sym,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
    ) -> Vec<Sym> {
        // `getFileSymbolIfFileSymbolExportEqualsContainer`
        let mut additional = Vec::new();
        if let Some(module) = self.external_module_container_of_symbol(container)
            && let Some(equals) = self.files().export(module, known::export_equals)
            && self.is_same_reference(equals, container)
        {
            additional.push(module);
        }
        // FOR SPEED: no module exports a member.
        let reexports = match at.is_none() || self.is_member_symbol(symbol) {
            true => Rc::default(),
            false => self.alternative_containing_modules(symbol, at),
        };
        let is_in_scope = !at.is_none()
            && self.flags_of(container).intersects(meaning.left().flags())
            && !self
                .accessible_symbol_chain(container, at, Meaning::Namespace)
                .is_empty();
        let object_literal_container = match self.decls_of(container).first() {
            Some(&(file, first)) if meaning.flags().intersects(SymFlags::VALUE) => {
                self.variable_declaration_of_object_literal(file, first)
            }
            _ => None,
        };
        let mut result = Vec::with_capacity(2 + additional.len() + reexports.len());
        // The real container comes first if it is in scope.
        if is_in_scope {
            result.push(container);
            result.extend(additional);
            result.extend(reexports.iter().copied());
            result.extend(object_literal_container);
        } else {
            result.extend(self.variable_matches(container, at, meaning).iter());
            result.extend(additional);
            result.push(container);
            result.extend(object_literal_container);
            result.extend(reexports.iter().copied());
        }
        result
    }

    /// The part of `getContainersOfSymbol` for the class expression `e` on the right of `a.b = class ..`: the module for
    /// `module.exports = ..` and `exports.b = ..`, otherwise what `a` resolves to.
    fn container_of_assigned_class_expression(&self, file: FileId, e: ExprId) -> Option<Sym> {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let Parent::Expr(assignment) = bound.expr_parent[e.idx()] else {
            return None;
        };
        if assignment.is_none() {
            return None;
        }
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[assignment].kind
        else {
            return None;
        };
        if value != e
            || is_parenthesized(self.hir(file), e)
            || is_parenthesized(self.hir(file), target)
        {
            return None;
        }
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[target].kind else {
            return None;
        };
        if !is_entity_name_expression(self.hir(file), obj) {
            return None;
        }
        // `IsModuleExportsAccessExpression(left) || IsExportsIdentifier(left.Expression())`
        if crate::bind::is_module_exports(hir, target)
            || matches!(hir[obj].kind, ExprKind::Ident(known::exports))
        {
            return files
                .module(file)
                .is_module()
                .then(|| files.file_symbol(file));
        }
        match hir[obj].kind {
            ExprKind::Ident(name) => self.symbol_of_identifier(file, obj, name),
            _ => None,
        }
    }

    /// `getContainersOfSymbol`
    fn containers_of_symbol(&mut self, symbol: Sym, at: Enclosing, meaning: Meaning) -> Vec<Sym> {
        if let Some(container) = self.parent_of_symbol(symbol)
            && !self.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER)
        {
            return self.with_alternative_containers(container, symbol, at, meaning);
        }
        let files = self.files();
        let mut candidates: Vec<Sym> = Vec::new();
        for (file, decl) in self.decls_of(symbol) {
            // `IsAmbientModule`
            if matches!(decl, Decl::Module(m) if !matches!(self.hir(file)[m].name, ModuleName::Ident(_)))
                || matches!(
                    decl,
                    Decl::ImportDefault(_)
                        | Decl::ImportNamespace(_)
                        | Decl::ImportSpec(_)
                        | Decl::ExportSpec(_)
                )
            {
                continue;
            }
            if let Decl::Class(class) = decl
                && let ClassOwner::Expr(e) = self.bound(file).class_owner[class.idx()]
            {
                if let Some(candidate) = self.container_of_assigned_class_expression(file, e)
                    && !candidates.contains(&candidate)
                {
                    candidates.push(candidate);
                }
                continue;
            }
            let Some(statement) = self.statement_of(file, decl) else {
                continue;
            };
            let bound = self.bound(file);
            let candidate = match bound.stmt_parent[statement.idx()] {
                // A direct child of a module.
                Parent::File if files.module(file).is_module() => files.file_symbol(file),
                Parent::Module(m) => {
                    let module = files.sym(file, bound.module_symbol[m.idx()]);
                    // The `export =` target of an ambient module.
                    if files.module_value(module) != symbol {
                        continue;
                    }
                    module
                }
                _ => continue,
            };
            if !candidates.contains(&candidate) {
                candidates.push(candidate);
            }
        }
        let (mut best, mut alternatives) = (Vec::new(), Vec::new());
        for container in candidates {
            if self
                .alias_for_symbol_in_container(container, symbol)
                .is_none()
            {
                continue;
            }
            let all = self.with_alternative_containers(container, symbol, at, meaning);
            if let Some((&first, rest)) = all.split_first() {
                best.push(first);
                alternatives.extend_from_slice(rest);
            }
        }
        best.extend(alternatives);
        best
    }

    /// `IsAnySymbolAccessible`. `paints`: `shouldComputeAliasesToMakeVisible`.
    fn is_any_symbol_accessible(
        &mut self,
        symbols: &[Sym],
        at: Enclosing,
        initial: Sym,
        meaning: Meaning,
        paints: bool,
    ) -> Option<Access> {
        if self.is_stack_low() {
            return None;
        }
        let mut had_accessible_chain = None;
        let mut early_module_bail = false;
        for &symbol in symbols {
            let chain = self.accessible_symbol_chain(symbol, at, meaning);
            if let Some(&first) = chain.first() {
                had_accessible_chain = Some(symbol);
                if let Some(aliases) = self.has_visible_declarations(first, paints) {
                    return Some(Access::accessible(aliases));
                }
            }
            // A module symbol, under any meaning, can be emitted as an `import` type.
            if self.is_external_module_symbol(symbol) {
                if paints {
                    early_module_bail = true;
                    continue;
                }
                return Some(Access::accessible(Vec::new()));
            }
            let containers = self.containers_of_symbol(symbol, at, meaning);
            let next = if initial == symbol {
                meaning.left()
            } else {
                meaning
            };
            let of_parent = self.is_any_symbol_accessible(&containers, at, initial, next, paints);
            if of_parent.is_some() {
                return of_parent;
            }
        }
        if early_module_bail {
            return Some(Access::accessible(Vec::new()));
        }
        let had = had_accessible_chain?;
        let module_name = if had != initial {
            self.symbol_to_string_ex(had, at, Meaning::Namespace)
        } else {
            Vec::new()
        };
        Some(Access {
            accessibility: Accessibility::NotAccessible,
            symbol_name: self.symbol_to_string_ex(initial, at, meaning),
            module_name,
            error_node: None,
        })
    }

    /// `IsSymbolAccessible`
    pub(super) fn is_symbol_accessible(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        paints: bool,
    ) -> Access {
        if let Some(result) = self.is_any_symbol_accessible(&[symbol], at, symbol, meaning, paints)
        {
            return result;
        }
        self.inaccessible(symbol, at, meaning)
    }

    /// The end of `isSymbolAccessibleWorker`: `symbol` is not exported from its module, or is in another module and has no alias.
    fn inaccessible(&mut self, symbol: Sym, at: Enclosing, meaning: Meaning) -> Access {
        let mut result = Access {
            accessibility: Accessibility::NotAccessible,
            symbol_name: self.symbol_to_string_ex(symbol, at, meaning),
            module_name: Vec::new(),
            error_node: None,
        };
        if let Some(module) = self.external_module_container_of_symbol(symbol)
            && Some(module) != self.external_module_container(at.file, at.scope)
        {
            result.accessibility = Accessibility::CannotBeNamed;
            result.module_name = self.symbol_text(module);
            // `ErrorNode`
            let enclosing_declaration = self.node_of_enclosing_declaration(at);
            if enclosing_declaration.is_some() && self.hir(at.file).is_js {
                let range = self.get_error_range_for_node(at.file, enclosing_declaration);
                result.error_node = Some(range);
            }
        }
        result
    }
}

// ───────────────────────────── `SymbolTracker` ─────────────────────────────

impl SymbolTrackerImpl {
    /// `GetTextOfNode`
    fn text(&self, c: &Checker<'_, '_>, node: Node) -> Vec<u8> {
        let file = self.current_source_file;
        c.source_text(file, c.hir(file).start(node), c.end_of_node(file, node))
    }

    fn add_diagnostic(&mut self, range: (u32, u32), code: u32, args: Vec<Vec<u8>>) {
        self.diagnostics.push(Found {
            start: range.0,
            end: range.1,
            code,
            args,
            related: Vec::new(),
        });
    }

    /// `getSymbolAccessibilityDiagnostic`: `diagnosticMessage`, `typeName`, `errorNode`. `None`: no diagnostic is reported.
    fn accessibility_diagnostic(
        &self,
        c: &Checker<'_, '_>,
        access: &Access,
    ) -> Option<(u32, Node, Node)> {
        let hir = c.hir(self.current_source_file);
        let has_module = !access.module_name.is_empty();
        // `selectDiagnosticBasedOnModuleName`
        let by_module = |[not_nameable, private_module, private_name]: [u32; 3]| {
            if !has_module {
                private_name
            } else if access.accessibility == Accessibility::CannotBeNamed {
                not_nameable
            } else {
                private_module
            }
        };
        // `selectDiagnosticBasedOnModuleNameNoNameCheck`
        let no_name_check = |[private_module, private_name]: [u32; 2]| match has_module {
            true => private_module,
            false => private_name,
        };
        // The codes for a static member, for any other member of a class declaration, and for the
        // rest.
        let by_place = |member: Node, of_static: [u32; 3], in_class: [u32; 3], other: [u32; 2]| {
            if hir.is_static(member) {
                by_module(of_static)
            } else if hir.kind(hir.parent(member)) == Kind::ClassDeclaration {
                by_module(in_class)
            } else {
                no_name_check(other)
            }
        };
        let (node, is_for_name) = match self.get_symbol_accessibility_diagnostic {
            Context::ForNode(node) => (node, false),
            Context::ForNodeName(node) => (node, true),
            Context::DefaultExport(node) => return Some((4082, Node::NONE, node)),
            Context::ExtendsClause(node) => {
                return Some((4020, hir.name(hir.parent(hir.parent(node))), node));
            }
        };
        let (kind, parent, name) = (
            hir.kind(node),
            hir.parent(node),
            get_name_of_declaration(hir, node),
        );
        let of_property = || by_place(node, [4026, 4027, 4028], [4029, 4030, 4031], [4032, 4033]);
        Some(match kind {
            // `getVariableDeclarationTypeVisibilityDiagnosticMessage`
            Kind::VariableDeclaration | Kind::BindingElement => {
                (by_module([4023, 4024, 4025]), name, node)
            }
            Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::PropertyAccessExpression
            | Kind::ElementAccessExpression
            | Kind::BinaryExpression => (of_property(), name, node),
            // `getAccessorNameVisibilityDiagnosticMessage`
            Kind::GetAccessor | Kind::SetAccessor if is_for_name => (of_property(), name, node),
            // `getMethodNameVisibilityDiagnosticMessage`
            Kind::MethodDeclaration | Kind::MethodSignature if is_for_name => {
                let code = by_place(node, [4095, 4096, 4097], [4098, 4099, 4100], [4101, 4102]);
                (code, name, node)
            }
            // `getAccessorDeclarationTypeVisibilityDiagnosticMessage`
            Kind::SetAccessor if hir.is_static(node) => (no_name_check([4034, 4035]), name, name),
            Kind::SetAccessor => (no_name_check([4036, 4037]), name, name),
            Kind::GetAccessor if hir.is_static(node) => (by_module([4038, 4039, 4040]), name, name),
            Kind::GetAccessor => (by_module([4041, 4042, 4043]), name, name),
            // `getReturnTypeVisibilityDiagnosticMessage`, at the name, or else at the whole node.
            Kind::ConstructSignature
            | Kind::CallSignature
            | Kind::IndexSignature
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::FunctionDeclaration => {
                let code = match kind {
                    Kind::ConstructSignature => no_name_check([4044, 4045]),
                    Kind::CallSignature => no_name_check([4046, 4047]),
                    Kind::IndexSignature => no_name_check([4048, 4049]),
                    Kind::FunctionDeclaration => by_module([4058, 4059, 4060]),
                    _ => by_place(node, [4050, 4051, 4052], [4053, 4054, 4055], [4056, 4057]),
                };
                (code, Node::NONE, if name.is_some() { name } else { node })
            }
            // A parameter property of a private constructor.
            Kind::Parameter
                if hir.is_parameter_property_declaration(node)
                    && hir.flags(parent).contains(Flags::PRIVATE) =>
            {
                (by_module([4029, 4030, 4031]), name, node)
            }
            // `getParameterDeclarationTypeVisibilityDiagnosticMessage`
            Kind::Parameter => {
                let code = match hir.kind(parent) {
                    Kind::Constructor => by_module([4061, 4062, 4063]),
                    Kind::ConstructSignature | Kind::ConstructorType => no_name_check([4064, 4065]),
                    Kind::CallSignature => no_name_check([4066, 4067]),
                    Kind::IndexSignature => no_name_check([4091, 4092]),
                    Kind::MethodDeclaration | Kind::MethodSignature => {
                        by_place(parent, [4068, 4069, 4070], [4071, 4072, 4073], [4074, 4075])
                    }
                    Kind::FunctionDeclaration | Kind::FunctionType => by_module([4076, 4077, 4078]),
                    Kind::SetAccessor | Kind::GetAccessor => by_module([4108, 4107, 4106]),
                    _ => return None,
                };
                (code, name, node)
            }
            // `getTypeParameterConstraintVisibilityDiagnosticMessage`
            Kind::TypeParameter => {
                let code = match hir.kind(parent) {
                    Kind::ClassDeclaration => 4002,
                    Kind::InterfaceDeclaration => 4004,
                    Kind::MappedType => 4103,
                    Kind::ConstructorType | Kind::ConstructSignature => 4006,
                    Kind::CallSignature => 4008,
                    Kind::MethodDeclaration | Kind::MethodSignature if hir.is_static(parent) => {
                        4010
                    }
                    Kind::MethodDeclaration | Kind::MethodSignature => {
                        match hir.kind(hir.parent(parent)) {
                            Kind::ClassDeclaration => 4012,
                            _ => 4014,
                        }
                    }
                    Kind::FunctionType | Kind::FunctionDeclaration => 4016,
                    Kind::InferType => 4085,
                    Kind::TypeAliasDeclaration => 4083,
                    _ => return None,
                };
                (code, name, node)
            }
            Kind::ExpressionWithTypeArguments => {
                let holder = hir.parent(parent);
                let code = match (hir.kind(holder), parent.part()) {
                    (Kind::ClassDeclaration, Some(Part::Implements)) => 4019,
                    (Kind::ClassDeclaration, _) if hir.name(holder).is_some() => 4020,
                    (Kind::ClassDeclaration, _) => 4021,
                    _ => 4022,
                };
                (code, hir.name(holder), node)
            }
            Kind::ImportEqualsDeclaration => (4000, name, node),
            Kind::TypeAliasDeclaration => (no_name_check([4084, 4081]), name, hir.type_node(node)),
            // `Object.defineProperty(exports, "name", descriptor)`
            Kind::CallExpression => {
                let NodeData::Expr(e) = hir.data(node) else {
                    return None;
                };
                let key = hir.child(crate::bind::define_property_call(hir, e)?.1);
                (by_module([4023, 4024, 4025]), key, key)
            }
            _ => return None,
        })
    }

    /// `handleSymbolAccessibilityError`. Whether an error is reported.
    fn handle_symbol_accessibility_error(&mut self, c: &Checker<'_, '_>, access: Access) -> bool {
        match access.accessibility {
            Accessibility::Accessible(aliases) => {
                for (file, statement) in aliases {
                    if file == self.current_source_file
                        && !self.late_marked_statements.contains(&statement)
                    {
                        self.late_marked_statements.push(statement);
                    }
                }
                return false;
            }
            // The checker reports unresolved names itself.
            Accessibility::NotResolved => return false,
            Accessibility::NotAccessible | Accessibility::CannotBeNamed => {}
        }
        let Some((code, type_name, error_node)) = self.accessibility_diagnostic(c, &access) else {
            return false;
        };
        let mut args = Vec::with_capacity(3);
        if type_name.is_some() {
            args.push(self.text(c, type_name));
        }
        args.push(access.symbol_name);
        args.push(access.module_name);
        let error_node = c.get_error_range_for_node(self.current_source_file, error_node);
        self.add_diagnostic(access.error_node.unwrap_or(error_node), code, args);
        true
    }

    /// `errorLocation`
    fn error_location(&self) -> Node {
        if self.error_name_node.is_some() {
            return self.error_name_node;
        }
        self.fallback_stack.last().copied().unwrap_or(Node::NONE)
    }

    /// `errorDeclarationNameWithFallback`
    fn error_declaration_name(&self, c: &Checker<'_, '_>) -> Vec<u8> {
        let hir = c.hir(self.current_source_file);
        let location = self.error_location();
        let name = match self.error_name_node.is_some() {
            true => location,
            false => hir.name(location),
        };
        // `DeclarationNameToString`
        match (self.text(c, name), hir.data(location)) {
            (text, _) if !text.is_empty() => text,
            (_, NodeData::Stmt(s)) if name.is_none() => match hir[s].kind {
                StmtKind::ExportAssign(_) => b"export=".to_vec(),
                StmtKind::ExportDefault(_) => b"default".to_vec(),
                _ => b"(Missing)".to_vec(),
            },
            _ => b"(Missing)".to_vec(),
        }
    }
}

impl<'p> SymbolTracker<'p> for SymbolTrackerImpl {
    /// `TrackSymbol`
    fn track_symbol(
        &mut self,
        c: &mut Checker<'p, '_>,
        symbol: Sym,
        enclosing_declaration: Option<Enclosing>,
        meaning: SymFlags,
    ) -> bool {
        let Some(at) = enclosing_declaration else {
            return false;
        };
        if c.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER) {
            return false;
        }
        if self.watched_class_symbol == Some(symbol) {
            self.class_symbol_tracked = true;
            return false;
        }
        let meaning = Meaning::of(meaning, false);
        let access = c.is_symbol_accessible(symbol, at, meaning, true);
        self.handle_symbol_accessibility_error(c, access)
    }

    /// The six reports that `Report` represents.
    fn report(&mut self, c: &mut Checker<'p, '_>, report: Report) {
        let (hir, location) = (c.hir(self.current_source_file), self.error_location());
        if location.is_none() {
            return;
        }
        let name = self.error_declaration_name(c);
        let is_name_of_variable = hir.kind(hir.parent(location)) == Kind::VariableDeclaration;
        let location = c.get_error_range_for_node(self.current_source_file, location);
        match report {
            Report::CyclicStructure => self.add_diagnostic(location, 5088, vec![name]),
            Report::InaccessibleThis => {
                self.add_diagnostic(location, 2527, vec![name, b"this".to_vec()]);
            }
            Report::InaccessibleUniqueSymbol => {
                self.add_diagnostic(location, 2527, vec![name, b"unique symbol".to_vec()]);
            }
            Report::LikelyUnsafeImportRequired(specifier, symbol) => {
                self.add_diagnostic(location, 2883, vec![name, specifier, symbol]);
            }
            Report::NonSerializableProperty(property) => {
                self.add_diagnostic(location, 4118, vec![property]);
            }
            Report::PrivateInBaseOfClassExpression(property) => {
                self.add_diagnostic(location, 4094, vec![property]);
                if is_name_of_variable && let Some(found) = self.diagnostics.last_mut() {
                    found.related.push(c.new_diagnostic(
                        (self.current_source_file, location.0, location.1),
                        9027,
                        &[Arg::Bytes(&name)],
                    ));
                }
            }
        }
    }

    /// `ReportTruncationError`, which is not deferred.
    fn report_truncation_error(&mut self, c: &mut Checker<'p, '_>) {
        if self.error_location().is_some() {
            let location =
                c.get_error_range_for_node(self.current_source_file, self.error_location());
            self.add_diagnostic(location, 7056, Vec::new());
        }
    }

    /// `ReportInferenceFallback`. A node in another file is reported for that file.
    fn report_inference_fallback(&mut self, c: &mut Checker<'p, '_>, file: FileId, node: Node) {
        if let Some(isolated_declarations) = &mut self.isolated_declarations
            && file == self.current_source_file
        {
            c.iso_report(isolated_declarations, node);
        }
    }
}

// ───────────────────────────── `DeclarationTransformer` ─────────────────────────────

impl<'p> DeclarationEmit<'_, 'p, '_> {
    /// `visitSourceFile`, `transformSourceFile`
    fn transform_source_file(&mut self) -> Vec<u8> {
        self.set_indent(0);
        let detached = self.detached_comments_text();
        self.precalculate_visibility();
        self.transform_commonjs_exports();
        self.transform_expando_assignments();
        let hir = self.c.hir(self.file());
        let mut visited = Vec::with_capacity(hir.body.len());
        for s in hir.ids(hir.body) {
            visited.push(self.visit_statement(s));
        }
        let combined = self.transform_late_painted_statements(visited, true);
        // `appendCjsExports`
        let mut statements = std::mem::take(&mut self.cjs_export_assignment);
        statements.append(&mut self.cjs_export_members);
        statements.extend(combined);
        let (file, files) = (self.file(), self.c.files());
        let module = files.module(file);
        if hir.is_js
            && (module.is_module() || module.is_commonjs())
            && let Some(equals) = files.export(files.file_symbol(file), known::export_equals)
            && files.decls_of(equals).len() > 1
        {
            for (of, declaration) in files.decls(equals) {
                if let Some(range) = self.c.error_range_of_declaration(of, declaration) {
                    self.tracker.add_diagnostic(range, 6424, Vec::new());
                }
            }
        }
        if (module.is_module() || module.is_commonjs())
            && (!self.result_has_external_module_indicator
                || self.needs_scope_fix_marker && !self.result_has_scope_marker)
        {
            statements.push(Statement::empty_exports());
        }
        // `emitSourceFile`: `emitShebangIfNeeded`, `emitDetachedCommentsBeforeStatementList`, `emitTripleSlashDirectives`.
        let mut shebang = Vec::new();
        if hir.text.starts_with(b"#!") {
            let end = strings::index_of_char_usize(&hir.text, b'\n').unwrap_or(hir.text.len());
            shebang = [hir.text[..end].trim_end_with(|c| c == '\r'), b"\n"].concat();
        }
        let directives = self.reference_directives();
        // `emitDetachedCommentsAfterStatementList`: `statements.Loc.End()` is the end of the last
        // token of the file.
        let written = hir
            .ids(hir.body)
            .filter(|&s| !hir.is_in_jsdoc(hir[s].start));
        let end = written.map(|s| hir[s].loc.end).max().unwrap_or(0);
        let mut after = self.leading_comments(end);
        if after.ends_with(b" ") {
            after.push(b'\n');
        }
        [
            shebang,
            detached,
            directives,
            self.statements_text(&statements),
            after,
        ]
        .concat()
    }

    /// `getReferencedFiles`, `getTypeReferences`, `getLibReferences`, `emitTripleSlashDirectives`:
    /// those that have `preserve="true"`.
    fn reference_directives(&self) -> Vec<u8> {
        let hir = self.c.hir(self.file());
        let mut text = Vec::new();
        for (expected, word) in [
            (ReferenceKind::Path, &b"path"[..]),
            (ReferenceKind::Types, b"types"),
            (ReferenceKind::Lib, b"lib"),
        ] {
            for &(kind, value, pos, mode) in hir.references.iter().filter(|it| it.0 == expected) {
                let _ = kind;
                let line = &hir.text[(pos as usize).min(hir.text.len())..];
                let line = &line[..strings::index_of_char_usize(line, b'\n').unwrap_or(line.len())];
                if !strings::contains(line, b"preserve=\"true\"")
                    && !strings::contains(line, b"preserve='true'")
                {
                    continue;
                }
                let mut name = self.name(value).to_vec();
                if expected == ReferenceKind::Path {
                    let files = self.c.files();
                    let Some(file) = files.source_file_from_reference(self.file(), &name) else {
                        continue;
                    };
                    let decl_file_name = match files.hir(file).kind {
                        FileKind::Declaration => files.module(file).file_name().to_vec(),
                        _ => files.declaration_file_path(file),
                    };
                    let output_file_path = files.declaration_file_path(self.file());
                    let output_file_path = dirname::<Posix>(&output_file_path);
                    // `GetRelativePathToDirectoryOrUrl`
                    name = get_relative_path_from_directory(
                        output_file_path,
                        &decl_file_name,
                        files.is_case_sensitive,
                    );
                }
                let mode: &[u8] = match mode {
                    ResolutionMode::None => b"",
                    ResolutionMode::Import => b"resolution-mode=\"import\" ",
                    ResolutionMode::Require => b"resolution-mode=\"require\" ",
                };
                text.extend_from_slice(
                    &[b"/// <reference ", word, b"=\"", &name[..], b"\" ", mode].concat(),
                );
                text.extend_from_slice(b"preserve=\"true\" />\n");
            }
        }
        text
    }

    // ───────────────────────────── emitted text ─────────────────────────────

    fn text_of(&mut self, what: Written) -> Vec<u8> {
        if !self.writes() {
            return Vec::new();
        }
        let (file, enclosing) = (self.file(), self.enclosing);
        self.c.text_of_reused_node(file, what, enclosing)
    }

    /// Empty for a declaration without a name: `export default class {}`.
    fn name(&self, name: Atom) -> &'p [u8] {
        if name.is_none() {
            return b"";
        }
        self.c.atoms().bytes(name)
    }

    fn indentation(&self) -> Vec<u8> {
        b"    ".repeat(self.indent)
    }

    fn set_indent(&mut self, indent: usize) {
        self.indent = indent;
        self.c.declaration_indent = self.writes().then_some(indent);
    }

    /// `emitLeadingComments`, under `OnlyPrintJSDocStyle`, for a node that is emitted at the start
    /// of a line. `pos`: `node.Pos()`.
    fn leading_comments(&mut self, pos: u32) -> Vec<u8> {
        let Writes::Yes { detached_comments } = self.writes else {
            return Vec::new();
        };
        if self.c.files().options.remove_comments {
            return Vec::new();
        }
        let mut pos = pos as usize;
        // "skip detached comments"
        if let Some((_, end)) = detached_comments.filter(|it| it.0 == pos) {
            pos = end;
        }
        let text = &self.c.hir(self.file()).text[..];
        comments_text(
            text,
            super::spans::get_leading_comment_ranges(text, pos),
            self.indent,
        )
    }

    /// `emitCommentsBeforeNode`, `text`, `emitCommentsAfterNode`, for a node that continues a line.
    /// `range`: its `Pos()`, if it differs from `containerPos`, and its `End()`.
    fn with_comments(&self, range: (Option<u32>, u32), text: &[u8]) -> Vec<u8> {
        if !self.writes() || range.1 == 0 || self.c.files().options.remove_comments {
            return text.to_vec();
        }
        let mut writer = Writer::new(&self.c.hir(self.file()).text, self.indent);
        if let Some(pos) = range.0 {
            writer.emit_leading_comments(pos as usize);
        }
        writer.write(text);
        writer.emit_trailing_comments(range.1 as usize);
        writer.into_text()
    }

    /// `emitDetachedComments` for the file: the comments at its start that a blank line separates
    /// from what follows.
    fn detached_comments_text(&mut self) -> Vec<u8> {
        let hir = self.c.hir(self.file());
        let text = &hir.text[..];
        // `statements.Loc.Pos()`
        let pos = 0;
        if !self.writes() {
            return Vec::new();
        }
        let only_pinned = self.c.files().options.remove_comments;
        let lines_between =
            |from: usize, to: usize| bun_core::strings::count_char(&text[from..to], b'\n');
        let mut detached: Vec<(usize, usize)> = Vec::new();
        for comment in super::spans::get_leading_comment_ranges(text, pos) {
            // "removeComments is true, only reserve pinned comment at the top of file"
            if only_pinned && !is_pinned_comment(&text[comment.0..comment.1]) {
                continue;
            }
            // "There was a blank line between the last comment and this comment."
            if detached
                .last()
                .is_some_and(|last| lines_between(last.1, comment.0) >= 2)
            {
                break;
            }
            detached.push(comment);
        }
        let Some(&(_, end)) = detached.last() else {
            return Vec::new();
        };
        let node = self.c.skip_trivia_from(self.file(), pos as u32) as usize;
        if lines_between(end, node.max(end)) < 2 {
            return Vec::new();
        }
        self.writes = Writes::Yes {
            detached_comments: Some((pos, end)),
        };
        comments_text(text, detached, self.indent)
    }

    /// Each statement on a line of its own.
    fn statements_text(&self, statements: &[Statement]) -> Vec<u8> {
        let mut text = Vec::new();
        for statement in statements {
            text.extend_from_slice(&self.indentation());
            text.extend_from_slice(&statement.comments);
            text.extend_from_slice(&modifiers_text(&statement.modifiers));
            text.extend_from_slice(&statement.text);
            text.push(b'\n');
        }
        text
    }

    /// `{`, each of `lines` on its own line indented one more level, with `separator` between them,
    /// and `}`.
    fn block(&self, lines: &[Vec<u8>], separator: &[u8]) -> Vec<u8> {
        let mut text = b"{\n".to_vec();
        for (i, line) in lines.iter().enumerate() {
            text.extend_from_slice(&self.indentation());
            text.extend_from_slice(b"    ");
            text.extend_from_slice(line);
            if i + 1 != lines.len() {
                text.extend_from_slice(separator);
            }
            text.push(b'\n');
        }
        text.extend_from_slice(&self.indentation());
        text.push(b'}');
        text
    }

    /// `ensureModifiers`, `ensureModifierFlags`, `maskModifierFlags`. `written`: `node.Modifiers()`.
    fn ensure_modifiers(&self, written: Span<ModifierId>, node: ModifiedNode) -> Vec<Flags> {
        self.ensure_modifiers_of_statement(written, Flags::empty(), Parent::None, node)
    }

    /// The same for a statement in `container`. `declared`: the flags of its declaration. A
    /// statement synthesized by the reparser has clones of the modifiers of its host, which are not
    /// HIR nodes.
    fn ensure_modifiers_of_statement(
        &self,
        written: Span<ModifierId>,
        declared: Flags,
        container: Parent,
        node: ModifiedNode,
    ) -> Vec<Flags> {
        let hir = self.c.hir(self.file());
        let mut in_order: Vec<Flags> = (written.iter())
            .filter_map(|m| match hir[m].kind {
                ModifierKind::Keyword(modifier) => Some(modifier - Flags::REPARSED),
                ModifierKind::Decorator(_) => None,
            })
            .collect();
        if declared.contains(Flags::REPARSED) && in_order.is_empty() {
            in_order.extend(
                MODIFIERS
                    .iter()
                    .map(|it| it.0)
                    .filter(|&it| declared.contains(it)),
            );
        }
        let current = in_order.iter().fold(Flags::empty(), |all, &it| all | it);
        // "No async and override modifiers in declaration files"
        let mut flags = current - (Flags::PUBLIC | Flags::ASYNC | Flags::OVERRIDE);
        match node {
            ModifiedNode::Nested => flags -= Flags::AMBIENT,
            ModifiedNode::InFile { is_always_type } => {
                if self.needs_declare && !is_always_type {
                    flags |= Flags::AMBIENT;
                }
            }
        }
        if (self.c).is_implicitly_exported_jsdoc_declaration(self.file(), declared, container) {
            flags |= Flags::EXPORT;
        }
        if flags.contains(Flags::DEFAULT) {
            flags |= Flags::EXPORT;
            flags -= Flags::AMBIENT;
        }
        // `canReuseModifierNodes`
        let is_reparsed = |m: ModifierId| matches!(hir[m].kind, ModifierKind::Keyword(modifier) if modifier.contains(Flags::REPARSED));
        if flags == current && !written.iter().any(is_reparsed) {
            return in_order;
        }
        let created = MODIFIERS.iter().filter(|it| flags.contains(it.0));
        created.map(|it| it.0).collect()
    }

    /// The source text of the module specifier literal in the statement `s`.
    fn module_specifier_text(&self, s: StmtId, spec: Atom) -> Vec<u8> {
        let hir = self.c.hir(self.file());
        let (from, to) = (hir[s].start, hir[s].loc.end);
        let mut uses = hir.specifier_uses.iter();
        let written = uses.find(|it| it.spec == spec && (from..to).contains(&it.pos));
        let text = &hir.text[..];
        if let Some(start) = written.map(|it| it.pos as usize)
            && let Some(&quote) = text.get(start)
            && matches!(quote, b'"' | b'\'')
        {
            let mut end = start + 1;
            while end < text.len() && text[end] != quote && text[end] != b'\n' {
                end += if text[end] == b'\\' { 2 } else { 1 };
            }
            return text[start..(end + 1).min(text.len())].to_vec();
        }
        super::print::quoted(self.name(spec), b'"', false)
    }

    /// `NewUniqueNameEx(base, GeneratedIdentifierFlagsOptimistic)`, `makeUniqueName`: `base` if
    /// nothing in the file has that name.
    fn unique_name(&mut self, base: &[u8]) -> Vec<u8> {
        let mut name = base.to_vec();
        let mut number = 0;
        while !self.is_unique_name(&name) {
            number += 1;
            name = cat!(base, b"_", super::sink::number_text(number));
        }
        self.generated_names.push(name.clone());
        name
    }

    /// `makeTempVariableName(tempFlagsAuto)`
    fn temp_variable_name(&mut self) -> Vec<u8> {
        loop {
            let count = self.temp_count;
            self.temp_count += 1;
            // "Skip over 'i' and 'n'"
            if count == 8 || count == 13 {
                continue;
            }
            let name = match count {
                0..26 => vec![b'_', b'a' + count as u8],
                _ => cat!(b"_", super::sink::number_text(count as usize - 26)),
            };
            if self.is_unique_name(&name) {
                self.generated_names.push(name.clone());
                return name;
            }
        }
    }

    /// `isUniqueName`
    fn is_unique_name(&self, name: &[u8]) -> bool {
        if self.generated_names.iter().any(|it| it == name) {
            return false;
        }
        let text = &self.c.hir(self.file()).text[..];
        let is_part = |byte: Option<&u8>| {
            byte.is_some_and(|&b| b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b >= 0x80)
        };
        let mut from = 0;
        while let Some(at) = strings::index_of(&text[from..], name).map(|at| from + at) {
            if !is_part(at.checked_sub(1).and_then(|before| text.get(before)))
                && !is_part(text.get(at + name.len()))
            {
                return false;
            }
            from = at + 1;
        }
        true
    }

    /// `<A, B>`, or nothing.
    fn visit_type_parameters(&mut self, type_parameters: Span<TypeParamId>) -> Vec<u8> {
        let file = self.file();
        let hir = self.c.hir(file);
        let Some(first) = type_parameters.iter().next() else {
            return Vec::new();
        };
        // `Pos()` of the first: the end of the `<`. Only trivia is between the two.
        let start = hir[first].start;
        let before = match self.writes() && !hir.is_in_jsdoc(start) {
            true => &hir.text[..(start as usize).min(hir.text.len())],
            false => &[],
        };
        // A comment between the two may have a `<` of its own.
        let mut pos = (before.iter().enumerate().rev())
            .filter(|&(_, &byte)| byte == b'<')
            .take(4)
            .map(|(at, _)| at + 1)
            .find(|&after| self.c.skip_trivia_from(file, after as u32) == start);
        let mut elements = Vec::with_capacity(type_parameters.len());
        for tp in type_parameters.iter() {
            let end = hir[tp].end;
            elements.push(Element {
                range: pos.map(|pos| (pos, end as usize)),
                text: self.visit_type_parameter(tp),
            });
            let comma = self.c.skip_trivia_from(file, end) as usize;
            pos = (pos.is_some() && hir.text.get(comma) == Some(&b',')).then_some(comma + 1);
        }
        let list = self.list_text(elements, ListFormat::SINGLE_LINE);
        [b"<", &list[..], b">"].concat()
    }

    /// The same for type arguments, which have already been visited.
    fn type_arguments_text(&mut self, arguments: IdList<TypeNodeId>) -> Vec<u8> {
        let mut texts = Vec::with_capacity(arguments.len());
        for argument in self.c.hir(self.file()).ids(arguments) {
            texts.push(self.text_of(Written::Type(argument)));
        }
        if texts.is_empty() {
            return Vec::new();
        }
        [b"<", &texts.join(&b", "[..])[..], b">"].concat()
    }

    /// `visitNestedExpression`, `transformExpandoAssignment` for each `f.name = value` that
    /// declares a property. They come before all statements.
    fn transform_expando_assignments(&mut self) {
        let file = self.file();
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        for &e in bound.expando_declarations.iter() {
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[e].kind
            else {
                continue;
            };
            // `GetLeftmostAccessExpression`
            let mut root = target;
            while let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[root].kind {
                if is_parenthesized(hir, root) {
                    break;
                }
                root = obj;
            }
            let ExprKind::Ident(name) = hir[root].kind else {
                continue;
            };
            if is_parenthesized(hir, root) {
                continue;
            }
            // `GetReferencedValueDeclaration`
            let Some(host) = self.c.symbol_of_identifier(file, root, name) else {
                continue;
            };
            let host = files.export_symbol_of_value_symbol_if_exported(host);
            let declaration = files.decls_of(host).iter().copied().find(|&(_, decl)| {
                !matches!(
                    decl,
                    Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_)
                )
            });
            let Some((of, declaration)) = declaration else {
                continue;
            };
            if of != file {
                continue;
            }
            let loc = files.loc_of_declaration(file, declaration);
            if loc.is_some_and(|loc| self.c.should_strip_internal(file, loc.pos)) {
                continue;
            }
            // The function that is emitted for a variable.
            let mut variable: Option<(VarDeclId, FnId)> = None;
            match declaration {
                Decl::Var(pat) => {
                    let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
                        continue;
                    };
                    let decl = &hir[d];
                    if decl.ty.is_some() || decl.init.is_none() || is_parenthesized(hir, decl.init)
                    {
                        continue;
                    }
                    let ExprKind::Fn(f) = hir[decl.init].kind else {
                        continue;
                    };
                    variable = Some((d, f));
                }
                Decl::Fn(f) => {
                    if hir.jsdoc_type(JsDocTypeOwner::Fn(f)).is_some() {
                        continue;
                    }
                }
                Decl::Class(_) | Decl::Enum(_) | Decl::Module(_) => {}
                _ => continue,
            }
            // `tryGetPropertyName`
            let property = match hir[target].kind {
                ExprKind::Dot { name, .. } => Some(name),
                ExprKind::Index { index, .. } => match hir[index].kind {
                    ExprKind::String(name) => Some(name),
                    // `tryGetNameFromEntityNameExpression`
                    _ if is_entity_name_expression(hir, index)
                        && self
                            .c
                            .resolve_entity_name_expression(file, index, SymFlags::VALUE)
                            .is_some_and(|sym| {
                                files
                                    .flags(sym)
                                    .intersects(SymFlags::CONST | SymFlags::ENUM_MEMBER)
                            }) =>
                    {
                        self.c.member_name(file, PropKey::Computed(index))
                    }
                    _ => None,
                },
                _ => None,
            };
            let Some(property) =
                property.filter(|&name| bun_core::lexer::is_identifier(self.c.atoms().bytes(name)))
            else {
                continue;
            };
            // `isDeclarationAndNotVisible`
            let is_visible = match declaration {
                Decl::Var(pat) => self.is_binding_name_visible(pat),
                _ => self.c.is_declaration_visible(file, declaration),
            };
            if !is_visible {
                continue;
            }
            // `shouldEmitFunctionProperties`
            if let Decl::Fn(f) = declaration
                && matches!(hir[f].body, FnBody::None)
                && !files.decls_of(host).iter().any(|&(file, decl)| {
                    matches!(decl, Decl::Fn(f) if !matches!(self.c.hir(file)[f].body, FnBody::None))
                })
            {
                continue;
            }
            // `transformExpandoHost`: it is emitted as a function, replacing the whole statement. A
            // function declaration emits the same when it is visited.
            // `getExpandoHostId`
            let root = match variable {
                Some((d, _)) => bound.var_stmt[d.idx()].some(),
                None => self.c.files().statement_of_declaration(file, declaration),
            };
            if let Some((d, function)) = variable {
                let statement = bound.var_stmt[d.idx()];
                if statement.is_some() && !self.expando_hosts.contains_key(&statement) {
                    let saved = self.tracker.get_symbol_accessibility_diagnostic;
                    self.tracker.get_symbol_accessibility_diagnostic =
                        Context::ForNode(hir.node(d));
                    let outer = self.indent;
                    self.set_indent(self.indent_of_statements(bound.stmt_parent[statement.idx()]));
                    let signature = self.transform_signature(function);
                    self.set_indent(outer);
                    self.tracker.get_symbol_accessibility_diagnostic = saved;
                    let host = self.expando_host(statement, name, &signature);
                    self.expando_hosts.insert(statement, host.clone());
                    if self.written.contains_key(&statement) {
                        let block = self.create_full_expando_block(statement, host);
                        self.written.insert(statement, block);
                    }
                    if let Some(isolated_declarations) = &mut self.tracker.isolated_declarations {
                        self.c
                            .iso_report_expandos(isolated_declarations, hir.node(d));
                    }
                }
            }
            let saved = (
                self.tracker.error_name_node,
                self.tracker.get_symbol_accessibility_diagnostic,
            );
            self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(hir.node(e));
            let export_of = |names: Vec<u8>| {
                let text = [b"export { ", &names[..], b" };"].concat();
                Statement::new(StatementKind::ExportDeclaration, text)
            };
            let export_name = self.name(property);
            let mut added = Vec::new();
            if let ExprKind::Ident(right) = hir[value].kind
                && !is_parenthesized(hir, value)
            {
                // `transformBinaryExpressionToExportDeclaration`: it is emitted as `export { right
                // as name }`.
                self.check_entity_name_visibility(right, hir[value].pos, Meaning::ValueOfName);
                added.push(export_of(if right == property {
                    export_name.to_vec()
                } else {
                    [self.name(right), b" as ", export_name].concat()
                }));
            } else {
                let holder = self.c.type_of_symbol(host);
                if let Some(ty) = self.c.type_of_property(holder, property) {
                    self.tracker.error_name_node = Node::NONE;
                    // It is emitted in the namespace of its host.
                    let around = root.map_or(Parent::None, |root| bound.stmt_parent[root.idx()]);
                    let outer = self.indent;
                    self.set_indent(self.indent_of_statements(around) + 1);
                    let ty = self.create_type_of_declaration(
                        Some(hir.node(e)),
                        ty,
                        DECLARATION_EMIT_NODE_BUILDER_FLAGS,
                    );
                    self.set_indent(outer);
                    // "use exportName as localName if there won't be any conflicts or keyword issues"
                    let any = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
                    let scope = self.enclosing.scope;
                    let local_name = if files.resolve_name(file, scope, property, any).is_some()
                        || is_non_contextual_keyword(export_name)
                    {
                        // `NewGeneratedNameForNode` for the assignment
                        self.temp_variable_name()
                    } else {
                        export_name.to_vec()
                    };
                    added.push(Statement::new(
                        StatementKind::Other,
                        [b"var ", &local_name[..], b": ", &ty[..], b";"].concat(),
                    ));
                    if local_name != export_name {
                        added.push(export_of([&local_name[..], b" as ", export_name].concat()));
                    }
                }
            }
            if let Some(root) = root {
                let members = self.expando_members.entry(root).or_default();
                let is_export = |it: &Statement| it.kind == StatementKind::ExportDeclaration;
                let had_export = members.iter().any(is_export);
                // "so they remain exported after the `export {}` is added"
                if added.len() > 1 && !had_export {
                    for member in members.iter_mut().filter(|it| !it.is_exported()) {
                        member.modifiers.insert(0, Flags::EXPORT);
                    }
                }
                if had_export && let Some(first) = added.first_mut().filter(|it| !is_export(it)) {
                    first.modifiers.push(Flags::EXPORT);
                }
                members.append(&mut added);
            }
            (
                self.tracker.error_name_node,
                self.tracker.get_symbol_accessibility_diagnostic,
            ) = saved;
        }
    }

    /// `PrecalculateDeclarationEmitVisibility`
    fn precalculate_visibility(&mut self) {
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let any = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
        for (i, statement) in hir.stmts.iter().enumerate() {
            if bound.stmt_parent[i] == Parent::None {
                continue;
            }
            match statement.kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                    if let ExprKind::Ident(name) = hir[e].kind
                        && !is_parenthesized(self.c.hir(self.file()), e)
                        && let Some(&scope) = bound.expr_scope.get(&e)
                    {
                        self.mark_linked_aliases(files.resolve_name(self.file(), scope, name, any));
                    }
                }
                StmtKind::ExportNamed(export) if !hir[export].has_module_specifier => {
                    let scope = bound.export_scope[export.idx()];
                    for spec in hir[export].items.iter() {
                        let target = files.resolve_name(self.file(), scope, hir[spec].local, any);
                        self.mark_linked_aliases(target);
                    }
                }
                // `isCommonJSModuleExports`
                StmtKind::Expr(e)
                    if bound.commonjs_indicator.is_some()
                        && bound.stmt_parent[i] == Parent::File
                        && matches!(
                            crate::bind::assignment_declaration_kind(hir, e),
                            crate::bind::JsDeclarationKind::ModuleExports
                                | crate::bind::JsDeclarationKind::ExportsProperty(_)
                        ) =>
                {
                    if let ExprKind::Assign { value, .. } = hir[e].kind
                        && let ExprKind::Ident(name) = hir[value].kind
                        && !is_parenthesized(self.c.hir(self.file()), value)
                    {
                        let target = files.resolve_name(self.file(), ScopeId(0), name, any);
                        self.mark_linked_aliases(target);
                    }
                }
                _ => {}
            }
        }
    }

    /// `markLinkedAliases`
    fn mark_linked_aliases(&mut self, target: Option<Sym>) {
        let files = self.c.files();
        let any = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
        let mut visited: Vec<Sym> = Vec::new();
        let mut at = target;
        while let Some(symbol) = at {
            if visited.contains(&symbol) {
                break;
            }
            visited.push(symbol);
            at = None;
            for (file, decl) in files.decls(symbol) {
                self.c.emit_resolver_links.paint_visible(file, decl);
                // `import a = b.c` makes `b` visible.
                if let Decl::ImportEquals(i) = decl
                    && let ImportEqualsTarget::Entity(names) = self.c.hir(file)[i].target
                    && !names.is_empty()
                {
                    let scope = self.c.bound(file).import_equals_scope[i.idx()];
                    at = files.resolve_name(file, scope, self.c.hir(file)[names.at(0)].text, any);
                }
            }
        }
    }

    /// `visit` for a statement.
    fn visit_statement(&mut self, s: StmtId) -> Visited {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let statement = &hir[s];
        // `visitDeclarationStatements`
        if self.c.should_strip_internal(self.file(), statement.loc.pos) {
            return Visited::Statements(Vec::new());
        }
        let parent_is_file = bound.stmt_parent[s.idx()] == Parent::File;
        match statement.kind {
            StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } => {
                self.result_has_external_module_indicator |= parent_is_file;
                self.result_has_scope_marker = true;
                let mut written = self.export_declaration(s);
                written.comments = self.leading_comments(statement.loc.pos);
                written.text = self.with_comments((None, statement.loc.end), &written.text);
                Visited::Statements(vec![written])
            }
            // `VisitEachChild`
            StmtKind::ExportAsNamespace(name) => {
                let text = [b"export as namespace ", self.name(name), b";"].concat();
                Visited::Statements(vec![Statement::new(StatementKind::Other, text)])
            }
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                let is_export_equals = matches!(statement.kind, StmtKind::ExportAssign(_));
                let node = hir.node(s);
                Visited::Statements(self.transform_export_assignment(
                    node,
                    node,
                    e,
                    is_export_equals,
                ))
            }
            StmtKind::Import(_)
            | StmtKind::Fn(_)
            | StmtKind::Class(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::Var(_)
            | StmtKind::ImportEquals(_) => {
                if !self.written.contains_key(&s)
                    && let Some(written) = self.transform_top_level_declaration(s)
                {
                    self.written.insert(s, written);
                }
                Visited::Late(s)
            }
            _ => Visited::Statements(Vec::new()),
        }
    }

    /// The indentation level of the statements of `container`.
    fn indent_of_statements(&self, mut container: Parent) -> usize {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let mut indent = 0;
        while let Parent::Module(module) = container {
            indent += nested_module_declaration(hir, module).is_none() as usize;
            container = match hir[module].stmt.some() {
                Some(s) => bound.stmt_parent[s.idx()],
                None => Parent::None,
            };
        }
        indent
    }

    /// `transformAndReplaceLatePaintedStatements`. `parent_is_file`: `IsSourceFile(statement.Parent)`.
    fn transform_late_painted_statements(
        &mut self,
        visited: Vec<Visited>,
        parent_is_file: bool,
    ) -> Vec<Statement> {
        while !self.tracker.late_marked_statements.is_empty() {
            let next = self.tracker.late_marked_statements.remove(0);
            let parent = self.c.bound(self.file()).stmt_parent[next.idx()];
            let saved = std::mem::replace(&mut self.needs_declare, parent == Parent::File);
            // It is emitted among the statements of its own container.
            let outer = self.indent;
            self.set_indent(self.indent_of_statements(parent));
            let written = self.transform_top_level_declaration(next);
            self.set_indent(outer);
            self.needs_declare = saved;
            match written {
                Some(written) => self.written.insert(next, written),
                None => self.written.remove(&next),
            };
        }
        let mut results = Vec::with_capacity(visited.len());
        for visited in visited {
            match visited {
                Visited::Statements(mut statements) => results.append(&mut statements),
                Visited::Late(s) => {
                    for statement in self.written.get(&s).into_iter().flatten() {
                        self.needs_scope_fix_marker |= statement.needs_scope_marker();
                        self.result_has_external_module_indicator |=
                            parent_is_file && statement.is_external_module_indicator();
                        results.push(statement.clone());
                    }
                }
            }
        }
        results
    }

    /// An `ExportDeclaration`, which is preserved.
    fn export_declaration(&mut self, s: StmtId) -> Statement {
        let hir = self.c.hir(self.file());
        let mut text = b"export ".to_vec();
        let from_expression = hir.exports_from_expressions.iter().find(|it| it.0 == s);
        let (spec, mode) = match hir[s].kind {
            StmtKind::ExportNamed(export) => {
                let export = &hir[export];
                if export.type_only {
                    text.extend_from_slice(b"type ");
                }
                // `Pos()` of an element: the end of the `{` or the comma before it.
                let after_comma = |end: u32| {
                    let comma = self.c.skip_trivia_from(self.file(), end) as usize;
                    (hir.text.get(comma) == Some(&b',')).then_some(comma + 1)
                };
                let statement = hir[s].start as usize;
                let mut pos = strings::index_of_char_usize(&hir.text[statement..], b'{')
                    .map(|brace| statement + brace + 1);
                let mut items = Vec::with_capacity(export.items.len());
                for item in export.items.iter() {
                    let (start, end) = (hir[item].start as usize, hir[item].end as usize);
                    items.push(Element {
                        range: pos.map(|pos| (pos, end)),
                        text: hir.text[start..end].to_vec(),
                    });
                    pos = after_comma(hir[item].end);
                }
                if items.is_empty() {
                    text.extend_from_slice(b"{}");
                } else {
                    let format = ListFormat {
                        // `NodeList.HasTrailingComma`
                        has_trailing_comma: pos.is_some(),
                        ..ListFormat::SINGLE_LINE
                    };
                    let items = self.list_text(items, format);
                    text.extend_from_slice(&[b"{ ", &items[..], b" }"].concat());
                }
                (export.spec, export.mode)
            }
            StmtKind::ExportStar {
                spec,
                alias,
                type_only,
                mode,
                alias_pos,
                ..
            } => {
                if type_only {
                    text.extend_from_slice(b"type ");
                }
                text.push(b'*');
                if alias.is_some() {
                    // `export * as "a b"`
                    let name = match hir.text.get(alias_pos as usize) {
                        Some(&quote @ (b'"' | b'\'')) => {
                            super::print::quoted(self.name(alias), quote, false)
                        }
                        _ => self.name(alias).to_vec(),
                    };
                    text.extend_from_slice(&[b" as ", &name[..]].concat());
                }
                (spec, mode)
            }
            _ => (Atom::NONE, ResolutionMode::None),
        };
        if spec.is_some() || from_expression.is_some() {
            // `rewriteModuleSpecifier`
            self.result_has_external_module_indicator = true;
            text.extend_from_slice(b" from ");
            match from_expression {
                // `rewriteModuleSpecifier` leaves what is not a string literal as it is.
                Some(&(_, e)) if e.is_some() => {
                    let (start, end) = (hir[e].pos, self.c.end_of_expr(self.file(), e));
                    text.extend_from_slice(&hir.text[start as usize..end as usize]);
                }
                Some(_) => {}
                None => text.extend_from_slice(&self.module_specifier_text(s, spec)),
            }
            text.extend_from_slice(&self.resolution_mode_override_text(s, mode));
        }
        text.push(b';');
        Statement::new(StatementKind::ExportDeclaration, text)
    }

    /// `tryGetResolutionModeOverride`: the import attributes of the statement `s`, if they specify
    /// a resolution mode.
    fn resolution_mode_override_text(&self, s: StmtId, mode: ResolutionMode) -> Vec<u8> {
        let hir = self.c.hir(self.file());
        let statement = &hir.text[hir[s].start as usize..hir[s].loc.end as usize];
        // `GetResolutionModeOverride`
        let reported = strings::index_of(statement, b"resolution-mode").map(|at| &statement[at..]);
        let word: &[u8] = match mode {
            ResolutionMode::Import => b"import",
            ResolutionMode::Require => b"require",
            ResolutionMode::None => {
                match reported.and_then(|it| bun_core::strings::split_any(it, b"\"'").nth(2)) {
                    Some(b"import") => b"import",
                    Some(b"require") => b"require",
                    _ => return Vec::new(),
                }
            }
        };
        [b" with { \"resolution-mode\": \"", word, b"\" }"].concat()
    }

    /// `UpdateImportDeclaration`, `UpdateImportEqualsDeclaration`: `text` after `decl.Modifiers()`
    /// of the statement `s`.
    fn update_import(&self, kind: StatementKind, s: StmtId, text: Vec<u8>) -> Statement {
        let hir = self.c.hir(self.file());
        let modifiers = (hir[s].modifiers.iter()).filter_map(|m| match hir[m].kind {
            ModifierKind::Keyword(modifier) => Some(modifier),
            ModifierKind::Decorator(_) => None,
        });
        Statement {
            kind,
            comments: Vec::new(),
            modifiers: modifiers.collect(),
            text,
        }
    }

    /// `transformImportDeclaration`
    fn transform_import_declaration(&mut self, i: ImportId, s: StmtId) -> Option<Statement> {
        let file = self.file();
        let hir = self.c.hir(file);
        let import = &hir[i];
        let tail = |emit: &mut Self| {
            // `rewriteModuleSpecifier`
            emit.result_has_external_module_indicator = true;
            let specifier = emit.module_specifier_text(s, import.spec);
            [
                &specifier[..],
                &emit.resolution_mode_override_text(s, import.mode)[..],
                b";",
            ]
            .concat()
        };
        // `import "mod"`: "possibly needed for side effects? (global interface patches, module augmentations, etc)"
        if import.clause_start == import.clause_end {
            let text = [b"import ", &tail(self)[..]].concat();
            return Some(self.update_import(StatementKind::Import, s, text));
        }
        let mut bindings: Vec<Vec<u8>> = Vec::new();
        if import.default.is_some() && self.c.is_declaration_visible(file, Decl::ImportDefault(i)) {
            bindings.push(self.name(import.default).to_vec());
        }
        if import.namespace.is_some() {
            if self
                .c
                .is_declaration_visible(file, Decl::ImportNamespace(i))
            {
                bindings.push([b"* as ", self.name(import.namespace)].concat());
            }
        } else {
            let mut named: Vec<&[u8]> = Vec::new();
            for spec in import.named.iter() {
                if self.c.is_declaration_visible(file, Decl::ImportSpec(spec)) {
                    named.push(&hir.text[hir[spec].start as usize..hir[spec].end as usize]);
                }
            }
            if !named.is_empty() {
                bindings.push([b"{ ", &named.join(&b", "[..])[..], b" }"].concat());
            }
        }
        if bindings.is_empty() {
            // "Augmentation of export depends on import", for `NamedImports`.
            if import.namespace.is_some()
                || import.named.is_empty() && import.default.is_some()
                || !self.c.is_import_required_by_augmentation(file, i)
            {
                return None;
            }
            if let Some(isolated_declarations) = &mut self.tracker.isolated_declarations {
                self.c.iso_transform_import(isolated_declarations, s);
            }
            let text = [b"import ", &tail(self)[..]].concat();
            return Some(self.update_import(StatementKind::Import, s, text));
        }
        let type_only: &[u8] = if import.type_only { b"type " } else { b"" };
        let bindings = bindings.join(&b", "[..]);
        let text = [
            b"import ",
            type_only,
            &bindings[..],
            b" from ",
            &tail(self)[..],
        ]
        .concat();
        Some(self.update_import(StatementKind::Import, s, text))
    }

    /// Makes `scope` the scope that names are resolved from.
    fn enter(&mut self, scope: ScopeId) {
        if scope.is_some() {
            self.enclosing = Enclosing::at_scope(self.file(), scope);
        }
    }

    /// `transformTopLevelDeclaration`. `None`: nothing is emitted for the statement.
    fn transform_top_level_declaration(&mut self, s: StmtId) -> Option<Vec<Statement>> {
        self.tracker
            .late_marked_statements
            .retain(|&marked| marked != s);
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        if self.c.should_strip_internal(self.file(), hir[s].loc.pos) {
            return None;
        }
        let kind = hir[s].kind;
        let decl = match kind {
            StmtKind::ImportEquals(_) | StmtKind::Import(_) => {
                let mut written = match kind {
                    StmtKind::ImportEquals(i) => self.transform_import_equals(i, s)?,
                    StmtKind::Import(i) => self.transform_import_declaration(i, s)?,
                    _ => return None,
                };
                written.comments = self.leading_comments(hir[s].loc.pos);
                written.text = self.with_comments((None, hir[s].loc.end), &written.text);
                return Some(vec![written]);
            }
            StmtKind::Fn(f) => Some(Decl::Fn(f)),
            StmtKind::Class(c) => Some(Decl::Class(c)),
            StmtKind::Interface(i) => Some(Decl::Interface(i)),
            StmtKind::TypeAlias(a) => Some(Decl::Alias(a)),
            StmtKind::Enum(e) => Some(Decl::Enum(e)),
            StmtKind::Module(m) => Some(Decl::Module(m)),
            StmtKind::Var(_) => None,
            _ => return None,
        };
        let file = self.file();
        if let Some(decl) = decl
            && !self.c.is_declaration_visible(file, decl)
        {
            return None;
        }
        if let StmtKind::Fn(f) = kind
            && self.is_implementation_of_overload(f)
        {
            return None;
        }
        if let Some(host) = self.expando_hosts.get(&s) {
            let host = host.clone();
            return Some(self.create_full_expando_block(s, host));
        }
        let saved = (
            self.enclosing,
            self.tracker.get_symbol_accessibility_diagnostic,
            self.tracker.error_name_node,
            self.needs_declare,
        );
        let modified = ModifiedNode::new(bound.stmt_parent[s.idx()] == Parent::File);
        let other = |modifiers: Vec<Flags>, text: Vec<u8>| {
            Some(vec![Statement {
                kind: StatementKind::Other,
                comments: Vec::new(),
                modifiers,
                text,
            }])
        };
        let written = match kind {
            StmtKind::TypeAlias(a) => {
                self.enter(bound.alias_scope[a.idx()]);
                self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(hir.node(s));
                self.needs_declare = false;
                let container = bound.stmt_parent[s.idx()];
                let written = hir[s].modifiers;
                let modifiers =
                    self.ensure_modifiers_of_statement(written, hir[a].flags, container, modified);
                let type_parameters = self.visit_type_parameters(hir[a].type_params);
                self.visit_type(hir[a].ty, true);
                let ty = self.text_of(Written::Type(hir[a].ty));
                let name = self.name(hir[a].name);
                Some(vec![Statement {
                    kind: match hir[a].flags.contains(Flags::REPARSED) {
                        true => StatementKind::JsTypeAlias,
                        false => StatementKind::Other,
                    },
                    comments: Vec::new(),
                    modifiers,
                    text: [b"type ", name, &type_parameters[..], b" = ", &ty[..], b";"].concat(),
                }])
            }
            StmtKind::Interface(i) => {
                self.enter(bound.interface_scope[i.idx()]);
                let modified = match modified {
                    ModifiedNode::InFile { .. } => ModifiedNode::InFile {
                        is_always_type: true,
                    },
                    ModifiedNode::Nested => ModifiedNode::Nested,
                };
                let modifiers = self.ensure_modifiers(hir[s].modifiers, modified);
                let type_parameters = self.visit_type_parameters(hir[i].type_params);
                let mut extends = Vec::new();
                for node in hir.ids(hir[i].extends) {
                    self.visit_heritage_type(node);
                    // `transformHeritageClause`
                    if matches!(hir[node].kind, TypeNodeKind::Ref { .. }) {
                        extends.push(self.text_of(Written::Type(node)));
                    }
                }
                self.set_indent(self.indent + 1);
                let mut members = Vec::with_capacity(hir[i].members.len());
                for m in hir[i].members.iter() {
                    members.extend(self.visit_member(m));
                }
                self.set_indent(self.indent - 1);
                let mut text =
                    [b"interface ", self.name(hir[i].name), &type_parameters[..]].concat();
                if !extends.is_empty() {
                    text.extend_from_slice(b" extends ");
                    text.extend_from_slice(&extends.join(&b", "[..]));
                }
                text.push(b' ');
                text.extend_from_slice(&self.block(&members, b""));
                other(modifiers, text)
            }
            StmtKind::Fn(f) => {
                if let Some(isolated_declarations) = &mut self.tracker.isolated_declarations {
                    self.c
                        .iso_report_expandos(isolated_declarations, hir.node(s));
                }
                self.enter(bound.fns[f.idx()].scope);
                self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(hir.node(s));
                let signature = self.transform_signature(f);
                if self.expando_members.contains_key(&s) {
                    Some(self.expando_host(s, hir[f].name, &signature))
                } else {
                    // A function is not `IsImplicitlyExportedJSDocDeclaration`.
                    let (written, declared) = (hir[s].modifiers, hir[f].flags);
                    let modifiers = self.ensure_modifiers_of_statement(
                        written,
                        declared,
                        Parent::None,
                        modified,
                    );
                    let name = self.name(hir[f].name);
                    other(
                        modifiers,
                        [b"function ", name, &signature[..], b";"].concat(),
                    )
                }
            }
            StmtKind::Enum(e) => {
                if let Some(isolated_declarations) = &mut self.tracker.isolated_declarations {
                    self.c.iso_transform_enum(isolated_declarations, e);
                }
                let modifiers = self.ensure_modifiers(hir[s].modifiers, modified);
                let text = self.transform_enum_declaration(e);
                other(modifiers, text)
            }
            StmtKind::Module(m) => Some(vec![self.transform_module_declaration(m, s)]),
            StmtKind::Class(c) => Some(self.transform_class_declaration(c, s)),
            StmtKind::Var(decls) => self.transform_variable_statement(decls, s),
            _ => Some(Vec::new()),
        };
        (
            self.enclosing,
            self.tracker.get_symbol_accessibility_diagnostic,
            self.tracker.error_name_node,
            self.needs_declare,
        ) = saved;
        let mut written = written?;
        let comments = self.leading_comments(hir[s].loc.pos);
        let preserves_comments = match kind {
            StmtKind::Class(_) => written.last_mut(),
            _ => written.first_mut(),
        };
        if let Some(statement) = preserves_comments {
            statement.comments = comments;
            statement.text = self.with_comments((None, hir[s].loc.end), &statement.text);
        }
        Some(self.create_full_expando_block(s, written))
    }

    /// `transformExpandoHost` for a function: the function `name` with `signature`, replacing the
    /// statement `s`.
    fn expando_host(&mut self, s: StmtId, name: Atom, signature: &[u8]) -> Vec<Statement> {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let parent_is_file = bound.stmt_parent[s.idx()] == Parent::File;
        let modified = ModifiedNode::new(parent_is_file);
        let saved = std::mem::replace(&mut self.needs_declare, true);
        let mut modifiers = self.ensure_modifiers(hir[s].modifiers, modified);
        self.needs_declare = saved;
        let is_default_export = modifiers.contains(&Flags::DEFAULT);
        if is_default_export {
            modifiers = vec![Flags::AMBIENT];
        }
        let name = self.name(name);
        let mut host = vec![Statement {
            kind: StatementKind::Other,
            comments: Vec::new(),
            modifiers,
            text: [b"function ", name, signature, b";"].concat(),
        }];
        if is_default_export {
            self.result_has_external_module_indicator |= parent_is_file;
            self.result_has_scope_marker = true;
            let text = [b"export default ", name, b";"].concat();
            host.push(Statement::new(StatementKind::ExportAssignment, text));
        }
        host
    }

    /// `createFullExpandoBlock`: `host`, which is emitted for the statement `s`, and a namespace
    /// with its assigned properties.
    fn create_full_expando_block(&mut self, s: StmtId, mut host: Vec<Statement>) -> Vec<Statement> {
        let Some(members) = self.expando_members.get(&s).cloned() else {
            return host;
        };
        let hir = self.c.hir(self.file());
        let name = match hir[s].kind {
            StmtKind::Fn(f) => hir[f].name,
            StmtKind::Class(c) => hir[c].name,
            StmtKind::Enum(e) => hir[e].name,
            StmtKind::Module(m) => match hir[m].name {
                ModuleName::Ident(name) => name,
                _ => Atom::NONE,
            },
            StmtKind::Var(decls) => match decls.iter().next().map(|d| hir[hir[d].pat].kind) {
                Some(PatKind::Ident(name)) => name,
                _ => Atom::NONE,
            },
            _ => Atom::NONE,
        };
        let Some(first) = host.first().filter(|_| name.is_some()) else {
            return host;
        };
        let modifiers = first.modifiers.clone();
        self.set_indent(self.indent + 1);
        let body = self.statements_text(&members);
        self.set_indent(self.indent - 1);
        let head = [b"namespace ", self.name(name), b" {\n"].concat();
        host.push(Statement {
            kind: StatementKind::Other,
            comments: Vec::new(),
            modifiers,
            text: [&head[..], &body[..], &self.indentation()[..], b"}"].concat(),
        });
        host
    }

    /// `transformEnumDeclaration`, starting at the keyword.
    fn transform_enum_declaration(&mut self, e: EnumId) -> Vec<u8> {
        let file = self.file();
        let hir = self.c.hir(file);
        let mut members = Vec::with_capacity(hir[e].members.len());
        for m in hir[e].members.iter() {
            if !self.writes() || self.c.should_strip_internal(file, hir[m].loc.pos) {
                continue;
            }
            let mut member = self.text_of(Written::PropertyName(hir.name(hir.node(m))));
            // "Rewrite enum values to their constants, if available"
            match self.c.enum_member_value(file, m) {
                Some(EnumValue::Number(bits)) => {
                    let value = f64::from_bits(bits);
                    let (sign, size): (&[u8], f64) = if value < 0.0 {
                        (b"-", -value)
                    } else {
                        (b"", value)
                    };
                    let size = crate::atom::number_to_string(size);
                    member.extend_from_slice(&cat!(b" = ", sign, size));
                }
                Some(EnumValue::String(value)) => {
                    member.extend_from_slice(b" = ");
                    member.extend_from_slice(&super::print::quoted(self.name(value), b'"', true));
                }
                None => {}
            }
            members.push(Element {
                range: Some((hir[m].loc.pos as usize, hir[m].loc.end as usize)),
                text: member,
            });
        }
        let name = self.name(hir[e].name);
        let members = self.list_text(members, ListFormat::MULTI_LINE);
        [
            b"enum ",
            name,
            b" {",
            &members[..],
            &self.indentation()[..],
            b"}",
        ]
        .concat()
    }

    /// `transformModuleDeclaration`
    fn transform_module_declaration(&mut self, m: ModuleId, s: StmtId) -> Statement {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let module = &hir[m];
        self.enter(bound.module_scope[m.idx()]);
        let container = bound.stmt_parent[s.idx()];
        let modified = ModifiedNode::new(container == Parent::File);
        let written = hir[s].modifiers;
        let modifiers =
            self.ensure_modifiers_of_statement(written, module.flags, container, modified);
        self.needs_declare = false;
        let is_nested = matches!(container, Parent::Module(outer)
            if nested_module_declaration(hir, outer) == Some(s));
        let (kind, head) = match module.name {
            // `IsAmbientModule`: `IsGlobalScopeAugmentation` too.
            ModuleName::Global => (StatementKind::AmbientModule, b"global".to_vec()),
            ModuleName::String(name) => {
                let written = hir.text.get(module.name_pos as usize).copied();
                let quote = written.filter(|&it| it == b'\'').unwrap_or(b'"');
                let name = super::print::quoted(self.name(name), quote, false);
                (
                    StatementKind::AmbientModule,
                    [b"module ", &name[..]].concat(),
                )
            }
            // `emitNestedModuleName`: it follows the name of its parent.
            ModuleName::Ident(name) if is_nested => {
                (StatementKind::Other, self.name(name).to_vec())
            }
            ModuleName::Ident(name) => (
                StatementKind::Other,
                [b"namespace ", self.name(name)].concat(),
            ),
        };
        // "eagerly transform nested namespaces (the nesting doesn't need any elision or painting done)"
        if let Some(inner) = nested_module_declaration(hir, m) {
            self.visit_statement(inner);
            let body = self.written.remove(&inner).unwrap_or_default();
            let text = match body.first() {
                Some(body) => [&head[..], b".", &body.text[..]].concat(),
                None => [&head[..], b";"].concat(),
            };
            return Statement {
                kind,
                comments: Vec::new(),
                modifiers,
                text,
            };
        }
        let saved = (self.needs_scope_fix_marker, self.result_has_scope_marker);
        (self.needs_scope_fix_marker, self.result_has_scope_marker) = (false, false);
        self.set_indent(self.indent + 1);
        let mut visited = Vec::with_capacity(module.body.len());
        for inner in hir.ids(module.body) {
            visited.push(self.visit_statement(inner));
        }
        let mut statements = self.transform_late_painted_statements(visited, false);
        // "If it was `declare`'d everything is implicitly exported already, ignore late printed "privates""
        if module.flags.contains(Flags::AMBIENT) {
            self.needs_scope_fix_marker = false;
        }
        if module.name != ModuleName::Global
            && !self.result_has_scope_marker
            && !statements.iter().any(Statement::is_scope_marker)
        {
            if self.needs_scope_fix_marker {
                statements.push(Statement::empty_exports());
            } else {
                // `stripExportModifiers`
                for statement in &mut statements {
                    if !matches!(
                        statement.kind,
                        StatementKind::ImportEquals | StatementKind::JsTypeAlias
                    ) && !statement.modifiers.contains(&Flags::DEFAULT)
                    {
                        statement.modifiers.retain(|&it| it != Flags::EXPORT);
                    }
                }
            }
        }
        let body = self.statements_text(&statements);
        self.set_indent(self.indent - 1);
        (self.needs_scope_fix_marker, self.result_has_scope_marker) = saved;
        // `rangeEndIsOnSameLineAsRangeStart` for the block, which starts after the name and ends
        // the declaration.
        let is_on_one_line = || {
            let after_name = self.c.end_of_name_at(self.file(), module.name_pos);
            let open = self.c.skip_trivia_from(self.file(), after_name) as usize;
            positions_are_on_same_line(&hir.text[..], hir[s].loc.end as usize, open)
        };
        let text = if !module.has_body {
            [&head[..], b";"].concat()
        } else if statements.is_empty() && is_on_one_line() {
            // `isEmptyBlock`: `LFSingleLineBlockStatements`
            [&head[..], b" { }"].concat()
        } else {
            [&head[..], b" {\n", &body[..], &self.indentation()[..], b"}"].concat()
        };
        Statement {
            kind,
            comments: Vec::new(),
            modifiers,
            text,
        }
    }

    /// `transformImportEqualsDeclaration`
    fn transform_import_equals(&mut self, i: ImportEqualsId, s: StmtId) -> Option<Statement> {
        let file = self.file();
        if !self.c.is_declaration_visible(file, Decl::ImportEquals(i)) {
            return None;
        }
        let hir = self.c.hir(self.file());
        if let ImportEqualsTarget::Entity(names) = hir[i].target
            && !names.is_empty()
        {
            let saved = self.tracker.get_symbol_accessibility_diagnostic;
            self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(hir.node(s));
            // The name comes after the `=`.
            let after_name = self.c.end_of_name_at(self.file(), hir[i].name_pos);
            let equals = self.c.skip_trivia_from(self.file(), after_name);
            let start = self.c.skip_trivia_from(self.file(), equals + 1);
            self.check_entity_name_visibility(hir[names.at(0)].text, start, Meaning::Namespace);
            self.tracker.get_symbol_accessibility_diagnostic = saved;
        }
        let target = match hir[i].target {
            ImportEqualsTarget::Require(spec) => {
                // `rewriteModuleSpecifier`
                self.result_has_external_module_indicator = true;
                [b"require(", &self.module_specifier_text(s, spec)[..], b")"].concat()
            }
            ImportEqualsTarget::Entity(names) => {
                let names: Vec<&[u8]> = names.iter().map(|it| self.name(hir[it].text)).collect();
                names.join(&b"."[..])
            }
        };
        let type_only: &[u8] = if hir[i].flags.contains(Flags::TYPE_ONLY) {
            b"type "
        } else {
            b""
        };
        let name = self.name(hir[i].name);
        let text = [b"import ", type_only, name, b" = ", &target[..], b";"].concat();
        Some(self.update_import(StatementKind::ImportEquals, s, text))
    }

    /// `getBindingNameVisible`
    fn is_binding_name_visible(&mut self, pat: PatId) -> bool {
        let file = self.file();
        let hir = self.c.hir(file);
        match hir[pat].kind {
            PatKind::Missing => false,
            PatKind::Ident(_) => self.c.is_declaration_visible(file, Decl::Var(pat)),
            PatKind::Object(props) => props
                .iter()
                .any(|p| self.is_binding_name_visible(hir[p].value)),
            PatKind::Array(elems) => elems
                .iter()
                .any(|e| self.is_binding_name_visible(hir[e].pat)),
        }
    }

    /// `transformVariableStatement`
    fn transform_variable_statement(
        &mut self,
        decls: Span<VarDeclId>,
        s: StmtId,
    ) -> Option<Vec<Statement>> {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        if !decls
            .iter()
            .any(|d| self.is_binding_name_visible(hir[d].pat))
        {
            return None;
        }
        let mut declarations: Vec<Element> = Vec::new();
        let mut extra_imports: Vec<Statement> = Vec::new();
        let scope = match bound.stmt_parent[s.idx()] {
            Parent::File => ScopeId(0),
            Parent::Module(m) => bound.module_scope[m.idx()],
            _ => self.enclosing.scope,
        };
        let is_commonjs = bound.commonjs_indicator.is_some();
        for d in decls.iter() {
            let pat = hir[d].pat;
            if self.c.should_strip_internal(self.file(), hir[d].loc.pos) {
                continue;
            }
            // `IsVariableDeclarationInitializedToRequire`
            let is_require = is_commonjs
                && hir.is_js
                && hir[d].init.is_some()
                && crate::bind::required_specifier(hir, hir[d].init).is_some();
            if is_require {
                extra_imports.extend(self.transform_cjs_require_variable_declaration(d));
                continue;
            }
            if !self.is_binding_name_visible(pat) {
                continue;
            }
            let saved = (
                self.enclosing,
                self.tracker.get_symbol_accessibility_diagnostic,
                self.tracker.error_name_node,
                self.suppresses_new_contexts,
            );
            self.enclosing = Enclosing {
                variable: d,
                ..Enclosing::at_scope(self.file(), scope)
            };
            if !self.suppresses_new_contexts {
                self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(hir.node(d));
            }
            if let PatKind::Ident(name) = hir[pat].kind {
                self.suppresses_new_contexts = true;
                let ensured = self.ensure_type(hir.node(d), false);
                let loc = hir[d].loc;
                declarations.push(Element {
                    range: (loc.end != 0).then_some((loc.pos as usize, loc.end as usize)),
                    text: [self.name(name), &ensured.text()[..]].concat(),
                });
            } else {
                let names = self.recreate_binding_pattern(pat, true);
                declarations.extend(names.into_iter().map(|text| Element { range: None, text }));
            }
            (
                self.enclosing,
                self.tracker.get_symbol_accessibility_diagnostic,
                self.tracker.error_name_node,
                self.suppresses_new_contexts,
            ) = saved;
        }
        if declarations.is_empty() {
            return (!extra_imports.is_empty()).then_some(extra_imports);
        }
        let modified = ModifiedNode::new(bound.stmt_parent[s.idx()] == Parent::File);
        let keyword: &[u8] = match decls.iter().next().map(|d| hir[d].kind) {
            Some(VarKind::Var) | None => b"var ",
            Some(VarKind::Let) => b"let ",
            Some(VarKind::Const | VarKind::Using | VarKind::AwaitUsing) => b"const ",
        };
        // `End()` of the declaration list, which emits the comments after its last declaration
        // unless the statement ends there too.
        let list_end = decls.iter().next_back().map_or(0, |d| hir[d].loc.end);
        let declarations =
            self.list_text_in(declarations, ListFormat::SINGLE_LINE, list_end as usize);
        let mut list = [keyword, &declarations[..]].concat();
        if list_end != hir[s].loc.end {
            list = self.with_comments((None, list_end), &list);
        }
        extra_imports.push(Statement {
            kind: StatementKind::Other,
            comments: Vec::new(),
            modifiers: self.ensure_modifiers(hir[s].modifiers, modified),
            text: [&list[..], b";"].concat(),
        });
        Some(extra_imports)
    }

    /// `recreateBindingPattern`, and `walkBindingPattern`, which does not check visibility: each
    /// name with its type.
    fn recreate_binding_pattern(&mut self, pat: PatId, only_visible: bool) -> Vec<Vec<u8>> {
        let hir = self.c.hir(self.file());
        let elements: Vec<PatId> = match hir[pat].kind {
            PatKind::Object(props) => props.iter().map(|p| hir[p].value).collect(),
            PatKind::Array(elems) => elems.iter().map(|e| hir[e].pat).collect(),
            _ => return Vec::new(),
        };
        let mut names = Vec::with_capacity(elements.len());
        for element in elements {
            if only_visible && !self.is_binding_name_visible(element) {
                continue;
            }
            match hir[element].kind {
                PatKind::Missing => {}
                PatKind::Ident(name) => {
                    let ensured = self.ensure_type(hir.parent(hir.node(element)), false);
                    // The declaration is synthesized. Its name is the node of the file.
                    let pos = self.c.end_of_token_before(self.file(), hir[element].pos);
                    let name = self.with_comments((Some(pos), hir[element].end), self.name(name));
                    names.push([&name[..], &ensured.text()[..]].concat());
                }
                _ => names.append(&mut self.recreate_binding_pattern(element, only_visible)),
            }
        }
        names
    }

    /// `transformClassDeclaration`
    fn transform_class_declaration(&mut self, c: ClassId, s: StmtId) -> Vec<Statement> {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let class = hir[c];
        self.enter(bound.class_scope[c.idx()]);
        self.tracker.error_name_node = hir.name(hir.node(s));
        self.tracker.fallback_stack.push(hir.node(s));
        let modified = ModifiedNode::new(bound.stmt_parent[s.idx()] == Parent::File);
        let modifiers = self.ensure_modifiers(hir[s].modifiers, modified);
        let type_parameters = self.visit_type_parameters(class.type_params);
        let members = self.build_class_members(c);
        let (base, heritage) = self.visit_class_heritage(c);
        self.tracker.fallback_stack.pop();
        let name = match self.name(class.name) {
            b"" => Vec::new(),
            name => [b" ", name].concat(),
        };
        let head = [
            b"class",
            &name[..],
            &type_parameters[..],
            &heritage[..],
            b" ",
        ]
        .concat();
        let class = Statement {
            kind: StatementKind::Other,
            comments: Vec::new(),
            modifiers,
            text: [&head[..], &self.block(&members, b"")[..]].concat(),
        };
        base.into_iter().chain([class]).collect()
    }

    /// `transformClassExpressionToDeclaration`
    fn transform_class_expression(
        &mut self,
        c: ClassId,
        name: &[u8],
        modifiers: Vec<Flags>,
    ) -> Statement {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let class = hir[c];
        let saved = (self.enclosing, self.in_class_expression);
        self.enter(bound.class_scope[c.idx()]);
        self.in_class_expression = true;
        let members = self.build_class_members(c);
        let type_parameters = self.visit_type_parameters(class.type_params);
        let (_, heritage) = self.visit_class_heritage(c);
        (self.enclosing, self.in_class_expression) = saved;
        let head = [b"class ", name, &type_parameters[..], &heritage[..], b" "].concat();
        Statement {
            kind: StatementKind::Other,
            comments: Vec::new(),
            modifiers,
            text: [&head[..], &self.block(&members, b"")[..]].concat(),
        }
    }

    /// `buildClassMembers`: each member, as emitted one indentation level deeper.
    fn build_class_members(&mut self, c: ClassId) -> Vec<Vec<u8>> {
        let hir = self.c.hir(self.file());
        let members = hir[c].members;
        self.set_indent(self.indent + 1);
        let mut parameter_properties: Vec<Vec<u8>> = Vec::new();
        // `GetFirstConstructorWithBody`
        let constructor = members.iter().find(|&m| {
            hir[m].kind == MemberKind::Constructor
                && hir[m].func.is_some()
                && !matches!(hir[hir[m].func].body, FnBody::None)
        });
        if let Some(constructor) = constructor {
            let saved = self.tracker.get_symbol_accessibility_diagnostic;
            let mut previous_sibling = None;
            for p in hir[hir[constructor].func].params.iter() {
                let previous_sibling = previous_sibling.replace(p);
                if !hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                    || (self.c).should_strip_internal_parameter(self.file(), p, previous_sibling)
                {
                    continue;
                }
                self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(hir.node(p));
                let modified = ModifiedNode::Nested;
                let modifiers = self.ensure_modifiers(hir.param_modifiers(p), modified);
                // `preserveJsDoc`
                let comments = self.leading_comments(hir[p].loc.pos);
                let modifiers = [comments, modifiers_text(&modifiers)].concat();
                match hir[hir[p].pat].kind {
                    PatKind::Ident(name) => {
                        let ensured = self.ensure_type(hir.node(p), false);
                        let question: &[u8] = if hir[p].flags.contains(Flags::OPTIONAL) {
                            b"?"
                        } else {
                            b""
                        };
                        let name = self.name(name);
                        let property =
                            [&modifiers[..], name, question, &ensured.text()[..], b";"].concat();
                        parameter_properties
                            .push(self.with_comments((None, hir[p].loc.end), &property));
                    }
                    _ => {
                        for name in self.recreate_binding_pattern(hir[p].pat, false) {
                            parameter_properties.push([&modifiers[..], &name[..], b";"].concat());
                        }
                    }
                }
            }
            self.tracker.get_symbol_accessibility_diagnostic = saved;
        }
        let mut written: Vec<Vec<u8>> = Vec::new();
        // "When the class has at least one private identifier, create a unique constant identifier to retain the nominal typing behavior"
        if (members.iter()).any(|m| matches!(hir[m].key, PropKey::Private(_))) {
            written.push(b"#private;".to_vec());
        }
        written.append(&mut self.create_late_bound_index_signatures(c));
        written.append(&mut parameter_properties);
        written.append(&mut self.collect_this_property_assignments(c));
        for m in members.iter() {
            written.extend(self.visit_member(m));
        }
        self.set_indent(self.indent - 1);
        written
    }

    /// `CreateLateBoundIndexSignatures`
    fn create_late_bound_index_signatures(&mut self, c: ClassId) -> Vec<Vec<u8>> {
        let file = self.file();
        let files = self.c.files();
        let class = self.c.class_sym(file, c);
        let mut written: Vec<Vec<u8>> = Vec::new();
        for is_static in [true, false] {
            let holder = if is_static {
                self.c.type_of_symbol(class)
            } else {
                self.c.declared_type(class)
            };
            let Some(members) = self.c.members(holder) else {
                continue;
            };
            let (infos, mapper) = (&members.shape().index, members.mapper);
            for &info in infos {
                if info.declaration.is_some() {
                    continue;
                }
                let components = self.c.index_components(info.components);
                // `anyBaseTypeIndexInfo`: "inherited, but looks like a late-bound signature because it has no declarations"
                if components.is_empty() {
                    continue;
                }
                // `getIndexInfosOfIndexSymbol(instanceIndexSymbol, ..)`: those of the class itself.
                let is_own = |component: &IndexComponent| {
                    matches!(*component, IndexComponent::Member(of, m)
                        if of == file && self.c.bound(of).member_owner[m.idx()] == MemberOwner::Class(c))
                };
                if !is_static && !components.iter().all(is_own) {
                    continue;
                }
                let modifiers: &[u8] = match (is_static, info.readonly) {
                    (true, true) => b"static readonly ",
                    (true, false) => b"static ",
                    (false, true) => b"readonly ",
                    (false, false) => b"",
                };
                let mut names = Vec::with_capacity(components.len());
                for &component in components {
                    if let (of, PropKey::Computed(name)) = self.c.name_of_index_component(component)
                        && self.c.is_trivially_serializable_computed_name_at(
                            of,
                            name,
                            self.enclosing,
                        )
                    {
                        names.push((component, of, name));
                    }
                }
                if !components.is_empty() && names.len() == components.len() {
                    for (component, of, name) in names {
                        // `hasLateBindableName`: it is preserved as a property.
                        if self.c.member_name(of, PropKey::Computed(name)).is_some() {
                            continue;
                        }
                        let first = first_identifier(self.c.hir(of), name);
                        if let ExprKind::Ident(text) = self.c.hir(of)[first].kind {
                            let scope = self.c.enclosing_scope_of_expr(of, first);
                            let meaning = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
                            if let Some(symbol) = files.resolve_name(of, scope, text, meaning) {
                                self.tracker.track_symbol(
                                    self.c,
                                    symbol,
                                    Some(self.enclosing),
                                    SymFlags::VALUE,
                                );
                            }
                        }
                        let ty = self.c.type_of_index_component(component);
                        let ty = self.c.type_to_type_node(
                            ty,
                            Some(self.enclosing),
                            DECLARATION_EMIT_NODE_BUILDER_FLAGS,
                            Some(&mut self.tracker),
                        );
                        let name = self.text_of(Written::EntityName(name));
                        // `c.QuestionToken()`
                        let question: &[u8] = match component {
                            IndexComponent::Member(of, m)
                                if self.c.hir(of)[m].flags.contains(Flags::OPTIONAL) =>
                            {
                                b"?"
                            }
                            _ => b"",
                        };
                        let name = [modifiers, b"[", &name[..], b"]", question].concat();
                        written.push([&name[..], b": ", &ty[..], b";"].concat());
                    }
                    continue;
                }
                // `IndexInfoToIndexSignatureDeclaration`
                let value = self.c.instantiate(info.value, mapper);
                let value = self.c.type_to_type_node(
                    value,
                    Some(self.enclosing),
                    DECLARATION_EMIT_NODE_BUILDER_FLAGS,
                    Some(&mut self.tracker),
                );
                let key = self.c.type_to_type_node(
                    info.key,
                    Some(self.enclosing),
                    DECLARATION_EMIT_NODE_BUILDER_FLAGS,
                    None,
                );
                written.push([modifiers, b"[x: ", &key[..], b"]: ", &value[..], b";"].concat());
            }
        }
        written
    }

    /// The heritage clauses of a class, each preceded by a space. If the expression a class
    /// declaration extends is not a name, it is emitted as a variable of its type, with the
    /// statement that declares it.
    fn visit_class_heritage(&mut self, c: ClassId) -> (Option<Statement>, Vec<u8>) {
        let hir = self.c.hir(self.file());
        let (class, base) = (hir[c], hir.node(c).with(Part::Base));
        let (mut variable, mut heritage) = (None, Vec::new());
        if class.extends.is_some() {
            if is_entity_name_expression(hir, class.extends) {
                let saved = self.tracker.get_symbol_accessibility_diagnostic;
                if !self.suppresses_new_contexts {
                    self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(base);
                }
                if let Some((first, start)) = self.c.first_identifier(self.file(), class.extends) {
                    self.check_entity_name_visibility(first, start, Meaning::ValueOfName);
                }
                for argument in hir.ids(class.extends_args) {
                    self.visit_type(argument, false);
                }
                self.tracker.get_symbol_accessibility_diagnostic = saved;
                let name = self.text_of(Written::EntityName(class.extends));
                let arguments = self.type_arguments_text(class.extends_args);
                heritage = [b" extends ", &name[..], &arguments[..]].concat();
            } else if matches!(hir[class.extends].kind, ExprKind::Null) {
                heritage = b" extends null".to_vec();
            } else if hir.kind(hir.node(c)) == Kind::ClassDeclaration
                && !matches!(hir[class.extends].kind, ExprKind::Null)
            {
                self.tracker.get_symbol_accessibility_diagnostic = Context::ExtendsClause(base);
                let file = self.file();
                let expression = hir.child(class.extends);
                self.tracker
                    .report_inference_fallback(self.c, file, expression);
                let old_name: &[u8] = if class.name.is_some() {
                    self.name(class.name)
                } else {
                    b"default"
                };
                let name = self.unique_name(&[old_name, b"_base"].concat());
                let ty = self.create_type_of_expression(class.extends);
                for argument in hir.ids(class.extends_args) {
                    self.visit_type(argument, false);
                }
                variable = Some(Statement {
                    kind: StatementKind::Other,
                    comments: Vec::new(),
                    modifiers: if self.needs_declare {
                        vec![Flags::AMBIENT]
                    } else {
                        Vec::new()
                    },
                    text: [b"const ", &name[..], b": ", &ty[..], b";"].concat(),
                });
                let arguments = self.type_arguments_text(class.extends_args);
                heritage = [b" extends ", &name[..], &arguments[..]].concat();
            }
        }
        let mut implements = Vec::new();
        for node in hir.ids(class.implements) {
            self.visit_heritage_type(node);
            // `transformHeritageClause`
            if matches!(hir[node].kind, TypeNodeKind::Ref { .. }) {
                implements.push(self.text_of(Written::Type(node)));
            }
        }
        if !implements.is_empty() {
            heritage.extend_from_slice(b" implements ");
            heritage.extend_from_slice(&implements.join(&b", "[..]));
        }
        (variable, heritage)
    }

    /// `transformExpressionWithTypeArguments` for a type that a class implements or an interface
    /// extends.
    fn visit_heritage_type(&mut self, node: TypeNodeId) {
        let saved = self.tracker.get_symbol_accessibility_diagnostic;
        if !self.suppresses_new_contexts {
            let node = self.c.hir(self.file()).node(node);
            self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(node);
        }
        self.visit_type(node, false);
        self.tracker.get_symbol_accessibility_diagnostic = saved;
    }

    /// `transformExportAssignment`
    fn transform_export_assignment(
        &mut self,
        input: Node,
        assignment: Node,
        e: ExprId,
        is_export_equals: bool,
    ) -> Vec<Statement> {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        // `input.Parent`, `input.Pos()`
        let (parent, pos) = match hir.data(input) {
            NodeData::Stmt(s) => (bound.stmt_parent[s.idx()], Some(hir[s].loc.pos)),
            _ => (Parent::None, None),
        };
        let comments = |emit: &mut Self| pos.map_or(Vec::new(), |pos| emit.leading_comments(pos));
        self.result_has_external_module_indicator |= parent == Parent::File;
        self.result_has_scope_marker = true;
        let keyword: &[u8] = if is_export_equals {
            b"export = "
        } else {
            b"export default "
        };
        let export_of = |name: &[u8]| {
            Statement::new(
                StatementKind::ExportAssignment,
                [keyword, name, b";"].concat(),
            )
        };
        if let ExprKind::Ident(name) = hir[e].kind
            && !is_parenthesized(self.c.hir(self.file()), e)
            && matches!(parent, Parent::File | Parent::Module(_))
        {
            let mut written = export_of(self.name(name));
            written.comments = comments(self);
            return vec![written];
        }
        // `SkipOuterExpressions(expression, OEKExpressionTypePassthrough)`
        let mut unwrapped = e;
        loop {
            unwrapped = match hir[unwrapped].kind {
                ExprKind::Assign {
                    op: None, value, ..
                } => value,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => right,
                _ => break,
            };
        }
        // `getNameOfExportedAssignedExpression`, `tryGetNameOfAssignedExpression`
        let own_name = match hir[unwrapped].kind {
            ExprKind::Class(c) => hir[c].name,
            ExprKind::Fn(f) => hir[f].name,
            ExprKind::Ident(name) => name,
            _ => Atom::NONE,
        };
        let name = if own_name.is_some() && own_name != known::default {
            // `IsNameResolvable`
            let any = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
            let at = self.enclosing;
            match self
                .c
                .files()
                .resolve_name(at.file, at.scope, own_name, any)
            {
                Some(_) => self.unique_name(self.name(own_name)),
                None => self.name(own_name).to_vec(),
            }
        } else if is_export_equals && hir.is_js {
            self.unique_name(b"_exports")
        } else {
            self.unique_name(b"_default")
        };
        self.cjs_export_assignment_name = Some(name.clone());
        let declare = if self.needs_declare {
            vec![Flags::AMBIENT]
        } else {
            Vec::new()
        };
        match hir[unwrapped].kind {
            ExprKind::Class(c) => {
                let mut class = self.transform_class_expression(c, &name, declare);
                class.comments = comments(self);
                return vec![export_of(&name), class];
            }
            ExprKind::Fn(f) => {
                let signature = self.transform_signature(f);
                let function = Statement {
                    kind: StatementKind::Other,
                    comments: comments(self),
                    modifiers: declare,
                    text: [b"function ", &name[..], &signature[..], b";"].concat(),
                };
                return vec![export_of(&name), function];
            }
            _ => {}
        }
        self.tracker.get_symbol_accessibility_diagnostic = Context::DefaultExport(input);
        // `IsPrimitiveLiteralValue`: it is emitted verbatim.
        let ensured = if self.c.iso_is_primitive_literal(self.file(), e, true) {
            let literal = self.c.type_of_expr(self.file(), e);
            Ensured::Initializer(self.create_literal_const_value(literal))
        } else {
            self.tracker.fallback_stack.push(assignment);
            let ensured = self.ensure_type(assignment, false);
            self.tracker.fallback_stack.pop();
            ensured
        };
        let variable = Statement {
            kind: StatementKind::Other,
            comments: comments(self),
            modifiers: declare,
            text: [b"const ", &name[..], &ensured.text()[..], b";"].concat(),
        };
        vec![variable, export_of(&name)]
    }

    // ───────────────────────────── members and signatures ─────────────────────────────

    /// `IsImplementationOfOverload`. `getSignaturesOfSymbol` has one signature for each function
    /// declaration, except the implementation.
    fn is_implementation_of_overload(&mut self, f: FnId) -> bool {
        let (file, files) = (self.file(), self.c.files());
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        if matches!(hir[f].body, FnBody::None) {
            return false;
        }
        let declarations = match bound.fns[f.idx()].owner {
            FnOwner::Stmt(_) if bound.fn_symbol[f.idx()].is_some() => {
                files.decls_of(files.sym(file, bound.fn_symbol[f.idx()]))
            }
            // `getSymbolOfDeclaration`: a computed name resolves to the late-bound symbol.
            FnOwner::Member(m) => self.c.declarations_of_member(file, Decl::Member(m)),
            _ => return false,
        };
        let is_function_like = |&&(file, decl): &&(FileId, Decl)| match decl {
            Decl::Fn(_) => true,
            Decl::Member(m) => self.c.hir(file)[m].func.is_some(),
            _ => false,
        };
        declarations.iter().filter(is_function_like).count() > 1
    }

    /// `GetEffectiveDeclarationFlags(node, ModifierFlagsPrivate) != 0` for a function-like node.
    fn is_private_function(&self, f: FnId) -> bool {
        let hir = self.c.hir(self.file());
        hir.flags(hir.node(f)).contains(Flags::PRIVATE)
    }

    /// `ensureTypeParams`, `updateParamList`, `ensureType`: `<T>(a: T): T`
    fn transform_signature(&mut self, f: FnId) -> Vec<u8> {
        let type_parameters = self.ensure_type_params(f);
        let parameters = self.update_param_list(f);
        let returned = self.ensure_type(self.c.hir(self.file()).node(f), false);
        [
            &type_parameters[..],
            b"(",
            &parameters[..],
            b")",
            &returned.text()[..],
        ]
        .concat()
    }

    /// `ensureTypeParams`: `<A, B>`, or nothing.
    fn ensure_type_params(&mut self, f: FnId) -> Vec<u8> {
        if self.is_private_function(f) {
            return Vec::new();
        }
        let file = self.file();
        let hir = self.c.hir(file);
        // `typeParametersToTypeParameterDeclarations` has those of a symbol with
        // `SymbolFlagsFunction`.
        if !hir[f].type_params.is_empty()
            || hir.jsdoc_type(JsDocTypeOwner::Fn(f)).is_none()
            || !matches!(hir[f].kind, FnKind::Decl | FnKind::Expr | FnKind::Arrow)
        {
            return self.visit_type_parameters(hir[f].type_params);
        }
        let node = hir.node(f);
        let saved = (
            self.tracker.error_name_node,
            self.tracker.get_symbol_accessibility_diagnostic,
        );
        self.tracker.error_name_node = hir.name(node);
        if !self.suppresses_new_contexts && can_produce_diagnostics(hir.kind(node)) {
            self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(node);
        }
        // `CreateTypeParametersOfSignatureDeclaration`
        let type_parameters = self.c.serialize_type_parameters_for_signature(
            file,
            f,
            self.enclosing,
            DECLARATION_EMIT_NODE_BUILDER_FLAGS,
            &mut self.tracker,
        );
        self.tracker.error_name_node = saved.0;
        if !self.suppresses_new_contexts {
            self.tracker.get_symbol_accessibility_diagnostic = saved.1;
        }
        type_parameters
    }

    /// `updateParamList`: the parameters, with `, ` between them.
    fn update_param_list(&mut self, f: FnId) -> Vec<u8> {
        if self.is_private_function(f) {
            return Vec::new();
        }
        let hir = self.c.hir(self.file());
        let function = hir[f];
        let mut parameters = Vec::with_capacity(function.params.len() + 1);
        if function.this_ty(hir).is_some() {
            // `ensureParameter`
            let ty = match self.ensure_type(hir.node(function.this_param), true) {
                Ensured::Type(ty) => ty,
                Ensured::Nothing | Ensured::Initializer(_) => Vec::new(),
            };
            parameters.push(Element {
                range: None,
                text: [b"this: ", &ty[..]].concat(),
            });
        }
        for p in function.params.iter() {
            let loc = hir[p].loc;
            parameters.push(Element {
                range: (loc.end != 0).then_some((loc.pos as usize, loc.end as usize)),
                text: self.ensure_parameter(p),
            });
        }
        self.list_text(parameters, ListFormat::SINGLE_LINE)
    }

    /// `emitListItems`: see `Writer::emit_list_items`.
    fn list_text(&self, elements: Vec<Element>, format: ListFormat) -> Vec<u8> {
        self.list_text_in(elements, format, usize::MAX)
    }

    /// The same, in a parent that may end where its last element ends.
    fn list_text_in(
        &self,
        mut elements: Vec<Element>,
        format: ListFormat,
        parent_end: usize,
    ) -> Vec<u8> {
        if !self.writes() {
            return Vec::new();
        }
        if self.c.files().options.remove_comments {
            elements.iter_mut().for_each(|it| it.range = None);
        }
        let mut writer = Writer::new(&self.c.hir(self.file()).text, self.indent);
        writer.emit_list_items(&elements, b",", format, parent_end);
        writer.into_text()
    }

    /// `ensureParameter`
    fn ensure_parameter(&mut self, p: ParamId) -> Vec<u8> {
        let file = self.file();
        let hir = self.c.hir(file);
        let saved = self.tracker.get_symbol_accessibility_diagnostic;
        if !self.suppresses_new_contexts {
            self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(hir.node(p));
        }
        self.visit_binding_name(hir[p].pat);
        let ensured = self.ensure_type(hir.node(p), true);
        self.tracker.get_symbol_accessibility_diagnostic = saved;
        let rest: &[u8] = if hir[p].flags.contains(Flags::REST) {
            b"..."
        } else {
            b""
        };
        let question: &[u8] = if self.writes() && self.c.is_optional_parameter(file, p) {
            b"?"
        } else {
            b""
        };
        let name = self.text_of(Written::BindingName(hir[p].pat));
        [rest, &name[..], question, &ensured.text()[..]].concat()
    }

    /// `visitBindingName`
    fn visit_binding_name(&mut self, pat: PatId) {
        let hir = self.c.hir(self.file());
        match hir[pat].kind {
            PatKind::Object(props) => {
                for p in props.iter() {
                    if let PropKey::Computed(key) = hir[p].key
                        && is_entity_name_expression(self.c.hir(self.file()), key)
                        && let Some((first, start)) = self.c.first_identifier(self.file(), key)
                    {
                        self.check_entity_name_visibility(first, start, Meaning::ValueOfName);
                    }
                    self.visit_binding_name(hir[p].value);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.visit_binding_name(hir[e].pat);
                }
            }
            PatKind::Ident(_) | PatKind::Missing => {}
        }
    }

    /// `visitDeclarationSubtree` for a type parameter.
    fn visit_type_parameter(&mut self, tp: TypeParamId) -> Vec<u8> {
        let hir = self.c.hir(self.file());
        let saved = self.tracker.get_symbol_accessibility_diagnostic;
        if !self.suppresses_new_contexts {
            self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(hir.node(tp));
        }
        self.visit_type(hir[tp].constraint, false);
        self.visit_type(hir[tp].default, false);
        self.tracker.get_symbol_accessibility_diagnostic = saved;
        self.text_of(Written::TypeParameter(tp))
    }

    /// `visitDeclarationSubtree` for a member of a class, an interface or a type literal. `None`:
    /// nothing is emitted for it.
    fn visit_member(&mut self, m: MemberId) -> Option<Vec<u8>> {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let member = hir[m];
        if self.c.should_strip_internal(self.file(), member.loc.pos) {
            return None;
        }
        let f = member.func;
        if member.kind == MemberKind::StaticBlock
            || f.is_none() && member.kind != MemberKind::Property
        {
            return None;
        }
        // `HasDynamicName`: `[-1]` is none.
        let dynamic_name = match member.key {
            PropKey::Computed(key)
                if !matches!(
                    hir[key].kind,
                    ExprKind::Unary {
                        op: UnOp::Minus | UnOp::Plus,
                        operand
                    } if matches!(hir[operand].kind, ExprKind::Number(_))
                ) =>
            {
                Some(key)
            }
            _ => None,
        };
        if let Some(isolated_declarations) = &mut self.tracker.isolated_declarations {
            if self.c.iso_report_dynamic_name(isolated_declarations, m) {
                return None;
            }
        }
        // `IsLateBound`
        else if let Some(key) = dynamic_name
            && !(is_entity_name_expression(self.c.hir(self.file()), key)
                && self.c.member_name(self.file(), member.key).is_some())
        {
            return None;
        }
        if f.is_some()
            && !matches!(member.kind, MemberKind::Getter | MemberKind::Setter)
            && self.is_implementation_of_overload(f)
        {
            return None;
        }
        let saved = (
            self.enclosing,
            self.tracker.get_symbol_accessibility_diagnostic,
            self.tracker.error_name_node,
            self.suppresses_new_contexts,
        );
        if f.is_some() {
            self.enter(bound.fns[f.idx()].scope);
        }
        if !self.suppresses_new_contexts {
            self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(hir.node(m));
        }
        let is_private = member.flags.contains(Flags::PRIVATE);
        let is_written = !matches!(member.key, PropKey::Private(_));
        let mut written = None;
        if is_written {
            let modified = ModifiedNode::Nested;
            let modifiers = modifiers_text(&self.ensure_modifiers(member.modifiers, modified));
            let name = self.text_of(Written::PropertyName(hir.name(hir.node(m))));
            let head = match member.kind {
                MemberKind::Method if member.flags.contains(Flags::REPARSED) => {
                    self.head_of_reparsed_method(m, &modifiers, &name)
                }
                _ => [&modifiers[..], &name[..]].concat(),
            };
            let question: &[u8] = if member.flags.contains(Flags::OPTIONAL) {
                b"?"
            } else {
                b""
            };
            written = match member.kind {
                MemberKind::Property => {
                    let ensured = self.ensure_type(hir.node(m), false);
                    Some([&head[..], question, &ensured.text()[..], b";"].concat())
                }
                // `omitPrivateMethodType`: emitted once, regardless of its overloads.
                MemberKind::Method if is_private => {
                    let files = self.c.files();
                    let symbol = bound.member_symbol[m.idx()];
                    let is_first = symbol.is_none()
                        || files.decls_of(files.sym(self.file(), symbol)).first()
                            == Some(&(self.file(), Decl::Member(m)));
                    is_first.then(|| [&head[..], b";"].concat())
                }
                MemberKind::Method => {
                    let signature = self.transform_signature(f);
                    Some([&head[..], question, &signature[..], b";"].concat())
                }
                MemberKind::CallSignature => {
                    Some([&self.transform_signature(f)[..], b";"].concat())
                }
                MemberKind::ConstructSignature => {
                    Some([b"new ", &self.transform_signature(f)[..], b";"].concat())
                }
                MemberKind::Constructor => {
                    let parameters = self.update_param_list(f);
                    Some([&modifiers[..], b"constructor(", &parameters[..], b");"].concat())
                }
                MemberKind::Getter => {
                    if !is_private {
                        self.visit_type(hir[f].this_ty(hir), false);
                    }
                    let ensured = self.ensure_type(hir.node(m), false);
                    let name = [&modifiers[..], b"get ", &name[..]].concat();
                    Some([&name[..], b"()", &ensured.text()[..], b";"].concat())
                }
                // `updateAccessorParamList`
                MemberKind::Setter => {
                    let mut value = None;
                    if !is_private {
                        self.visit_type(hir[f].this_ty(hir), false);
                        if let Some(parameter) = hir[f].params.iter().next() {
                            let loc = hir[parameter].loc;
                            let element = Element {
                                range: (loc.end != 0)
                                    .then_some((loc.pos as usize, loc.end as usize)),
                                text: self.ensure_parameter(parameter),
                            };
                            value = Some(self.list_text(vec![element], ListFormat::SINGLE_LINE));
                        }
                    }
                    let value = value.unwrap_or_else(|| {
                        if is_private {
                            b"value".to_vec()
                        } else {
                            b"value: any".to_vec()
                        }
                    });
                    let name = [&modifiers[..], b"set ", &name[..]].concat();
                    Some([&name[..], b"(", &value[..], b");"].concat())
                }
                MemberKind::IndexSignature => {
                    self.visit_type(hir[f].ret, false);
                    let value = self.text_of(Written::Type(hir[f].ret));
                    let parameters = self.update_param_list(f);
                    let key = [&modifiers[..], b"[", &parameters[..], b"]: "].concat();
                    Some([&key[..], &value[..], b";"].concat())
                }
                MemberKind::StaticBlock => None,
            };
        }
        // `checkName`
        if is_written
            && let Some(key) = dynamic_name
            && let Some((first, start)) = self.c.first_identifier(self.file(), key)
        {
            if !self.suppresses_new_contexts {
                self.tracker.get_symbol_accessibility_diagnostic =
                    Context::ForNodeName(hir.node(m));
            }
            self.check_entity_name_visibility(first, start, Meaning::ValueOfName);
        }
        (
            self.enclosing,
            self.tracker.get_symbol_accessibility_diagnostic,
            self.tracker.error_name_node,
            self.suppresses_new_contexts,
        ) = saved;
        let written = self.with_comments((None, member.loc.end), &written?);
        Some([self.leading_comments(member.loc.pos), written].concat())
    }

    /// The modifiers and the name of the method `m`, which `reparseJSDocSignature` makes from an
    /// `@overload` tag. The name is a clone of the name of the host and has its `Pos()`. `Pos()` of
    /// `m` is in the tag, so `emitLeadingComments` writes the comments before the name.
    fn head_of_reparsed_method(&mut self, m: MemberId, modifiers: &[u8], name: &[u8]) -> Vec<u8> {
        let hir = self.c.hir(self.file());
        // The host follows the methods that are made from its tags.
        let mut host = m;
        while hir[host].flags.contains(Flags::REPARSED) {
            host = MemberId(host.0 + 1);
        }
        let host = hir[host];
        let pos = if host.start == host.name_pos {
            host.loc.pos as usize
        } else {
            pos_before(&hir.text, host.name_pos as usize)
        };
        if modifiers.is_empty() {
            return [&self.leading_comments(pos as u32)[..], name].concat();
        }
        let mut writer = Writer::new(&hir.text, self.indent);
        writer.write(modifiers);
        if self.writes() && !self.c.files().options.remove_comments {
            writer.emit_leading_comments(pos);
        }
        writer.write(name);
        writer.into_text()
    }

    // ───────────────────────────── annotated types ─────────────────────────────

    /// `checkEntityNameVisibility`
    fn check_entity_name_visibility(&mut self, first: Atom, start: u32, meaning: Meaning) {
        let at = self.enclosing;
        let access = self
            .c
            .is_entity_name_visible(first, Some(start), meaning, at, true);
        self.tracker
            .handle_symbol_accessibility_error(self.c, access);
    }

    /// `visitDeclarationSubtree` for a type node. `is_alias_body`: it is the whole body of a type
    /// alias.
    fn visit_type(&mut self, node: TypeNodeId, is_alias_body: bool) {
        if node.is_none() || self.c.is_stack_low() {
            return;
        }
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        match hir[node].kind {
            TypeNodeKind::Ref { name, args } => {
                if !name.is_empty() {
                    let meaning = if name.len() == 1 {
                        Meaning::Type
                    } else {
                        Meaning::Namespace
                    };
                    self.check_entity_name_visibility(hir[name.at(0)].text, hir[node].pos, meaning);
                }
                for argument in hir.ids(args) {
                    self.visit_type(argument, false);
                }
            }
            TypeNodeKind::Typeof { args, expr, .. } => {
                if expr.is_some()
                    && let Some((first, start)) = self.c.first_identifier(self.file(), expr)
                {
                    self.check_entity_name_visibility(first, start, Meaning::ValueOfName);
                }
                for argument in hir.ids(args) {
                    self.visit_type(argument, false);
                }
            }
            TypeNodeKind::Import { args, .. } => {
                for argument in hir.ids(args) {
                    self.visit_type(argument, false);
                }
            }
            TypeNodeKind::Template { types, .. }
            | TypeNodeKind::Union(types)
            | TypeNodeKind::Intersection(types) => {
                for ty in hir.ids(types) {
                    self.visit_type(ty, false);
                }
            }
            TypeNodeKind::Array(of)
            | TypeNodeKind::Keyof(of)
            | TypeNodeKind::Readonly(of)
            | TypeNodeKind::Unique(of)
            | TypeNodeKind::JSDoc { ty: of, .. } => {
                self.visit_type(of, false);
            }
            TypeNodeKind::Tuple(elems) => {
                for elem in elems.iter() {
                    self.visit_type(hir[elem].ty, false);
                }
            }
            TypeNodeKind::Fn(f) => {
                let saved = self.enclosing;
                self.enter(bound.fns[f.idx()].scope);
                // The text emitted for a type comes from the printer (`text_of`).
                let writes = std::mem::take(&mut self.writes);
                for tp in hir[f].type_params.iter() {
                    self.visit_type_parameter(tp);
                }
                self.update_param_list(f);
                self.writes = writes;
                self.visit_type(hir[f].ret, false);
                self.enclosing = saved;
            }
            TypeNodeKind::Object(members) => {
                let saved = self.suppresses_new_contexts;
                self.suppresses_new_contexts |= !is_alias_body;
                let writes = std::mem::take(&mut self.writes);
                for m in members.iter() {
                    self.visit_member(m);
                }
                self.writes = writes;
                self.suppresses_new_contexts = saved;
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                self.visit_type(check, false);
                self.visit_type(extends, false);
                let saved = self.enclosing;
                self.enter(bound.type_scope[yes.idx()]);
                self.visit_type(yes, false);
                self.enclosing = saved;
                self.visit_type(no, false);
            }
            TypeNodeKind::Infer(tp) => {
                let writes = std::mem::take(&mut self.writes);
                self.visit_type_parameter(tp);
                self.writes = writes;
            }
            TypeNodeKind::Mapped(m) => {
                let mapped = hir[m];
                let saved = (self.enclosing, self.suppresses_new_contexts);
                self.enter(bound.type_param_scope[mapped.param.idx()]);
                self.suppresses_new_contexts |= !is_alias_body;
                self.visit_type(mapped.ty, false);
                let writes = std::mem::take(&mut self.writes);
                self.visit_type_parameter(mapped.param);
                self.writes = writes;
                self.visit_type(mapped.name_ty, false);
                (self.enclosing, self.suppresses_new_contexts) = saved;
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.visit_type(obj, false);
                self.visit_type(index, false);
            }
            TypeNodeKind::Predicate { ty, .. } => self.visit_type(ty, false),
            TypeNodeKind::Error
            | TypeNodeKind::Heritage(_)
            | TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::UniqueSymbol => {}
        }
    }

    // ───────────────────────────── inferred types ─────────────────────────────

    /// `shouldPrintWithInitializer`: the literal type of a constant that is emitted with its value.
    fn literal_const_type(&mut self, node: Node) -> Option<TypeId> {
        let hir = self.c.hir(self.file());
        let ty = match hir.data(node) {
            NodeData::VarDecl(d) if hir[d].kind == VarKind::Const && hir[d].init.is_some() => {
                self.c.type_of_pat(self.file(), hir[d].pat)
            }
            NodeData::Member(m)
                if hir[m].flags.contains(Flags::READONLY) && hir[m].init.is_some() =>
            {
                self.c.iso_type_of_member(self.file(), m)
            }
            _ => return None,
        };
        self.c.is_fresh_literal(ty).then_some(ty)
    }

    /// `CreateLiteralConstValue` for a type that is not `TypeFlagsEnumLike`. Its string literal is
    /// without `EFNoAsciiEscaping`, unlike that of the node builder.
    fn create_literal_const_value(&mut self, literal: TypeId) -> Vec<u8> {
        if let TypeData::StringLit { value, .. } = *self.c.data(literal) {
            return super::print::quoted(self.name(value), b'"', true);
        }
        let flags = DECLARATION_EMIT_NODE_BUILDER_FLAGS;
        self.c
            .type_to_type_node(literal, Some(self.enclosing), flags, None)
    }

    /// `ensureType`, `ensureNoInitializer`
    fn ensure_type(&mut self, node: Node, ignores_private: bool) -> Ensured {
        let file = self.file();
        let hir = self.c.hir(file);
        // A private declaration gets no type, except the parameter of a private parameter property.
        if !ignores_private && hir.flags(node).contains(Flags::PRIVATE) {
            return Ensured::Nothing;
        }
        if let Some(literal) = self.literal_const_type(node) {
            // `unwrapParenthesizedExpression(node.Initializer())`: the stored expression id excludes the parentheses.
            let initializer = match hir.data(node) {
                NodeData::VarDecl(d) => hir[d].init,
                NodeData::Member(m) => hir[m].init,
                _ => ExprId::NONE,
            };
            if initializer.is_some() && !self.c.iso_is_primitive_literal(file, initializer, true) {
                self.tracker.report_inference_fallback(self.c, file, node);
            }
            // `CreateLiteralConstValue`: an enum member is emitted by name.
            if let TypeData::EnumLit { member, .. } | TypeData::Enum { symbol: member, .. } =
                *self.c.data(literal)
            {
                self.tracker
                    .track_symbol(self.c, member, Some(self.enclosing), SymFlags::VALUE);
                if self.writes() {
                    let value = self.c.symbol_to_expression(member, self.enclosing);
                    return Ensured::Initializer(value);
                }
            }
            if !self.writes() {
                return Ensured::Nothing;
            }
            return Ensured::Initializer(self.create_literal_const_value(literal));
        }
        // An export assignment and a binding element have none.
        if let NodeData::Type(annotation) = hir.data(hir.type_node(node))
            && !matches!(hir.data(node), NodeData::Param(p)
                if self.c.requires_adding_implicit_undefined(file, p, Some(self.enclosing)))
        {
            if !hir.is_js {
                self.visit_type(annotation, false);
                return Ensured::Type(self.text_of(Written::Type(annotation)));
            }
            let flags = if self.in_class_expression {
                DECLARATION_EMIT_NODE_BUILDER_FLAGS & !WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL
            } else {
                DECLARATION_EMIT_NODE_BUILDER_FLAGS
            };
            let (at, tracker) = (self.enclosing, &mut self.tracker);
            if let Some(text) = self
                .c
                .try_js_type_node_to_type_node(file, annotation, at, flags, tracker)
            {
                return Ensured::Type(text);
            }
        }
        let saved = (
            self.tracker.error_name_node,
            self.tracker.get_symbol_accessibility_diagnostic,
        );
        self.tracker.error_name_node = hir.name(node);
        if !self.suppresses_new_contexts && can_produce_diagnostics(hir.kind(node)) {
            self.tracker.get_symbol_accessibility_diagnostic = Context::ForNode(node);
        }
        let flags = if self.in_class_expression {
            DECLARATION_EMIT_NODE_BUILDER_FLAGS & !WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL
        } else {
            DECLARATION_EMIT_NODE_BUILDER_FLAGS
        };
        let ty = match hir.data(node) {
            NodeData::Stmt(s) => match hir[s].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                    Some(self.type_of_export_assignment(s, e))
                }
                _ => None,
            },
            NodeData::Expr(e) if hir.is_js && !self.c.bound(file).is_expando_declaration(e) => {
                let ty = self.type_of_commonjs_declaration(e);
                ty.map(|ty| self.c.widen_literal(ty))
            }
            _ if self.c.iso_has_inferred_type(file, node) => {
                self.c.iso_type_of_declared(file, node)
            }
            _ => None,
        };
        let text = if let Some(ty) = ty {
            self.create_type_of_declaration(Some(node), ty, flags)
        } else if let Some(f) = hir.function_of(node).some() {
            // `CreateReturnTypeOfSignatureDeclaration`
            self.c.serialize_return_type_for_signature(
                file,
                f,
                self.enclosing,
                flags,
                &mut self.tracker,
            )
        } else {
            b"any".to_vec()
        };
        self.tracker.error_name_node = saved.0;
        if !self.suppresses_new_contexts {
            self.tracker.get_symbol_accessibility_diagnostic = saved.1;
        }
        Ensured::Type(text)
    }

    /// `getTypeOfSymbol` for the symbol of `export default e` or `export = e`.
    fn type_of_export_assignment(&mut self, s: StmtId, e: ExprId) -> TypeId {
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let container = match bound.stmt_parent[s.idx()] {
            Parent::Module(m) => files.sym(self.file(), bound.module_symbol[m.idx()]),
            _ => files.file_symbol(self.file()),
        };
        let name = if matches!(hir[s].kind, StmtKind::ExportDefault(_)) {
            known::default
        } else {
            known::export_equals
        };
        if let Some(symbol) = files.export(container, name)
            && files
                .decls_of(symbol)
                .iter()
                .any(|&d| d == (self.file(), Decl::ExportExpr(s)))
            && files.flags(symbol).contains(SymFlags::PROPERTY)
        {
            return self.c.type_of_symbol(symbol);
        }
        let ty = self.c.type_of_expr(self.file(), e);
        self.c.widened(ty)
    }

    /// `CreateTypeOfDeclaration` for a declaration of this file whose symbol has the type `ty`.
    fn create_type_of_declaration(
        &mut self,
        declaration: Option<Node>,
        ty: TypeId,
        flags: u32,
    ) -> Vec<u8> {
        let file = self.file();
        self.c.serialize_type_for_declaration(
            file,
            declaration,
            ty,
            self.enclosing,
            flags,
            &mut self.tracker,
        )
    }

    /// `CreateTypeOfExpression` for the expression the enclosing class extends.
    fn create_type_of_expression(&mut self, e: ExprId) -> Vec<u8> {
        let file = self.file();
        self.c.serialize_type_for_expression(
            file,
            e,
            self.enclosing,
            DECLARATION_EMIT_NODE_BUILDER_FLAGS,
            &mut self.tracker,
        )
    }
}

// ───────────────────────────── module specifier generation (`modulespecifiers`)
// ─────────────────────────────

/// `ModuleSpecifierEnding`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Ending {
    Minimal,
    Index,
    Js,
    Ts,
}

/// `MatchingMode`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Matching {
    Exact,
    Directory,
    Pattern,
}

/// `PathIsBareSpecifier`
fn path_is_bare_specifier(path: &[u8]) -> bool {
    get_root_length(path) == 0 && !path_is_relative(path)
}

/// `ComparePaths` for two normalized file names: neither has a relative path segment.
fn compare_paths(a: &[u8], b: &[u8], is_case_sensitive: bool) -> std::cmp::Ordering {
    let (a_root, a_rest) = a.split_at(get_root_length(a));
    let (b_root, b_rest) = b.split_at(get_root_length(b));
    compare_strings_case_insensitive(a_root, b_root).then_with(|| match is_case_sensitive {
        true => a_rest.cmp(b_rest),
        false => compare_strings_case_insensitive(a_rest, b_rest),
    })
}

/// `CountPathComponents`
fn count_path_components(path: &[u8]) -> usize {
    strings::count_char(path.strip_prefix(b"./").unwrap_or(path), b'/')
}

/// `TryGetRealFileNameForNonJSDeclarationFileName`
fn try_get_real_file_name_for_non_js_declaration_file_name(file_name: &[u8]) -> Option<Vec<u8>> {
    let base_name = file_name.rsplit(|&b| b == b'/').next().unwrap_or(file_name);
    let no_extension = file_name.strip_suffix(b".ts")?;
    if !strings::contains(base_name, b".d.") || base_name.ends_with(b".d.ts") {
        return None;
    }
    let extension = &no_extension[strings::last_index_of_char(no_extension, b'.')?..];
    let (before, _) = strings::split_once(no_extension, b".d.")?;
    Some([before, extension].concat())
}

/// `TryGetJSExtensionForFile`
fn js_extension_for_file(path: &[u8], preserves_jsx: bool) -> &'static [u8] {
    match known_extension(path) {
        b".ts" | b".d.ts" | b".js" => b".js",
        b".tsx" if preserves_jsx => b".jsx",
        b".tsx" => b".js",
        b".jsx" => b".jsx",
        b".json" => b".json",
        b".d.mts" | b".mts" | b".mjs" => b".mjs",
        b".d.cts" | b".cts" | b".cjs" => b".cjs",
        _ => b"",
    }
}

/// `GetNormalizedAbsolutePath(path, "")` for a package name followed by a path inside the package.
fn normalized_name(path: &[u8]) -> Vec<u8> {
    let mut name = join(b"/", path);
    name.remove(0);
    name
}

/// `GetPackageNameFromTypesPackageName`
fn package_name_from_types_package_name(name: &[u8]) -> Vec<u8> {
    match name.strip_prefix(b"@types/") {
        Some(mangled) => match strings::split_once(mangled, b"__") {
            Some((scope, rest)) => [&b"@"[..], scope, b"/", rest].concat(),
            None => mangled.to_vec(),
        },
        None => name.to_vec(),
    }
}

/// `tryGetModuleNameFromExportsOrImports` for `exports`: the specifier under which an importer
/// reaches the file `target` in the package in `package_directory`. `swapped`: `target` with its
/// JavaScript output extension. Empty: it cannot be imported.
fn module_name_from_exports(
    target: &[u8],
    swapped: &[u8],
    package_directory: &[u8],
    package_name: &[u8],
    exports: &Json,
    conditions: &[&[u8]],
    matching: Matching,
) -> Vec<u8> {
    match exports {
        Json::String(value) => {
            let pattern = join(package_directory, value);
            for candidate in [swapped, target] {
                if candidate.is_empty() {
                    continue;
                }
                match matching {
                    Matching::Exact => {
                        if candidate == pattern {
                            return package_name.to_vec();
                        }
                    }
                    Matching::Directory => {
                        if candidate
                            .strip_prefix(pattern.as_slice())
                            .is_some_and(|rest| rest.starts_with(b"/"))
                        {
                            let fragment = relative_normalized::<Posix, true>(&pattern, candidate);
                            return normalized_name(
                                &[package_name, b"/", value.as_slice(), b"/", fragment].concat(),
                            );
                        }
                    }
                    Matching::Pattern => {
                        let (leading, trailing) = strings::split_once(&pattern, b"*")
                            .unwrap_or((pattern.as_slice(), b""));
                        if leading.len() + trailing.len() <= candidate.len()
                            && candidate.starts_with(leading)
                            && candidate.ends_with(trailing)
                        {
                            let star = &candidate[leading.len()..candidate.len() - trailing.len()];
                            return package_name.replacen(b"*", star, 1);
                        }
                    }
                }
            }
        }
        Json::Array(list) => {
            for entry in list {
                let name = module_name_from_exports(
                    target,
                    swapped,
                    package_directory,
                    package_name,
                    entry,
                    conditions,
                    matching,
                );
                if !name.is_empty() {
                    return name;
                }
            }
        }
        // Each entry is a condition.
        Json::Object(entries) => {
            for (key, value) in entries {
                if key != b"default"
                    && !conditions.contains(&key.as_slice())
                    && !(conditions.contains(&&b"types"[..])
                        && crate::resolve::is_applicable_versioned_types_key(key))
                {
                    continue;
                }
                let name = module_name_from_exports(
                    target,
                    swapped,
                    package_directory,
                    package_name,
                    value,
                    conditions,
                    matching,
                );
                if !name.is_empty() {
                    return name;
                }
            }
        }
        _ => {}
    }
    Vec::new()
}

/// `tryGetModuleNameFromExports`
fn module_name_from_package_exports(
    target: &[u8],
    swapped: &[u8],
    package_directory: &[u8],
    package_name: &[u8],
    exports: &Json,
    conditions: &[&[u8]],
) -> Vec<u8> {
    // `IsSubpaths`
    if let Json::Object(entries) = exports
        && !entries.is_empty()
        && entries.iter().all(|entry| entry.0.starts_with(b"."))
    {
        for (key, value) in entries {
            let matching = if key.ends_with(b"/") {
                Matching::Directory
            } else if bun_core::strings::contains_char(key, b'*') {
                Matching::Pattern
            } else {
                Matching::Exact
            };
            let name = module_name_from_exports(
                target,
                swapped,
                package_directory,
                &normalized_name(&[package_name, b"/", key.as_slice()].concat()),
                value,
                conditions,
                matching,
            );
            if !name.is_empty() {
                return name;
            }
        }
    }
    module_name_from_exports(
        target,
        swapped,
        package_directory,
        package_name,
        exports,
        conditions,
        Matching::Exact,
    )
}

impl<'p, 's> Checker<'p, 's> {
    /// The relative specifiers in `file`, in source order.
    fn relative_specifiers_of(&self, file: FileId) -> Vec<&'p [u8]> {
        self.bound(file)
            .specifiers
            .iter()
            .map(|&specifier| self.atoms().bytes(specifier))
            .filter(|text| path_is_relative(text))
            .collect()
    }

    /// `resolutionMode` in `getSpecifierForModuleSymbol`. `mode`: `overrideImportMode`.
    fn resolution_mode_for_specifier(&self, at: Enclosing, mode: ResolutionMode) -> ResolutionMode {
        if mode != ResolutionMode::None {
            return mode;
        }
        if let Some(mode) = self.enclosing_module_specifier_mode {
            return mode;
        }
        // `TryGetModuleSpecifierFromDeclaration` for a variable declaration.
        let (hir, files) = (self.hir(at.file), self.files());
        if at.fake_scope == 0 && at.variable.is_some() {
            let initializer = hir[at.variable].init;
            if initializer.is_some()
                && !is_parenthesized(hir, initializer)
                && let Some((argument, _)) = crate::bind::require_call_argument(hir, initializer)
                && matches!(hir[argument].kind, ExprKind::String(_))
            {
                return files.mode_of_require(at.file);
            }
        }
        files.default_resolution_mode_for_file(at.file)
    }

    /// `getPreferredEnding`. `prefers_js`: `ImportModuleSpecifierEndingPreferenceJs`.
    fn preferred_ending(
        &self,
        importing: FileId,
        prefers_js: bool,
        mode: ResolutionMode,
    ) -> Ending {
        let files = self.files();
        let mode = if mode == ResolutionMode::None {
            self.files().default_resolution_mode_for_file(importing)
        } else {
            mode
        };
        let is_node = files.options.resolves_like_node;
        // `ExtensionsNotSupportingExtensionlessResolution` give no evidence of the preferred
        // ending.
        let is_telling = |text: &&[u8]| {
            !matches!(
                known_extension(text),
                b".mts" | b".d.mts" | b".mjs" | b".cts" | b".d.cts" | b".cjs"
            )
        };
        let has_ts_extension =
            |text: &[u8]| matches!(known_extension(text), b".ts" | b".tsx" | b".d.ts");
        let has_js_extension = |text: &[u8]| matches!(known_extension(text), b".js" | b".jsx");
        let specifiers = self.relative_specifiers_of(importing);
        // `inferPreference`
        let inferred = || {
            if is_node && mode == ResolutionMode::Require {
                return Ending::Minimal;
            }
            let mut telling = specifiers.iter().copied().filter(is_telling);
            if telling.clone().any(&has_ts_extension) {
                Ending::Ts
            } else if telling.any(&has_js_extension) {
                Ending::Js
            } else {
                Ending::Minimal
            }
        };
        let allows_ts = files.options.allow_importing_ts_extensions;
        if prefers_js || mode == ResolutionMode::Import && is_node {
            return if allows_ts && inferred() != Ending::Js {
                Ending::Ts
            } else {
                Ending::Js
            };
        }
        if allows_ts {
            return inferred();
        }
        // `usesExtensionsOnImports`
        match specifiers.iter().copied().find(is_telling) {
            Some(first) if has_ts_extension(first) || has_js_extension(first) => Ending::Js,
            _ => Ending::Minimal,
        }
    }

    /// `GetAllowedEndingsInPreferredOrder`
    fn allowed_endings(
        &self,
        importing: FileId,
        prefers_js: bool,
        mode: ResolutionMode,
    ) -> Vec<Ending> {
        let files = self.files();
        let allows_ts = files.options.allow_importing_ts_extensions
            || is_declaration_file_name(files.module(importing).file_name());
        if mode == ResolutionMode::Import && files.options.resolves_like_node {
            return if allows_ts {
                vec![Ending::Ts, Ending::Js]
            } else {
                vec![Ending::Js]
            };
        }
        match (
            self.preferred_ending(importing, prefers_js, mode),
            allows_ts,
        ) {
            (Ending::Js, true) => vec![Ending::Js, Ending::Ts, Ending::Minimal, Ending::Index],
            (Ending::Js, false) => vec![Ending::Js, Ending::Minimal, Ending::Index],
            (Ending::Ts, _) => vec![Ending::Ts, Ending::Minimal, Ending::Js, Ending::Index],
            (Ending::Index, true) => vec![Ending::Index, Ending::Minimal, Ending::Ts, Ending::Js],
            (Ending::Index, false) => vec![Ending::Index, Ending::Minimal, Ending::Js],
            (Ending::Minimal, true) => vec![Ending::Minimal, Ending::Index, Ending::Ts, Ending::Js],
            (Ending::Minimal, false) => vec![Ending::Minimal, Ending::Index, Ending::Js],
        }
    }

    /// `processEnding`
    fn process_ending(&self, file_name: &[u8], allowed: &[Ending]) -> Vec<u8> {
        let files = self.files();
        let extension = known_extension(file_name);
        if matches!(extension, b"" | b".json" | b".mjs" | b".cjs") {
            return file_name.to_vec();
        }
        let no_extension = remove_file_extension(file_name);
        let with_js_extension = || {
            let preserves_jsx = files.options.jsx == JsxEmit::Preserve;
            [
                no_extension,
                js_extension_for_file(file_name, preserves_jsx),
            ]
            .concat()
        };
        let priority = |ending: Ending| allowed.iter().position(|&allowed| allowed == ending);
        let js_priority = priority(Ending::Js);
        if matches!(extension, b".mts" | b".cts")
            && priority(Ending::Ts).is_some_and(|ts| js_priority.is_some_and(|js| ts < js))
        {
            return file_name.to_vec();
        }
        if matches!(extension, b".d.mts" | b".d.cts" | b".mts" | b".cts") {
            return with_js_extension();
        }
        if extension == b".ts"
            && strings::contains(file_name, b".d.")
            && let Some(real) = try_get_real_file_name_for_non_js_declaration_file_name(file_name)
        {
            return real;
        }
        match allowed.first() {
            Some(Ending::Minimal) | None => match no_extension.strip_suffix(b"/index") {
                // `index` is preserved if a file has the same name as the directory. Only the files
                // of the program are known.
                Some(directory)
                    if ![
                        b".ts".as_slice(),
                        b".tsx",
                        b".d.ts",
                        b".js",
                        b".jsx",
                        b".cts",
                        b".d.cts",
                        b".cjs",
                        b".mts",
                        b".d.mts",
                        b".mjs",
                        b".json",
                    ]
                    .iter()
                    .any(|extension| files.by_path.contains(&[directory, *extension].concat())) =>
                {
                    directory.to_vec()
                }
                _ => no_extension.to_vec(),
            },
            Some(Ending::Index) => no_extension.to_vec(),
            Some(Ending::Js) => with_js_extension(),
            Some(Ending::Ts) => {
                if !is_declaration_file_name(file_name) {
                    return file_name.to_vec();
                }
                let extensionless = allowed
                    .iter()
                    .position(|ending| matches!(ending, Ending::Minimal | Ending::Index));
                if extensionless.is_some_and(|at| js_priority.is_some_and(|js| at < js)) {
                    no_extension.to_vec()
                } else {
                    with_js_extension()
                }
            }
        }
    }

    /// `tryGetModuleNameAsNodeModule`: the specifier `importing` uses for the file at `path`, which
    /// is in `node_modules`. Empty: it has no specifier through `node_modules`.
    fn try_get_module_name_as_node_module(
        &self,
        path: &[u8],
        importing: FileId,
        mode: ResolutionMode,
        prefers_js: bool,
    ) -> Vec<u8> {
        let files = self.files();
        let options = &files.options;
        let Some((top_level_node_modules, top_level_package_name, package_root)) =
            node_module_path_parts(path)
        else {
            return Vec::new();
        };
        let package_directory = &path[..package_root];
        // `tryDirectoryWithPackageJson`
        let is_package_root = match files.package_jsons.get(package_directory) {
            // An `index` file resolves from the package name anyway.
            None => matches!(
                path.get(package_root + 1..),
                Some(b"index.d.ts" | b"index.js" | b"index.ts" | b"index.tsx")
            ),
            Some(json) => {
                if options.resolve_package_json_exports
                    && let Some(exports) = json.get(b"exports")
                {
                    let mode = match known_extension(path) {
                        b".cjs" | b".cts" | b".d.cts" => ResolutionMode::Require,
                        b".mjs" | b".mts" | b".d.mts" => ResolutionMode::Import,
                        _ if mode == ResolutionMode::None => {
                            self.files().default_resolution_mode_for_file(importing)
                        }
                        _ => mode,
                    };
                    // `GetConditions`
                    let is_import = mode == ResolutionMode::Import
                        || mode == ResolutionMode::None && !options.resolves_like_node;
                    let mut conditions = vec![
                        if is_import {
                            &b"import"[..]
                        } else {
                            b"require"
                        },
                        b"types",
                    ];
                    if options.resolves_like_node {
                        conditions.push(b"node");
                    }
                    conditions.extend(options.custom_conditions.iter().map(Vec::as_slice));
                    let swapped = if matches!(
                        known_extension(path),
                        b".ts" | b".tsx" | b".d.ts" | b".cts" | b".d.cts" | b".mts" | b".d.mts"
                    ) {
                        let preserves_jsx = options.jsx == JsxEmit::Preserve;
                        [
                            remove_file_extension(path),
                            js_extension_for_file(path, preserves_jsx),
                        ]
                        .concat()
                    } else {
                        Vec::new()
                    };
                    // A file that `exports` does not expose has no specifier through
                    // `node_modules`.
                    return module_name_from_package_exports(
                        path,
                        &swapped,
                        package_directory,
                        &package_name_from_types_package_name(
                            &package_directory[top_level_package_name + 1..],
                        ),
                        exports,
                        &conditions,
                    );
                }
                // The specifier of the main file is the package name.
                let main = [b"typings".as_slice(), b"types", b"main"]
                    .iter()
                    .find_map(|field| json.get(field).and_then(Json::as_str))
                    .unwrap_or(b"index.js");
                let main = join(package_directory, main);
                remove_file_extension(&main) == remove_file_extension(path)
                    || json.get(b"type").and_then(Json::as_str) != Some(b"module")
                        && !matches!(
                            known_extension(path),
                            b".mts" | b".d.mts" | b".mjs" | b".cts" | b".d.cts" | b".cjs"
                        )
                        && dirname::<Posix>(path) == main
                        && remove_file_extension(&path[main.len()..]) == b"/index"
            }
        };
        let module_specifier = if is_package_root {
            package_directory.to_vec()
        } else {
            let allowed = self.allowed_endings(importing, prefers_js, ResolutionMode::None);
            self.process_ending(path, &allowed)
        };
        if !dirname::<Posix>(files.module(importing).file_name())
            .starts_with(&path[..top_level_node_modules])
        {
            return Vec::new();
        }
        package_name_from_types_package_name(&module_specifier[top_level_package_name + 1..])
    }

    /// `GetEachFileNameOfModule`: the paths that reach one of `targets` through a symlink to a
    /// directory that contains the file at `real`. Each path, here and below, is paired with
    /// whether it `IsRedirect`.
    fn paths_through_links(
        &self,
        real: &[u8],
        targets: &[(Vec<u8>, bool)],
        importing: &[u8],
    ) -> Vec<(Vec<u8>, bool)> {
        let links = self.files().linked_directories;
        let mut paths = Vec::new();
        let mut directory = dirname::<Posix>(real);
        while !links.is_empty() && !directory.is_empty() && directory != b"/" {
            let mut to_here = links.iter().filter(|link| link.0 == directory).peekable();
            if to_here.peek().is_some() {
                // A package does not import from itself by its name.
                if importing
                    .strip_prefix(directory)
                    .is_some_and(|rest| rest.starts_with(b"/"))
                {
                    break;
                }
                let to_here: Vec<&(&[u8], &[u8])> = to_here.collect();
                for (target, is_redirect) in targets {
                    let Some(rest) = target.strip_prefix(directory) else {
                        continue;
                    };
                    for link in to_here.iter().filter(|_| rest.starts_with(b"/")) {
                        paths.push(([link.1, rest].concat(), *is_redirect));
                    }
                }
            }
            directory = dirname::<Posix>(directory);
        }
        paths
    }

    /// `getAllModulePathsWorker`, `computeModuleSpecifiers`, first result only: the specifier
    /// `importing` uses for `target`, which all of `paths` resolve to.
    fn compute_module_specifiers(
        &self,
        target: FileId,
        mut paths: Vec<(Vec<u8>, bool)>,
        importing: FileId,
        mode: ResolutionMode,
        target_mode: ResolutionMode,
        prefers_js: bool,
    ) -> Vec<u8> {
        let from = dirname::<Posix>(self.files().module(importing).file_name());
        // The number of directory levels from the importing file up to the directory that contains
        // `path`.
        let distance = |path: &[u8]| {
            let (mut directory, mut up) = (from, 0);
            while !directory.is_empty()
                && directory != b"/"
                && !path
                    .strip_prefix(directory)
                    .is_some_and(|rest| rest.starts_with(b"/"))
            {
                directory = dirname::<Posix>(directory);
                up += 1;
            }
            up
        };
        // `comparePathsByRedirect`. Names that differ only in case are in no particular order there.
        let is_case_sensitive = self.files().is_case_sensitive;
        paths.sort_by(|a, b| {
            distance(&a.0)
                .cmp(&distance(&b.0))
                .then(b.1.cmp(&a.1))
                .then(strings::count_char(&a.0, b'/').cmp(&strings::count_char(&b.0, b'/')))
                .then_with(|| compare_paths(&a.0, &b.0, is_case_sensitive))
                .then_with(|| a.0.cmp(&b.0))
        });
        paths.dedup();
        // The specifier of an import that resolves to one of the paths, by its `ResolvedFileName`.
        let importer = self.files().module(importing);
        let mut existing: Vec<(Atom, ResolutionMode, Vec<u8>)> = Vec::new();
        for &specifier in &self.bound(importing).specifiers {
            for used in [
                importer.default_mode,
                ResolutionMode::Import,
                ResolutionMode::Require,
                ResolutionMode::None,
            ] {
                if importer.imports.get(&(specifier, used)) == Some(&target)
                    && !existing.iter().any(|it| it.0 == specifier && it.1 == used)
                {
                    let resolved = self.resolved_file_name_of_import(importing, specifier, used);
                    existing.push((specifier, used, resolved));
                }
            }
        }
        for (path, _) in &paths {
            if let Some(&(specifier, used, _)) = existing.iter().find(|it| it.2 == *path)
                && (used == target_mode
                    || used == ResolutionMode::None
                    || target_mode == ResolutionMode::None)
            {
                return self.atoms().bytes(specifier).to_vec();
            }
        }
        let allowed_endings = self.allowed_endings(importing, prefers_js, target_mode);
        let imported_file_is_in_node_modules = paths
            .iter()
            .any(|path| strings::contains(&path.0, b"/node_modules/"));
        // The first of `pathsSpecifiers`, `redirectPathsSpecifiers`, `nodeModulesSpecifiers`, `relativeSpecifiers`.
        let (mut from_paths, mut from_redirect_paths) = (None, None);
        let (mut from_node_modules, mut relative) = (None, None);
        for (path, is_redirect) in &paths {
            let is_redirect = *is_redirect;
            let is_in_node_modules = strings::contains(path, b"/node_modules/");
            let mut specifier = Vec::new();
            if is_in_node_modules {
                specifier =
                    self.try_get_module_name_as_node_module(path, importing, mode, prefers_js);
            }
            let paths_only = is_redirect || !specifier.is_empty();
            if !specifier.is_empty() {
                let first = from_node_modules.get_or_insert(specifier);
                // "it was a bare package specifier .. No other specifier will be this good, so stop looking."
                if is_redirect {
                    return std::mem::take(first);
                }
            }
            let local = self.get_local_module_specifier(
                path,
                target,
                importing,
                &allowed_endings,
                paths_only,
            );
            if local.is_empty() {
                continue;
            }
            if is_redirect {
                from_redirect_paths.get_or_insert(local);
            } else if path_is_bare_specifier(&local) {
                if strings::contains(&local, b"/node_modules/") {
                    relative.get_or_insert(local);
                } else {
                    from_paths.get_or_insert(local);
                }
            } else if !imported_file_is_in_node_modules || is_in_node_modules {
                // A relative path to another package is not portable: the specifier through
                // `node_modules` is used, which is reported.
                relative.get_or_insert(local);
            }
        }
        from_paths
            .or(from_redirect_paths)
            .or(from_node_modules)
            .or(relative)
            .unwrap_or_default()
    }

    /// `getLocalModuleSpecifier`, for `RelativePreferenceExternalNonRelative`:
    /// `getSpecifierForModuleSymbol` requests `ImportModuleSpecifierPreferenceProjectRelative`.
    /// `module_file_name` resolves to `target`.
    fn get_local_module_specifier(
        &self,
        module_file_name: &[u8],
        target: FileId,
        importing: FileId,
        allowed_endings: &[Ending],
        paths_only: bool,
    ) -> Vec<u8> {
        let files = self.files();
        let options = &files.options;
        if paths_only && options.paths.is_empty() {
            return Vec::new();
        }
        let source_directory = dirname::<Posix>(files.module(importing).file_name());
        let mut relative_path = self.try_get_module_name_from_root_dirs(
            module_file_name,
            source_directory,
            allowed_endings,
        );
        if relative_path.is_empty() {
            let relative = get_relative_path_from_directory(
                source_directory,
                module_file_name,
                files.is_case_sensitive,
            );
            relative_path =
                self.process_ending(&ensure_path_is_non_module_name(relative), allowed_endings);
        }
        // `GetPathsBasePath`
        let base_directory = match options.paths_base_dir.as_slice() {
            b"" => options.base_dir.as_slice(),
            reported => reported,
        };
        // `tryGetModuleNameFromPackageJsonImports` is not ported: no `#name` specifier is generated
        // yet.
        // `getRelativePathIfInSameVolume`
        let relative_to_base_url = get_relative_path_from_directory(
            base_directory,
            module_file_name,
            files.is_case_sensitive,
        );
        if is_rooted_disk_path(&relative_to_base_url) {
            return if paths_only {
                Vec::new()
            } else {
                relative_path
            };
        }
        let maybe_non_relative = self.try_get_module_name_from_paths(
            &relative_to_base_url,
            allowed_endings,
            base_directory,
        );
        if paths_only {
            return maybe_non_relative;
        }
        if maybe_non_relative.is_empty() {
            return relative_path;
        }
        if !path_is_relative(&maybe_non_relative) {
            let project_directory = match options.config_path.as_slice() {
                b"" => options.base_dir.as_slice(),
                config_path => dirname::<Posix>(config_path),
            };
            let is_internal = |path: &[u8]| contains_path(project_directory, path, true);
            // The import crosses the directory of the configuration file, or goes from one package to another.
            return if is_internal(source_directory) != is_internal(module_file_name)
                || files.module(importing).package_json_directory
                    != files.module(target).package_json_directory
            {
                maybe_non_relative
            } else {
                relative_path
            };
        }
        // `isPathRelativeToParent`
        if maybe_non_relative.starts_with(b"..")
            || count_path_components(&relative_path) < count_path_components(&maybe_non_relative)
        {
            relative_path
        } else {
            maybe_non_relative
        }
    }

    /// `tryGetModuleNameFromRootDirs`
    fn try_get_module_name_from_root_dirs(
        &self,
        module_file_name: &[u8],
        source_directory: &[u8],
        allowed_endings: &[Ending],
    ) -> Vec<u8> {
        let root_dirs = &self.files().options.root_dirs;
        // `getPathsRelativeToRootDirs`, each with a `/` before it.
        let relative_to_root_dirs = |path: &[u8]| -> Vec<Vec<u8>> {
            root_dirs
                .iter()
                .map(|root_dir| [b"/", relative_normalized::<Posix, true>(root_dir, path)].concat())
                .filter(|relative| !relative.starts_with(b"/.."))
                .collect()
        };
        let target_paths = relative_to_root_dirs(module_file_name);
        let mut shortest: Option<Vec<u8>> = None;
        for source_path in relative_to_root_dirs(source_directory) {
            for target_path in &target_paths {
                let candidate = ensure_path_is_non_module_name(
                    relative_normalized::<Posix, true>(&source_path, target_path).to_vec(),
                );
                let separators = strings::count_char(&candidate, b'/');
                if shortest
                    .as_ref()
                    .is_none_or(|shortest| separators < strings::count_char(shortest, b'/'))
                {
                    shortest = Some(candidate);
                }
            }
        }
        match shortest {
            Some(shortest) => self.process_ending(&shortest, allowed_endings),
            None => Vec::new(),
        }
    }

    /// `tryGetModuleNameFromPaths`. `validateEnding` is true for every candidate: it runs
    /// `processEnding` again, with the same host.
    fn try_get_module_name_from_paths(
        &self,
        relative_to_base_url: &[u8],
        allowed_endings: &[Ending],
        base_directory: &[u8],
    ) -> Vec<u8> {
        for (key, values) in &self.files().options.paths {
            for pattern_text in values {
                let normalized = join(base_directory, pattern_text);
                let pattern =
                    relative_normalized::<Posix, true>(base_directory, &normalized).to_vec();
                let mut candidates: Vec<Vec<u8>> = allowed_endings
                    .iter()
                    .map(|&ending| self.process_ending(relative_to_base_url, &[ending]))
                    .collect();
                // The extension is in the mapping, so the mapping resolves to the file itself.
                if !known_extension(&pattern).is_empty() {
                    candidates.push(relative_to_base_url.to_vec());
                }
                let Some((prefix, suffix)) = strings::split_once(&pattern, b"*") else {
                    if candidates.contains(&pattern) {
                        return key.clone();
                    }
                    continue;
                };
                for value in &candidates {
                    if value.len() >= prefix.len() + suffix.len()
                        && value.starts_with(prefix)
                        && value.ends_with(suffix)
                    {
                        let matched_star = &value[prefix.len()..value.len() - suffix.len()];
                        if !path_is_relative(matched_star) {
                            return key.replacen(b"*", matched_star, 1);
                        }
                    }
                }
            }
        }
        Vec::new()
    }

    /// `referenceRedirect` in `GetEachFileNameOfModule`
    fn reference_redirect(&self, path: &[u8]) -> Option<Vec<u8>> {
        let output_dts = self.files().options.parse_file_redirect(path)?;
        Some(output_dts.to_vec())
    }

    /// `ResolvedFileName` of an import of `importing`.
    fn resolved_file_name_of_import(
        &self,
        importing: FileId,
        specifier: Atom,
        mode: ResolutionMode,
    ) -> Vec<u8> {
        let files = self.files();
        let importer = files.module(importing);
        let mut redirected = importer.redirected_imports.iter();
        if let Some(&(_, _, name)) = redirected.find(|it| it.0 == specifier && it.1 == mode) {
            return self.atoms().bytes(name).to_vec();
        }
        let path = files
            .module(importer.imports[&(specifier, mode)])
            .file_name();
        let mut to_outputs = importer.project_reference_imports.iter();
        if to_outputs.any(|&it| it == (specifier, mode))
            && let Some(output) = self.reference_redirect(path)
        {
            return output;
        }
        path.to_vec()
    }

    /// `GetModuleSpecifiers`, first result only: the specifier `importing` uses for the file
    /// `target`. `prefers_js`: `ImportModuleSpecifierEndingPreferenceJs`.
    fn get_module_specifiers(
        &self,
        target: FileId,
        importing: FileId,
        mode: ResolutionMode,
        prefers_js: bool,
    ) -> Vec<u8> {
        let files = self.files();
        let from = files.module(importing);
        let target_mode = if mode == ResolutionMode::None {
            self.files().default_resolution_mode_for_file(importing)
        } else {
            mode
        };
        // `GetModuleSpecifiersWithInfo`: "Use original source file name when file is from project reference output".
        let path = files.source_of_project_reference_if_output_included(target);
        // `GetEachFileNameOfModule`. The output of a referenced project for the file comes first,
        // then the source: the `exports` of its package map to one or the other.
        let reference_redirect = self.reference_redirect(path);
        let mut targets: Vec<(Vec<u8>, bool)> = Vec::with_capacity(2);
        targets.extend(reference_redirect.map(|output| (output, true)));
        targets.push((path.to_vec(), false));
        // `GetRedirectTargets`
        let redirects = files
            .redirect_targets
            .get(&target)
            .copied()
            .unwrap_or_default();
        targets.extend(redirects.iter().map(|path| (path.to_vec(), false)));
        let mut paths = self.paths_through_links(path, &targets, from.file_name());
        // `containsIgnoredPath`, `shouldFilterIgnoredPaths`
        let contains_ignored_path = |path: &[u8]| {
            [b"/node_modules/.".as_slice(), b"/.git", b".#"]
                .iter()
                .any(|ignored| strings::contains(path, ignored))
        };
        let filters = !paths.is_empty() || !targets.iter().all(|it| contains_ignored_path(&it.0));
        targets.retain(|it| !(filters && contains_ignored_path(&it.0)));
        paths.append(&mut targets);
        self.compute_module_specifiers(target, paths, importing, mode, target_mode, prefers_js)
    }

    /// `getSpecifierForModuleSymbol`
    pub(super) fn specifier_for_module_symbol(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        mode: ResolutionMode,
    ) -> Vec<u8> {
        if at.is_none() {
            return self.specifier_of_module(symbol);
        }
        let importing = at.file;
        let resolution_mode = self.resolution_mode_for_specifier(at, mode);
        if let Some(known) =
            self.emit_resolver_links
                .specifiers
                .get(&(symbol, importing, resolution_mode))
        {
            return known.clone();
        }
        let decls = self.decls_of(symbol);
        // `isAmbientModuleSymbolName(symbol.Name)`
        let ambient_name = match decls.first() {
            Some(&(file, Decl::Module(m))) => match self.hir(file)[m].name {
                ModuleName::String(name) => Some(name),
                _ => None,
            },
            _ => None,
        };
        let mut target = None;
        let mut specifier = None;
        for (file, decl) in decls {
            match decl {
                Decl::File => target = target.or(Some(file)),
                // `tryGetModuleNameFromAmbientModule`
                Decl::Module(m) => {
                    if let ModuleName::String(name) = self.hir(file)[m].name {
                        let name = self.atoms().bytes(name).to_vec();
                        if !self.hir(file).has_module_syntax || !is_relative(&name) {
                            specifier = specifier.or(Some(name));
                        }
                    }
                }
                _ => {}
            }
        }
        let specifier = match (ambient_name, specifier, target) {
            // Without a file, `StripQuotes(symbol.Name)`.
            (Some(name), _, None) => self.atoms().bytes(name).to_vec(),
            (_, Some(name), _) => name,
            (_, None, target) => match target.or_else(|| self.source_file_of_module(symbol)) {
                Some(target) => {
                    let prefers_js = resolution_mode == ResolutionMode::Import;
                    self.get_module_specifiers(target, importing, mode, prefers_js)
                }
                None => Vec::new(),
            },
        };
        self.emit_resolver_links
            .specifiers
            .insert((symbol, importing, resolution_mode), specifier.clone());
        specifier
    }

    /// `sortByBestName`
    fn sort_by_best_name(&self, a: &(Sym, Vec<u8>), b: &(Sym, Vec<u8>)) -> std::cmp::Ordering {
        if a.1.is_empty() || b.1.is_empty() {
            return self.compare_symbols_of_chain(a.0, b.0);
        }
        match (path_is_relative(&a.1), path_is_relative(&b.1)) {
            (false, true) => std::cmp::Ordering::Less,
            (true, false) => std::cmp::Ordering::Greater,
            _ => count_path_components(&a.1).cmp(&count_path_components(&b.1)),
        }
    }

    /// `parentSpecifiers`, sorted.
    fn sorted_by_best_name(&mut self, parents: Vec<Sym>, at: Enclosing) -> Vec<Sym> {
        let mut named: Vec<(Sym, Vec<u8>)> = Vec::with_capacity(parents.len());
        for parent in parents {
            let name = if self.is_external_module_symbol(parent) {
                self.specifier_for_module_symbol(parent, at, ResolutionMode::None)
            } else {
                Vec::new()
            };
            named.push((parent, name));
        }
        named.sort_by(|a, b| self.sort_by_best_name(a, b));
        named.into_iter().map(|parent| parent.0).collect()
    }

    /// `getSymbolChain`
    pub(super) fn symbol_chain_ex(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        yield_module_symbol: YieldModuleSymbol,
        end_of_chain: EndOfChain,
    ) -> Vec<Sym> {
        let mut chain = self.accessible_symbol_chain(symbol, at, meaning).to_vec();
        let qualifier_meaning = if chain.len() > 1 {
            meaning.left()
        } else {
            meaning
        };
        let root = chain.first().copied();
        if !self.is_stack_low()
            && root.is_none_or(|root| self.needs_qualification(root, at, qualifier_meaning))
        {
            // Go up and add the parent.
            let parents = self.containers_of_symbol(root.unwrap_or(symbol), at, meaning);
            for parent in self.sorted_by_best_name(parents, at) {
                let mut parent_chain = self.symbol_chain_ex(
                    parent,
                    at,
                    meaning.left(),
                    yield_module_symbol,
                    EndOfChain::No,
                );
                if parent_chain.is_empty() {
                    continue;
                }
                // The module's `export =` target is the symbol.
                let is_the_module = self
                    .files()
                    .export(parent, known::export_equals)
                    .is_some_and(|equals| self.is_same_reference(equals, symbol));
                if !is_the_module {
                    if chain.is_empty() {
                        let last = self
                            .alias_for_symbol_in_container(parent, symbol)
                            .unwrap_or(symbol);
                        chain.push(self.target_of_module_clone(last));
                    }
                    parent_chain.append(&mut chain);
                }
                chain = parent_chain;
                break;
            }
        }
        // A parent that is an anonymous type is not emitted, nor one that is an external module,
        // unless the chain may start with it.
        let anonymous = SymFlags::TYPE_LITERAL | SymFlags::OBJECT_LITERAL;
        if chain.is_empty()
            && (end_of_chain == EndOfChain::Yes
                || !self.flags_of(symbol).intersects(anonymous)
                    && (yield_module_symbol == YieldModuleSymbol::Yes
                        || !self.is_external_module_symbol(symbol)))
        {
            // A symbol created by `cloneTypeAsModuleType` is emitted as its target, whose name and
            // declarations it has.
            chain.push(self.target_of_module_clone(symbol));
        }
        chain
    }

    /// The part of `symbolToTypeNode` that emits `import("specifier")` for `module`: the specifier,
    /// and the `resolution-mode` attribute.
    pub(super) fn import_type_specifier_and_mode(
        &mut self,
        module: Sym,
        at: Enclosing,
        allows_node_modules_relative_paths: bool,
    ) -> (Vec<u8>, Option<&'static [u8]>) {
        let files = self.files();
        let is_node = files.options.resolves_like_node;
        // `GetEmitModuleFormatOfFile`
        let context_format = files.module(at.file).implied_format;
        let target_format = self
            .decls_of(module)
            .into_iter()
            .find(|d| d.1 == Decl::File)
            .map(|d| d.0)
            .or_else(|| self.source_file_of_module(module))
            .map(|file| files.module(file).implied_format);
        let mut specifier = Vec::new();
        let mut mode = None;
        // An `import` type that targets an ECMAScript module only resolves in `import` mode.
        if is_node
            && target_format == Some(ResolutionMode::Import)
            && context_format != ResolutionMode::Import
        {
            specifier = self.specifier_for_module_symbol(module, at, ResolutionMode::Import);
            mode = Some(&b"import"[..]);
        }
        if specifier.is_empty() {
            specifier = self.specifier_for_module_symbol(module, at, ResolutionMode::None);
        }
        if !allows_node_modules_relative_paths
            && is_node
            && strings::contains(&specifier, b"/node_modules/")
        {
            // It may resolve in the other mode.
            let (swapped, swapped_mode) = if context_format == ResolutionMode::Import {
                (ResolutionMode::Require, &b"require"[..])
            } else {
                (ResolutionMode::Import, &b"import"[..])
            };
            let other = self.specifier_for_module_symbol(module, at, swapped);
            if !strings::contains(&other, b"/node_modules/") {
                return (other, Some(swapped_mode));
            }
        }
        (specifier, mode)
    }
}

/// `canProduceDiagnostics`
fn can_produce_diagnostics(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::VariableDeclaration
            | Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::BindingElement
            | Kind::SetAccessor
            | Kind::GetAccessor
            | Kind::ConstructSignature
            | Kind::CallSignature
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::FunctionDeclaration
            | Kind::Parameter
            | Kind::TypeParameter
            | Kind::ExpressionWithTypeArguments
            | Kind::ImportEqualsDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::Constructor
            | Kind::IndexSignature
            | Kind::PropertyAccessExpression
            | Kind::ElementAccessExpression
            | Kind::BinaryExpression
            | Kind::CallExpression
    )
}

/// `GetNameOfDeclaration`
fn get_name_of_declaration(hir: &hir::File, node: Node) -> Node {
    match hir.data(node) {
        NodeData::Expr(e) => match hir[e].kind {
            // `GetElementOrPropertyAccessName`
            ExprKind::Assign { target, .. } => hir.name(hir.node(target)),
            _ => hir.name(node),
        },
        _ => hir.name(node),
    }
}
