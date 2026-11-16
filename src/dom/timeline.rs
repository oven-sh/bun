//! Timelines that follow the offset of a scroller. Their time is a percentage.

use crate::boxes::{BoxId, VIEWPORT};
use crate::document::Document;
use crate::grammar::split_list;
use crate::properties::{Id, Style};
use crate::tree::{DOCUMENT, NodeId};
use crate::types::*;
use crate::values::*;

#[derive(Clone, PartialEq)]
pub(crate) struct Watched {
    /// 0 makes it inactive.
    pub(crate) node: NodeId,
    pub(crate) how: Watch,
    pub(crate) axis: Axis,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Snapshot {
    pub(crate) source: NodeId,
    pub(crate) axis: usize,
    /// From where scrolling starts.
    offset: f32,
    /// The offsets at which the subject starts to enter, has entered, starts to exit, and has exited.
    marks: [f32; 4],
    pub(crate) extent: f32,
    is_view: bool,
    pub(crate) zoom: f32,
}

impl Snapshot {
    pub(crate) fn range(&self) -> [f32; 2] {
        [self.marks[0], self.marks[3]]
    }

    pub(crate) fn time(&self) -> f64 {
        let [offset, start, end] = [self.offset, self.marks[0], self.marks[3]].map(f64::from);
        (offset - start) / (end - start) * 100.0
    }

    /// The first two edges are those of one range, and the others those of another.
    pub(crate) fn is_in(&self, edges: &[RangeEdge; 4]) -> [bool; 2] {
        let time = |index: usize| {
            self.fraction(
                edges[index].0,
                edges[index]
                    .1
                    .as_ref()
                    .unwrap_or(&Lp::Fraction((index % 2) as f32)),
            ) * 100.0
        };
        [0, 2].map(|start| {
            (time(start).min(time(0)) - 1e-3..=time(start + 1).max(time(1)) + 1e-3)
                .contains(&self.time())
        })
    }

    pub(crate) fn has_same_ranges(&self, other: &Snapshot) -> bool {
        (self.marks, self.extent) == (other.marks, other.extent)
    }

    /// Of the timeline.
    pub(crate) fn fraction(&self, name: Option<RangeName>, offset: &Lp) -> f64 {
        let [start, entered, exits, end] = self.marks;
        let [from, to] = match name.filter(|_| self.is_view).unwrap_or(RangeName::Cover) {
            RangeName::Cover => [start, end],
            RangeName::Contain => [entered.min(exits), entered.max(exits)],
            RangeName::Entry => [start, entered.min(exits)],
            RangeName::Exit => [entered.max(exits), end],
            RangeName::EntryCrossing => [start, entered],
            RangeName::ExitCrossing => [exits, end],
            RangeName::Scroll => [0.0, self.extent],
        };
        let along = match offset {
            Lp::Fraction(it) => f64::from(*it) * f64::from(to - from),
            offset => offset.resolve(to - from).into(),
        };
        (f64::from(from - start) + along) / f64::from(end - start)
    }
}

/// `auto` is what the activation range has.
pub(crate) fn trigger_ranges<'a>(edge: impl Fn(usize) -> &'a [u8], zoom: f32) -> [RangeEdge; 4] {
    let cx = Ctx {
        zoom,
        ..Ctx::dummy()
    };
    let parse = |index| parse_all(edge(index), |p| RangeEdge::parse(p, &cx));
    [0, 1, 2, 3].map(|index| {
        parse(index)
            .or_else(|| parse(index % 2))
            .unwrap_or_default()
    })
}

impl Document {
    fn named_timeline(&self, node: NodeId, name: &str) -> Option<Watched> {
        let style = self.tree.style(node)?;
        if let Some(index) = style
            .scroll
            .timeline_name
            .iter()
            .rposition(|it| **it == *name)
        {
            return Some(Watched {
                node,
                how: Watch::Scroller(Scroller::Itself),
                axis: *style.scroll.timeline_axis.at(index),
            });
        }
        let cx = Ctx {
            zoom: style.zoom,
            ..Ctx::dummy()
        };
        let index = parse_all(style.other_if_set(Id::ViewTimelineName)?.as_bytes(), |p| {
            Commas::<Str>::parse(p, &cx)
        })?
        .iter()
        .rposition(|it| **it == *name)?;
        let item = |id| {
            let all = split_list(style.other(id).as_bytes());
            all[index % all.len()]
        };
        let insets = parse_all(item(Id::ViewTimelineInset), |p| view_insets(p, &cx))?;
        Some(Watched {
            node,
            how: Watch::View(insets),
            axis: parse_all(item(Id::ViewTimelineAxis), |p| Axis::parse(p, &cx))?,
        })
    }

