//! https://html.spec.whatwg.org/#user-interface

use super::player::Network;
use super::*;
use crate::api::core::{
    DomString, Element, Known, Node, Observers, insert, remove, string_replace_all,
};
use crate::api::events::Event;
use crate::api::ui::assistive::Semantics;
use crate::api::ui::pointer::Tracking;
use crate::api::ui::{NodeExt as _, Ui, fullscreen, layout};
use crate::api::uievents::{KeyboardEvent, Modifiers, MouseEvent};

const IDLE_MILLISECONDS: f64 = 2500.0;

const PLAY: &str = "-webkit-media-controls-play-button";
const TIME: &str = "-webkit-media-controls-current-time-display";
const TIMELINE: &str = "-webkit-media-controls-timeline";
const VOLUME: &str = "-webkit-media-controls-volume-slider";
const MUTE: &str = "-webkit-media-controls-mute-button";
const FULLSCREEN: &str = "-webkit-media-controls-fullscreen-button";

pub(super) fn add_part<'a>(
    cx: Cx<'_, 'a>,
    media: &'a Element,
    parent: &'a Node,
    tag: Known,
    pseudo: &str,
) -> &'a Element {
    let made = media.doc().create_html(&cx.heap, tag);
    made.set_pseudo(pseudo, media);
    insert(cx, made, parent, None, Observers::Suppress);
    made
}

pub(super) fn set_style<'a>(cx: Cx<'_, 'a>, part: &'a Element, style: &str) {
    if part.with_attr(atom!("style"), |it| it == style) != Some(true) {
        part.set_attr(cx, atom!("style"), DomString::from_utf8(style));
    }
}

fn clock(time: f64) -> String {
    let seconds = if time.is_finite() { time as u64 } else { 0 };
    match seconds / 3600 {
        0 => format!("{}:{:02}", seconds / 60, seconds % 60),
        hours => format!("{hours}:{:02}:{:02}", seconds / 60 % 60, seconds % 60),
    }
}

fn panel_of(media: &Element) -> Option<&Element> {
    media
        .shadow_root()?
        .first_child()?
        .element_children()
        .nth(1)
}

pub(crate) fn parts_of(media: &Element) -> impl Iterator<Item = &Element> {
    panel_of(media)
        .into_iter()
        .flat_map(|it| it.element_children())
}

/// Of `media` or a part of it.
#[optimize(size)]
pub(crate) fn semantics<'a>(heap: &JsHeap<'a>, media: &'a Element, part: &Element) -> Semantics {
    let player = Player::of_element(heap, media);
    let button = |label: &str| {
        vec![
            ("role", "button".to_owned()),
            ("aria-label", label.to_owned()),
        ]
    };
    let slider = |label: &str, value: f64, max: f64| {
        vec![
            ("role", "slider".to_owned()),
            ("aria-label", label.to_owned()),
            ("aria-valuenow", value.to_string()),
            ("aria-valuemax", max.to_string()),
        ]
    };
    let mut all = match () {
        () if part.is_part(PLAY) => button(if player.is_paused.get() {
            "play"
        } else {
            "pause"
        }),
        () if part.is_part(MUTE) => button(if player.is_muted() { "unmute" } else { "mute" }),
        () if part.is_part(FULLSCREEN) => button(if player.is_fullscreen() {
            "exit full screen"
        } else {
            "enter full screen"
        }),
        () if part.is_part(TIME) => return vec![("aria-hidden", "true".to_owned())],
        () if part.is_part(VOLUME) => {
            slider("volume", (player.volume.get() * 100.0).round(), 100.0)
        }
        () if part.is_part(TIMELINE) => {
            let (time, duration) = (
                player.time().floor(),
                Some(player.duration.get())
                    .filter(|it| it.is_finite())
                    .unwrap_or(0.0),
            );
            let mut all = slider(
                if player.is_video() {
                    "video time scrubber"
                } else {
                    "audio time scrubber"
                },
                time,
                duration,
            );
            all.push(("aria-valuetext", format!("elapsed time: {}", clock(time))));
            all
        }
        () => Vec::new(),
    };
    if player.is_unsupported() || matches!(player.network.get(), Network::Empty | Network::NoSource)
    {
        all.push(("aria-disabled", "true".to_owned()));
        all.extend((part == media).then(|| ("aria-label", "Unable to play media.".to_owned())));
    }
    all
}

