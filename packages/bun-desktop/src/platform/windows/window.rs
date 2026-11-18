use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::composition::Tree;
use super::ime::InputMethod;
use super::pixels::{self, Buffer};
use super::pointer::Pointer;
use super::{accessibility, clock, displays, drag, gpu, keyboard, shell};
use crate::abi::Rect;
use crate::error::{Result, ensure};
use crate::frame::Part;
use crate::gfx::Pixmap;
use crate::host::system::{callback, later};
use crate::input;
use crate::paint::flatten::Lifted;
use crate::paint::raster::IntRect;
use crate::platform::{self, Cursor, Edge, Geometry, Icon, Painter, Point, WindowButton};
use crate::protocol::{
    Accent, Background, Dragged, Limits, Material, Size, WindowCommand, WindowEvent, WindowKind,
    WindowStyle,
};
use crate::win32::*;
use crate::window::{self, Options};

#[derive(Clone, Copy, PartialEq)]
enum Frame {
    Full,
    /// The invisible borders that resize it, the shadow and the corners.
    WithoutTitleBar,
    None,
}

pub struct Window {
    pub id: u32,
    pub handle: Handle,
    frame: Frame,
    limits: Cell<Limits>,
    aspect_ratio: Cell<(f32, Size)>,
    is_movable: Cell<bool>,
    /// Where it was, and its style.
    before_fullscreen: Cell<Option<(WindowPlacement, u32)>>,
    opens_maximized: Cell<bool>,
    opens_fullscreen: Cell<bool>,
    last_geometry: Cell<Geometry>,
    was_visible: Cell<bool>,
    was_minimized: Cell<bool>,
    is_being_resized: Cell<bool>,
    /// While a command is carried out: the next ones are run while the frame is waited for.
    owes_frame: Cell<Option<bool>>,
    is_being_moved: Cell<bool>,
    pub is_active: Cell<bool>,
    opacity: Cell<f32>,
    ignores_mouse: Cell<bool>,
    icons: RefCell<Vec<pixels::Icon>>,
    buffer: RefCell<Option<Buffer>>,
    /// In place of `buffer`.
    tree: RefCell<Option<Tree>>,
    /// In front of `buffer`, until that has been painted.
    retired_tree: Cell<Option<Tree>>,
    wants_gpu: Cell<bool>,
    is_opaque: Cell<bool>,
    /// What GDI has painted shows through the tree.
    has_leftovers: Cell<bool>,
    large_updates: Cell<u32>,
    rests_at: Cell<Option<Instant>>,
    interval: Cell<Duration>,
    wants_frame: Cell<bool>,
    last_frame: Cell<Option<Instant>>,
    accent: Cell<(Accent, u32)>,
    watched_messages: RefCell<Vec<u32>>,
    pub has_thumbnail_buttons: Cell<bool>,
    pub pointer: Pointer,
    pub ime: InputMethod,
}

thread_local! {
    static WINDOWS: RefCell<Vec<Rc<Window>>> = RefCell::default();
}

pub fn all() -> Vec<Rc<Window>> {
    WINDOWS.with_borrow(Clone::clone)
}

fn find(is_it: impl Fn(&Window) -> bool) -> Option<Rc<Window>> {
    WINDOWS.with_borrow(|all| all.iter().find(|it| is_it(it)).cloned())
}

pub fn with_id(id: u32) -> Option<Rc<Window>> {
    find(|it| it.id == id)
}

pub fn handle_of(id: Option<u32>) -> Handle {
    id.and_then(with_id).map_or(0, |it| it.handle)
}

unsafe extern "system" fn handle_message(
    handle: Handle,
    message: u32,
    w: usize,
    l: isize,
) -> isize {
    // SAFETY: as it came.
    unsafe {
        let answer = find(|it| it.handle == handle)
            .and_then(|window| callback(None, || window.message(message, w, l)));
        answer.unwrap_or_else(|| DefWindowProcW(handle, message, w, l))
    }
}

fn class() -> Str<'static> {
    let name = wide!("BunDesktopWindow");
    RegisterClassExW(&WndClassExW {
        cb_size: size_of::<WndClassExW>() as u32,
        lpfn_wnd_proc: Some(handle_message),
        h_instance: module(),
        h_icon: shell::icon_of_app(),
        lpsz_class_name: name,
        ..Default::default()
    });
    name
}

fn flag(flags: u32, is_on: bool) -> u32 {
    if is_on { flags } else { 0 }
}

fn point_in(l: isize) -> DevicePoint {
    DevicePoint {
        x: low(l),
        y: high(l),
    }
}

const REST: usize = 1;
const KEEPS_PLACE: u32 = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;