    pub(crate) fn find_timeline(&self, node: NodeId, timeline: &Timeline) -> Option<Watched> {
        let name = match timeline {
            Timeline::Anonymous(how, axis) => {
                return Some(Watched {
                    node,
                    how: how.clone(),
                    axis: *axis,
                });
            }
            Timeline::Named(name) => name,
            _ => return None,
        };
        let found = self.find_in_scope(node, name, Id::TimelineScope, |id| {
            self.named_timeline(id, name)
        });
        found.map_or_else(
            |has_scope| {
                has_scope.then_some(Watched {
                    node: 0,
                    how: Watch::Scroller(Scroller::Itself),
                    axis: Axis::Block,
                })
            },
            Some,
        )
    }

    /// The error says whether something limits the scope of the name.
    fn find_in_scope<T>(
        &self,
        node: NodeId,
        name: &str,
        scope: Id,
        declared: impl Fn(NodeId) -> Option<T>,
    ) -> Result<T, bool> {
        let scopes = |id: NodeId| {
            let scope = self.tree.style(id).and_then(|it| it.other_if_set(scope));
            scope.is_some_and(|it| {
                it == "all" || split_list(it.as_bytes()).contains(&name.as_bytes())
            })
        };
        let up = |id: NodeId| core::iter::once(id).chain(self.tree.flat_ancestors(id));
        let scope = match up(node).find_map(|id| {
            declared(id)
                .map(Ok)
                .or_else(|| scopes(id).then_some(Err(id)))
        }) {
            Some(Ok(found)) => return Ok(found),
            Some(Err(scope)) => Some(scope),
            None => None,
        };
        let sources = self
            .scrolling
            .timeline_sources
            .iter()
            .filter(|it| up(**it).find(|it| scopes(*it)) == scope);
        let last = sources
            .filter_map(|it| Some((*it, declared(*it)?)))
            .max_by_key(|it| self.tree.path(it.0));
        last.map(|it| it.1).ok_or(scope.is_some())
    }

    pub(crate) fn find_trigger(
        &self,
        node: NodeId,
        name: &str,
        is_laid_out: bool,
    ) -> Option<(NodeId, Option<[bool; 2]>)> {
        let declared = |id| {
            let names = self.tree.style(id)?.other_if_set(Id::TimelineTriggerName)?;
            Some((
                id,
                split_list(names.as_bytes())
                    .iter()
                    .rposition(|it| *it == name.as_bytes())?,
            ))
        };
        let (source, index) = self
            .find_in_scope(node, name, Id::TriggerScope, declared)
            .ok()?;
        let style = self.tree.style(source)?;
        let item = |id| {
            let all = split_list(style.other(id).as_bytes());
            all[index % all.len()]
        };
        let edges = [
            Id::TimelineTriggerActivationRangeStart,
            Id::TimelineTriggerActivationRangeEnd,
            Id::TimelineTriggerActiveRangeStart,
            Id::TimelineTriggerActiveRangeEnd,
        ];
        Some(
            match parse_all(item(Id::TimelineTriggerSource), |p| {
                Timeline::parse(
                    p,
                    &Ctx {
                        zoom: style.zoom,
                        ..Ctx::dummy()
                    },
                )
            })? {
                Timeline::Auto => (source, Some([true; 2])),
                Timeline::None => return None,
                timeline => {
                    let snapshot = self
                        .find_timeline(source, &timeline)
                        .filter(|_| is_laid_out)
                        .and_then(|it| self.snapshot(&it));
                    (
                        source,
                        snapshot
                            .map(|it| it.is_in(&trigger_ranges(|at| item(edges[at]), style.zoom))),
                    )
                }
            },
        )
    }

