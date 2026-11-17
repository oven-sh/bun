//! https://w3c.github.io/webvtt/#rendering

use super::controls::{add_part, set_style};
use super::webvtt::{self, CueSettings};
use super::*;
use crate::abi::Rect;
use crate::api::core::{
    Atom, DomString, Element, Node, Ns, Observers, QualName, Rooted, insert, remove,
};

impl CueSettings {
    /// https://w3c.github.io/webvtt/#cue-computed-position-alignment
    #[optimize(size)]
    fn computed_position_alignment(&self, is_rtl: bool) -> PositionAlignSetting {
        match (self.position_align, self.align, is_rtl) {
            (PositionAlignSetting::Auto, AlignSetting::Left, _)
            | (PositionAlignSetting::Auto, AlignSetting::Start, false)
            | (PositionAlignSetting::Auto, AlignSetting::End, true) => {
                PositionAlignSetting::LineLeft
            }
            (PositionAlignSetting::Auto, AlignSetting::Center, _) => PositionAlignSetting::Center,
            (PositionAlignSetting::Auto, ..) => PositionAlignSetting::LineRight,
            (given, ..) => given,
        }
    }

    /// https://w3c.github.io/webvtt/#cue-computed-position
    fn computed_position(&self, is_rtl: bool) -> f64 {
        self.position.unwrap_or(match (self.align, is_rtl) {
            (AlignSetting::Left, _) | (AlignSetting::Start, false) | (AlignSetting::End, true) => {
                0.0
            }
            (AlignSetting::Center, _) => 50.0,
            _ => 100.0,
        })
    }

    /// https://w3c.github.io/webvtt/#cue-computed-line
    fn computed_line(&self, tracks_before: usize) -> f64 {
        match self.line {
            Some(line) if self.snaps_to_lines || (0.0..=100.0).contains(&line) => line,
            None if self.snaps_to_lines => -1.0 - tracks_before as f64,
            _ => 100.0,
        }
    }

    /// Where it starts and how long it is in the direction of the lines.
    #[optimize(size)]
    fn span(&self, is_rtl: bool) -> [f64; 2] {
        let position = self.computed_position(is_rtl);
        let (maximum, before) = match self.computed_position_alignment(is_rtl) {
            PositionAlignSetting::LineLeft => (100.0 - position, 0.0),
            PositionAlignSetting::LineRight => (position, 1.0),
            _ => (position.min(100.0 - position) * 2.0, 0.5),
        };
        let size = self.size.min(maximum);
        [position - size * before, size]
    }

    fn text_align(&self) -> &'static str {
        match self.align {
            AlignSetting::Start => "start",
            AlignSetting::Center => "center",
            AlignSetting::End => "end",
            AlignSetting::Left => "left",
            AlignSetting::Right => "right",
        }
    }

    /// The step of https://w3c.github.io/webvtt/#apply-webvtt-cue-settings that adjusts the positions of the boxes:
    /// where `own`, which is at the start of `area`, goes.
    #[optimize(size)]
    fn adjusted(
        &self,
        own: Rect,
        line_count: usize,
        line: f64,
        area: Rect,
        output: &[Rect],
    ) -> Option<Rect> {
        const SLACK: f32 = 0.5;
        let axis = usize::from(self.vertical == DirectionSetting::Horizontal);
        let ([start, end], extent) = (area.span(axis), own.to_array()[2 + axis]);
        let at = |offset: f32| {
            own.moved(if axis == 0 {
                [offset, 0.0]
            } else {
                [0.0, offset]
            })
        };
        let is_within =
            |it: &Rect| it.span(axis)[0] >= start - SLACK && it.span(axis)[1] <= end + SLACK;
        let fits = |it: &Rect| {
            is_within(it)
                && output
                    .iter()
                    .all(|other| it.grown(-SLACK).intersection(other).is_empty())
        };
        if !self.snaps_to_lines {
            let before = match self.line_align {
                LineAlignSetting::Start => 0.0,
                LineAlignSetting::Center => 0.5,
                LineAlignSetting::End => 1.0,
            };
            let wanted = (end - start) * line as f32 / 100.0 - extent * before;
            let edges = output
                .iter()
                .flat_map(|it| [it.span(axis)[0] - extent - start, it.span(axis)[1] - start]);
            let free = [wanted, 0.0, end - start - extent]
                .into_iter()
                .chain(edges)
                .filter(|it| fits(&at(*it)));
            return Some(at(free
                .min_by(|a, b| (a - wanted).abs().total_cmp(&(b - wanted).abs()))
                .unwrap_or(wanted)));
        }
        let (mut step, grows_left) = (
            extent / line_count.max(1) as f32,
            self.vertical == DirectionSetting::Rl,
        );
        if step < SLACK {
            return Some(own);
        }
        let reach = f64::from((end - start) / step).ceil() + 1.0;
        let line = (line + 0.5).floor().clamp(-reach, reach) as f32;
        let line = if grows_left { -(line + 1.0) } else { line };
        let (mut specified, first_line) =
            (step * line, if grows_left { extent - step } else { 0.0 });
        specified -= first_line;
        if line < 0.0 {
            specified += end - start;
            step = -step;
        }
        [step, -step].into_iter().find_map(|step| {
            let is_left = |it: &f32| {
                if step < 0.0 {
                    it + first_line >= -SLACK
                } else {
                    it + first_line + step <= end - start + SLACK
                }
            };
            core::iter::successors(Some(specified), |it| is_left(it).then_some(it + step))
                .map(at)
                .find(fits)
        })
    }
}