impl Window {
    pub fn open(options: &Options, icon: Option<&Icon>) -> Result<Rc<Window>> {
        let frame = match options.frame && !options.hidden_title_bar {
            _ if options.background == Background::Transparent
                || options.kind == WindowKind::Popup =>
            {
                Frame::None
            }
            true => Frame::Full,
            false => Frame::WithoutTitleBar,
        };
        let buttons = WS_SYSMENU
            | flag(WS_MINIMIZEBOX, options.minimizable)
            | flag(WS_MAXIMIZEBOX, options.resizable);
        let style = buttons
            | if frame == Frame::None {
                WS_POPUP
            } else {
                WS_CAPTION | flag(WS_THICKFRAME, options.resizable)
            };
        let extended = match options.kind {
            WindowKind::Popup => WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
            WindowKind::Floating => WS_EX_TOOLWINDOW,
            _ => WS_EX_APPWINDOW,
        };
        let bounds = Rect {
            x: options.x.get().unwrap_or(0.),
            y: options.y.get().unwrap_or(0.),
            width: options.width,
            height: options.height,
        };
        let monitor = displays::matching(bounds);
        let at = monitor.device(Point {
            x: bounds.x + bounds.width / 2.,
            y: bounds.y + bounds.height / 2.,
        });
        let handle = CreateWindowExW(
            extended,
            class(),
            Wide::new(&*options.title).str(),
            style,
            at.x,
            at.y,
            1,
            1,
            0,
            0,
            module(),
            0,
        );
        ensure!(
            handle != 0,
            "could not create a window: {}",
            std::io::Error::last_os_error()
        );
        let window = Rc::new(Window {
            id: options.id,
            handle,
            frame,
            limits: Limits {
                min: Size {
                    width: options.min_width,
                    height: options.min_height,
                },
                max: None.into(),
                is_resizable: options.resizable,
            }
            .into(),
            aspect_ratio: Cell::default(),
            is_movable: options.movable.into(),
            before_fullscreen: None.into(),
            opens_maximized: options.maximized.into(),
            opens_fullscreen: options.fullscreen.into(),
            last_geometry: Cell::default(),
            was_visible: false.into(),
            was_minimized: false.into(),
            is_being_resized: false.into(),
            owes_frame: None.into(),
            is_being_moved: false.into(),
            is_active: false.into(),
            opacity: 1.0.into(),
            ignores_mouse: false.into(),
            icons: RefCell::default(),
            buffer: RefCell::default(),
            tree: RefCell::default(),
            retired_tree: Cell::default(),
            wants_gpu: false.into(),
            is_opaque: true.into(),
            has_leftovers: false.into(),
            large_updates: 0.into(),
            rests_at: None.into(),
            interval: Duration::from_micros(16_667).into(),
            wants_frame: false.into(),
            last_frame: None.into(),
            accent: (Accent::AsUserLikes, 0).into(),
            watched_messages: RefCell::default(),
            has_thumbnail_buttons: Cell::default(),
            pointer: Pointer::default(),
            ime: InputMethod::default(),
        });
        if window.minds_hidden_bars() && !all().iter().any(|it| it.minds_hidden_bars()) {
            shell::look_for_hidden_bars();
        }
        WINDOWS.with_borrow_mut(|all| all.push(window.clone()));
        window.place(bounds);
        window.display_changed();
        window.set_dark(crate::app::is_dark());
        window.set_background(options.background);
        window.ime.has_changed.set(true);
        icon.into_iter().for_each(|it| {
            window.set_icons(|side| pixels::Icon::scaled(it.width, it.height, &it.pixels, side))
        });
        drag::accept_drops(&window);
        Ok(window)
    }

    // ───────────────────────────── where it is ─────────────────────────────

    pub fn scale(&self) -> f32 {
        // It has none when it is closed.
        GetDpiForWindow(self.handle).max(96) as f32 / 96.
    }

    pub fn metric(&self, which: i32) -> i32 {
        GetSystemMetricsForDpi(which, GetDpiForWindow(self.handle))
    }

    pub fn has_title_bar(&self) -> bool {
        self.frame == Frame::Full
    }

    pub fn client_size(&self) -> (i32, i32) {
        let mut area = DeviceRect::default();
        GetClientRect(self.handle, &mut area);
        (area.right, area.bottom)
    }

    /// Of the content, on the screen.
    pub fn origin(&self) -> DevicePoint {
        let mut origin = DevicePoint::default();
        ClientToScreen(self.handle, &mut origin);
        origin
    }

    pub fn in_content(&self, mut at: DevicePoint) -> DevicePoint {
        ScreenToClient(self.handle, &mut at);
        at
    }

    pub fn logical(&self, at: DevicePoint) -> Point {
        let scale = self.scale();
        Point {
            x: at.x as f32 / scale,
            y: at.y as f32 / scale,
        }
    }

    fn area(&self) -> DeviceRect {
        let mut area = DeviceRect::default();
        GetWindowRect(self.handle, &mut area);
        area
    }

    fn style(&self, index: i32) -> u32 {
        GetWindowLongPtrW(self.handle, index) as u32
    }

    fn set_style(&self, index: i32, flags: u32, is_on: bool) {
        let (before, now) = (
            self.style(index),
            self.style(index) & !flags | flag(flags, is_on),
        );
        if before != now {
            // SAFETY: a style is a number.
            unsafe { SetWindowLongPtrW(self.handle, index, now as isize) };
            SetWindowPos(
                self.handle,
                0,
                0,
                0,
                0,
                0,
                KEEPS_PLACE | SWP_NOZORDER | SWP_FRAMECHANGED,
            );
        }
    }

    /// What the frame adds to the content: the left and the top are negative.
    fn borders(&self, dpi: u32) -> DeviceRect {
        let mut borders = DeviceRect::default();
        AdjustWindowRectExForDpi(
            &mut borders,
            self.style(GWL_STYLE),
            0,
            self.style(GWL_EXSTYLE),
            dpi,
        );
        DeviceRect {
            top: if self.frame == Frame::Full {
                borders.top
            } else {
                0
            },
            ..borders
        }
    }

    /// The borders that are not in the bounds.
    fn overhang(&self, dpi: u32) -> DeviceRect {
        if self.frame == Frame::Full {
            DeviceRect::default()
        } else {
            self.borders(dpi)
        }
    }

    /// Of the window, for bounds of that size.
    fn outer_size(&self, size: Size, dpi: u32) -> (i32, i32) {
        let (borders, scale) = (self.overhang(dpi), dpi as f32 / 96.);
        (
            (size.width * scale).round() as i32 + borders.width(),
            (size.height * scale).round() as i32 + borders.bottom,
        )
    }

