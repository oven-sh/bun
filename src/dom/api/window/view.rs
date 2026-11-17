//! <https://drafts.csswg.org/cssom-view/#extensions-to-the-window-interface>

use bun_web::host::{Environment, Rect};

use super::*;
use crate::document::Document;
use crate::tree::DOCUMENT;

const SMALLEST_WINDOW: f64 = 100.0;

pub(super) struct View {
    environment: RefCell<Environment>,
    /// 0 if it is not drawn anywhere.
    surface: Cell<u32>,
    /// In device-independent pixels.
    surface_size: Cell<[f64; 2]>,
    surface_scale: Cell<f64>,
}

impl Default for View {
    fn default() -> View {
        View {
            environment: Default::default(),
            surface: 0.into(),
            surface_size: [800.0, 600.0].into(),
            surface_scale: 1.0.into(),
        }
    }
}

/// What the element of a frame says about it.
#[derive(Clone, Copy, Default)]
pub(crate) struct FromContainer {
    /// If it has a color scheme.
    pub(crate) is_dark: Option<bool>,
    pub(crate) looks_dark: bool,
    pub(crate) cannot_scroll: bool,
}

impl Window {
    pub(crate) fn environment(&self) -> core::cell::Ref<'_, Environment> {
        self.view.environment.borrow()
    }

    pub(crate) fn surface(&self) -> u32 {
        self.view.surface.get()
    }

    pub(crate) fn zoom(&self) -> f64 {
        self.environment().zoom
    }

    /// In CSS pixels.
    pub(crate) fn viewport_size(&self) -> [f64; 2] {
        self.view.surface_size.get().map(|it| it / self.zoom())
    }

    /// Device pixels per CSS pixel.
    pub(crate) fn scale(&self) -> f64 {
        self.view.surface_scale.get() * self.zoom()
    }

    pub(crate) fn surface_scale(&self) -> f64 {
        self.view.surface_scale.get()
    }

    pub(super) fn set_surface(&self, surface: u32) {
        self.view.surface.set(surface);
    }

    pub(super) fn resize_surface(&self, size: [f64; 2], scale: f64) {
        self.view.surface_size.set(size);
        self.view.surface_scale.set(scale);
    }

    pub(super) fn read_environment(&self, container: FromContainer) {
        let mut new = *self.host().environment();
        new.is_dark = container.is_dark.unwrap_or(new.is_dark);
        self.set_languages(core::mem::take(&mut new.languages));
        self.view.environment.replace(new);
        let (it, viewport) = (self.environment(), self.viewport_size());
        let narrow = |it: f64| it as f32;
        self.document().engine(|engine, _| {
            engine.set_environment(crate::document::Environment {
                viewport: viewport.map(|it| narrow(it).max(0.0)),
                scale: narrow(self.scale()).max(0.01),
                zoom: narrow(it.zoom).max(0.01),
                screen: it
                    .display
                    .map_or(viewport, |it| [it.bounds.width, it.bounds.height])
                    .map(narrow),
                highlight: [it.light_highlight, it.dark_highlight],
                titlebar_area: self.titlebar_area().map(|it| it.map(narrow)),
                dark: it.is_dark,
                reduced_motion: it.reduces_motion,
                more_contrast: it.increases_contrast,
                forces_colors: it.forces_colors,
                fullscreen: it.is_fullscreen,
                overlay_scrollbars: it.overlays_scrollbars,
                is_active: it.is_active,
                reduced_transparency: it.reduces_transparency,
                cannot_scroll: container.cannot_scroll,
                ..engine.environment.clone()
            });
        });
    }

    /// In CSS pixels.
    pub(super) fn titlebar_area(&self) -> Option<[f64; 4]> {
        let area = self.environment().titlebar_area?;
        Some([area.x, area.y, area.width, area.height].map(|it| it / self.zoom()))
    }

    pub(super) fn whole_surface(&self) -> Rect {
        let [width, height] = self.view.surface_size.get();
        Rect {
            x: 0.0,
            y: 0.0,
            width,
            height,
        }
    }

    fn bounds(&self) -> Rect {
        self.environment()
            .window_bounds
            .unwrap_or_else(|| self.whole_surface())
    }

    /// Scripts see the new bounds until the host says otherwise.
    fn set_bounds(&self, bounds: Rect) {
        if !self.is_disposed() && !self.document().is(DocFlags::IN_FRAME) {
            self.view.environment.borrow_mut().window_bounds = Some(bounds);
            self.host().move_window(bounds);
        }
    }

    pub(super) fn laid_out<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        read: impl FnOnce(&mut Document) -> f32,
    ) -> f64 {
        f64::from(self.document().synced_engine(cx, |engine, _| {
            engine.catch_up_with_compositor();
            engine.update_layout_for(DOCUMENT);
            read(engine)
        }))
    }

    fn measured_viewport<'a>(&'a self, cx: Cx<'_, 'a>) -> [f64; 2] {
        pending::measure_container(cx, self);
        self.viewport_size()
    }

    pub(crate) fn get_device_pixel_ratio(&self, _: Cx<'_, '_>) -> f64 {
        self.scale()
    }

    pub(crate) fn get_inner_width<'a>(&'a self, cx: Cx<'_, 'a>) -> i32 {
        self.measured_viewport(cx)[0] as i32
    }

    pub(crate) fn get_inner_height<'a>(&'a self, cx: Cx<'_, 'a>) -> i32 {
        self.measured_viewport(cx)[1] as i32
    }

    pub(crate) fn get_outer_width(&self, _: Cx<'_, '_>) -> i32 {
        self.bounds().width as i32
    }

    pub(crate) fn get_outer_height(&self, _: Cx<'_, '_>) -> i32 {
        self.bounds().height as i32
    }

    pub(crate) fn get_screen_x(&self, _: Cx<'_, '_>) -> i32 {
        self.bounds().x as i32
    }

    pub(crate) fn get_screen_y(&self, _: Cx<'_, '_>) -> i32 {
        self.bounds().y as i32
    }

    pub(crate) fn get_scroll_x<'a>(&'a self, cx: Cx<'_, 'a>) -> f64 {
        self.laid_out(cx, |engine| engine.scroll_position(DOCUMENT)[0])
    }

    pub(crate) fn get_scroll_y<'a>(&'a self, cx: Cx<'_, 'a>) -> f64 {
        self.laid_out(cx, |engine| engine.scroll_position(DOCUMENT)[1])
    }

    pub(crate) fn move_to(&self, x: i32, y: i32) {
        self.set_bounds(Rect {
            x: x.into(),
            y: y.into(),
            ..self.bounds()
        });
    }

    pub(crate) fn move_by(&self, x: i32, y: i32) {
        let old = self.bounds();
        self.set_bounds(Rect {
            x: old.x + f64::from(x),
            y: old.y + f64::from(y),
            ..old
        });
    }

    fn set_size(&self, width: f64, height: f64) {
        self.set_bounds(Rect {
            width: width.max(SMALLEST_WINDOW),
            height: height.max(SMALLEST_WINDOW),
            ..self.bounds()
        });
    }

    pub(crate) fn resize_to(&self, width: i32, height: i32) {
        self.set_size(width.into(), height.into());
    }

    pub(crate) fn resize_by(&self, width: i32, height: i32) {
        let old = self.bounds();
        self.set_size(old.width + f64::from(width), old.height + f64::from(height));
    }
}
