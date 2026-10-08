//! `prettier-plugin-organize-imports` 4.3, which hands a file to the "Organize Imports" of
//! TypeScript's language service before Prettier formats it: `organizeImports.ts` of TypeScript
//! 5.9, and of `textChanges.ts` what it uses.
//!
//! Imports that nothing refers to are removed, imports of one module are combined, and imports,
//! what they import, and exports with a `from` are sorted. An empty line or a line of comments
//! separates groups, which are sorted on their own.

use super::compare::lowercase;
use super::sort::stable_sort_by;
use bun_core::strings;
use bun_lint::ast::{
    Export, ExportSpec, ExprKind, ExprTag, File, Ident, Import, ImportSpec, List, ModuleName, Node,
    Stmt, StmtKind,
};
use bun_lint::span::Span;
use bun_lint::tokens::TokenKind;
use std::cmp::Ordering;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum TypeOrder {
    Last,
    Inline,
    First,
}

#[derive(Debug)]
pub(super) struct Options {
    /// `organizeImportsSkipDestructiveCodeActions`: nothing is removed.
    pub(super) skips_destructive_code_actions: bool,
    /// `organizeImportsTypeOrder`
    pub(super) type_order: Option<TypeOrder>,
    /// `jsx` of the `tsconfig.json` is `react` or `react-native`: JSX uses what the next two name.
    pub(super) jsx_needs_import: bool,
    /// The first name in `jsxFactory`, or `reactNamespace`, or `React`.
    pub(super) jsx_namespace: Box<[u8]>,
    /// The first name in `jsxFragmentFactory`.
    pub(super) jsx_fragment_factory: Option<Box<[u8]>>,
}

/// `getOrganizeImportsOrdinalStringComparer`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Comparer {
    /// `compareStringsCaseInsensitiveEslintCompatible`
    IgnoringCase,
    /// `compareStringsCaseSensitive`
    CaseSensitive,
}

impl Comparer {
    fn compare(self, a: &[u8], b: &[u8]) -> Ordering {
        match self {
            Comparer::CaseSensitive => a.cmp(b),
            Comparer::IgnoringCase if a.is_ascii() && b.is_ascii() => a
                .iter()
                .map(u8::to_ascii_lowercase)
                .cmp(b.iter().map(u8::to_ascii_lowercase)),
            Comparer::IgnoringCase => lowercase(a).cmp(&lowercase(b)),
        }
    }
}

const COMPARERS: [Comparer; 2] = [Comparer::IgnoringCase, Comparer::CaseSensitive];

/// An `ImportDeclaration` or an `ExportDeclaration`.
#[derive(Copy, Clone)]
struct Declaration<'a> {
    statement: Stmt<'a>,
    /// `getFullStart()`: where the token before it ends.
    full_start: u32,
}

impl<'a> Declaration<'a> {
    fn span(&self) -> Span {
        self.statement.span()
    }

    fn import(&self) -> Option<Import<'a>> {
        match self.statement.kind() {
            StmtKind::Import(import) => Some(import),
            _ => None,
        }
    }

    /// `getExternalModuleName(moduleSpecifier)`
    fn module(&self) -> Option<&'a [u8]> {
        match self.statement.kind() {
            StmtKind::Import(import) => Some(import.spec().bytes()),
            StmtKind::ExportNamed(export) => export.spec().map(|it| it.bytes()),
            StmtKind::ExportStar { spec, .. } => spec.map(|it| it.bytes()),
            _ => None,
        }
    }
}

/// `measureSortedness`
fn measure_sortedness<T>(items: &[T], compare: impl Fn(&T, &T) -> Ordering) -> usize {
    items
        .iter()
        .zip(items.iter().skip(1))
        .filter(|(a, b)| compare(a, b) == Ordering::Greater)
        .count()
}

/// `detectCaseSensitivityBySort`
fn detect_case_sensitivity_by_sort(groups: &[Vec<&[u8]>]) -> Comparer {
    let unsortedness = |comparer: Comparer| -> usize {
        groups
            .iter()
            .map(|group| measure_sortedness(group, |a, b| comparer.compare(a, b)))
            .sum()
    };
    match unsortedness(Comparer::CaseSensitive) < unsortedness(Comparer::IgnoringCase) {
        true => Comparer::CaseSensitive,
        false => Comparer::IgnoringCase,
    }
}

/// `compareImportOrExportSpecifiers`
fn compare_specifiers(
    a: (bool, &[u8]),
    b: (bool, &[u8]),
    comparer: Comparer,
    type_order: TypeOrder,
) -> Ordering {
    let by_kind = match type_order {
        TypeOrder::First => b.0.cmp(&a.0),
        TypeOrder::Inline => Ordering::Equal,
        TypeOrder::Last => a.0.cmp(&b.0),
    };
    by_kind.then_with(|| comparer.compare(a.1, b.1))
}

/// `detectNamedImportOrganizationBySort`
fn detect_named_import_organization_by_sort(
    imports: &[Declaration],
    orders: &[TypeOrder],
) -> Option<(Comparer, Option<TypeOrder>)> {
    let named: Vec<Vec<(bool, &[u8])>> = (imports.iter().filter_map(Declaration::import))
        .map(|import| {
            import
                .named()
                .iter()
                .map(|it| (it.is_type_only(), it.local().bytes()))
                .collect::<Vec<_>>()
        })
        .filter(|elements| !elements.is_empty())
        .collect();
    if named.is_empty() {
        return None;
    }
    let has_both = named
        .iter()
        .any(|elements| elements.iter().any(|it| it.0) && elements.iter().any(|it| !it.0));
    if !has_both {
        let names: Vec<Vec<&[u8]>> = named
            .iter()
            .map(|elements| elements.iter().map(|it| it.1).collect())
            .collect();
        return Some((
            detect_case_sensitivity_by_sort(&names),
            if let [only] = orders {
                Some(*only)
            } else {
                None
            },
        ));
    }
    // For each order, the comparer that what is there is closest to being sorted by.
    let best: Vec<(usize, Comparer, TypeOrder)> = (orders.iter())
        .map(|&order| {
            let unsortedness = |comparer: Comparer| -> usize {
                named
                    .iter()
                    .map(|elements| {
                        measure_sortedness(elements, |a, b| {
                            compare_specifiers(*a, *b, comparer, order)
                        })
                    })
                    .sum()
            };
            let (ignoring, sensitive) = (unsortedness(COMPARERS[0]), unsortedness(COMPARERS[1]));
            if sensitive < ignoring {
                (sensitive, COMPARERS[1], order)
            } else {
                (ignoring, COMPARERS[0], order)
            }
        })
        .collect();
    let least = best.iter().map(|it| it.0).min()?;
    best.iter()
        .find(|it| it.0 == least)
        .map(|it| (it.1, Some(it.2)))
}

