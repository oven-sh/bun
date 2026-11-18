use bun_jsc::DOMExceptionCode;
use bun_web::host::{Display, Rect};

use super::*;
use crate::api::geometry::DOMRect;
use crate::tree::DOCUMENT;

macro_rules! targets_of_window {
    ($($Type:ident $js:ident)*) => {$(
        #[repr(C)]
        #[derive(Default)]
        pub(crate) struct $Type {
            pub(crate) base: EventTarget,
            pub(crate) fields: $js::Fields,
        }

        impl $Type {
            pub(super) fn new<'a>(heap: &JsHeap<'a>, window: &'a Window) -> &'a $Type {
                let made = $js::create(window.realm(heap), Default::default());
                $js::set_window(made, Some(window));
                made
            }
        }

        of_window!($Type $js);
    )*};
}

targets_of_window!(Screen js_Screen VisualViewport js_VisualViewport WindowControlsOverlay js_WindowControlsOverlay);

impl Window {
    pub(crate) fn get_screen<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Screen {
        Screen::new(heap, self)
    }

    pub(crate) fn get_visual_viewport<'a>(&'a self, heap: &JsHeap<'a>) -> &'a VisualViewport {
        VisualViewport::new(heap, self)
    }
}

impl Screen {
    fn area(&self, of: fn(Display) -> Rect) -> Rect {
        let window = self.window();
        if window.is_disposed() {
            Rect::default()
        } else {
            window
                .environment()
                .display
                .map_or_else(|| window.whole_surface(), of)
        }
    }

    pub(crate) fn get_width(&self) -> i32 {
        self.area(|it| it.bounds).width as i32
    }

    pub(crate) fn get_height(&self) -> i32 {
        self.area(|it| it.bounds).height as i32
    }

    pub(crate) fn get_avail_left(&self) -> i32 {
        self.area(|it| it.work_area).x as i32
    }

    pub(crate) fn get_avail_top(&self) -> i32 {
        self.area(|it| it.work_area).y as i32
    }

    pub(crate) fn get_avail_width(&self) -> i32 {
        self.area(|it| it.work_area).width as i32
    }

    pub(crate) fn get_avail_height(&self) -> i32 {
        self.area(|it| it.work_area).height as i32
    }

    pub(crate) fn get_color_depth(&self) -> u32 {
        self.window()
            .environment()
            .display
            .map_or(24, |it| it.color_depth)
    }

    pub(crate) fn get_orientation<'a>(&'a self, heap: &JsHeap<'a>) -> &'a ScreenOrientation {
        js_ScreenOrientation::create(self.realm(heap), Default::default())
    }

    pub(crate) fn get_is_extended(&self) -> bool {
        false
    }
}

impl ScreenOrientation {
    pub(crate) fn lock<'a>(&self, cx: Cx<'_, 'a>, _: OrientationLockType) -> Result<'a, JSValue> {
        Err(cx.heap.dom_exception(
            DOMExceptionCode::NotSupportedError,
            format_args!("screen.orientation.lock() is not available on this device."),
        ))
    }

    pub(crate) fn unlock(&self) {}

    pub(crate) fn get_kind(&self) -> &[u8] {
        b"landscape-primary"
    }

    pub(crate) fn get_angle(&self) -> u16 {
        0
    }
}

impl VisualViewport {
    pub(crate) fn get_offset(&self) -> f64 {
        0.0
    }

    pub(crate) fn get_page_left<'a>(&'a self, cx: Cx<'_, 'a>) -> f64 {
        self.window().get_scroll_x(cx)
    }

    pub(crate) fn get_page_top<'a>(&'a self, cx: Cx<'_, 'a>) -> f64 {
        self.window().get_scroll_y(cx)
    }

    pub(crate) fn get_width<'a>(&'a self, cx: Cx<'_, 'a>) -> f64 {
        self.window()
            .laid_out(cx, |engine| engine.client_metrics(DOCUMENT)[2])
    }

    pub(crate) fn get_height<'a>(&'a self, cx: Cx<'_, 'a>) -> f64 {
        self.window()
            .laid_out(cx, |engine| engine.client_metrics(DOCUMENT)[3])
    }

    pub(crate) fn get_scale(&self) -> f64 {
        1.0
    }
}

impl WindowControlsOverlay {
    pub(crate) fn get_visible(&self) -> bool {
        self.window().titlebar_area().is_some()
    }

    pub(crate) fn get_titlebar_area_rect<'a>(&'a self, heap: &JsHeap<'a>) -> &'a DOMRect {
        DOMRect::new(
            self.realm(heap),
            self.window().titlebar_area().unwrap_or_default(),
        )
    }
}