#[optimize(size)]
fn place<'a>(
    cx: Cx<'_, 'a>,
    display: &'a Element,
    settings: &CueSettings,
    is_rtl: bool,
    offset: f32,
) {
    let ([start, size], align) = (settings.span(is_rtl), settings.text_align());
    let style = match settings.vertical {
        DirectionSetting::Horizontal => {
            format!("left:{start}%;width:{size}%;top:{offset}%;text-align:{align}")
        }
        DirectionSetting::Rl => format!(
            "top:{start}%;height:{size}%;left:{offset}%;text-align:{align};writing-mode:vertical-rl"
        ),
        DirectionSetting::Lr => format!(
            "top:{start}%;height:{size}%;left:{offset}%;text-align:{align};writing-mode:vertical-lr"
        ),
    };
    set_style(cx, display, &style);
}

/// The engine forgets them when the cue is not rendered any more.
fn apply_style_sheets(cue: &VTTCue) -> Option<()> {
    let scope = js_TextTrackCue::display(cue)?
        .element_children()
        .nth(1)?
        .shadow_root()
        .filter(|it| it.is_rendered())?;
    let sheets = js_TextTrackCue::track(cue)?.style_sheets.borrow();
    scope.engine(|engine, id| engine.set_cue_styles(id, &sheets));
    Some(())
}