/// `isExternalModuleNameRelative`
fn is_relative(name: &[u8]) -> bool {
    match name {
        b"."
        | b".."
        | [b'/' | b'\\', ..]
        | [b'.', b'/' | b'\\', ..]
        | [b'.', b'.', b'/' | b'\\', ..] => true,
        [drive, b':', ..] => drive.is_ascii_alphabetic(),
        _ => false,
    }
}

/// `compareModuleSpecifiersWorker`
fn compare_module_specifiers(a: Option<&[u8]>, b: Option<&[u8]>, comparer: Comparer) -> Ordering {
    (a.is_none().cmp(&b.is_none()))
        .then_with(|| a.is_some_and(is_relative).cmp(&b.is_some_and(is_relative)))
        .then_with(|| comparer.compare(a.unwrap_or_default(), b.unwrap_or_default()))
}

/// An element of `NamedImports`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Specifier<'a> {
    /// As it is written, but for an `a as a`, which is `a`.
    Written(ImportSpec<'a>),
    /// `default as name`
    Default(Ident<'a>),
}

impl<'a> Specifier<'a> {
    fn key(&self) -> (bool, &'a [u8]) {
        match self {
            Specifier::Written(it) => (it.is_type_only(), it.local().bytes()),
            Specifier::Default(name) => (false, name.bytes()),
        }
    }
}

/// An `ImportDeclaration` that is written in place of the old ones.
#[derive(Clone)]
struct NewImport<'a> {
    /// The declaration that it is an update of: what its comments, its module specifier and its
    /// attributes are those of.
    base: Declaration<'a>,
    name: Option<Ident<'a>>,
    namespace: Option<Ident<'a>>,
    /// `Some` and empty: `{}`.
    named: Option<Vec<Specifier<'a>>>,
    /// The import whose `{ }` it has, and whether all that is written there is still in them.
    braces: Option<(Import<'a>, bool)>,
}

impl<'a> NewImport<'a> {
    fn of(base: Declaration<'a>, import: Import<'a>) -> Self {
        NewImport {
            base,
            name: import.default(),
            namespace: import.namespace(),
            named: import
                .has_named_imports()
                .then(|| import.named().iter().map(Specifier::Written).collect()),
            braces: import.has_named_imports().then_some((import, true)),
        }
    }

    fn has_clause(&self) -> bool {
        self.name.is_some() || self.namespace.is_some() || self.named.is_some()
    }

    fn is_type_only(&self) -> bool {
        self.has_clause() && self.base.import().is_some_and(|it| it.is_type_only())
    }

    /// `getImportKindOrder`
    fn kind_order(&self) -> u8 {
        match self {
            _ if !self.has_clause() => 0,
            _ if self.is_type_only() => 1,
            _ if self.namespace.is_some() => 2,
            _ if self.name.is_some() => 3,
            _ => 4,
        }
    }

    /// Whether it says what `base` says.
    fn is_unchanged(&self) -> bool {
        let Some(import) = self.base.import() else {
            return false;
        };
        let same =
            |a: Option<Ident>, b: Option<Ident>| a.map(|it| it.span()) == b.map(|it| it.span());
        same(self.name, import.default())
            && same(self.namespace, import.namespace())
            && match &self.named {
                None => !import.has_named_imports(),
                Some(named) => {
                    import.has_named_imports()
                        && named.len() == import.named().len()
                        && named.iter().zip(import.named().iter()).all(|(new, old)| {
                            *new == Specifier::Written(old)
                                && !(old.is_renamed()
                                    && !old.imported().is_string()
                                    && old.imported().bytes() == old.local().bytes())
                        })
                }
            }
    }
}

/// An element of named imports or exports that is written.
struct Element {
    /// Where it is in the file, if it is.
    span: Option<Span>,
    code: Vec<u8>,
    /// Where the statement starts that it is in, and which element of that it is.
    place: (u32, usize),
}

struct Organizer<'a, 'o> {
    file: &'a File<'a>,
    text: &'a [u8],
    options: &'o Options,
    end_of_line: &'static [u8],
    /// The comments of the file.
    comments: Vec<(Span, bool)>,
    module_comparer: Comparer,
    /// `None`: there is nothing to tell it by.
    named_comparer: Option<Comparer>,
    type_order: TypeOrder,
    /// The names that JSX uses, if there is JSX and it uses any.
    jsx_names: Vec<Vec<u8>>,
    /// What replaces which part of the text.
    changes: Vec<(Span, Vec<u8>)>,
}

impl<'a> Organizer<'a, '_> {
    // ───────────────────────────── scanner.ts ─────────────────────────────

    fn comment_at(&self, at: u32) -> Option<(Span, bool)> {
        let index = self
            .comments
            .partition_point(|comment| comment.0.start < at);
        self.comments
            .get(index)
            .copied()
            .filter(|comment| comment.0.start == at)
    }

    /// If a line break is at `at`, where it ends.
    fn line_break_end(&self, at: u32) -> Option<u32> {
        match self.text.get(at as usize..).unwrap_or_default() {
            [b'\r', b'\n', ..] => Some(at + 2),
            [b'\n' | b'\r', ..] => Some(at + 1),
            [0xE2, 0x80, 0xA8 | 0xA9, ..] => Some(at + 3),
            _ => None,
        }
    }

    fn blank_end(&self, at: u32) -> Option<u32> {
        match self.text.get(at as usize..).unwrap_or_default() {
            [b' ' | b'\t' | 0x0B | 0x0C, ..] => Some(at + 1),
            [0xC2, 0xA0, ..] => Some(at + 2),
            [0xEF, 0xBB, 0xBF, ..] => Some(at + 3),
            _ => None,
        }
    }

    /// `skipTrivia`
    fn skip_trivia(
        &self,
        mut at: u32,
        stops_after_line_break: bool,
        stops_at_comments: bool,
    ) -> u32 {
        loop {
            if let Some(end) = self.line_break_end(at) {
                at = end;
                if stops_after_line_break {
                    return at;
                }
            } else if let Some(end) = self.blank_end(at) {
                at = end;
            } else if let Some(comment) = self.comment_at(at).filter(|_| !stops_at_comments) {
                at = comment.0.end;
            } else {
                return at;
            }
        }
    }

    /// `getTrailingCommentRanges`: the comments from `at` to the end of the line.
    fn trailing_comments(&self, mut at: u32) -> Vec<(Span, bool)> {
        let mut found = Vec::new();
        loop {
            if let Some(end) = self.blank_end(at) {
                at = end;
            } else if let Some(comment) = self.comment_at(at) {
                found.push(comment);
                at = comment.0.end;
            } else {
                return found;
            }
        }
    }

    /// `getLeadingCommentRanges`: the comments from the first line break after `at`, or from the
    /// start of the file, to the next token.
    fn leading_comments(&self, mut at: u32) -> Vec<(Span, bool)> {
        let mut found = Vec::new();
        let mut is_collecting = at == 0;
        loop {
            if let Some(end) = self.line_break_end(at) {
                (at, is_collecting) = (end, true);
            } else if let Some(end) = self.blank_end(at) {
                at = end;
            } else if let Some(comment) = self.comment_at(at) {
                if is_collecting {
                    found.push(comment);
                }
                at = comment.0.end;
            } else {
                return found;
            }
        }
    }

    /// `getLineStartPositionForPosition`
    fn line_start(&self, at: u32) -> u32 {
        let before = &self.text[..(at as usize).min(self.text.len())];
        strings::last_index_of_any(before, b"\n\r").map_or(0, |it| it as u32 + 1)
    }

    fn next_line_start(&self, at: u32) -> u32 {
        let rest = self.text.get(at as usize..).unwrap_or_default();
        match strings::index_of_any(rest, b"\n\r") {
            Some(found) => self
                .line_break_end(at + found as u32)
                .unwrap_or(at + found as u32 + 1),
            None => self.text.len() as u32,
        }
    }

    // ───────────────────────────── textChanges.ts ─────────────────────────────

    /// `getEndPositionOfMultilineTrailingComment`
    fn end_of_multiline_trailing_comment(&self, end: u32) -> Option<u32> {
        let has_line_break =
            |span: Span| strings::index_of_any(self.file.slice(span), b"\n\r").is_some();
        let comments = self.trailing_comments(end);
        let multiline = comments
            .iter()
            .take_while(|comment| comment.1)
            .find(|comment| has_line_break(comment.0))?;
        Some(self.skip_trivia(multiline.0.end, true, true))
    }

    /// `getAdjustedEndPosition` with `TrailingTriviaOption.Include`
    fn adjusted_end(&self, end: u32) -> u32 {
        self.end_of_multiline_trailing_comment(end)
            .unwrap_or_else(|| self.skip_trivia(end, true, false))
    }

    /// `getAdjustedStartPosition` without a `leadingTriviaOption`
    fn adjusted_start(&self, declaration: &Declaration, has_trailing_comment: bool) -> u32 {
        let (full_start, start) = (declaration.full_start, declaration.span().start);
        let full_start_line = self.line_start(full_start);
        if full_start == start || self.line_start(start) == full_start_line {
            return start;
        }
        if has_trailing_comment
            && let Some(comment) = (self.leading_comments(full_start).first().copied())
                .or_else(|| self.trailing_comments(full_start).first().copied())
        {
            return self.skip_trivia(comment.0.end, true, true);
        }
        let line = if full_start > 0 {
            self.next_line_start(full_start_line)
        } else {
            full_start_line
        };
        self.line_start(self.skip_trivia(line, false, true))
    }

    // ───────────────────────────── organizeImports.ts ─────────────────────────────

    /// `isNewGroup`: whether there are two line breaks, not counting those in comments, before
    /// `declaration`.
    fn is_new_group(&self, declaration: &Declaration) -> bool {
        let (mut at, mut line_breaks) = (declaration.full_start, 0);
        while at < declaration.span().start {
            if let Some(end) = self.line_break_end(at) {
                at = end;
                line_breaks += 1;
                if line_breaks >= 2 {
                    return true;
                }
            } else if let Some(comment) = self.comment_at(at) {
                at = comment.0.end;
            } else {
                at += 1;
            }
        }
        false
    }

    /// `groupByNewlineContiguous`
    fn group_by_newline_contiguous(
        &self,
        declarations: &[Declaration<'a>],
    ) -> Vec<Vec<Declaration<'a>>> {
        let mut groups: Vec<Vec<Declaration<'a>>> = Vec::new();
        for declaration in declarations {
            match groups.last_mut() {
                Some(group) if !self.is_new_group(declaration) => group.push(*declaration),
                _ => groups.push(vec![*declaration]),
            }
        }
        groups
    }

    /// Whether a JSDoc comment names `name` where TypeScript takes it for a reference: in the type
    /// after a tag, as what a `{@link}` links to, or after `@see` and the like.
    fn is_named_in_jsdoc(&self, name: &[u8]) -> bool {
        let is_word = |byte: Option<&u8>| {
            byte.is_some_and(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$') || !byte.is_ascii()
            })
        };
        self.comments
            .iter()
            .filter(|comment| comment.1)
            .any(|comment| {
                let text = self.file.slice(comment.0);
                // One that follows something on its line documents nothing, unless that is a parameter.
                let before = self.text[..comment.0.start as usize].trim_ascii_end();
                let starts_line = before.is_empty()
                    || self.has_line_break_in(before.len() as u32, comment.0.start);
                if !text.starts_with(b"/**")
                    || !(starts_line || matches!(before.last(), Some(b'(' | b',')))
                {
                    return false;
                }
                let mut from = 0;
                while let Some(found) = strings::index_of(&text[from..], name) {
                    let (start, end) = (from + found, from + found + name.len());
                    from = end;
                    if is_word(text.get(start.wrapping_sub(1)))
                        || is_word(text.get(end))
                        || text.get(start.wrapping_sub(1)) == Some(&b'.')
                    {
                        continue;
                    }
                    let before = text[..start].trim_ascii_end();
                    let open = strings::last_index_of_char(before, b'{')
                        .filter(|open| strings::last_index_of_char(before, b'}') < Some(*open));
                    let is_reference = match open
                        .map(|open| (text[..open].trim_ascii_end(), &before[open + 1..]))
                    {
                        Some((_, [b'@', tag @ ..])) => {
                            matches!(tag, b"link" | b"linkcode" | b"linkplain")
                        }
                        // `@param {A}`
                        Some((before_brace, _)) => {
                            let word = before_brace.len()
                                - before_brace
                                    .iter()
                                    .rev()
                                    .take_while(|byte| byte.is_ascii_alphabetic())
                                    .count();
                            word > 0 && word < before_brace.len() && before_brace[word - 1] == b'@'
                        }
                        None => [
                            &b"@see"[..],
                            b"@extends",
                            b"@augments",
                            b"@implements",
                            b"@throws",
                        ]
                        .iter()
                        .any(|tag| before.ends_with(tag)),
                    };
                    if is_reference {
                        return true;
                    }
                }
                false
            })
    }

    /// `isDeclarationUsed`
    fn is_used(&self, name: Ident<'a>, statement: Stmt<'a>) -> bool {
        let Some(symbol) = Node::Stmt(statement).scope().get_name(name.name()) else {
            return true;
        };
        // For TypeScript, neither part of the tag `<a:b>` is a name.
        let is_in_namespaced_tag = |node: Node| matches!(node, Node::Expr(tag) if matches!(tag.kind(), ExprKind::String(_)));
        self.jsx_names.iter().any(|it| it == name.bytes())
            || symbol.declarations().len() > 1
            || symbol
                .references()
                .any(|it| !it.is_jsx_pragma() && !is_in_namespaced_tag(it.node()))
            || self.is_named_in_jsdoc(name.bytes())
    }

    /// `removeUnusedImports`
    fn remove_unused_imports(&self, imports: Vec<NewImport<'a>>) -> Vec<NewImport<'a>> {
        let mut used = Vec::with_capacity(imports.len());
        for mut import in imports {
            if !import.has_clause() {
                used.push(import);
                continue;
            }
            let statement = import.base.statement;
            import.name = import.name.filter(|name| self.is_used(*name, statement));
            import.namespace = import
                .namespace
                .filter(|name| self.is_used(*name, statement));
            if let Some(named) = &mut import.named {
                let count = named.len();
                named.retain(|it| matches!(it, Specifier::Written(it) if self.is_used(it.local(), statement)));
                import.braces = import.braces.map(|it| (it.0, named.len() == count));
                if named.is_empty() && count > 0 {
                    import.named = None;
                }
            }
            if import.has_clause() {
                used.push(import);
            } else if self.has_module_declaration_matching(import.base.module()) {
                // `declare module "m"` needs an import of it to be an augmentation.
                match (self.file.is_declaration_file(), import.base.import()) {
                    (false, Some(original)) => used.push(NewImport::of(import.base, original)),
                    _ => used.push(import),
                }
            }
        }
        used
    }

    /// `hasModuleDeclarationMatchingSpecifier`
    fn has_module_declaration_matching(&self, module: Option<&[u8]>) -> bool {
        self.file
            .body()
            .iter()
            .any(|statement| match statement.kind() {
                StmtKind::Module(it) => {
                    matches!(it.name(), ModuleName::String(name) if Some(name.bytes()) == module)
                }
                _ => false,
            })
    }

    /// What the imports that are combined have to have in common.
    fn attributes_key(&self, declaration: &Declaration<'a>) -> Vec<u8> {
        let Some(attributes) = declaration.statement.import_attributes() else {
            return Vec::new();
        };
        let mut entries: Vec<(&[u8], &[u8])> = (attributes.entries().iter())
            .filter_map(|it| {
                Some((
                    it.key()?.name()?.bytes(),
                    self.file
                        .slice(it.value()?.span())
                        .get(1..)?
                        .split_last()?
                        .1,
                ))
            })
            .collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        let mut key = [self.file.slice(attributes.keyword_span()), b" "].concat();
        for (name, value) in entries {
            key.extend_from_slice(&[name, b":\"", value, b"\""].concat());
        }
        key
    }

    /// `coalesceImportsWorker`
    fn coalesce_imports(&self, imports: Vec<NewImport<'a>>) -> Vec<NewImport<'a>> {
        let mut by_attributes: Vec<(Vec<u8>, Vec<NewImport<'a>>)> = Vec::new();
        for import in imports {
            let key = self.attributes_key(&import.base);
            match by_attributes.iter_mut().find(|it| it.0 == key) {
                Some(group) => group.1.push(import),
                None => by_attributes.push((key, vec![import])),
            }
        }
        let mut coalesced = Vec::new();
        for (_, group) in by_attributes {
            coalesced.extend(group.iter().find(|it| !it.has_clause()).cloned());
            for is_type_only in [false, true] {
                let of_kind = || {
                    group
                        .iter()
                        .filter(move |it| it.has_clause() && it.is_type_only() == is_type_only)
                };
                let defaults: Vec<&NewImport> = of_kind().filter(|it| it.name.is_some()).collect();
                let mut namespaces: Vec<&NewImport> =
                    of_kind().filter(|it| it.namespace.is_some()).collect();
                let named: Vec<&NewImport> = of_kind().filter(|it| it.named.is_some()).collect();
                if let (false, [default], [namespace], []) =
                    (is_type_only, &defaults[..], &namespaces[..], &named[..])
                {
                    coalesced.push(NewImport {
                        namespace: namespace.namespace,
                        named: None,
                        ..(*default).clone()
                    });
                    continue;
                }
                let name_of =
                    |it: &NewImport<'a>| it.namespace.map_or(&[][..], |name| name.bytes());
                stable_sort_by(&mut namespaces, |a, b| {
                    self.module_comparer.compare(name_of(a), name_of(b))
                });
                coalesced.extend(namespaces.iter().map(|it| NewImport {
                    name: None,
                    named: None,
                    ..(*it).clone()
                }));
                let Some(base) = defaults.first().or_else(|| named.first()) else {
                    continue;
                };
                let mut specifiers: Vec<Specifier<'a>> = Vec::new();
                let new_default = match &defaults[..] {
                    [only] => only.name,
                    all => {
                        specifiers
                            .extend(all.iter().filter_map(|it| it.name).map(Specifier::Default));
                        None
                    }
                };
                specifiers.extend(
                    named
                        .iter()
                        .flat_map(|it| it.named.iter().flatten())
                        .copied(),
                );
                stable_sort_by(&mut specifiers, |a, b| {
                    compare_specifiers(
                        a.key(),
                        b.key(),
                        self.named_comparer.unwrap_or(Comparer::IgnoringCase),
                        self.type_order,
                    )
                });
                let new_named =
                    (!specifiers.is_empty() || new_default.is_none()).then_some(specifiers);
                let braces = named.first().and_then(|it| it.braces);
                let import = |base: &NewImport<'a>, name, named| NewImport {
                    base: base.base,
                    name,
                    namespace: None,
                    named,
                    braces,
                };
                if is_type_only && new_default.is_some() && new_named.is_some() {
                    coalesced.push(import(base, new_default, None));
                    coalesced.push(import(named.first().unwrap_or(base), None, new_named));
                } else {
                    coalesced.push(import(base, new_default, new_named));
                }
            }
        }
        coalesced
    }

    /// The groups of `declarations` by module, sorted.
    fn sorted_by_module(&self, declarations: &[Declaration<'a>]) -> Vec<Vec<Declaration<'a>>> {
        let mut by_module: Vec<Vec<Declaration<'a>>> = Vec::new();
        for declaration in declarations {
            match by_module
                .iter_mut()
                .find(|group| group[0].module() == declaration.module())
            {
                Some(group) => group.push(*declaration),
                None => by_module.push(vec![*declaration]),
            }
        }
        let mut order: Vec<usize> = (0..by_module.len()).collect();
        stable_sort_by(&mut order, |a, b| {
            compare_module_specifiers(
                by_module[*a][0].module(),
                by_module[*b][0].module(),
                self.module_comparer,
            )
        });
        order
            .into_iter()
            .map(|index| std::mem::take(&mut by_module[index]))
            .collect()
    }

    /// The comments that the printer writes before and after the declaration `base`, around `code`.
    fn with_comments(
        &self,
        base: &Declaration<'a>,
        has_leading_comments: bool,
        code: &[u8],
        out: &mut Vec<u8>,
    ) {
        if has_leading_comments {
            for (span, is_block) in self.leading_comments(base.full_start) {
                out.extend_from_slice(self.file.slice(span));
                let is_on_its_own_line =
                    !is_block || self.line_break_end(self.skip_blanks(span.end)).is_some();
                out.extend_from_slice(if is_on_its_own_line {
                    self.end_of_line
                } else {
                    b" "
                });
            }
        }
        out.extend_from_slice(code);
        for (span, _) in self.trailing_comments(base.span().end) {
            out.push(b' ');
            out.extend_from_slice(self.file.slice(span));
        }
    }

    fn skip_blanks(&self, mut at: u32) -> u32 {
        while let Some(end) = self.blank_end(at) {
            at = end;
        }
        at
    }

    /// `getFullStart()` of what starts at `start`: where the token before it ends.
    fn full_start_of(&self, start: u32) -> u32 {
        let mut at = start;
        loop {
            at = self.text[..at as usize].trim_ascii_end().len() as u32;
            let index = self.comments.partition_point(|comment| comment.0.end < at);
            match self
                .comments
                .get(index)
                .filter(|comment| comment.0.end == at)
            {
                Some(comment) => at = comment.0.start,
                None => return at,
            }
        }
    }

    fn has_line_break_in(&self, from: u32, to: u32) -> bool {
        strings::index_of_any(
            self.text
                .get(from as usize..to as usize)
                .unwrap_or_default(),
            b"\n\r",
        )
        .is_some()
    }

    fn write_comment(&self, comment: (Span, bool), out: &mut Vec<u8>) {
        out.extend_from_slice(self.file.slice(comment.0));
        let ends_line = !comment.1
            || self
                .line_break_end(self.skip_blanks(comment.0.end))
                .is_some();
        out.extend_from_slice(if ends_line { self.end_of_line } else { b" " });
    }

    /// The comments on the lines after `at`, up to the next token: `emitLeadingCommentsOfPosition`.
    fn write_leading_comments(&self, at: u32, out: &mut Vec<u8>) {
        let leading = self.leading_comments(at);
        // `emitNewLineBeforeLeadingCommentOfPosition`
        if !leading.is_empty() {
            self.write_line(out);
        }
        leading
            .into_iter()
            .for_each(|it| self.write_comment(it, out));
    }

    /// `writer.writeLine()`: nothing at the start of a line.
    fn write_line(&self, out: &mut Vec<u8>) {
        if out.last() == Some(&b' ') {
            out.pop();
        }
        if !out.ends_with(self.end_of_line) {
            out.extend_from_slice(self.end_of_line);
        }
    }

    /// `emitNodeListItems` for the elements of named imports or exports, with the comments that
    /// the printer writes with them. `list`: the list that the braces are those of.
    /// `prefers_new_lines`: `ListFormat.PreferNewLine`.
    fn write_elements(
        &self,
        elements: &[Element],
        list: u32,
        prefers_new_lines: bool,
        has_trailing_comma: bool,
        out: &mut Vec<u8>,
    ) {
        if elements.is_empty() {
            return out.extend_from_slice(b"{ }");
        }
        out.push(b'{');
        // `getLeadingLineTerminatorCount`
        let starts_on_new_line = prefers_new_lines
            || (elements
                .first()
                .filter(|it| it.place.0 == list)
                .and_then(|it| it.span))
            .is_some_and(|span| self.has_line_break_in(self.full_start_of(span.start), span.start));
        out.extend_from_slice(if starts_on_new_line {
            self.end_of_line
        } else {
            b" "
        });
        // Whether what is between the `,` before an element and the end of that line is written.
        let mut writes_intervening_comments = !starts_on_new_line;
        let mut previous: Option<&Element> = None;
        for element in elements {
            let full_start = element.span.map(|span| self.full_start_of(span.start));
            if let Some(previous) = previous {
                if let Some(span) = previous.span {
                    self.write_leading_comments(span.end, out);
                }
                out.push(b',');
                // `getSeparatingLineTerminatorCount`
                let is_on_new_line = match (previous.span, element.span) {
                    (Some(before), Some(span))
                        if previous.place == (element.place.0, element.place.1.wrapping_sub(1)) =>
                    {
                        self.has_line_break_in(before.end, span.start)
                    }
                    _ => prefers_new_lines,
                };
                if is_on_new_line {
                    if writes_intervening_comments {
                        self.write_trailing_comments(full_start, out);
                    }
                    self.write_line(out);
                    writes_intervening_comments = false;
                } else {
                    out.push(b' ');
                }
            }
            if let (true, Some(full_start)) = (writes_intervening_comments, full_start) {
                self.trailing_comments(full_start)
                    .into_iter()
                    .for_each(|it| self.write_comment(it, out));
            }
            writes_intervening_comments = true;
            if let Some(full_start) = full_start {
                self.write_leading_comments(full_start, out);
            }
            out.extend_from_slice(&element.code);
            self.write_trailing_comments(element.span.map(|it| it.end), out);
            previous = Some(element);
        }
        match previous.and_then(|it| it.span) {
            // `emitTokenWithComment`
            Some(last) if has_trailing_comma => {
                self.write_leading_comments(last.end, out);
                out.push(b',');
                self.write_trailing_comments(
                    Some(self.skip_trivia(last.end, false, false) + 1),
                    out,
                );
            }
            Some(last) => self.write_leading_comments(last.end, out),
            None if has_trailing_comma && previous.is_some() => out.push(b','),
            None => {}
        }
        if prefers_new_lines {
            self.write_line(out);
        } else if !out.ends_with(self.end_of_line) {
            out.push(b' ');
        }
        out.push(b'}');
    }

    /// The comments from `at` to the end of the line.
    fn write_trailing_comments(&self, at: Option<u32>, out: &mut Vec<u8>) {
        for (span, is_block) in at.map(|at| self.trailing_comments(at)).unwrap_or_default() {
            out.push(b' ');
            out.extend_from_slice(self.file.slice(span));
            if !is_block {
                out.extend_from_slice(self.end_of_line);
            }
        }
    }

    /// The `{ .. }` in `within`.
    fn braces_in(&self, within: Span) -> Option<Span> {
        let mut at = within.start;
        while at < within.end && self.text.get(at as usize) != Some(&b'{') {
            at = self.comment_at(at).map_or(at + 1, |comment| comment.0.end);
        }
        (at < within.end && self.text.get(within.end as usize - 1) == Some(&b'}'))
            .then(|| Span::new(at, within.end))
    }

    /// `"m" with { type: "json" };`
    fn write_source(&self, statement: Stmt<'a>, out: &mut Vec<u8>) {
        let Some(source) = statement.module_specifier_span() else {
            return;
        };
        let end = statement
            .import_attributes()
            .map_or(source.end, |it| it.braces_span().end);
        out.extend_from_slice(self.file.slice(Span::new(source.start, end)));
    }

    fn import_code(&self, import: &NewImport<'a>) -> Vec<u8> {
        if self.is_written_alike(import) {
            return self.as_written(&import.base);
        }
        let original = import.base.import();
        // What is before and after the braces is written as it is, with its comments.
        let own_braces = original
            .filter(|it| {
                import.named.is_some() && import.braces.is_some_and(|braces| braces.0 == *it)
            })
            .and_then(|it| self.braces_in(it.clause_span()));
        let has_same_name = import.namespace.is_none()
            && import.name.map(|it| it.span())
                == original.and_then(|it| it.default()).map(|it| it.span());
        let mut out = match own_braces.filter(|_| has_same_name) {
            Some(braces) => self
                .file
                .slice(Span::new(import.base.span().start, braces.start))
                .to_vec(),
            None => {
                let mut out = b"import ".to_vec();
                if import.is_type_only() {
                    out.extend_from_slice(b"type ");
                } else if import.has_clause() && original.is_some_and(|it| it.is_deferred()) {
                    out.extend_from_slice(b"defer ");
                }
                if let Some(name) = import.name {
                    out.extend_from_slice(self.file.slice(name.span()));
                    if import.namespace.is_some() || import.named.is_some() {
                        out.extend_from_slice(b", ");
                    }
                }
                if let Some(namespace) = import.namespace {
                    out.extend_from_slice(b"* as ");
                    out.extend_from_slice(self.file.slice(namespace.span()));
                }
                out
            }
        };
        if let Some(named) = &import.named {
            let elements: Vec<Element> = (named.iter())
                .map(|specifier| match specifier {
                    Specifier::Default(name) => Element {
                        span: None,
                        code: [b"default as ", self.file.slice(name.span())].concat(),
                        place: (0, 0),
                    },
                    Specifier::Written(it) => {
                        let is_redundant = it.is_renamed()
                            && !it.imported().is_string()
                            && it.imported().bytes() == it.local().bytes();
                        Element {
                            span: Some(it.span()),
                            code: match is_redundant {
                                true => [
                                    if it.is_type_only() {
                                        &b"type "[..]
                                    } else {
                                        b""
                                    },
                                    self.file.slice(it.local().span()),
                                ]
                                .concat(),
                                false => self.file.slice(it.span()).to_vec(),
                            },
                            place: (
                                it.import().stmt().span().start,
                                it.import()
                                    .named()
                                    .iter()
                                    .position(|other| other == *it)
                                    .unwrap_or(0),
                            ),
                        }
                    }
                })
                .collect();
            let braces = import
                .braces
                .and_then(|it| Some((it.0, it.1, self.braces_in(it.0.clause_span())?)));
            let is_multi_line =
                braces.is_some_and(|it| self.has_line_break_in(it.2.start, it.2.end));
            let has_trailing_comma = braces.is_some_and(|it| {
                let after_last =
                    it.0.named()
                        .last()
                        .map(|last| self.skip_trivia(last.span().end, false, false));
                it.1 && after_last.is_some_and(|at| self.text.get(at as usize) == Some(&b','))
            });
            self.write_elements(
                &elements,
                braces.map_or(0, |it| it.0.stmt().span().start),
                is_multi_line,
                has_trailing_comma,
                &mut out,
            );
        }
        if let Some(braces) = own_braces {
            out.extend_from_slice(
                self.file
                    .slice(Span::new(braces.end, import.base.span().end)),
            );
            if !out.ends_with(b";") {
                out.push(b';');
            }
            return out;
        }
        if import.has_clause() {
            out.extend_from_slice(b" from ");
        }
        self.write_source(import.base.statement, &mut out);
        out.push(b';');
        out
    }

    /// `organizeDeclsWorker`, once what replaces `old` is known: for each new declaration, the
    /// old one that it has the comments of, and its code.
    fn replace(&mut self, old: &[Declaration<'a>], new: &[(Declaration<'a>, Vec<u8>)]) {
        let Some((first, rest)) = old.split_first() else {
            return;
        };
        if new.is_empty() {
            for declaration in old {
                self.changes.push((
                    Span::new(
                        declaration.span().start,
                        self.adjusted_end(declaration.span().end),
                    ),
                    Vec::new(),
                ));
            }
            return;
        }
        let mut text = Vec::new();
        for (index, (base, code)) in new.iter().enumerate() {
            if index > 0 {
                text.extend_from_slice(self.end_of_line);
            }
            self.with_comments(base, base.span() != first.span(), code, &mut text);
        }
        text.extend_from_slice(self.end_of_line);
        self.changes.push((
            Span::new(first.span().start, self.adjusted_end(first.span().end)),
            text,
        ));
        let mut has_trailing_comment = self
            .end_of_multiline_trailing_comment(first.span().end)
            .is_some();
        for declaration in rest {
            let start = self.adjusted_start(declaration, has_trailing_comment);
            self.changes.push((
                Span::new(start, self.adjusted_end(declaration.span().end)),
                Vec::new(),
            ));
            has_trailing_comment = self
                .end_of_multiline_trailing_comment(declaration.span().end)
                .is_some();
        }
    }

    /// Whether writing `declarations` anew in the same order changes nothing: no other statement
    /// is between them, no comment that is written with the second or a later one, and none has
    /// its `;` on a later line.
    fn is_plain(&self, declarations: &[Declaration<'a>]) -> bool {
        !declarations
            .iter()
            .any(|it| self.before_far_semicolon(it).is_some())
            && (declarations.iter().zip(declarations.iter().skip(1))).all(|(a, b)| {
                a.span().end == b.full_start
                    && (self.comments.is_empty() || self.leading_comments(b.full_start).is_empty())
            })
    }

    /// Of a declaration with its `;` on a later line, what is before the `;`.
    fn before_far_semicolon(&self, declaration: &Declaration<'a>) -> Option<&'a [u8]> {
        let text = self.file.slice(declaration.span()).strip_suffix(b";")?;
        let before = text.trim_ascii_end();
        let end = declaration.span().start + before.len() as u32;
        let is_after_comment = self
            .comments
            .get(self.comments.partition_point(|it| it.0.end < end))
            .is_some_and(|it| it.0.end == end);
        (!is_after_comment && strings::index_of_any(&text[before.len()..], b"\n\r").is_some())
            .then_some(before)
    }

    /// `declaration` the way it is written, with its `;` where the printer writes it.
    fn as_written(&self, declaration: &Declaration<'a>) -> Vec<u8> {
        match self.before_far_semicolon(declaration) {
            Some(before) => [before, b";"].concat(),
            None => self.file.slice(declaration.span()).to_vec(),
        }
    }

    fn has_comment_in(&self, span: Span) -> bool {
        let next = self
            .comments
            .partition_point(|comment| comment.0.start < span.start);
        self.comments
            .get(next)
            .is_some_and(|comment| comment.0.end <= span.end)
    }

    /// Whether the printer writes `import` the way it is written. It makes a new list of what is
    /// in the braces, and leaves out some of the comments there.
    fn is_written_alike(&self, import: &NewImport<'a>) -> bool {
        import.is_unchanged()
            && !(import.base.import())
                .and_then(|it| self.braces_in(it.clause_span()))
                .is_some_and(|it| self.has_comment_in(it))
    }

    /// `organizeImportsWorker`
    fn organize_imports(&mut self, old: &[Declaration<'a>]) {
        let mut new: Vec<NewImport<'a>> = Vec::with_capacity(old.len());
        for group in self.sorted_by_module(old) {
            let mut imports: Vec<NewImport<'a>> = group
                .iter()
                .filter_map(|it| Some(NewImport::of(*it, it.import()?)))
                .collect();
            if !self.options.skips_destructive_code_actions {
                imports = self.remove_unused_imports(imports);
            }
            imports = self.coalesce_imports(imports);
            stable_sort_by_clone(&mut imports, |a, b| a.kind_order().cmp(&b.kind_order()));
            new.extend(imports);
        }
        let is_same = new.len() == old.len()
            && self.is_plain(old)
            && new
                .iter()
                .zip(old)
                .all(|(new, old)| new.base.span() == old.span() && self.is_written_alike(new));
        if !is_same {
            let new: Vec<(Declaration<'a>, Vec<u8>)> = new
                .iter()
                .map(|it| (it.base, self.import_code(it)))
                .collect();
            self.replace(old, &new);
        }
    }

    fn export_code(
        &self,
        base: &Declaration<'a>,
        export: Export<'a>,
        items: &[ExportSpec<'a>],
    ) -> Vec<u8> {
        let mut out = if export.is_type_only() {
            b"export type ".to_vec()
        } else {
            b"export ".to_vec()
        };
        let elements: Vec<Element> = (items.iter())
            .map(|it| Element {
                span: Some(it.span()),
                code: self.file.slice(it.span()).to_vec(),
                place: (
                    it.export().stmt().span().start,
                    it.export()
                        .items()
                        .iter()
                        .position(|other| other == *it)
                        .unwrap_or(0),
                ),
            })
            .collect();
        self.write_elements(&elements, base.span().start, false, false, &mut out);
        if export.has_from() {
            out.extend_from_slice(b" from ");
            self.write_source(base.statement, &mut out);
        }
        out.push(b';');
        out
    }

    /// `organizeExportsWorker`
    fn organize_exports(&mut self, old: &[Declaration<'a>]) {
        let type_order = self.options.type_order.unwrap_or(TypeOrder::Last);
        let mut new: Vec<(Declaration<'a>, Vec<u8>)> = Vec::with_capacity(old.len());
        let mut is_same = true;
        for group in self.sorted_by_module(old) {
            // `coalesceExportsWorker`
            let is_star = |it: &&Declaration| {
                matches!(
                    it.statement.kind(),
                    StmtKind::ExportStar { alias: None, .. }
                )
            };
            new.extend(
                group
                    .iter()
                    .find(is_star)
                    .map(|it| (*it, self.as_written(it))),
            );
            is_same &= group.iter().filter(is_star).count() <= 1;
            for is_type_only in [false, true] {
                let of_kind: Vec<&Declaration> = (group.iter())
                    .filter(|it| match it.statement.kind() {
                        StmtKind::ExportNamed(export) => export.is_type_only() == is_type_only,
                        StmtKind::ExportStar {
                            alias: Some(_),
                            type_only,
                            ..
                        } => type_only == is_type_only,
                        _ => false,
                    })
                    .collect();
                let Some(&first) = of_kind.first() else {
                    continue;
                };
                is_same &= of_kind.len() == 1;
                let StmtKind::ExportNamed(export) = first.statement.kind() else {
                    new.push((*first, self.as_written(first)));
                    continue;
                };
                let written: Vec<ExportSpec<'a>> = (of_kind.iter())
                    .filter_map(|it| {
                        if let StmtKind::ExportNamed(export) = it.statement.kind() {
                            Some(export.items())
                        } else {
                            None
                        }
                    })
                    .flat_map(List::iter)
                    .collect();
                let mut items = written.clone();
                stable_sort_by(&mut items, |a, b| {
                    let key = |it: &ExportSpec<'a>| (it.is_type_only(), it.exported().bytes());
                    compare_specifiers(
                        key(a),
                        key(b),
                        self.named_comparer.unwrap_or(Comparer::CaseSensitive),
                        type_order,
                    )
                });
                let is_sorted = items
                    .iter()
                    .zip(&written)
                    .all(|(a, b)| a.span() == b.span())
                    && !self.has_comment_in(first.span());
                is_same &= is_sorted;
                new.push((
                    *first,
                    if is_sorted && of_kind.len() == 1 {
                        self.as_written(first)
                    } else {
                        self.export_code(first, export, &items)
                    },
                ));
            }
        }
        is_same &= new.len() == old.len()
            && self.is_plain(old)
            && new
                .iter()
                .zip(old)
                .all(|(new, old)| new.0.span() == old.span());
        if !is_same {
            self.replace(old, &new);
        }
    }

    /// The imports, and the groups of exports (`getTopLevelExportGroups`), among `statements`,
    /// before which the token before ends at `start`.
    fn declarations_in(
        &self,
        statements: List<'a, Stmt<'a>>,
        start: u32,
    ) -> (Vec<Declaration<'a>>, Vec<Vec<Declaration<'a>>>) {
        let (mut imports, mut exports): (Vec<Declaration<'a>>, Vec<Vec<Declaration<'a>>>) =
            (Vec::new(), vec![Vec::new()]);
        let mut full_start = start;
        // Exports without a `from` that follow each other end a group.
        let mut is_in_local_run = false;
        for statement in statements.iter() {
            let declaration = Declaration {
                statement,
                full_start,
            };
            full_start = statement.span().end;
            let is_export = matches!(
                statement.kind(),
                StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. }
            );
            if is_in_local_run && !is_export {
                is_in_local_run = false;
                exports.push(Vec::new());
            }
            match statement.kind() {
                StmtKind::Import(_) => imports.push(declaration),
                _ if is_export => {
                    is_in_local_run |= declaration.module().is_none();
                    if let Some(group) = exports.last_mut() {
                        group.push(declaration);
                    }
                }
                _ => {}
            }
        }
        (imports, exports)
    }
}

fn stable_sort_by_clone<T: Clone>(items: &mut Vec<T>, compare: impl Fn(&T, &T) -> Ordering) {
    let mut order: Vec<usize> = (0..items.len()).collect();
    stable_sort_by(&mut order, |a, b| compare(&items[*a], &items[*b]));
    *items = order
        .into_iter()
        .map(|index| items[index].clone())
        .collect();
}

/// The text that the plugin hands to Prettier in place of `file`. `None`: the same text, or one
/// that is formatted the same.
pub(super) fn preprocess<'a>(
    file: &'a File<'a>,
    options: &Options,
    end_of_line: &'static [u8],
) -> Option<Vec<u8>> {
    let text = file.text();
    if strings::contains(text, b"// organize-imports-ignore")
        || strings::contains(text, b"// tslint:disable:ordered-imports")
    {
        return None;
    }
    let is_declaration = |it: Stmt| {
        matches!(
            it.kind(),
            StmtKind::Import(_)
                | StmtKind::ExportNamed(_)
                | StmtKind::ExportStar { .. }
                | StmtKind::Module(_)
        )
    };
    if !file.body().iter().any(is_declaration) {
        return None;
    }
    let mut organizer = Organizer {
        file,
        text,
        options,
        end_of_line,
        comments: (file.comments().filter(|it| it.kind() != TokenKind::Shebang))
            .map(|it| (it.span(), it.kind() == TokenKind::Block))
            .collect(),
        module_comparer: Comparer::IgnoringCase,
        named_comparer: None,
        type_order: TypeOrder::Last,
        jsx_names: Vec::new(),
        changes: Vec::new(),
    };
    let start = file
        .comments()
        .next()
        .filter(|it| it.kind() == TokenKind::Shebang)
        .map_or(0, |it| it.span().end);
    let (imports, exports) = organizer.declarations_in(file.body(), start);
    let groups = organizer.group_by_newline_contiguous(&imports);

    let names: Vec<Vec<&[u8]>> = groups
        .iter()
        .map(|group| {
            group
                .iter()
                .map(|it| it.module().unwrap_or_default())
                .collect()
        })
        .collect();
    organizer.module_comparer = detect_case_sensitivity_by_sort(&names);
    let orders = options.type_order.map_or_else(
        || vec![TypeOrder::Last, TypeOrder::Inline, TypeOrder::First],
        |order| vec![order],
    );
    let detected = detect_named_import_organization_by_sort(&imports, &orders);
    organizer.named_comparer = detected.map(|it| it.0);
    organizer.type_order = options
        .type_order
        .or_else(|| detected.and_then(|it| it.1))
        .unwrap_or(TypeOrder::Last);

    if options.jsx_needs_import && file.has_exprs([ExprTag::Jsx]) {
        // `/** @jsx h */`
        let pragma = |name: &[u8]| {
            let first_token = file.program_span().start;
            organizer
                .comments
                .iter()
                .take_while(|it| it.0.end <= first_token)
                .filter(|it| it.1)
                .find_map(|it| {
                    let text = file.slice(it.0);
                    let rest = text[strings::index_of(text, name)? + name.len()..]
                        .strip_prefix(b" ")?
                        .trim_ascii_start();
                    Some(
                        rest[..rest
                            .iter()
                            .take_while(|byte| {
                                byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$')
                            })
                            .count()]
                            .to_vec(),
                    )
                })
        };
        let namespace = pragma(b"@jsx").unwrap_or_else(|| options.jsx_namespace.to_vec());
        let fragment_factory = pragma(b"@jsxFrag")
            .or_else(|| options.jsx_fragment_factory.as_deref().map(<[u8]>::to_vec));
        organizer.jsx_names = std::iter::once(namespace).chain(fragment_factory).collect();
    }

    for group in &groups {
        organizer.organize_imports(group);
    }
    for group in exports
        .iter()
        .flat_map(|group| organizer.group_by_newline_contiguous(group))
        .collect::<Vec<_>>()
    {
        organizer.organize_exports(&group);
    }
    for statement in file.body().iter() {
        let StmtKind::Module(module) = statement.kind() else {
            continue;
        };
        let (ModuleName::String(_) | ModuleName::Global, Some(body)) =
            (module.name(), module.body_span())
        else {
            continue;
        };
        let (imports, exports) = organizer.declarations_in(module.body(), body.start + 1);
        for group in organizer.group_by_newline_contiguous(&imports) {
            organizer.organize_imports(&group);
        }
        let exports: Vec<Declaration> = exports.into_iter().flatten().collect();
        organizer.organize_exports(&exports);
    }

    if organizer.changes.is_empty() {
        return None;
    }
    let mut changes = organizer.changes;
    changes.sort_by_key(|change| change.0.start);
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    for (span, new_text) in changes {
        out.extend_from_slice(
            text.get(at..(span.start as usize).max(at))
                .unwrap_or_default(),
        );
        out.extend_from_slice(&new_text);
        at = at.max(span.end as usize);
    }
    out.extend_from_slice(text.get(at..).unwrap_or_default());
    Some(out)
}