impl Player {
    #[optimize(size)]
    fn overlay<'a>(&'a self, cx: Cx<'_, 'a>) -> &'a Element {
        let media = self.element();
        if let Some(known) = media
            .shadow_root()
            .and_then(|it| it.first_child()?.as_element())
        {
            return known;
        }
        media.engine(|engine, _| engine.use_media_styles());
        let root = media.attach_ua_shadow(cx);
        let overlay = add_part(cx, media, root, atom!("div"), "-webkit-media-controls");
        add_part(
            cx,
            media,
            overlay,
            atom!("div"),
            "-webkit-media-text-track-container",
        );
        overlay
    }

    fn shows_panel(&self) -> bool {
        !self.is_video() || self.is_paused.get() || self.is_awake.get()
    }

    pub(super) fn captions_and_panel<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
    ) -> (&'a Element, Option<&'a Element>) {
        let overlay = self.overlay(cx);
        (
            overlay.element_children().next().unwrap_or(overlay),
            panel_of(self.element()).filter(|_| self.shows_panel()),
        )
    }

    #[optimize(size)]
    pub(super) fn add_or_remove_controls<'a>(&'a self, cx: Cx<'_, 'a>) {
        let media = self.element();
        match (media.has_attr(atom!("controls")), panel_of(media)) {
            (true, None) if media.is_rendered() => {
                let overlay = self.overlay(cx);
                let panel = add_part(
                    cx,
                    media,
                    overlay,
                    atom!("div"),
                    "-webkit-media-controls-panel",
                );
                for name in [PLAY, TIME, TIMELINE, VOLUME, MUTE, FULLSCREEN]
                    .into_iter()
                    .filter(|it| *it != FULLSCREEN || self.offers_fullscreen())
                {
                    let part = add_part(cx, media, panel, atom!("div"), name);
                    match name {
                        TIME => {}
                        TIMELINE | VOLUME => {
                            _ = add_part(
                                cx,
                                media,
                                part,
                                atom!("div"),
                                "-internal-media-controls-track",
                            )
                        }
                        _ => {
                            _ = add_part(
                                cx,
                                media,
                                part,
                                atom!("div"),
                                "-internal-media-controls-icon",
                            )
                        }
                    }
                }
                self.update_controls(cx);
            }
            (false, Some(panel)) => remove(cx, panel, Observers::Suppress),
            _ => {}
        }
    }

    pub(super) fn renew_controls<'a>(&'a self, cx: Cx<'_, 'a>) {
        panel_of(self.element())
            .into_iter()
            .for_each(|it| remove(cx, it, Observers::Suppress));
        self.add_or_remove_controls(cx);
    }

    #[optimize(size)]
    fn look_of(&self, part: &Element) -> String {
        let volume = if self.is_muted() {
            0.0
        } else {
            self.volume.get()
        };
        let filled = |fraction: f64| {
            format!(
                "background-size:{}%",
                if fraction.is_finite() {
                    fraction * 100.0
                } else {
                    0.0
                }
            )
        };
        let icon = match () {
            () if part.is_part(TIMELINE) => return filled(self.time() / self.duration.get()),
            () if part.is_part(VOLUME) => return filled(volume),
            () if part.is_part(PLAY) && self.is_paused.get() => "M7 4l13 8-13 8z",
            () if part.is_part(PLAY) => "M6 4h4v16H6zM14 4h4v16h-4z",
            () if part.is_part(MUTE) && volume == 0.0 => {
                "M3 9h4l5-5v16l-5-5H3zM14.5 9.5L16 8l2 2.5L20 8l1.5 1.5-2.2 2.5 2.2 2.5L20 16l-2-2.5-2 2.5-1.5-1.5 2.2-2.5z"
            }
            () if part.is_part(MUTE) => "M3 9h4l5-5v16l-5-5H3zM14 8h2v8h-2zM18 5h2v14h-2z",
            () if self.is_fullscreen() => {
                "M8 4h2v6H4V8h4zM14 4h2v4h4v2h-6zM4 14h6v6H8v-4H4zM14 14h6v2h-4v4h-2z"
            }
            () => "M4 4h6v2H6v4H4zM14 4h6v6h-2V6h-4zM4 14h2v4h4v2H4zM18 14h2v6h-6v-2h4z",
        };
        format!("clip-path:path('{icon}')")
    }

    #[optimize(size)]
    pub(super) fn update_controls<'a>(&'a self, cx: Cx<'_, 'a>) {
        let Some(panel) = panel_of(self.element()) else {
            return;
        };
        let time = DomString::from_utf8(&format!(
            "{} / {}",
            clock(self.time()),
            clock(self.duration.get())
        ));
        for part in panel.element_children() {
            match part.element_children().next() {
                Some(inner) => set_style(cx, inner, &self.look_of(part)),
                None if part.child_text_content() != time => {
                    string_replace_all(cx, time.clone(), part)
                }
                None => {}
            }
        }
        set_style(cx, panel, if self.shows_panel() { "" } else { "opacity:0" });
    }

    fn wake_controls<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.has_stirred.set(true);
        if !self.is_awake.replace(true) {
            self.update_controls(cx);
            self.doze_off(cx);
        }
    }

    #[optimize(size)]
    fn doze_off<'a>(&'a self, cx: Cx<'_, 'a>) {
        if !self.has_stirred.take() {
            self.is_awake.set(false);
            return self.update_controls(cx);
        }
        queue_task_after(
            self.element().doc(),
            IDLE_MILLISECONDS,
            &[self.to_js()],
            |cx, this| {
                Player::from_js(&cx.heap, this[0])
                    .into_iter()
                    .for_each(|it| it.doze_off(cx));
                Ok(())
            },
        );
    }

    fn offers_fullscreen(&self) -> bool {
        self.is_video()
            && !self
                .element()
                .attr(atom!("controlslist"))
                .is_some_and(|it| it.has_token(&DomString::from("nofullscreen"), true))
    }

    fn is_fullscreen(&self) -> bool {
        Ui::of(self.element().doc()).and_then(fullscreen::element) == Some(self.element())
    }

    fn toggle_fullscreen<'a>(&'a self, cx: Cx<'_, 'a>) {
        let done = if self.is_fullscreen() {
            fullscreen::exit(cx, self.element().doc())
        } else {
            fullscreen::request(cx, self.element(), true)
        };
        if let Err(error) = done {
            drop(cx.catch(error));
        }
    }
}