    pub(crate) fn timeline_source(&self, watched: &Watched) -> NodeId {
        let node = watched.node;
        match watched.how {
            _ if node == 0 => 0,
            Watch::Scroller(Scroller::Root) => DOCUMENT,
            Watch::Scroller(Scroller::Itself) => {
                if self.tree.is_root(node) {
                    DOCUMENT
                } else {
                    node
                }
            }
            _ => self.subject(node).map_or(0, |(own, _)| {
                let first = Some(own).filter(|it| self.boxes[*it].node != node);
                let found = first
                    .into_iter()
                    .chain(self.boxes.containers(own))
                    .find(|it| self.boxes[*it].scrolls());
                found.map_or(DOCUMENT, |it| self.boxes[it].node)
            }),
        }
    }

    /// The box that it is or is in, and where it is in that.
    fn subject(&self, node: NodeId) -> Option<(BoxId, crate::abi::Rect)> {
        let rects = self.own_box(node).map_or_else(
            || self.local_rects(node),
            |own| vec![(own, self.border_box(own))],
        );
        let first = rects.first()?.0;
        rects
            .into_iter()
            .filter(|it| it.0 == first)
            .reduce(|a, b| (first, a.1.union(&b.1)))
    }

    pub(crate) fn snapshot(&self, watched: &Watched) -> Option<Snapshot> {
        let source = self.timeline_source(watched);
        let scroller = self
            .own_box(source)
            .filter(|it| source != 0 && (*it == VIEWPORT || self.boxes[*it].scrolls()))?;
        let axis = match watched.axis {
            Axis::X => 0,
            Axis::Y => 1,
            axis => usize::from((axis == Axis::Block) != self.boxes[scroller].mode.is_vertical()),
        };
        let [min, max] = self.scroll_range(scroller)[axis];
        let (offset, extent, zoom) = (
            self.scroll_offset(source)[axis].abs(),
            max - min,
            self.zoom_of(watched.node),
        );
        let Watch::View(insets) = &watched.how else {
            return (extent > 0.0).then_some(Snapshot {
                source,
                axis,
                offset,
                marks: [0.0, extent, 0.0, extent],
                extent,
                is_view: false,
                zoom,
            });
        };
        let (own, rect) = self.subject(watched.node)?;
        let is_reversed = self.boxes[scroller].reaches_negative_overflow()[axis];
        let ([near, far], [start, end]) = (self.client_box(scroller).span(axis), rect.span(axis));
        let (view, size, sign) = (
            far - near,
            end - start,
            if is_reversed { -1.0 } else { 1.0 },
        );
        let position = |offset: f32| {
            let inside = core::iter::once(own)
                .chain(self.boxes.containers(own))
                .take_while(|it| *it != scroller);
            let at = start
                + inside
                    .map(|it| self.unscrolled_offset(it, Some([offset * sign; 2]))[axis])
                    .sum::<f32>();
            if is_reversed {
                far - at - size
            } else {
                at - near
            }
        };
        let padding = |style: &Style, side: usize| {
            let s = &style.scroll;
            let sides = [
                [&s.padding_left, &s.padding_right],
                [&s.padding_top, &s.padding_bottom],
            ][axis];
            sides[side ^ usize::from(is_reversed)]
                .0
                .as_ref()
                .map_or(0.0, |it| it.0.resolve(view))
        };
        let style = self.tree.style(if source == DOCUMENT {
            self.tree.root_element()
        } else {
            source
        })?;
        let [before, after] = [0, 1].map(|side| {
            insets[side]
                .0
                .as_ref()
                .map_or_else(|| padding(style, side), |it| it.resolve(view))
        });
        // A sticky box stays where it is in the scrollport for a while.
        let resting = [position(-1e7), position(1e7)];
        let reaches = |at: f32, is_last: bool| {
            if resting[0] == resting[1] {
                return resting[0] - at;
            }
            let (mut low, mut high) = (resting[0] - at - 1.0, resting[1] - at + 1.0);
            for _ in 0..32 {
                let middle = (low + high) / 2.0;
                let ahead = position(middle) - middle - at;
                *(if ahead > if is_last { -0.01 } else { 0.01 } {
                    &mut low
                } else {
                    &mut high
                }) = middle;
            }
            (low * 16.0).round() / 16.0
        };
        let marks = [
            reaches(view - after, true),
            reaches(view - after - size, false),
            reaches(before, true),
            reaches(before - size, false),
        ];
        (marks[3] > marks[0]).then_some(Snapshot {
            source,
            axis,
            offset,
            marks,
            extent,
            is_view: true,
            zoom,
        })
    }
}
