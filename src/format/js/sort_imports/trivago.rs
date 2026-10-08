//! `@trivago/prettier-plugin-sort-imports` 6.0: its `preprocessor`.

use super::babel::{Attached, Declaration, Model, Node, SpecifierKind, utf16_len};
use super::builtins::is_builtin_module;
use super::compare::{locale_compare, natural_sort};
use super::generator::{Piece, PieceKind, Printer};
use super::layout::is_unchanged;
use super::sort::stable_sort_by;
use bun_lint::linter::Glob;
use bun_lint::regex::Regex;
use bun_lint::span::Span;
use std::cmp::Ordering;

pub(super) const THIRD_PARTY_MODULES: &[u8] = b"<THIRD_PARTY_MODULES>";
pub(super) const BUILTIN_MODULES: &[u8] = b"<BUILTIN_MODULES>";
pub(super) const THIRD_PARTY_TYPES: &[u8] = b"<THIRD_PARTY_TS_TYPES>";
pub(super) const TYPES: &[u8] = b"<TS_TYPES>";
pub(super) const SEPARATOR: &[u8] = b"<SEPARATOR>";

/// An element of `importOrder`.
#[derive(Debug)]
pub(super) struct Group {
    pub(super) text: Box<[u8]>,
    pub(super) regex: Regex,
    /// The first element with the same text: they are one group.
    pub(super) same_as: usize,
}

impl Group {
    fn is_for_types(&self) -> bool {
        self.text.starts_with(TYPES)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ByLength {
    Ascending,
    Descending,
}

pub(super) struct Exclude {
    pub(super) glob: Glob,
    pub(super) has_slash: bool,
}

impl std::fmt::Debug for Exclude {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Exclude").field("has_slash", &self.has_slash).finish_non_exhaustive()
    }
}

#[derive(Debug)]
pub(super) struct Options {
    /// `importOrder`, with `<THIRD_PARTY_MODULES>` before it if it does not have it.
    pub(super) order: Vec<Group>,
    pub(super) is_case_insensitive: bool,
    pub(super) separation: bool,
    pub(super) group_namespace_specifiers: bool,
    pub(super) sort_specifiers: bool,
    pub(super) sort_by_length: Option<ByLength>,
    pub(super) side_effects: bool,
    pub(super) attributes_keyword: &'static [u8],
    pub(super) exclude: Vec<Exclude>,
}

impl Options {
    fn index_of(&self, text: &[u8]) -> Option<usize> {
        self.order.iter().position(|group| &*group.text == text)
    }

    /// `shouldSkipFile`
    fn skips(&self, path: &[u8]) -> bool {
        let name = bun_core::strings::last_index_of_char(path, b'/').map_or(path, |slash| &path[slash + 1..]);
        self.exclude.iter().any(|it| it.glob.matches(if it.has_slash { path } else { name }))
    }