fn part_at<'a>(media: &'a Element, origin: &'a Node) -> Option<&'a Element> {
    parts_of(media).find(|it| it.contains(origin))
}

/// `slider` is what the mouse went down in.
#[optimize(size)]
pub(crate) fn follow<'a>(cx: Cx<'_, 'a>, slider: &'a Element, [x, _]: [f64; 2]) {
    let (Some(media), Some(track)) = (
        slider.out_of_control().as_element(),
        slider.element_children().next(),
    ) else {
        return;
    };
    let (player, rect) = (
        Player::of_element(&cx.heap, media),
        layout::bounding_rect(cx, track),
    );
    let fraction = ((x - f64::from(rect.x)) / f64::from(rect.width)).clamp(0.0, 1.0);
    if slider.is_part(VOLUME) && fraction.is_finite() {
        player.set_muted(false);
        player.set_volume(fraction);
    } else if (fraction * player.duration.get()).is_finite() {
        player.seek_to(fraction * player.duration.get());
    }
    player.wake_controls(cx);
}

#[optimize(size)]
pub(super) fn activate<'a>(
    cx: Cx<'_, 'a>,
    media: &'a Element,
    event: &'a Event,
    origin: &'a Node,
    _: JSValue,
) {
    let Some(panel) = panel_of(media).filter(|_| event.is_trusted()) else {
        return;
    };
    let player = Player::of_element(&cx.heap, media);
    match part_at(media, origin) {
        Some(part) if part.is_part(PLAY) => player.toggle(cx),
        Some(part) if part.is_part(MUTE) => player.set_muted(!player.is_muted()),
        Some(part) if part.is_part(FULLSCREEN) => player.toggle_fullscreen(cx),
        None if !panel.contains(origin) => player.toggle(cx),
        _ => {}
    }
}

#[optimize(size)]
pub(super) fn default_action<'a>(
    cx: Cx<'_, 'a>,
    media: &'a Element,
    event: &'a Event,
    origin: &'a Node,
) -> bool {
    let Some(panel) = panel_of(media) else {
        return false;
    };
    let player = Player::of_element(&cx.heap, media);
    if let Some(mouse) = event
        .downcast::<MouseEvent>()
        .filter(|it| it.get_button() == 0)
    {
        let slider = part_at(media, origin).filter(|it| it.is_part(TIMELINE) || it.is_part(VOLUME));
        match (event.name(), slider.zip(Ui::of(media.doc()))) {
            (atom!("mousedown"), Some((slider, ui))) => {
                ui.pointer().track(Tracking::MediaSlider, slider);
                follow(cx, slider, mouse.mouse().client);
            }
            (atom!("mousemove"), _) if player.is_video() => player.wake_controls(cx),
            (atom!("dblclick"), _) if player.offers_fullscreen() && !panel.contains(origin) => {
                player.toggle_fullscreen(cx)
            }
            _ => {}
        }
        return false;
    }
    let is_plain = |it: &&KeyboardEvent| {
        !it.modifiers()
            .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::META)
    };
    let Some(event) = event
        .downcast::<KeyboardEvent>()
        .filter(|_| event.name() == atom!("keydown"))
        .filter(is_plain)
    else {
        return false;
    };
    let duration = player.duration.get();
    let seek = |time: f64| {
        duration
            .is_finite()
            .then_some(time.min(duration).max(0.0))
            .into_iter()
            .for_each(|it| player.seek_to(it))
    };
    let louder = |by: f64| player.set_volume((player.volume.get() + by).clamp(0.0, 1.0));
    match event.key() {
        atom!("Enter") | atom!(" ") => player.toggle(cx),
        atom!("ArrowUp") => louder(0.05),
        atom!("ArrowDown") => louder(-0.05),
        atom!("ArrowRight") if origin.is_part(VOLUME) => louder(0.05),
        atom!("ArrowLeft") if origin.is_part(VOLUME) => louder(-0.05),
        atom!("ArrowRight") => seek(player.time() + duration / 100.0),
        atom!("ArrowLeft") => seek(player.time() - duration / 100.0),
        atom!("Home") => seek(0.0),
        atom!("End") => seek(duration),
        _ => return false,
    }
    player.wake_controls(cx);
    true
}
