//! What `bun build --sourcemap` printed has a mapping at the `loc` of each node.

use std::sync::Arc;

use bun_ast::coverage::{Anchor, Anchors, MAX_COUNTERS};
use bun_sema::check::spans::token_end;
use bun_sourcemap::{Ordinal, ParsedSourceMap};

use crate::files::{Text, is_file};
use crate::filter::Filter;
use crate::find_anchors;
use crate::locs::token_after;
use crate::positions::Positions;

pub(crate) struct Bundle {
    map: Arc<ParsedSourceMap>,
    /// By the index in the map. `None` if it is not reported.
    sources: Vec<Option<Arc<Text>>>,
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

impl Bundle {
    /// `None` if code of the project would be missing from the report, with nothing in its place.
    pub(crate) fn find(path: &[u8], text: &[u8], filter: &Filter) -> Option<Bundle> {
        let path = bun_paths::Path::resolve(&[filter.root(), path]);
        let (map, sources) = bun_sourcemap::load_with_sources(&path, text)?;
        let mut is_any_gone = sources.is_empty();
        let sources: Vec<_> = (sources.into_iter())
            .map(|(path, text)| {
                if !filter.is_source_file(&path) || filter.is_ignored(&path) {
                    return None;
                }
                let loader = filter.loader_by_extension(&path);
                let text = text.filter(|_| loader.is_javascript_like() && is_file(&path));
                is_any_gone |= text.is_none();
                let text = text.filter(|_| filter.is_selected(&path))?;
                Some(Text::new(&path, loader, &text))
            })
            .collect();
        (!is_any_gone || sources.iter().any(Option::is_some)).then_some(Bundle { map, sources })
    }

    pub(crate) fn join<'a>(&'a self, text: &'a [u8]) -> (Joined<'a>, Anchors) {
        let (mut all, mut texts, mut end) = (Anchors::default(), Vec::new(), 0u32);
        let mut join = |source: &'a Arc<Text>| {
            let text = &*source.bytes;
            let anchors = find_anchors(source.loader, text)?;
            let (positions, start, first) = (Positions::new(text), end, all.counters);
            end = end.checked_add(text.len() as u32)?.checked_add(1)?;
            all.counters = Some(first + anchors.counters).filter(|&it| it <= MAX_COUNTERS)?;
            for it in &anchors.all {
                let locs = core::iter::successors(Some(it.loc), |&loc| member_after(text, loc));
                all.all.extend(locs.map(|loc| Anchor {
                    loc: start + positions.units_before(loc),
                    counter: first + it.counter,
                    ..*it
                }));
            }
            (all.statements).extend(anchors.statements.iter().map(|it| (first + it.0, it.1)));
            texts.push((Arc::clone(source), anchors.counters));
            Some((positions, start))
        };
        let sources = (self.sources.iter())
            .map(|it| it.as_ref().and_then(&mut join))
            .collect();
        let joined = Joined {
            map: &self.map,
            bundle: Positions::new(text),
            sources,
            texts,
        };
        (joined, all)
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