    fn place(&self, bounds: Rect) {
        let monitor = displays::matching(bounds);
        let (at, dpi) = (
            monitor.device(Point {
                x: bounds.x,
                y: bounds.y,
            }),
            (monitor.display.scale * 96.) as u32,
        );
        let ((width, height), left) = (
            self.outer_size(
                Size {
                    width: bounds.width,
                    height: bounds.height,
                },
                dpi,
            ),
            at.x + self.overhang(dpi).left,
        );
        if IsIconic(self.handle) != 0 || IsZoomed(self.handle) != 0 {
            let inset = monitor.device(Point {
                x: monitor.display.work_area.x,
                y: monitor.display.work_area.y,
            });
            let (left, top) = (
                left - (inset.x - monitor.area.left),
                at.y - (inset.y - monitor.area.top),
            );
            let area = DeviceRect {
                left,
                top,
                right: left + width,
                bottom: top + height,
            };
            let how = if IsIconic(self.handle) != 0 {
                SW_SHOWMINNOACTIVE
            } else {
                SW_SHOWNOACTIVATE
            };
            SetWindowPlacement(
                self.handle,
                &WindowPlacement {
                    rc_normal_position: area,
                    show_cmd: how as u32,
                    ..self.placement()
                },
            );
            return;
        }
        // On a display with another scale it first gets the size that the system suggests.
        for _ in 0..1 + usize::from(dpi != GetDpiForWindow(self.handle)) {
            SetWindowPos(
                self.handle,
                0,
                left,
                at.y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }

    fn bounds(&self) -> Rect {
        let Geometry {
            x,
            y,
            top,
            border,
            width,
            height,
            ..
        } = platform::Window::geometry(self);
        Rect {
            x,
            y,
            width: width + border * 2.,
            height: top + height + border,
        }
    }

    fn placement(&self) -> WindowPlacement {
        let mut placement = WindowPlacement {
            length: size_of::<WindowPlacement>() as u32,
            ..Default::default()
        };
        GetWindowPlacement(self.handle, &mut placement);
        placement
    }

    fn set_fullscreen(&self, is_on: bool) {
        const FRAME: u32 = WS_CAPTION | WS_THICKFRAME;
        if IsWindowVisible(self.handle) == 0 && self.before_fullscreen.get().is_none() {
            self.opens_fullscreen.set(is_on);
            return window::bounds_changed(self.id);
        }
        match (is_on, self.before_fullscreen.get()) {
            (true, None) => {
                self.before_fullscreen
                    .set(Some((self.placement(), self.style(GWL_STYLE) & FRAME)));
                self.set_style(GWL_STYLE, FRAME | WS_MAXIMIZE, false);
                self.fill_display();
            }
            (false, Some((placement, style))) => {
                self.before_fullscreen.set(None);
                self.set_style(GWL_STYLE, style, true);
                SetWindowPlacement(self.handle, &placement);
            }
            _ => return,
        }
        shell::mark_fullscreen(self.handle, is_on);
        window::bounds_changed(self.id);
    }

    fn fill_display(&self) {
        let area = displays::of_window(self.handle).area;
        SetWindowPos(
            self.handle,
            0,
            area.left,
            area.top,
            area.width(),
            area.height(),
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }

    pub fn display_changed(&self) {
        let frequency = displays::of_window(self.handle).display.frequency;
        self.interval.set(Duration::from_secs_f32(
            1. / if frequency > 0. { frequency } else { 60. },
        ));
        if self.before_fullscreen.get().is_some() {
            self.fill_display();
        }
        window::bounds_changed(self.id);
    }

    fn was_placed(&self, how: &WindowPos) {
        self.may_have_been_minimized();
        self.visibility_may_have_changed();
        if how.flags & SWP_NOMOVE == 0 {
            self.display_changed();
            self.ime.has_changed.set(true);
        }
        if how.flags & SWP_NOSIZE == 0 || how.flags & SWP_FRAMECHANGED != 0 {
            if self.owes_frame.get().is_some() {
                return self.owes_frame.set(Some(true));
            }
            window::was_resized(self.id);
            // The frame and the content change together.
            if self.is_being_resized.get() {
                _ = DwmFlush();
            }
        }
    }

    fn may_have_been_minimized(&self) {
        let is_minimized = IsIconic(self.handle) != 0;
        if self.was_minimized.replace(is_minimized) != is_minimized {
            window::user_acts(self.id, WindowEvent::Minimized(is_minimized));
        }
    }

    pub fn visibility_may_have_changed(&self) {
        let is_visible = platform::Window::is_visible(self);
        if self.was_visible.replace(is_visible) != is_visible {
            window::visibility_changed(self.id);
        }
    }

    /// A maximized window hangs over the display by its borders.
    fn content_within(&self, area: &mut DeviceRect) {
        let borders = self.borders(GetDpiForWindow(self.handle));
        (area.left, area.right, area.bottom) = (
            area.left - borders.left,
            area.right - borders.right,
            area.bottom - borders.bottom,
        );
        if IsZoomed(self.handle) != 0 {
            area.top += borders.bottom;
            // The system takes a window that covers the display for fullscreen, and a hidden taskbar would not come back.
            let [left, top, right, bottom] =
                shell::hidden_bars(displays::of_area(*area).area).map(i32::from);
            *area = DeviceRect {
                left: area.left + left,
                top: area.top + top,
                right: area.right - right,
                bottom: area.bottom - bottom,
            };
        }
    }

    pub fn minds_hidden_bars(&self) -> bool {
        self.frame == Frame::WithoutTitleBar
    }

    pub fn hidden_bars_changed(&self) {
        if self.minds_hidden_bars() && IsZoomed(self.handle) != 0 {
            SetWindowPos(
                self.handle,
                0,
                0,
                0,
                0,
                0,
                KEEPS_PLACE | SWP_NOZORDER | SWP_FRAMECHANGED,
            );
        }
    }

    fn limit(&self, info: &mut MinMaxInfo) {
        let (Limits { min, max, .. }, dpi) = (self.limits.get(), GetDpiForWindow(self.handle));
        let (x, y) = self.outer_size(min, dpi);
        info.pt_min_track_size = DevicePoint {
            x: x.max(info.pt_min_track_size.x * i32::from(self.frame == Frame::Full)),
            y,
        };
        if let Some((x, y)) = max.get().map(|it| self.outer_size(it, dpi)) {
            info.pt_max_track_size = DevicePoint { x, y };
        }
        if self.frame == Frame::None {
            let monitor = displays::of_window(self.handle);
            let Rect {
                x,
                y,
                width,
                height,
            } = monitor.display.work_area;
            let (start, end) = (
                monitor.device(Point { x, y }),
                monitor.device(Point {
                    x: x + width,
                    y: y + height,
                }),
            );
            info.pt_max_position = DevicePoint {
                x: start.x - monitor.area.left,
                y: start.y - monitor.area.top,
            };
            info.pt_max_size = DevicePoint {
                x: end.x - start.x,
                y: end.y - start.y,
            };
        }
    }

    fn keep_aspect_ratio(&self, edge: usize, area: &mut DeviceRect) {
        let ((ratio, extra), borders) = (
            self.aspect_ratio.get(),
            self.borders(GetDpiForWindow(self.handle)),
        );
        let [width, height] = [
            (extra.width, borders.width()),
            (extra.height, borders.height()),
        ]
        .map(|it| (it.0 * self.scale()) as i32 + it.1);
        match edge {
            _ if ratio <= 0. => {}
            WMSZ_TOP | WMSZ_BOTTOM => {
                area.right =
                    area.left + width + ((area.height() - height) as f32 * ratio).round() as i32
            }
            WMSZ_TOPLEFT | WMSZ_TOPRIGHT => {
                area.top =
                    area.bottom - height - ((area.width() - width) as f32 / ratio).round() as i32
            }
            _ => {
                area.bottom =
                    area.top + height + ((area.width() - width) as f32 / ratio).round() as i32
            }
        }
    }

    /// In the content.
    fn part_at(&self, at: DevicePoint) -> isize {
        let resizes = self.frame == Frame::WithoutTitleBar
            && self.style(GWL_STYLE) & (WS_THICKFRAME | WS_MAXIMIZE) == WS_THICKFRAME;
        let (reach, width) = (self.metric(SM_CYSIZEFRAME), self.client_size().0);
        match input::part_at(self.id, self.logical(at)) {
            _ if resizes && at.y < reach && at.x < reach * 2 => HTTOPLEFT,
            _ if resizes && at.y < reach && at.x >= width - reach * 2 => HTTOPRIGHT,
            _ if resizes && at.y < reach => HTTOP,
            Some(Part::Drag) => HTCAPTION,
            // The system offers its layouts there.
            Some(Part::Button(WindowButton::Maximize)) => HTMAXBUTTON,
            _ => HTCLIENT,
        }
    }

    // ───────────────────────────── what it looks like ─────────────────────────────

    fn set_attribute(&self, attribute: u32, value: u32) {
        // SAFETY: these are four bytes long.
        _ = unsafe { DwmSetWindowAttribute(self.handle, attribute, (&raw const value).cast(), 4) };
    }

    pub fn set_dark(&self, is_dark: bool) {
        self.set_attribute(DWMWA_USE_IMMERSIVE_DARK_MODE, is_dark.into());
    }

    pub fn accent(&self) -> Option<u32> {
        match self.accent.get() {
            (Accent::AsUserLikes, _)
                if registry::number(
                    wide!("Software\\Microsoft\\Windows\\DWM"),
                    wide!("ColorPrevalence"),
                ) != Some(1) =>
            {
                None
            }
            (Accent::AsUserLikes | Accent::OfSystem, _) => super::accent_of_system(),
            (Accent::None, _) => None,
            (Accent::Own, color) => Some(color),
        }
    }

    pub fn set_accent(&self, accent: Accent, color: u32) {
        let before = self.accent.replace((accent, color)).0;
        match accent {
            Accent::AsUserLikes if before != accent => self.paint_frame(None),
            _ => self.show_accent(),
        }
    }

    fn paint_frame(&self, color: Option<u32>) {
        const DEFAULT: u32 = u32::MAX;
        for attribute in [DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR] {
            self.set_attribute(
                attribute,
                color.map_or(DEFAULT, |it| it.swap_bytes() & 0xFF_FFFF),
            );
        }
    }

    pub fn show_accent(&self) {
        let (accent, is_dark) = (self.accent.get().0, crate::app::is_dark());
        match self.accent().filter(|_| self.is_active.get()) {
            _ if accent == Accent::AsUserLikes => {}
            None if accent == Accent::None => {
                self.paint_frame(Some(if is_dark { 0x2020_20FF } else { 0xF3F3_F3FF }))
            }
            color => self.paint_frame(color),
        }
    }

    pub fn watch_message(&self, message: u32, is_on: bool) {
        self.watched_messages
            .borrow_mut()
            .retain(|it| *it != message);
        self.watched_messages
            .borrow_mut()
            .extend(is_on.then_some(message));
    }

    fn set_background(&self, background: Background) {
        const NONE: u32 = 1;
        const MICA: u32 = 2;
        const ACRYLIC: u32 = 3;
        const TABBED: u32 = 4;
        let backdrop = match background {
            Background::Blurred {
                material: Material::Titlebar | Material::Header,
                ..
            } => TABBED,
            Background::Blurred {
                material:
                    Material::Menu
                    | Material::Popover
                    | Material::Hud
                    | Material::Tooltip
                    | Material::Sheet,
                ..
            } => ACRYLIC,
            Background::Blurred { .. } => MICA,
            _ => NONE,
        };
        let reach = if backdrop == NONE { 0 } else { -1 };
        _ = DwmExtendFrameIntoClientArea(
            self.handle,
            &Margins {
                cx_left_width: reach,
                cx_right_width: reach,
                cy_top_height: reach,
                cy_bottom_height: reach,
            },
        );
        self.set_attribute(DWMWA_SYSTEMBACKDROP_TYPE, backdrop);
        // Nothing is blurred, but the alpha of the pixels counts.
        let nowhere = CreateRectRgn(0, 0, -1, -1);
        let is_on = (background == Background::Transparent).into();
        _ = DwmEnableBlurBehindWindow(
            self.handle,
            &DwmBlurBehind {
                dw_flags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
                f_enable: is_on,
                h_rgn_blur: nowhere,
                ..Default::default()
            },
        );
        // SAFETY: it is no longer used.
        unsafe { DeleteObject(nowhere) };
    }

    fn set_icons(&self, make: impl Fn(i32) -> Option<pixels::Icon>) {
        let icons = [(ICON_SMALL, SM_CXSMICON), (ICON_BIG, SM_CXICON)]
            .into_iter()
            .filter_map(|(which, side)| {
                let icon = make(self.metric(side))?;
                // SAFETY: it lives until it is replaced.
                unsafe { SendMessageW(self.handle, WM_SETICON, which, icon.0) };
                Some(icon)
            });
        self.icons.replace(icons.collect());
    }

    fn update_layering(&self) {
        self.set_style(GWL_EXSTYLE, WS_EX_TRANSPARENT, self.ignores_mouse.get());
        self.set_style(
            GWL_EXSTYLE,
            WS_EX_LAYERED,
            self.ignores_mouse.get() || self.opacity.get() < 1.,
        );
        SetLayeredWindowAttributes(
            self.handle,
            0,
            (self.opacity.get().clamp(0., 1.) * 255.).round() as u8,
            LWA_ALPHA,
        );
    }

    fn set_shape(&self, parts: &[Rect]) {
        let (all, left) = (
            if parts.is_empty() {
                0
            } else {
                CreateRectRgn(0, 0, 0, 0)
            },
            -self.borders(GetDpiForWindow(self.handle)).left,
        );
        for it in parts {
            let [x, y, right, bottom] = [it.x, it.y, it.x + it.width, it.y + it.height]
                .map(|it| (it * self.scale()).round() as i32);
            let part = CreateRectRgn(left + x, y, left + right, bottom);
            CombineRgn(all, all, part, RGN_OR);
            // SAFETY: it is no longer used.
            unsafe { DeleteObject(part) };
        }
        SetWindowRgn(self.handle, all, 1);
    }

    fn change_style(&self, style: &WindowStyle) {
        const SQUARE: u32 = 1;
        style.movable.get().inspect(|it| self.is_movable.set(*it));
        style
            .focusable
            .get()
            .inspect(|it| self.set_style(GWL_EXSTYLE, WS_EX_NOACTIVATE, !it));
        style
            .minimizable
            .get()
            .inspect(|it| self.set_style(GWL_STYLE, WS_MINIMIZEBOX, *it));
        style
            .zoomable
            .get()
            .inspect(|it| self.set_style(GWL_STYLE, WS_MAXIMIZEBOX, *it));
        style.closable.get().inspect(|it| {
            _ = EnableMenuItem(
                GetSystemMenu(self.handle, 0),
                SC_CLOSE as u32,
                flag(MF_GRAYED, !it),
            )
        });
        style
            .rounded_corners
            .get()
            .inspect(|it| self.set_attribute(DWMWA_WINDOW_CORNER_PREFERENCE, flag(SQUARE, !it)));
    }

    // ───────────────────────────── what happens to it ─────────────────────────────

    fn activate(&self) {
        if IsIconic(self.handle) != 0 {
            ShowWindow(self.handle, SW_RESTORE);
        }
        SetForegroundWindow(self.handle);
    }

    fn activation_changed(&self, is_active: bool) {
        if !is_active {
            self.end_composition();
            self.forget_caret();
            super::keyboard::forget_keys();
        }
        self.may_have_been_minimized();
        self.is_active.set(is_active);
        self.show_accent();
        self.ime.has_changed.set(true);
        window::activation_changed(self.id, is_active);
    }

    fn post_command(&self, command: usize) {
        let mut at = DevicePoint::default();
        GetCursorPos(&mut at);
        self.give_up_pointer();
        PostMessageW(self.handle, WM_SYSCOMMAND, command, pair(at.x, at.y));
    }

    /// On the screen.
    pub fn open_system_menu(&self, at: Option<DevicePoint>) {
        let (handle, at, style) = (
            self.handle,
            at.unwrap_or_else(|| self.origin()),
            self.style(GWL_STYLE),
        );
        let (menu, is_maximized) = (GetSystemMenu(handle, 0), style & WS_MAXIMIZE != 0);
        let items = [
            (SC_RESTORE, is_maximized),
            (SC_MOVE, !is_maximized && self.is_movable.get()),
            (SC_SIZE, !is_maximized && style & WS_THICKFRAME != 0),
            (SC_MINIMIZE, style & WS_MINIMIZEBOX != 0),
            (SC_MAXIMIZE, !is_maximized && style & WS_MAXIMIZEBOX != 0),
        ];
        items.into_iter().for_each(|(item, is_enabled)| {
            _ = EnableMenuItem(menu, item as u32, flag(MF_GRAYED, !is_enabled))
        });
        later(move || {
            let command =
                TrackPopupMenuEx(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, at.x, at.y, handle, 0);
            if command != 0 {
                PostMessageW(handle, WM_SYSCOMMAND, command as usize, 0);
            }
        });
    }

    pub fn before_waiting(&self) {
        const PAUSE: u32 = 2;
        self.update_input_method();
        if !self.wants_frame.get() || !self.was_visible.get() {
            return;
        }
        match self
            .last_frame
            .get()
            .is_none_or(|it| it.elapsed() > self.interval.get() * PAUSE)
        {
            true => crate::host::system::wake_ui(),
            false => clock::ask_for_tick(self.interval.get()),
        }
    }

    pub fn begin_frame_if_due(&self, display_is_ready: bool) {
        let has_passed = |part: f32| {
            self.last_frame
                .get()
                .is_none_or(|it| it.elapsed() > self.interval.get().mul_f32(part))
        };
        if self.wants_frame.get()
            && self.was_visible.get()
            && has_passed(if display_is_ready { 0.5 } else { 2. })
        {
            self.wants_frame.set(false);
            self.last_frame.set(Some(Instant::now()));
            window::frame_is_due(self.id);
        }
    }

    fn repaint(&self, device: Handle, area: DeviceRect) {
        match &*self.buffer.borrow() {
            Some(buffer) => buffer.copy(
                device,
                IntRect::new(area.left, area.top, area.right, area.bottom),
            ),
            None if self.tree.borrow().is_some() => {
                _ = PatBlt(
                    device,
                    area.left,
                    area.top,
                    area.width(),
                    area.height(),
                    BLACKNESS,
                )
            }
            None => window::refresh(self.id),
        }
    }

    fn want_gpu(&self) {
        self.wants_gpu.set(true);
        gpu::get_ready();
    }

    fn rest_if_due(&self) {
        if self.rests_at.get().is_none_or(|it| it <= Instant::now()) {
            KillTimer(self.handle, REST);
            self.rests_at.set(None);
            self.tree.borrow_mut().iter_mut().for_each(Tree::rest);
        }
    }

    fn button(&self, message: u32, w: usize, at: DevicePoint) {
        let extra = 2 + high(w as i64) as u8;
        match message {
            WM_LBUTTONDOWN => self.press(at, 0),
            WM_MBUTTONDOWN => self.press(at, 1),
            WM_RBUTTONDOWN => self.press(at, 2),
            WM_XBUTTONDOWN => self.press(at, extra),
            WM_LBUTTONUP => self.release(self.point_at(at), 0),
            WM_MBUTTONUP => self.release(self.point_at(at), 1),
            WM_RBUTTONUP => self.release(self.point_at(at), 2),
            WM_XBUTTONUP => self.release(self.point_at(at), extra),
            _ => {}
        }
    }

    /// `None` leaves it to the system.
    ///
    /// # Safety
    /// `w` and `l` are what comes with that message.
    unsafe fn message(&self, message: u32, w: usize, l: isize) -> Option<isize> {
        // SAFETY: the caller's contract, here and below.
        let by_default = || unsafe { DefWindowProcW(self.handle, message, w, l) };
        let has_own_title_bar = self.frame != Frame::Full;
        if self.watched_messages.borrow().contains(&message) {
            window::user_acts(
                self.id,
                WindowEvent::Message {
                    message,
                    w: w as u64,
                    l: l as u64,
                },
            );
        }
        match message {
            WM_MOUSEMOVE => self.pointer_moved(point_in(l), true),
            WM_MOUSELEAVE => self.pointer_left(true),
            WM_MOUSEWHEEL | WM_MOUSEHWHEEL => self.wheel_turned(
                self.in_content(point_in(l)),
                high(w as i64),
                message == WM_MOUSEHWHEEL,
            ),
            WM_LBUTTONDOWN..=WM_XBUTTONUP => self.button(message, w, point_in(l)),
            WM_CAPTURECHANGED => self.lost_pointer(),
            WM_POINTERUPDATE..=WM_POINTERUP | WM_POINTERLEAVE | WM_POINTERCAPTURECHANGED => {
                return self
                    .contact(message, low(w as isize) as u16 as u32)
                    .then_some(0);
            }
            WM_SETCURSOR if low(l) as isize == HTCLIENT => {
                self.show_cursor();
                return Some(1);
            }
            WM_NCHITTEST if has_own_title_bar => {
                return Some(
                    Some(by_default())
                        .filter(|it| *it != HTCLIENT)
                        .unwrap_or_else(|| self.part_at(self.in_content(point_in(l)))),
                );
            }
            WM_NCMOUSEMOVE if has_own_title_bar => {
                self.pointer_moved(self.in_content(point_in(l)), false);
                return None;
            }
            WM_NCMOUSELEAVE => {
                self.pointer_left(false);
                return None;
            }
            WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK
                if has_own_title_bar && w as isize == HTMAXBUTTON =>
            {
                self.press(self.in_content(point_in(l)), 0)
            }
            // Or else it waits for half a second to see whether that is a drag, and nothing is drawn meanwhile.
            WM_NCLBUTTONDOWN if w as isize == HTCAPTION => {
                let at = self.in_content(point_in(l));
                PostMessageW(self.handle, WM_MOUSEMOVE, 0, pair(at.x, at.y));
                return None;
            }
            WM_NCRBUTTONDOWN if matches!(w as isize, HTCAPTION | HTSYSMENU) => {}
            WM_NCRBUTTONUP if matches!(w as isize, HTCAPTION | HTSYSMENU) => {
                window::user_acts(
                    self.id,
                    WindowEvent::WantsSystemMenu(Point {
                        x: low(l) as f32,
                        y: high(l) as f32,
                    }),
                );
            }
            WM_NCCALCSIZE if self.frame == Frame::WithoutTitleBar => {
                self.content_within(unsafe { &mut *(l as *mut DeviceRect) })
            }

            WM_KEYDOWN | WM_SYSKEYDOWN | WM_KEYUP | WM_SYSKEYUP => {
                return (!self.key(matches!(message, WM_KEYDOWN | WM_SYSKEYDOWN), w as u32, l))
                    .then_some(0);
            }
            WM_CHAR => self.character(w as u16),
            WM_SYSCHAR | WM_IME_STARTCOMPOSITION => {}
            WM_IME_SETCONTEXT => {
                return Some(unsafe {
                    DefWindowProcW(self.handle, message, w, l & !ISC_SHOWUICOMPOSITIONWINDOW)
                });
            }
            WM_IME_COMPOSITION => self.composition_changed(l as u32),
            WM_IME_ENDCOMPOSITION => self.composition_ended(),
            WM_IME_REQUEST => return unsafe { self.answer_input_method(w, l) },

            WM_PAINT => {
                let mut paint = PaintStruct::default();
                self.repaint(BeginPaint(self.handle, &mut paint), paint.rc_paint);
                EndPaint(self.handle, &paint);
            }
            WM_ERASEBKGND => {
                let (right, bottom) = self.client_size();
                self.repaint(
                    w as Handle,
                    DeviceRect {
                        left: 0,
                        top: 0,
                        right,
                        bottom,
                    },
                );
                return Some(1);
            }
            WM_TIMER if w == REST => self.rest_if_due(),
            WM_WINDOWPOSCHANGED => self.was_placed(unsafe { &*(l as *const WindowPos) }),
            WM_GETMINMAXINFO => self.limit(unsafe { &mut *(l as *mut MinMaxInfo) }),
            WM_DPICHANGED => {
                let area = unsafe { *(l as *const DeviceRect) };
                SetWindowPos(
                    self.handle,
                    0,
                    area.left,
                    area.top,
                    area.width(),
                    area.height(),
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                );
            }
            WM_GETDPISCALEDSIZE => {
                let Rect { width, height, .. } = self.bounds();
                let (cx, cy) = self.outer_size(Size { width, height }, w as u32);
                unsafe { *(l as *mut DeviceSize) = DeviceSize { cx, cy } };
                return Some(1);
            }
            WM_SIZING => {
                if !self.is_being_resized.replace(true) {
                    window::user_acts(self.id, WindowEvent::Resizing(true));
                }
                self.keep_aspect_ratio(w, unsafe { &mut *(l as *mut DeviceRect) });
                return Some(1);
            }
            WM_MOVING => {
                self.is_being_moved.set(true);
                window::user_acts(self.id, WindowEvent::Moving);
                return None;
            }
            WM_EXITSIZEMOVE if self.is_being_resized.take() => {
                window::user_acts(self.id, WindowEvent::Resizing(false));
                window::refresh(self.id);
            }
            WM_EXITSIZEMOVE if self.is_being_moved.take() => {
                window::user_acts(self.id, WindowEvent::Moved)
            }
            WM_SYSCOMMAND
                if w & 0xFFF0 == SC_KEYMENU || w & 0xFFF0 == SC_MOVE && !self.is_movable.get() => {}
            WM_SETFOCUS | WM_KILLFOCUS => self.activation_changed(message == WM_SETFOCUS),
            WM_CLOSE => window::close_requested(self.id),
            WM_APPCOMMAND => {
                window::user_acts(self.id, WindowEvent::AppCommand(high(l) as u32 & 0xFFF));
                return None;
            }
            WM_COMMAND if high(w as i64) == THBN_CLICKED as i32 => {
                window::user_acts(self.id, WindowEvent::ThumbnailButton(low(w as i64) as u32))
            }
            WM_QUERYENDSESSION => {
                return Some(super::may_end_session(self.id, true, l as u32).into());
            }
            WM_ENDSESSION if w != 0 => _ = super::may_end_session(self.id, false, l as u32),
            WM_GETOBJECT => return accessibility::object_for(self, w, l),
            _ => return None,
        }
        Some(0)
    }
}

impl platform::Window for Window {
    fn geometry(&self) -> Geometry {
        if IsIconic(self.handle) == 0 {
            let (area, origin, (width, height), scale) =
                (self.area(), self.origin(), self.client_size(), self.scale());
            let border = if self.frame == Frame::Full || IsZoomed(self.handle) != 0 {
                origin.x - area.left
            } else {
                0
            };
            let Point { x, y } = displays::of_window(self.handle).logical(DevicePoint {
                x: origin.x - border,
                y: area.top,
            });
            self.last_geometry.set(Geometry {
                x,
                y,
                top: (origin.y - area.top) as f32 / scale,
                border: border as f32 / scale,
                width: width as f32 / scale,
                height: height as f32 / scale,
                scale,
                is_maximized: IsZoomed(self.handle) != 0 || self.opens_maximized.get(),
                is_fullscreen: self.before_fullscreen.get().is_some()
                    || self.opens_fullscreen.get(),
                is_client_decorated: self.frame == Frame::None,
            });
        }
        self.last_geometry.get()
    }

    fn is_active(&self) -> bool {
        self.is_active.get()
    }

    fn is_visible(&self) -> bool {
        IsWindowVisible(self.handle) != 0
            && IsIconic(self.handle) == 0
            && !super::is_screen_unseen()
    }

    fn refresh_interval(&self) -> Option<Duration> {
        Some(self.interval.get())
    }

    fn mouse_position(&self) -> Point {
        self.pointer.at.get()
    }

    fn set_visible(&self, is_visible: bool, takes_focus: bool) {
        if !is_visible {
            ShowWindow(self.handle, SW_HIDE);
            return;
        }
        // It would be white until it is painted.
        let appears = IsWindowVisible(self.handle) == 0;
        if appears {
            self.set_attribute(DWMWA_CLOAK, 1);
        }
        self.at_once(|| {
            ShowWindow(
                self.handle,
                match takes_focus {
                    _ if self.opens_maximized.take() => SW_SHOWMAXIMIZED,
                    true => SW_SHOW,
                    false => SW_SHOWNA,
                },
            );
            if self.opens_fullscreen.take() {
                self.set_fullscreen(true);
            }
        });
        if appears {
            UpdateWindow(self.handle);
            self.set_attribute(DWMWA_CLOAK, 0);
        }
        if takes_focus {
            self.activate();
        }
    }

    fn close(&self) {
        accessibility::window_closes(self);
        WINDOWS.with_borrow_mut(|all| all.retain(|it| it.id != self.id));
        _ = RevokeDragDrop(self.handle);
        // They would go with it.
        for owned in all()
            .iter()
            .filter(|it| GetWindow(it.handle, GW_OWNER) == self.handle)
        {
            // SAFETY: a handle is a number.
            unsafe { SetWindowLongPtrW(owned.handle, GWLP_HWNDPARENT, 0) };
        }
        self.tree.take();
        DestroyWindow(self.handle);
    }

    fn request_frame(&self) {
        self.wants_frame.set(true);
    }

    fn can_present(&self) -> Option<bool> {
        Some(true)
    }

    fn present(&self, paint: Painter) {
        const IN_A_ROW: u32 = 8;
        const LARGE: i64 = 256 << 10;
        let (width, height) = self.client_size();
        let shown = (width.max(1), height.max(1));
        if IsIconic(self.handle) != 0 {
            return;
        }
        if let Some(tree) = &mut *self.tree.borrow_mut() {
            let result = tree.paint(shown, self.is_opaque.get(), paint);
            tree.device.check(result);
            return;
        }
        let (buffer, sent) = Buffer::present(self.buffer.take(), self.handle, shown, paint).unzip();
        self.buffer.replace(buffer);
        self.large_updates.update(|it| {
            if sent >= Some(LARGE) && !self.is_being_resized.get() {
                it + 1
            } else {
                0
            }
        });
        if self.large_updates.get() >= IN_A_ROW {
            self.want_gpu();
        }
    }

    fn begin_frame(&self, is_scrolling: bool, is_opaque: bool) {
        if is_scrolling {
            self.want_gpu();
        }
        let was_opaque = self.is_opaque.replace(is_opaque);
        // The system shows what GDI paints together with the new size.
        let device = gpu::device().filter(|_| self.wants_gpu.get() && !self.is_being_resized.get());
        let mut tree = self.tree.borrow_mut();
        if let Some(retired) = tree.take_if(|it| it.device.has_failed() || device.is_none()) {
            self.retired_tree.set(Some(retired));
        }
        if let Some(device) = device.filter(|_| tree.is_none()) {
            self.retired_tree.take();
            *tree = device.check(Tree::new(
                device.clone(),
                self.handle,
                self.buffer.take(),
                is_opaque,
            ));
            self.has_leftovers.set(true);
        }
        tree.iter_mut().for_each(|it| it.boost(is_scrolling));
        self.has_leftovers
            .update(|it| (it || was_opaque) && !is_opaque);
    }

    fn can_lift(&self) -> bool {
        self.want_gpu();
        self.tree.borrow().is_some()
    }

    fn commit(&self, lifted: Vec<Lifted>) -> Vec<u128> {
        const KEEPS_MEMORY: Duration = Duration::from_secs(2);
        self.retired_tree.take();
        let Some(tree) = &mut *self.tree.borrow_mut() else {
            return Vec::new();
        };
        let result = tree
            .show_lifted(lifted)
            .and_then(|kept| tree.commit().map(|()| kept));
        if self.has_leftovers.take() {
            let (device, (width, height)) = (GetDC(self.handle), self.client_size());
            PatBlt(device, 0, 0, width, height, BLACKNESS);
            ReleaseDC(self.handle, device);
            GdiFlush();
        }
        if self
            .rests_at
            .replace(Some(Instant::now() + KEEPS_MEMORY))
            .is_none()
        {
            SetTimer(self.handle, REST, KEEPS_MEMORY.as_millis() as u32, 0);
        }
        tree.device.check(result).unwrap_or_default()
    }

    fn release_pixels(&self) {
        self.buffer.take();
        self.tree.take();
    }

    fn set_cursor(&self, cursor: Cursor) {
        self.change_cursor(cursor);
    }

    fn begin_drag(&self, dragged: &Dragged, image: Option<&Pixmap>) {
        drag::begin(self, dragged, image);
    }

    fn text_input_changed(&self) {
        self.ime.has_changed.set(true);
    }

    fn start_move(&self) {
        self.post_command(SC_MOVE | HTCAPTION as usize);
    }

    fn start_resize(&self, edge: Edge) {
        self.post_command(
            SC_SIZE
                | [
                    WMSZ_TOP,
                    WMSZ_TOPRIGHT,
                    WMSZ_RIGHT,
                    WMSZ_BOTTOMRIGHT,
                    WMSZ_BOTTOM,
                    WMSZ_BOTTOMLEFT,
                    WMSZ_LEFT,
                    WMSZ_TOPLEFT,
                ][edge as usize],
        );
    }

    fn show_window_menu(&self, at: Point) {
        let (origin, scale) = (self.origin(), self.scale());
        self.give_up_pointer();
        self.open_system_menu(Some(DevicePoint {
            x: origin.x + (at.x * scale) as i32,
            y: origin.y + (at.y * scale) as i32,
        }));
    }

    fn title_was_double_clicked(&self) {
        if self.limits.get().is_resizable {
            self.post_command(if IsZoomed(self.handle) != 0 {
                SC_RESTORE
            } else {
                SC_MAXIMIZE
            });
        }
    }

    fn command(&self, command: &WindowCommand) -> Result<()> {
        self.at_once(|| self.obey(command));
        Ok(())
    }

    fn is_minimized(&self) -> bool {
        IsIconic(self.handle) != 0
    }

    fn handle(&self) -> u64 {
        self.handle as u64
    }
}

impl Window {
    fn at_once(&self, work: impl FnOnce()) {
        self.owes_frame.set(Some(false));
        work();
        if self.owes_frame.take() == Some(true) {
            window::was_resized(self.id);
        }
    }

    fn obey(&self, command: &WindowCommand) {
        let (handle, is_shown) = (self.handle, IsWindowVisible(self.handle) != 0);
        let put_after = |other| _ = SetWindowPos(handle, other, 0, 0, 0, 0, KEEPS_PLACE);
        match *command {
            WindowCommand::Title(ref title) => {
                _ = SetWindowTextW(handle, Wide::new(&**title).str())
            }
            WindowCommand::Position(Point { x, y }) => self.place(Rect {
                x,
                y,
                ..self.bounds()
            }),
            WindowCommand::Size(Size { width, height }) => self.place(Rect {
                width,
                height,
                ..self.bounds()
            }),
            WindowCommand::Bounds { bounds, .. } => self.place(bounds),
            WindowCommand::Limits(limits) => {
                let bounds = self.bounds();
                if self.limits.replace(limits).is_resizable != limits.is_resizable
                    && self.frame != Frame::None
                {
                    self.set_style(GWL_STYLE, WS_THICKFRAME, limits.is_resizable);
                    if self.frame == Frame::WithoutTitleBar {
                        self.place(bounds);
                    }
                }
            }
            WindowCommand::Focus if is_shown => self.activate(),
            WindowCommand::MoveTop => put_after(HWND_TOP),
            WindowCommand::MoveAbove(other) => put_after(GetWindow(other as Handle, GW_HWNDPREV)),
            WindowCommand::Blur => {
                let below = std::iter::successors(Some(handle), |it| {
                    Some(GetWindow(*it, GW_HWNDNEXT)).filter(|it| *it != 0)
                });
                below
                    .skip(1)
                    .find(|it| IsWindowVisible(*it) != 0)
                    .map(SetForegroundWindow);
            }
            WindowCommand::Minimize => _ = ShowWindow(handle, SW_MINIMIZE),
            WindowCommand::Maximize(on) if !is_shown => self.opens_maximized.set(on),
            WindowCommand::Maximize(true) => _ = ShowWindow(handle, SW_MAXIMIZE),
            WindowCommand::Maximize(false) if IsZoomed(handle) != 0 => {
                _ = ShowWindow(handle, SW_RESTORE)
            }
            WindowCommand::Restore => _ = ShowWindow(handle, SW_RESTORE),
            WindowCommand::Fullscreen(on) | WindowCommand::SimpleFullscreen(on) => {
                self.set_fullscreen(on)
            }
            WindowCommand::AlwaysOnTop(on) => {
                put_after(if on { HWND_TOPMOST } else { HWND_NOTOPMOST })
            }
            WindowCommand::SkipTaskbar(on) => {
                self.set_style(GWL_EXSTYLE, WS_EX_APPWINDOW, !on);
                shell::show_in_taskbar(handle, !on);
            }
            WindowCommand::Attention(on) => {
                let flags = flag(FLASHW_ALL | FLASHW_TIMERNOFG, on && !self.is_active.get());
                FlashWindowEx(&FlashWInfo {
                    cb_size: size_of::<FlashWInfo>() as u32,
                    hwnd: handle,
                    dw_flags: flags,
                    u_count: 0,
                    dw_timeout: 0,
                });
            }
            WindowCommand::AspectRatio { ratio, extra } => self.aspect_ratio.set((ratio, extra)),
            WindowCommand::Background(background) => self.set_background(background),
            WindowCommand::Style(ref style) => self.change_style(style),
            WindowCommand::Opacity(opacity) => {
                self.opacity.set(opacity);
                self.update_layering();
            }
            WindowCommand::IgnoreMouseEvents(on) => {
                self.ignores_mouse.set(on);
                self.update_layering();
            }
            WindowCommand::ContentProtection(on) => {
                _ = SetWindowDisplayAffinity(handle, flag(WDA_EXCLUDEFROMCAPTURE, on))
            }
            WindowCommand::Enabled(on) => _ = EnableWindow(handle, on.into()),
            WindowCommand::Shape(ref parts) => self.set_shape(parts),
            WindowCommand::Icon(ref encoded) => {
                self.set_icons(|side| pixels::Icon::decode(encoded, side))
            }
            // SAFETY: a handle is a number.
            WindowCommand::Parent(parent) => {
                _ = unsafe { SetWindowLongPtrW(handle, GWLP_HWNDPARENT, handle_of(parent.get())) }
            }
            WindowCommand::DragFiles {
                ref paths,
                ref icon,
            } => drag::begin_with_files(self, paths, icon),
            WindowCommand::Beep => _ = MessageBeep(MB_OK),
            WindowCommand::CharacterPalette => keyboard::open_character_palette(),
            _ => {}
        }
    }
}
