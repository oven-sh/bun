//! What `bun build --sourcemap` printed has a mapping at the `loc` of each node.

use std::sync::Arc;

use bun_ast::Loader;
use bun_ast::coverage::{Anchor, Anchors, MAX_COUNTERS};
use bun_core::strings::{contains_char, split_once_char};
use bun_paths::{Path, portable};
use bun_sema::check::spans::token_end;
use bun_sema::hir::{DiagnosticKind, find_transpiled_mark};
use bun_sourcemap::{Ordinal, ParsedSourceMap, SourceMapLoadHint};

use crate::files::{Files, Origin, Text, can_be_on_disk, is_file, read_if_file};
use crate::filter::{Filter, without_query};
use crate::locs::token_after;
use crate::positions::Positions;
use crate::{walk, with_tree};

pub(crate) struct Bundle {
    map: Arc<ParsedSourceMap>,
    /// By the index in the map. `None` if it is not reported.
    sources: Vec<Option<Source>>,
    /// It was likely built somewhere else. Without `outdir` the names start where the build ran.
    needs_proof: bool,
}

struct Source {
    path: Path,
    by_extension: Option<Loader>,
    text: Box<[u8]>,
}

/// Several files as if they were one. A `loc` counts UTF-16 code units.
pub(crate) struct Joined<'a> {
    map: &'a ParsedSourceMap,
    bundle: Positions<'a>,
    /// By the index in the map, with the `loc` of their start.
    sources: Vec<Option<(Positions<'a>, u32)>>,
    pub(crate) texts: Vec<(Arc<Text>, u32)>,
}

/// `namespace.member` is printed as one name, which has the `loc` of the member.
fn member_after(text: &[u8], name: u32) -> Option<u32> {
    let dot = token_after(text, token_end(text, name as usize, false) as u32);
    (text.get(dot as usize) == Some(&b'.')).then(|| token_after(text, dot + 1))
}

/// `namespace:name`
fn is_made_up(name: &[u8], folder: &[u8]) -> bool {
    split_once_char(name, b':').is_some_and(|it| !contains_char(it.0, b'.'))
        && !portable::is_absolute(name)
        && (cfg!(windows) || !is_file(without_query(&Path::from_parts(&[folder, name]))))
}

impl Source {
    fn is_overwritten_by_build(&self, now: &[u8]) -> bool {
        find_transpiled_mark(now).is_some() && find_transpiled_mark(&self.text).is_none()
    }

    fn read(&self) -> Option<Vec<u8>> {
        read_if_file(without_query(&self.path)).filter(|it| !self.is_overwritten_by_build(it))
    }

    /// The map does not say what the build took the text for.
    fn find_loader_and_anchors(&self) -> Option<(Loader, Anchors)> {
        let loaders = (self.by_extension.into_iter()).chain([Loader::Tsx, Loader::Ts, Loader::Jsx]);
        [false, true].into_iter().find_map(|allows_errors| {
            loaders.clone().find_map(|loader| {
                with_tree(loader, &self.text, |hir, _| {
                    let has_types =
                        (hir.diagnostics.iter()).any(|it| it.kind == DiagnosticKind::Js);
                    (!has_types && (allows_errors || hir.syntax_errors().next().is_none()))
                        .then(|| (loader, walk::find_anchors(hir, &self.text)))
                })?
            })
        })
    }
}