impl Player {
    pub(super) fn restore_cue_styles<'a>(&'a self, heap: &JsHeap<'a>) {
        if self.tracks().any(|it| !it.style_sheets.borrow().is_empty()) {
            self.later(heap, |cx, [this, _], _, _| {
                Player::from_js(&cx.heap, this.to_js())
                    .into_iter()
                    .flat_map(Player::active_cues)
                    .for_each(|it| _ = apply_style_sheets(it));
                Ok(JSValue::UNDEFINED)
            });
        }
    }

    #[optimize(size)]
    fn region_box<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        container: &'a Element,
        region: &'a VTTRegion,
        known: List<'a>,
    ) -> &'a Element {
        if let Some(found) = known
            .position_of_key(region.to_js())
            .and_then(|it| known.node(it + 1)?.as_element())
        {
            return found;
        }
        let (it, made) = (
            region.settings.get(),
            add_part(
                cx,
                self.element(),
                container,
                atom!("div"),
                "-webkit-media-text-track-region",
            ),
        );
        let (width, height) = (it.width, f64::from(it.lines) * 6.0);
        let [left, top] = [
            it.viewport_anchor[0] - it.anchor[0] * width / 100.0,
            it.viewport_anchor[1] - it.anchor[1] * height / 100.0,
        ];
        set_style(
            cx,
            made,
            &format!("left:{left}%;top:{top}%;width:{width}%;height:{height}%"),
        );
        [region.to_js(), made.to_js()]
            .into_iter()
            .for_each(|it| known.push(&cx.heap, it));
        made
    }

    #[optimize(size)]
    fn display_of<'a>(&'a self, cx: Cx<'_, 'a>, cue: &'a VTTCue) -> &'a Element {
        let (video, display) = (
            self.element(),
            self.element().doc().create_html(&cx.heap, atom!("div")),
        );
        display.set_pseudo("-webkit-media-text-track-display", video);
        let background = add_part(cx, video, display, atom!("span"), "cue");
        background.set_attr(cx, atom!("id"), cue.get_id());
        background.set_attr(cx, atom!("dir"), DomString::from("auto"));
        let track = js_TextTrackCue::track(cue);
        if let Some(language) = track
            .map(TextTrack::get_language)
            .filter(|it| !it.is_empty())
        {
            background.set_attr(cx, atom!("lang"), language);
        }
        webvtt::append_cue_text(cx, background, &cue.get_text(), Some(video));
        if track.is_some_and(|it| !it.style_sheets.borrow().is_empty()) {
            let scope = add_part(cx, video, display, atom!("div"), "-internal-cue-styles")
                .attach_ua_shadow(cx);
            let originator = video.doc().create_plain(
                &cx.heap,
                QualName {
                    ns: Ns::None,
                    prefix: None,
                    local: Atom::new(""),
                },
            );
            insert(cx, originator, scope, None, Observers::Suppress);
        }
        js_TextTrackCue::set_display(cue, Some(display));
        display
    }

    /// https://w3c.github.io/webvtt/#rules-for-updating-the-display-of-webvtt-text-tracks
    #[optimize(size)]
    pub(super) fn render_cues<'a>(&'a self, cx: Cx<'_, 'a>) {
        let video = self.element();
        if !self.is_video()
            || !video.is_rendered()
            || video.shadow_root().is_none() && !self.tracks().any(TextTrack::is_rendered)
        {
            return;
        }
        let (container, controls) = self.captions_and_panel(cx);
        let shown = || {
            self.tracks()
                .filter(|it| it.is_rendered())
                .enumerate()
                .flat_map(|(at, it)| {
                    it.cues()
                        .filter(|it| it.is_active.get())
                        .map(move |it| (at, it))
                })
        };
        let kept = Rooted::from_nodes(
            &cx.heap,
            shown()
                .filter_map(|it| js_TextTrackCue::display(it.1))
                .map(|it| &**it),
        );
        for old in Rooted::from_nodes(&cx.heap, container.children())
            .iter()
            .filter(|it| !kept.contains(it))
        {
            remove(cx, old, Observers::Suppress);
        }
        let rect_of = |cx: Cx<'_, 'a>, node: &'a Node| {
            node.synced_engine(cx, |engine, id| {
                engine.update_layout();
                engine.layout_rects(id).first().copied().unwrap_or_default()
            })
        };
        let (area, regions) = (rect_of(cx, container), List::new(&cx.heap));
        let mut output: Vec<_> = container
            .children()
            .chain(controls.map(|it| &**it))
            .map(|it| rect_of(cx, it))
            .collect();
        for (tracks_before, cue) in shown() {
            let known = js_TextTrackCue::display(cue).filter(|it| it.is_pseudo_of(video));
            if known.is_some_and(|it| it.parent() == Some(container)) {
                continue;
            }
            let (display, settings) = (
                known.unwrap_or_else(|| self.display_of(cx, cue)),
                cue.settings.get(),
            );
            let parent = cue
                .get_region()
                .map_or(container, |it| self.region_box(cx, container, it, regions));
            insert(cx, display, parent, None, Observers::Suppress);
            apply_style_sheets(cue);
            let Some(background) = display.first_child() else {
                continue;
            };
            let is_rtl = background.synced_engine(cx, |engine, id| {
                engine.style_on_demand(id).is_some_and(|it| it.is_rtl())
            });
            if parent != container {
                let shift = settings.computed_position(is_rtl) - 50.0;
                set_style(
                    cx,
                    display,
                    &format!(
                        "position:relative;flex:none;left:{shift}%;text-align:{}",
                        settings.text_align()
                    ),
                );
                continue;
            }
            place(cx, display, &settings, is_rtl, 0.0);
            let (own, axis) = (
                rect_of(cx, display),
                usize::from(settings.vertical == DirectionSetting::Horizontal),
            );
            let mut lines = background.engine(|engine, id| engine.layout_rects(id));
            lines.dedup_by(|a, b| a.span(axis)[0] == b.span(axis)[0]);
            match settings.adjusted(
                own,
                lines.len(),
                settings.computed_line(tracks_before),
                area,
                &output,
            ) {
                Some(rect) => {
                    let [start, end] = area.span(axis);
                    place(
                        cx,
                        display,
                        &settings,
                        is_rtl,
                        (rect.span(axis)[0] - start) / (end - start).max(1.0) * 100.0,
                    );
                    output.push(rect);
                }
                None => set_style(cx, display, "display:none"),
            }
        }
    }

    /// https://w3c.github.io/webvtt/#past-and-future-pseudo-classes. When that changes next.
    #[optimize(size)]
    pub(super) fn mark_past_and_future<'a>(&'a self, cx: Cx<'_, 'a>, now: f64) -> f64 {
        let mut next = f64::INFINITY;
        for display in self
            .active_cues()
            .filter_map(|it| js_TextTrackCue::display(it))
        {
            let timestamps = || {
                display
                    .descendants()
                    .filter_map(|it| Some((it, webvtt::timestamp_of(it)?)))
            };
            let (last_past, first_future) = (
                timestamps().filter(|it| it.1 < now).last(),
                timestamps().find(|it| it.1 > now),
            );
            next = timestamps()
                .map(|it| it.1)
                .filter(|it| *it >= now)
                .fold(next, f64::min);
            let (mut is_past, mut is_future) = (last_past.is_some(), false);
            for node in display
                .descendants()
                .take_while(|_| last_past.or(first_future).is_some())
            {
                is_past &= last_past.is_some_and(|it| it.0 != node);
                is_future |= first_future.is_some_and(|it| it.0 == node);
                if let Some(element) = node.as_element() {
                    element.set_custom_state(
                        cx,
                        ":past",
                        is_past && last_past.is_some_and(|it| !element.contains(it.0)),
                    );
                    element.set_custom_state(cx, ":future", is_future);
                }
            }
        }
        next
    }
}