    /// `getImportNodesMatchedGroup`
    fn group_of(&self, source: &[u8], is_type: bool) -> usize {
        if let Some(builtin) = self.index_of(BUILTIN_MODULES).filter(|_| is_builtin_module(source)) {
            return builtin;
        }
        let mut matching = (self.order.iter())
            .filter(|group| (is_type || !group.is_for_types()) && group.regex.test(source))
            .map(|group| (group.same_as, group.is_for_types()));
        let Some(first) = matching.next() else {
            let for_types = if is_type { self.index_of(THIRD_PARTY_TYPES) } else { None };
            return for_types.or_else(|| self.index_of(THIRD_PARTY_MODULES)).unwrap_or(0);
        };
        match is_type && !first.1 {
            true => matching.find(|it| it.1).unwrap_or(first).0,
            false => first.0,
        }
    }
}

/// `isSortImportsIgnored`
fn is_ignored(model: &Model, comments: super::babel::List) -> bool {
    let is_js_blank = |byte: &u8| byte.is_ascii_whitespace() || *byte == 0x0B;
    model.list(comments).iter().any(|comment| {
        let value = model.comment_value(*comment);
        let blanks = value.iter().take_while(|byte| is_js_blank(byte)).count();
        value[blanks..].starts_with(b"sort-imports-ignore")
    })
}

/// `getSortedNodesByImportOrder`
fn sorted_by_import_order(model: &mut Model, nodes: &[u32], options: &Options, out: &mut Vec<Node>) {
    let mut grouped: Vec<(usize, u32)> = nodes
        .iter()
        .map(|&index| {
            let declaration = &model.declarations[index as usize];
            (options.group_of(model.source_of(declaration), declaration.is_type), index)
        })
        .collect();

    let has_namespace = |declaration: &Declaration| {
        model.specifiers_of(declaration).iter().any(|it| model.specifiers[*it as usize].kind == SpecifierKind::Namespace)
    };
    let length = |declaration: &Declaration| declaration.span.map_or(0, |span| utf16_len(model.file.slice(span)));
    // `getSortedNodesGroup`
    stable_sort_by(&mut grouped, |a, b| {
        if a.0 != b.0 {
            return a.0.cmp(&b.0);
        }
        let (a, b) = (&model.declarations[a.1 as usize], &model.declarations[b.1 as usize]);
        let by_namespace = match options.group_namespace_specifiers {
            true => has_namespace(b).cmp(&has_namespace(a)),
            false => Ordering::Equal,
        };
        let (a_source, b_source) = (model.source_of(a), model.source_of(b));
        by_namespace.then_with(|| match options.sort_by_length {
            Some(ByLength::Ascending) => length(a).cmp(&length(b)).then_with(|| locale_compare(a_source, b_source)),
            Some(ByLength::Descending) => length(b).cmp(&length(a)).then_with(|| locale_compare(a_source, b_source)),
            None => natural_sort(a_source, b_source, options.is_case_insensitive),
        })
    });

    if options.sort_specifiers {
        for &(_, index) in &grouped {
            sort_specifiers(model, index, options);
        }
    }

    let has_user_provided_separators = options.index_of(SEPARATOR).is_some();
    let mut is_safe_to_add_new_line = false;
    for group in &options.order {
        if options.separation && &*group.text == SEPARATOR && is_safe_to_add_new_line {
            out.push(Node::NewLine);
        }
        let before = out.len();
        out.extend(grouped.iter().filter(|it| it.0 == group.same_as).map(|it| Node::Import(it.1)));
        if out.len() == before {
            continue;
        }
        is_safe_to_add_new_line = true;
        if options.separation && !has_user_provided_separators {
            out.push(Node::NewLine);
        }
    }
}

/// `getSortedImportSpecifiers`
fn sort_specifiers(model: &mut Model, index: u32, options: &Options) {
    let (start, len) = model.declarations[index as usize].specifiers;
    let mut order = std::mem::take(&mut model.orders);
    if let Some(specifiers) = order.get_mut(start as usize..(start + len) as usize) {
        stable_sort_by(specifiers, |a, b| {
            let (a, b) = (&model.specifiers[*a as usize], &model.specifiers[*b as usize]);
            match a.kind == b.kind {
                true => natural_sort(a.local.bytes(), b.local.bytes(), options.is_case_insensitive),
                false if a.kind == SpecifierKind::Default => Ordering::Less,
                false => Ordering::Greater,
            }
        });
    }
    model.orders = order;
}

/// `getSortedNodes`
fn sorted_nodes(model: &mut Model, options: &Options) -> Vec<Node> {
    let is_side_effect = |model: &Model, index: u32| !options.side_effects && model.declarations[index as usize].specifiers.1 == 0;
    let count = model.declarations.len() as u32;
    let mut nodes = Vec::with_capacity(count as usize + options.order.len() + 1);
    let mut start = 0;
    while start < count {
        let kind = is_side_effect(model, start);
        let end = (start..count).find(|index| is_side_effect(model, *index) != kind).unwrap_or(count);
        match kind {
            true => nodes.extend((start..end).map(Node::Import)),
            false => {
                let chunk: Vec<u32> = (start..end).collect();
                sorted_by_import_order(model, &chunk, options, &mut nodes);
            }
        }
        if options.separation {
            nodes.push(Node::NewLine);
        }
        start = end;
    }
    if !nodes.is_empty() && !options.separation {
        nodes.push(Node::NewLine);
    }

    // `adjustCommentsOnSortedNodes`
    let first_comments = model.declarations[0].comments.leading;
    for declaration in &mut model.declarations {
        declaration.comments = Attached {
            leading: declaration.comments.leading,
            ..Attached::default()
        };
    }
    model.declarations[0].comments.leading = Default::default();
    for at in 0..model.list(first_comments).len() {
        let comment = model.list(first_comments)[at];
        model.comments[comment as usize].has_loc = false;
    }
    if let Some(&Node::Import(first)) = nodes.first() {
        let own = model.declarations[first as usize].comments.leading;
        model.declarations[first as usize].comments.leading = model.concat(first_comments, own);
    }
    nodes
}

/// The text that the plugin hands to Prettier in place of the file of `model`. `None`: it is
/// formatted the same.
pub(super) fn preprocess(model: &mut Model, options: &Options, end_of_line: &'static [u8]) -> Option<Vec<u8>> {
    if options.skips(model.file.path()) {
        return None;
    }
    let (first_start, first_comments) = model.first_statement?;
    if is_ignored(model, first_comments) || model.declarations.iter().any(|it| is_ignored(model, it.comments.leading)) {
        return None;
    }
    let inject_at = model.list(first_comments).first().map_or(first_start, |it| model.comments[*it as usize].span.start);

    let nodes = sorted_nodes(model, options);
    let model = &*model;
    let printer = Printer::new(model, options.attributes_keyword, end_of_line).generate(false, false, &nodes);
    if printer.has_failed {
        return None;
    }

    // `assembleUpdatedCode`
    let mut removed: Vec<Span> = model.declarations.iter().filter_map(|it| it.span).collect();
    for declaration in &model.declarations {
        removed.extend(model.list(declaration.comments.leading).iter().map(|it| model.comments[*it as usize].span));
    }
    removed.sort_unstable_by_key(|span| span.start);
    let (text, code) = (model.text, printer.code());
    let mut out = Vec::with_capacity(text.len() + code.len());
    let mut pieces: Vec<Piece> = Vec::with_capacity(printer.pieces.len());
    let mut comments = model.comments.iter().enumerate().peekable();
    let mut at = 0;
    let mut is_injected = false;
    // Appends the text from `at` to `to`, with the code in it.
    let mut keep = |out: &mut Vec<u8>, at: u32, to: u32| {
        let mut at = at;
        if !is_injected && inject_at <= to {
            is_injected = true;
            out.extend_from_slice(&text[at as usize..inject_at.max(at) as usize]);
            at = inject_at.max(at);
            let moved = out.len() as u32;
            pieces.extend(printer.pieces.iter().map(|piece| Piece {
                start: piece.start + moved,
                end: piece.end + moved,
                ..*piece
            }));
            out.extend_from_slice(code);
        }
        // The comments that stay.
        while let Some((id, comment)) = comments.next_if(|it| it.1.span.start < to) {
            if comment.span.start >= at.max(inject_at) {
                let start = out.len() as u32 + comment.span.start - at;
                pieces.push(Piece {
                    kind: PieceKind::Comment(id as u32),
                    start,
                    end: start + comment.span.len(),
                });
            }
        }
        out.extend_from_slice(&text[at as usize..to as usize]);
    };
    for span in removed {
        if span.start > at {
            keep(&mut out, at, span.start);
        }
        at = at.max(span.end);
    }
    let rest_start = model.rest_start.max(at);
    keep(&mut out, at, rest_start);
    let new_rest_start = out.len() as u32;
    out.extend_from_slice(&text[rest_start as usize..]);

    let is_same = !printer.has_changed_comment && is_unchanged(model, inject_at, &out, inject_at, &pieces, new_rest_start);
    (!is_same).then_some(out)
}
