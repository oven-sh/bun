//! `@ianvs/prettier-plugin-sort-imports` 4.7: its `preprocessor`.

use super::babel::{
    Attached, CommentId, Declaration, Lines, List, Model, Node, SpecifierKind, Which,
};
use super::builtins::is_builtin_module;
use super::compare::{collate_base_numeric, natural_sort_case_sensitive};
use super::generator::{Piece, PieceKind, Printer, whitespace_len};
use super::layout::is_unchanged;
use super::sort::stable_sort_by;
use bun_lint::regex::Regex;
use bun_lint::span::Span;
use std::cmp::Ordering;

pub(super) const THIRD_PARTY_MODULES: &[u8] = b"<THIRD_PARTY_MODULES>";
pub(super) const BUILTIN_MODULES: &[u8] = b"<BUILTIN_MODULES>";
pub(super) const TYPES: &[u8] = b"<TYPES>";

#[derive(Debug)]
pub(super) enum Matcher {
    /// `""`: an empty line.
    Separator,
    ThirdParty,
    Builtin,
    /// `<TYPES>` and nothing else.
    Types,
    /// `is_for_types`: it has `<TYPES>` in it.
    Regex {
        regex: Box<Regex>,
        is_for_types: bool,
    },
}

/// An element of `importOrder`.
#[derive(Debug)]
pub(super) struct Group {
    pub(super) matcher: Matcher,
    /// The first element with the same text: they are one group.
    pub(super) same_as: usize,
}

#[derive(Debug)]
pub(super) struct Options {
    /// `importOrder`, normalized.
    pub(super) order: Vec<Group>,
    pub(super) combine_type_and_value_imports: bool,
    pub(super) is_case_sensitive: bool,
    pub(super) safe_side_effects: Vec<Regex>,
}

impl Options {
    fn has_separators(&self) -> bool {
        self.order
            .iter()
            .any(|group| matches!(group.matcher, Matcher::Separator))
    }

    fn has_types(&self) -> bool {
        self.order.iter().any(|group| {
            matches!(
                group.matcher,
                Matcher::Types
                    | Matcher::Regex {
                        is_for_types: true,
                        ..
                    }
            )
        })
    }

    fn compare(&self, a: &[u8], b: &[u8]) -> Ordering {
        match self.is_case_sensitive {
            true => natural_sort_case_sensitive(a, b),
            false => collate_base_numeric(a, b),
        }
    }

    /// `getImportNodesMatchedGroup`. `None`: there is no such group, which is an error.
    fn group_of(&self, source: &[u8], is_type: bool) -> Option<usize> {
        let has_types = self.has_types();
        for group in &self.order {
            let is_matched = match &group.matcher {
                Matcher::Separator | Matcher::ThirdParty | Matcher::Types => false,
                Matcher::Builtin => !(has_types && is_type) && is_builtin_module(source),
                Matcher::Regex {
                    regex,
                    is_for_types: true,
                } => is_type && regex.test(source),
                Matcher::Regex {
                    regex,
                    is_for_types: false,
                } => !(has_types && is_type) && regex.test(source),
            };
            if is_matched {
                return Some(group.same_as);
            }
        }
        self.order
            .iter()
            .position(|group| match has_types && is_type {
                true => matches!(group.matcher, Matcher::Types),
                false => matches!(group.matcher, Matcher::ThirdParty),
            })
    }
}

/// `hasIgnoreNextNode`
fn has_ignore_next_node(model: &Model, comments: &[CommentId]) -> bool {
    comments
        .iter()
        .any(|comment| trim(model.comment_value(*comment)) == b"prettier-ignore")
}

/// `text.trim()`
fn trim(text: &[u8]) -> &[u8] {
    trim_end(trim_start(text))
}

fn trim_end(text: &[u8]) -> &[u8] {
    let mut text = text;
    loop {
        text = match text {
            [rest @ .., b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C] | [rest @ .., 0xC2, 0xA0] => {
                rest
            }
            [rest @ .., a, b, c] if whitespace_len(&[*a, *b, *c]) == 3 => rest,
            _ => return text,
        };
    }
}

fn has_kind(model: &Model, declaration: &Declaration, kind: SpecifierKind) -> bool {
    model
        .specifiers_of(declaration)
        .iter()
        .any(|it| model.specifiers[*it as usize].kind == kind)
}