impl Bundle {
    /// `None` if code of the project would be missing from the report, with nothing in its place.
    pub(crate) fn find(bundle: &[u8], text: &[u8], filter: &Filter) -> Option<Bundle> {
        let file = without_query(bundle);
        let load_hint = match is_file(&[file, b".map"].concat()) {
            true => SourceMapLoadHint::None,
            false => SourceMapLoadHint::IsInlineMap,
        };
        let (map, texts) = bun_sourcemap::load_with_sources(file, text, load_hint)?;
        let is_for_source =
            read_if_file(file).is_some_and(|it| find_transpiled_mark(&it).is_none());
        let folder = bun_paths::dirname(file).filter(|it| can_be_on_disk(it) && !is_for_source);
        let start = folder.unwrap_or_else(|| filter.root());
        let real_start = Some(filter.without_link_to_root(start));
        let real_start = real_start.filter(|it| bun_paths::strip_prefix(start, it) != Some(b""));
        let resolve = |start: &[u8], name: &[u8]| {
            let name = bun_sys::typed_spelling(start, name, portable::from_portable_rooted);
            filter.by_way_of_root(&Path::resolve(&[start, &name]))
        };
        let mut is_any_missed = false;
        let sources: Vec<_> = (map.external_source_names.iter().zip(texts))
            .map(|(name, text)| {
                if is_made_up(name, start) {
                    let name = name.strip_prefix(b"dataurl:").unwrap_or(name);
                    is_any_missed |= filter.is_source_file(name) && !filter.is_ignored(name);
                    return None;
                }
                let path = (real_start.as_ref().map(|it| resolve(it, name)))
                    .filter(|it| is_file(without_query(it)))
                    .unwrap_or_else(|| resolve(start, name));
                if !filter.is_source_file(&path) {
                    return None;
                }
                let (file, is_ignored) = (without_query(&path), filter.is_ignored(&path));
                let Some(text) = text.filter(|_| filter.is_included(&path)) else {
                    is_any_missed |=
                        filter.inside_of_root(file).is_some() || !is_ignored && !is_file(file);
                    return None;
                };
                let by_extension = Some(filter.loader_by_extension(file));
                (!is_ignored).then(|| Source {
                    by_extension: by_extension.filter(|it| it.is_javascript_like()),
                    path,
                    text,
                })
            })
            .collect();
        (!is_any_missed || sources.iter().any(Option::is_some)).then(|| Bundle {
            map,
            sources,
            needs_proof: match folder {
                Some(folder) => filter.is_dependency(folder),
                None => filter.inside_of_root(bun_core::top_level_dir()) != Some(b""),
            },
        })
    }

    /// Whether the report can do without it if it has no counts.
    pub(crate) fn is_replaced(&self, loaded: &Files) -> bool {
        let sources = || self.sources.iter().flatten();
        sources().all(|it| (loaded.texts_of(&it.path)).any(|now| !it.is_overwritten_by_build(now)))
            || sources().any(|it| it.by_extension.is_some() && it.read().is_some())
                && self.is_from_here()
    }

    /// It can have been moved, also from a project that has some files of the same names.
    fn is_from_here(&self) -> bool {
        let (mut here, mut gone) = (0, 0);
        for it in self.sources.iter().flatten() {
            match it.read() {
                Some(now) if *now == *it.text => return true,
                Some(_) if !self.needs_proof => here += 1,
                _ => gone += 1,
            }
        }
        gone <= here
    }

    /// `None` if the map is of no use.
    pub(crate) fn join<'a>(&'a self, text: &'a [u8]) -> Option<(Joined<'a>, Anchors)> {
        if !self.is_from_here() {
            return None;
        }
        let (mut all, mut texts, mut end) = (Anchors::default(), Vec::new(), 0u32);
        let mut join = |source: &'a Source| {
            let text = &*source.text;
            let (loader, anchors) = source.find_loader_and_anchors()?;
            let (positions, start, first) = (Positions::new(text), end, all.counters);
            end = end.checked_add(text.len() as u32)?.checked_add(1)?;
            all.counters =
                (first.checked_add(anchors.counters)).filter(|&it| it <= MAX_COUNTERS)?;
            for it in &anchors.all {
                let locs = core::iter::successors(Some(it.loc), |&loc| member_after(text, loc));
                all.all.extend(locs.map(|loc| Anchor {
                    loc: start + positions.units_before(loc),
                    counter: first + it.counter,
                    ..*it
                }));
            }
            (all.statements).extend(anchors.statements.iter().map(|it| (first + it.0, it.1)));
            texts.push((
                Text::new(&source.path, loader, text, Origin::SourceMap),
                anchors.counters,
            ));
            Some((positions, start))
        };
        let sources = (self.sources.iter())
            .map(|it| it.as_ref().and_then(&mut join))
            .collect();
        let is_of_use = !texts.is_empty() || self.sources.iter().all(Option::is_none);
        let joined = Joined {
            map: &self.map,
            bundle: Positions::new(text),
            sources,
            texts,
        };
        is_of_use.then_some((joined, all))
    }
}

impl Joined<'_> {
    pub(crate) fn locs_of(&self, offset_in_bundle: u32) -> impl Iterator<Item = u32> {
        let (line, column) = self.bundle.line_and_column_of(offset_in_bundle);
        let [line, column] = [line as i32, column as i32].map(Ordinal::from_zero_based);
        (self.map.mappings.all_at(line, column)).filter_map(|it| {
            let (positions, start) = self.sources.get(it.source_index as usize)?.as_ref()?;
            let line = positions.start_of_line(it.original.lines.zero_based() as usize);
            (start + positions.units_before(line))
                .checked_add(it.original.columns.zero_based() as u32)
        })
    }
}