/// `mergeNodes`: whether `forget` has been merged into `keep`.
fn merge_nodes(model: &mut Model, keep: u32, forget: u32) -> bool {
    let (kept, forgotten) = (
        model.declarations[keep as usize],
        model.declarations[forget as usize],
    );
    // `mergeIsSafe`
    let both = [&kept, &forgotten];
    if both
        .iter()
        .any(|it| has_kind(model, it, SpecifierKind::Namespace))
        || both
            .iter()
            .all(|it| has_kind(model, it, SpecifierKind::Default))
        || both
            .iter()
            .any(|it| it.is_type && has_kind(model, it, SpecifierKind::Default))
    {
        return false;
    }
    // `convertTypeImportToValueImport`
    if kept.is_type != forgotten.is_type {
        let converted = if kept.is_type { keep } else { forget };
        model.declarations[converted as usize].is_type = false;
        let (start, len) = model.declarations[converted as usize].specifiers;
        for at in start..start + len {
            let specifier = &mut model.specifiers[model.orders[at as usize] as usize];
            specifier.is_type |= specifier.kind == SpecifierKind::Named;
        }
    }
    let all: Vec<u32> = [&kept, &forgotten]
        .iter()
        .flat_map(|it| model.specifiers_of(it).iter().copied())
        .collect();
    let specifiers = model.new_specifiers(all);
    let comments = Attached {
        leading: model.concat(kept.comments.leading, forgotten.comments.leading),
        inner: model.concat(kept.comments.inner, forgotten.comments.inner),
        trailing: model.concat(kept.comments.trailing, forgotten.comments.trailing),
    };
    let kept = &mut model.declarations[keep as usize];
    (kept.specifiers, kept.comments) = (specifiers, comments);
    true
}

/// `mergeNodesWithMatchingImportFlavors`
fn merge_nodes_with_matching_import_flavors(
    model: &mut Model,
    nodes: &mut Vec<u32>,
    options: &Options,
) {
    let text_start = model.text_start();
    let mut deleted: Vec<u32> = Vec::new();
    // By source, the node that others are merged into.
    let mut context: Vec<u32> = Vec::new();
    for is_type in [false, true] {
        if !options.combine_type_and_value_imports {
            context.clear();
        }
        for &node in nodes.iter() {
            let declaration = model.declarations[node as usize];
            // `getImportFlavorOfNode`
            if has_ignore_next_node(model, model.list(declaration.comments.leading))
                || declaration.specifiers.1 == 0
                || declaration.is_type != is_type
                || deleted.contains(&node)
            {
                continue;
            }
            let source = model.source_of(&declaration);
            let Some(at) = context
                .iter()
                .position(|it| model.source_of(&model.declarations[*it as usize]) == source)
            else {
                context.push(node);
                continue;
            };
            let existing = context[at];
            let start = |index: u32| {
                model.declarations[index as usize]
                    .span
                    .map_or(0, |span| span.start - text_start)
            };
            if start(existing) != 0 && start(node) != 0 && start(existing) > start(node) {
                if merge_nodes(model, node, existing) {
                    deleted.push(existing);
                    context[at] = node;
                }
            } else if merge_nodes(model, existing, node) {
                deleted.push(node);
            }
        }
    }
    nodes.retain(|node| !deleted.contains(node));
}

/// `explodeTypeAndValueSpecifiers`
fn explode_type_and_value_specifiers(model: &mut Model, nodes: &mut Vec<u32>) {
    let mut exploded = Vec::with_capacity(nodes.len());
    for &node in nodes.iter() {
        let declaration = model.declarations[node as usize];
        let specifiers = model.specifiers_of(&declaration);
        let is_type = |it: &&u32| {
            model.specifiers[**it as usize].kind == SpecifierKind::Named
                && model.specifiers[**it as usize].is_type
        };
        let types: Vec<u32> = specifiers.iter().filter(is_type).copied().collect();
        if declaration.is_type
            || specifiers.len() <= 1
            || types.is_empty()
            || types.len() == specifiers.len()
        {
            exploded.push(node);
            continue;
        }
        let values: Vec<u32> = specifiers
            .iter()
            .filter(|it| !is_type(it))
            .copied()
            .collect();
        for (is_type, specifiers) in [(false, values), (true, types)] {
            for &specifier in &specifiers {
                model.specifiers[specifier as usize].is_type = false;
            }
            exploded.push(model.declarations.len() as u32);
            let specifiers = model.new_specifiers(specifiers);
            model.declarations.push(Declaration {
                span: None,
                lines: None,
                is_type,
                specifiers,
                has_attributes: false,
                comments: Attached::default(),
                ..declaration
            });
        }
    }
    *nodes = exploded;
}

/// `getSortedImportSpecifiers`
fn sort_specifiers(model: &mut Model, index: u32, options: &Options) {
    let (start, len) = model.declarations[index as usize].specifiers;
    let mut orders = std::mem::take(&mut model.orders);
    if let Some(specifiers) = orders.get_mut(start as usize..(start + len) as usize) {
        stable_sort_by(specifiers, |a, b| {
            let (a, b) = (
                &model.specifiers[*a as usize],
                &model.specifiers[*b as usize],
            );
            if a.kind != b.kind {
                return if a.kind == SpecifierKind::Default {
                    Ordering::Less
                } else {
                    Ordering::Greater
                };
            }
            match a.is_type == b.is_type {
                true => options.compare(a.local.bytes(), b.local.bytes()),
                false if a.is_type => Ordering::Greater,
                false => Ordering::Less,
            }
        });
    }
    model.orders = orders;
}

/// `getSortedNodesByImportOrder`. `None`: an import belongs to no group.
fn sorted_by_import_order(
    model: &mut Model,
    nodes: &[u32],
    options: &Options,
    out: &mut Vec<Node>,
) -> Option<()> {
    let mut grouped = Vec::with_capacity(nodes.len());
    for &index in nodes {
        let declaration = &model.declarations[index as usize];
        grouped.push((
            options.group_of(model.source_of(declaration), declaration.is_type)?,
            index,
        ));
    }
    grouped.sort_by_key(|it: &(usize, u32)| it.0);
    for group in grouped.chunk_by_mut(|a, b| a.0 == b.0) {
        let source = |index: u32| model.source_of(&model.declarations[index as usize]);
        stable_sort_by(group, |a, b| options.compare(source(a.1), source(b.1)));
    }
    for &(_, index) in &grouped {
        sort_specifiers(model, index, options);
    }
    let start = out.len();
    for group in &options.order {
        match group.matcher {
            Matcher::Separator if out.len() == start || out.last() == Some(&Node::NewLine) => {}
            Matcher::Separator => out.push(Node::NewLine),
            _ => out.extend(
                grouped
                    .iter()
                    .filter(|it| it.0 == group.same_as)
                    .map(|it| Node::Import(it.1)),
            ),
        }
    }
    Some(())
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Owner {
    Declaration(u32),
    Specifier(u32),
}

/// `CommentEntry`
#[derive(Copy, Clone)]
struct Entry {
    owner: Owner,
    comment: CommentId,
    association: Which,
    needs_top_of_file_owner: bool,
    needs_last_specifier_owner: bool,
    processing_priority: u32,
}

struct Registry {
    entries: Vec<Entry>,
    is_registered: Vec<bool>,
    deferred: Vec<Entry>,
}

impl Registry {
    fn set(&mut self, entry: Entry) {
        self.is_registered[entry.comment as usize] = true;
        self.entries.push(entry);
    }

    /// `attachCommentsToRegistryMap`
    fn attach(&mut self, model: &Model, which: Which, comments: List, owner: Owner) {
        let owner_lines = match owner {
            Owner::Declaration(index) => model.declarations[index as usize].lines,
            Owner::Specifier(index) => model.lines(Node::Specifier(index)),
        };
        let is_specifier = matches!(owner, Owner::Specifier(_));
        let mut counter = 0;
        for &id in model.list(comments) {
            if self.is_registered[id as usize] {
                continue;
            }
            let comment = model.comments[id as usize];
            let entry = Entry {
                owner,
                comment: id,
                association: which,
                needs_top_of_file_owner: false,
                needs_last_specifier_owner: false,
                processing_priority: counter,
            };
            counter += 1;
            match which {
                Which::Inner => self.set(entry),
                Which::Trailing
                    if owner_lines.is_some_and(|lines| lines.start == comment.start_line) =>
                {
                    self.set(entry)
                }
                Which::Trailing if is_specifier => self.deferred.push(Entry {
                    needs_last_specifier_owner: true,
                    processing_priority: entry.processing_priority + 30000,
                    ..entry
                }),
                Which::Trailing => {}
                Which::Leading
                    if owner == Owner::Declaration(0)
                        && comment.end_line < owner_lines.map_or(0, |lines| lines.start) =>
                {
                    self.deferred.push(Entry {
                        needs_top_of_file_owner: true,
                        association: Which::Trailing,
                        processing_priority: entry.processing_priority + 20000,
                        ..entry
                    });
                }
                Which::Leading if is_specifier => self.deferred.push(Entry {
                    processing_priority: entry.processing_priority + 10000,
                    ..entry
                }),
                Which::Leading => self.set(entry),
            }
        }
    }
}

/// `getCommentRegistryFromImportDeclarations`
fn comment_registry(model: &Model, output: &[u32]) -> Vec<Entry> {
    let mut registry = Registry {
        entries: Vec::new(),
        is_registered: vec![false; model.comments.len()],
        deferred: Vec::new(),
    };
    for which in [Which::Inner, Which::Trailing, Which::Leading] {
        for &index in output {
            let declaration = &model.declarations[index as usize];
            registry.attach(
                model,
                which,
                declaration.comments.get(which),
                Owner::Declaration(index),
            );
            for &specifier in model.specifiers_of(declaration) {
                registry.attach(
                    model,
                    which,
                    model.specifiers[specifier as usize].comments.get(which),
                    Owner::Specifier(specifier),
                );
            }
        }
    }
    let mut deferred = std::mem::take(&mut registry.deferred);
    deferred.sort_by_key(|entry| entry.processing_priority);
    // The first specifier on a line.
    let specifier_on = |line: i32| {
        (output
            .iter()
            .flat_map(|index| model.specifiers_of(&model.declarations[*index as usize]))
            .copied())
        .find(|specifier| {
            model
                .lines(Node::Specifier(*specifier))
                .is_some_and(|lines| lines.start == line)
        })
    };
    for entry in deferred {
        if registry.is_registered[entry.comment as usize] {
            continue;
        }
        let Owner::Specifier(_) = entry.owner else {
            registry.set(entry);
            continue;
        };
        let owner = specifier_on(model.comments[entry.comment as usize].start_line)
            .map_or(entry.owner, Owner::Specifier);
        registry.set(Entry {
            owner,
            association: if entry.association == Which::Leading && owner != entry.owner {
                Which::Trailing
            } else {
                entry.association
            },
            ..entry
        });
    }
    registry
        .entries
        .sort_by_key(|entry| entry.processing_priority);
    registry.entries
}

/// `attachCommentsToOutputNodes`
fn attach_comments_to_output_nodes(
    model: &mut Model,
    entries: &[Entry],
    nodes: &mut Vec<Node>,
    provides_gap: bool,
) {
    let Some(&new_first_import) = nodes.first() else {
        return;
    };
    let mut has_patched = false;
    let mut top_of_file_comments: Vec<CommentId> = Vec::new();
    for entry in entries {
        if entry.needs_top_of_file_owner {
            // `ensureEmptyStatementAtFront`
            if nodes.first() != Some(&Node::Empty) {
                nodes.insert(0, Node::Empty);
            }
            if !has_patched {
                patch_new_first_import_location(model, new_first_import);
                has_patched = true;
            }
            top_of_file_comments.push(entry.comment);
        }
        let mut owner = match entry.owner {
            _ if entry.needs_top_of_file_owner => Node::Empty,
            Owner::Declaration(index) => Node::Import(index),
            Owner::Specifier(index) => Node::Specifier(index),
        };
        if let (true, Owner::Specifier(specifier)) = (entry.needs_last_specifier_owner, entry.owner)
        {
            let parent = nodes.iter().find_map(|node| match node {
                Node::Import(index) => Some(&model.declarations[*index as usize])
                    .filter(|it| model.specifiers_of(it).contains(&specifier)),
                _ => None,
            });
            let Some(&last) = parent.and_then(|parent| model.specifiers_of(parent).last()) else {
                continue;
            };
            owner = Node::Specifier(last);
            model.comments[entry.comment as usize].start_line =
                model.lines(owner).map_or(0, |lines| lines.end) + 1;
        }
        if owner == new_first_import
            && entry.association != Which::Leading
            && !entry.needs_last_specifier_owner
            && let Some(lines) = model.lines(owner)
        {
            model.comments[entry.comment as usize].start_line = lines.start;
        }
        let one = model.new_list([entry.comment]);
        model.attach(owner, entry.association, one);
    }
    if provides_gap
        && has_patched
        && !has_ignore_next_node(model, &top_of_file_comments)
        && let Node::Import(index) = new_first_import
        && let Some(lines) = &mut model.declarations[index as usize].lines
    {
        lines.start += 1;
    }
}

/// `patchNewFirstImportLocationOnlyOnce`
fn patch_new_first_import_location(model: &mut Model, new_first_import: Node) {
    let Node::Import(index) = new_first_import else {
        return;
    };
    let (Some(first), Some(original)) = (
        model.declarations[0].lines,
        model.declarations[index as usize].lines,
    ) else {
        return;
    };
    // `getHeightOfLeadingComments`
    let comments = model.declarations[index as usize].comments;
    let height = model.list(comments.leading).first().map_or(0, |it| {
        (original.start - model.comments[*it as usize].start_line).max(0)
    });
    let patched = Lines {
        start: first.start + height,
        end: first.end + height,
    };
    model.declarations[index as usize].lines = Some(patched);
    let moved = original.start - patched.start;
    for which in [Which::Inner, Which::Trailing, Which::Leading] {
        for at in 0..model.list(comments.get(which)).len() {
            let comment = model.list(comments.get(which))[at];
            model.comments[comment as usize].start_line -= moved;
            model.comments[comment as usize].end_line -= moved;
        }
    }
}

/// `getSortedNodes`. `None`: an import belongs to no group.
fn sorted_nodes(model: &mut Model, options: &Options) -> Option<Vec<Node>> {
    // `getChunkTypeOfNode`
    let is_unsortable = |model: &Model, index: u32| {
        let declaration = &model.declarations[index as usize];
        has_ignore_next_node(model, model.list(declaration.comments.leading))
            || (declaration.specifiers.1 == 0
                && !options
                    .safe_side_effects
                    .iter()
                    .any(|it| it.test(model.source_of(declaration))))
    };
    let count = model.declarations.len() as u32;
    let mut nodes = Vec::with_capacity(count as usize + options.order.len() + 2);
    let mut start = 0;
    while start < count {
        let kind = is_unsortable(model, start);
        let end = (start..count)
            .find(|index| is_unsortable(model, *index) != kind)
            .unwrap_or(count);
        if kind {
            let has_separators = options.has_separators();
            if has_separators
                && model.declarations[start as usize]
                    .comments
                    .leading
                    .is_empty()
            {
                nodes.push(Node::NewLine);
            }
            nodes.extend((start..end).map(Node::Import));
            if has_separators {
                nodes.push(Node::NewLine);
            }
        } else {
            let mut chunk: Vec<u32> = (start..end).collect();
            merge_nodes_with_matching_import_flavors(model, &mut chunk, options);
            if options.has_types() {
                explode_type_and_value_specifiers(model, &mut chunk);
            }
            sorted_by_import_order(model, &chunk, options, &mut nodes)?;
        }
        start = end;
    }
    nodes.push(Node::NewLine);

    // `adjustCommentsOnSortedNodes`
    let output: Vec<u32> = nodes
        .iter()
        .filter_map(|node| {
            if let Node::Import(index) = node {
                Some(*index)
            } else {
                None
            }
        })
        .collect();
    if model.comments.is_empty() || output.is_empty() {
        return Some(nodes);
    }
    let entries = comment_registry(model, &output);
    for &index in &output {
        model.declarations[index as usize].comments = Attached::default();
        let (start, len) = model.declarations[index as usize].specifiers;
        for at in start..start + len {
            model.specifiers[model.orders[at as usize] as usize].comments = Attached::default();
        }
    }
    let provides_gap = matches!(
        options.order.first(),
        Some(Group {
            matcher: Matcher::Separator,
            ..
        })
    );
    attach_comments_to_output_nodes(model, &entries, &mut nodes, provides_gap);
    Some(nodes)
}

/// The text that the plugin hands to Prettier in place of the file of `model`. `None`: it is
/// formatted the same.
pub(super) fn preprocess(
    model: &mut Model,
    options: &Options,
    end_of_line: &'static [u8],
) -> Option<Vec<u8>> {
    let original_count = model.declarations.len();
    let nodes = sorted_nodes(model, options)?;
    let model = &*model;

    // `getCodeFromAst`
    let mut removed: Vec<Span> = model.declarations[..original_count]
        .iter()
        .filter_map(|it| it.span)
        .collect();
    let mut remove_comments = |attached: &Attached| {
        for which in [Which::Leading, Which::Inner, Which::Trailing] {
            removed.extend(
                model
                    .list(attached.get(which))
                    .iter()
                    .map(|it| model.comments[*it as usize].span),
            );
        }
    };
    for node in &nodes {
        match node {
            Node::Import(index) => {
                let declaration = &model.declarations[*index as usize];
                remove_comments(&declaration.comments);
                model
                    .specifiers_of(declaration)
                    .iter()
                    .for_each(|it| remove_comments(&model.specifiers[*it as usize].comments));
            }
            Node::Empty => remove_comments(&model.empty),
            _ => {}
        }
    }
    model
        .directives
        .iter()
        .for_each(|it| remove_comments(&it.comments));
    model
        .interpreter
        .iter()
        .for_each(|it| remove_comments(&it.1));
    removed.extend(model.directives.iter().map(|it| it.span));
    removed.extend(model.interpreter.iter().map(|it| it.0));
    removed.sort_unstable_by_key(|span| span.start);

    let printer = Printer::new(model, b"with", end_of_line).generate(true, true, &nodes);
    if printer.has_failed {
        return None;
    }

    // `removeNodesFromOriginalCode`, and `trim`
    let (text, from) = (model.text, model.text_start());
    let mut out = Vec::with_capacity(model.rest_start as usize + printer.code().len() + 64);
    out.extend_from_slice(&text[..from as usize]);
    let moved = out.len() as u32;
    let mut pieces: Vec<Piece> = (printer.pieces.iter())
        .map(|piece| Piece {
            start: piece.start + moved,
            end: piece.end + moved,
            ..*piece
        })
        .collect();
    out.extend_from_slice(printer.code());
    let header_end = out.len();
    let mut comments = model.comments.iter().enumerate().peekable();
    let mut keep = |out: &mut Vec<u8>, at: u32, to: u32| {
        let mut kept = &text[at as usize..to as usize];
        let mut at = at;
        if out.len() == header_end {
            let trimmed = kept.len() - trim_start(kept).len();
            (kept, at) = (&kept[trimmed..], at + trimmed as u32);
        }
        while let Some((id, comment)) = comments.next_if(|it| it.1.span.start < to) {
            if comment.span.start >= at {
                let start = out.len() as u32 + comment.span.start - at;
                pieces.push(Piece {
                    kind: PieceKind::Comment(id as u32),
                    start,
                    end: start + comment.span.len(),
                });
            }
        }
        out.extend_from_slice(kept);
    };
    let mut at = from;
    for span in removed {
        if span.start > at {
            keep(&mut out, at, span.start);
        }
        at = at.max(span.end);
    }
    let rest_start = model.rest_start.max(at);
    keep(&mut out, at, rest_start);

    let new_from = from
        + u32::from(
            nodes.first() == Some(&Node::Empty)
                && model.interpreter.is_none()
                && model.directives.is_empty(),
        );
    if !printer.has_changed_comment
        && is_unchanged(model, from, &out, new_from, &pieces, out.len() as u32)
    {
        return None;
    }
    out.extend_from_slice(&text[rest_start as usize..]);
    let trimmed = header_end + trim_end(&out[header_end..]).len();
    out.truncate(trimmed);
    Some(out)
}

fn trim_start(text: &[u8]) -> &[u8] {
    let mut text = text;
    while let len @ 1.. = whitespace_len(text) {
        text = &text[len..];
    }
    text
}
