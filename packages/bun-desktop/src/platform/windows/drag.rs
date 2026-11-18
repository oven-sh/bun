use std::cell::{Cell, RefCell};

use super::clipboard::{self, Contents};
use super::keyboard::modifiers;
use super::pixels::Bitmap;
use super::window::{self, Window};
use crate::gfx::Pixmap;
use crate::host::system::{callback, later};
use crate::input;
use crate::platform::{Cursor, Input, Point};
use crate::protocol::{Clipboard, Dragged, Icon, Text};
use crate::win32::com::{
    self, Borrowed, Interface as _, Object, Out, Outcome, Status, Unknown, class,
};
use crate::win32::*;

const ELSEWHERE: Point = Point { x: -1e4, y: -1e4 };

thread_local! {
    /// The window, and whether its page follows the drag.
    static BEGUN_IN: Cell<Option<(u32, bool)>> = const { Cell::new(None) };
    static DROPPED_AT: Cell<Option<Point>> = const { Cell::new(None) };
}

pub fn is_dragging() -> bool {
    BEGUN_IN.get().is_some()
}

// ───────────────────────────── from here ─────────────────────────────

/// The shell adds what it needs to show the image.
struct Data(RefCell<Contents>);

class! { Data {
    0 [IDataObject::ID] {
        get(format: &FormatEtc, medium: Out<StgMedium>),
        _(),
        query(format: &FormatEtc),
        _(),
        set(format: &FormatEtc, medium: &mut StgMedium, releases: Bool),
        list(direction: u32, all: &mut Option<Unknown>),
        _(),
        _(),
        _(),
    }
} }

impl Data {
    fn get(&self, format: &FormatEtc, medium: Out<StgMedium>) -> Outcome {
        let contents = self.0.borrow();
        let found = contents
            .iter()
            .find(|it| it.0 == format.cf_format && format.tymed & TYMED_HGLOBAL != 0)
            .ok_or(Status(DV_E_FORMATETC));
        medium.answer(found.map(|it| StgMedium {
            tymed: TYMED_HGLOBAL,
            h_global: clipboard::global(&it.1),
            ..Default::default()
        }))
    }

    fn query(&self, format: &FormatEtc) -> Outcome {
        let has_it = self
            .0
            .borrow()
            .iter()
            .any(|it| it.0 == format.cf_format && format.tymed & TYMED_HGLOBAL != 0);
        if has_it {
            Ok(())
        } else {
            Err(Status(DV_E_FORMATETC))
        }
    }

    fn set(&self, format: &FormatEtc, medium: &mut StgMedium, releases: Bool) -> Outcome {
        // SAFETY: it says what it is, and whose.
        unsafe {
            let bytes = (medium.tymed == TYMED_HGLOBAL)
                .then(|| clipboard::bytes_in(medium.h_global))
                .flatten()
                .ok_or(Status::NOT_IMPLEMENTED)?;
            self.0.borrow_mut().retain(|it| it.0 != format.cf_format);
            self.0.borrow_mut().push((format.cf_format, bytes));
            if releases != 0 {
                ReleaseStgMedium(medium);
            }
        }
        Ok(())
    }

    fn list(&self, direction: u32, all: &mut Option<Unknown>) -> Outcome {
        let formats: Vec<_> = self
            .0
            .borrow()
            .iter()
            .filter(|_| direction == DATADIR_GET)
            .map(|it| FormatEtc::global(it.0))
            .collect();
        // SAFETY: the vector with its length.
        unsafe { SHCreateStdEnumFmtEtc(formats.len() as u32, formats.as_ptr(), all) }.ok()
    }
}

struct Source;

class! { Source {
    0 [IID_I_DROP_SOURCE] { goes_on(is_cancelled: Bool, keys: u32), shows(effect: u32) }
} }

impl Source {
    fn goes_on(&self, is_cancelled: Bool, keys: u32) -> Outcome {
        match (is_cancelled != 0, keys as usize & MK_LBUTTON != 0) {
            (true, _) => Err(Status(DRAGDROP_S_CANCEL)),
            (_, false) => Err(Status(DRAGDROP_S_DROP)),
            _ => Ok(()),
        }
    }

    fn shows(&self, _: u32) -> Outcome {
        Err(Status(DRAGDROP_S_USEDEFAULTCURSORS))
    }
}

fn attach_image(data: &Unknown, image: &Pixmap, (x, y): (i32, i32)) -> Option<()> {
    const NO_COLOR: u32 = u32::MAX;
    let bgra = image
        .data()
        .as_chunks()
        .0
        .iter()
        .map(|it| crate::paint::raster::demultiply(*it))
        .map(|[r, g, b, a]| [b, g, r, a]);
    let bitmap = Bitmap::of(image.width(), image.height(), bgra)?;
    let size = DeviceSize {
        cx: bitmap.size.0,
        cy: bitmap.size.1,
    };
    let image = ShDragImage {
        size_drag_image: size,
        pt_offset: DevicePoint { x, y },
        hbmp_drag_image: bitmap.handle(),
        cr_color_key: NO_COLOR,
    };
    com::create::<IDragSourceHelper>(CLSID_DRAG_DROP_HELPER)
        .ok()?
        .initialize_from_bitmap(&image, data.borrowed())
        .ok()
        .ok()?;
    bitmap.leak();
    Some(())
}

fn run(window: &Window, data: Unknown, allowed: u32, page_follows: bool) {
    let id = window.id;
    later(move || {
        // It may be over.
        if !is_dragging() && window::with_id(id).is_some_and(|it| it.is_pressed()) {
            BEGUN_IN.set(Some((id, page_follows)));
            _ = DoDragDrop(
                data.borrowed(),
                Object::create(Source).borrowed(),
                allowed,
                &mut 0,
            );
            BEGUN_IN.set(None);
            let at = DROPPED_AT.take().unwrap_or(ELSEWHERE);
            window::with_id(id).inspect(|it| it.release(at, 0));
        }
    });
}

pub fn begin(window: &Window, dragged: &Dragged, image: Option<&Pixmap>) {
    let [text, html] =
        [&dragged.text, &dragged.html].map(|it| it.unless_empty().map(Into::into).into());
    let mut contents = clipboard::offer(Clipboard {
        text,
        html,
        ..Clipboard::default()
    })
    .unwrap_or_default();
    contents.extend(dragged.url.unless_empty().map(|it| {
        (
            clipboard::format(wide!("UniformResourceLocatorW")),
            Wide::new(it).bytes(),
        )
    }));
    contents.retain(|_| dragged.copies || dragged.links);
    let data = Object::create(Data(contents.into()));
    let scale = |image: &Pixmap| image.width() as f32 / dragged.area.width;
    image.and_then(|it| {
        attach_image(
            &data,
            it,
            (
                (-dragged.area.x * scale(it)) as i32,
                (-dragged.area.y * scale(it)) as i32,
            ),
        )
    });
    run(
        window,
        data,
        DROPEFFECT_COPY | DROPEFFECT_LINK | DROPEFFECT_MOVE,
        true,
    );
}

pub fn begin_with_files(window: &Window, paths: &[Text], icon: &Icon) {
    let data = Object::create(Data(
        vec![(CF_HDROP, clipboard::list_of_files(paths))].into(),
    ));
    crate::images::decode_pixmap(&icon.bytes).and_then(|it| attach_image(&data, &it, (0, 0)));
    run(window, data, DROPEFFECT_COPY | DROPEFFECT_LINK, false);
}

// ───────────────────────────── to here ─────────────────────────────

struct Target {
    window: u32,
    has_files: Cell<bool>,
    /// It shows the image.
    helper: RefCell<Option<IDropTargetHelper>>,
}

class! { Target {
    0 [IID_I_DROP_TARGET] {
        enter(data: Borrowed<IDataObject>, keys: u32, at: DevicePoint, effect: &mut u32),
        over(keys: u32, at: DevicePoint, effect: &mut u32),
        leave(),
        dropped(data: Borrowed<IDataObject>, keys: u32, at: DevicePoint, effect: &mut u32),
    }
} }

fn files_in(data: &IDataObject) -> Vec<String> {
    let mut medium = StgMedium::default();
    if data
        .get_data(&FormatEtc::global(CF_HDROP), &mut medium)
        .ok()
        .is_err()
    {
        return Vec::new();
    }
    // SAFETY: it says what it is, and is this function's.
    unsafe {
        let bytes = (medium.tymed == TYMED_HGLOBAL)
            .then(|| clipboard::bytes_in(medium.h_global))
            .flatten();
        ReleaseStgMedium(&mut medium);
        clipboard::paths_in(&bytes.unwrap_or_default())
    }
}

impl Target {
    fn is_at_home(&self) -> bool {
        BEGUN_IN.get() == Some((self.window, true))
    }

    fn tell(&self, event: Input) {
        callback((), || input::handle(self.window, event));
    }

    /// Returns where that is in the window.
    fn answer(&self, at: DevicePoint, effect: &mut u32) -> Outcome<Point> {
        let window = window::with_id(self.window).ok_or(Status::FAILED)?;
        // The cursor says what the page would do.
        *effect &= match window.pointer.cursor.get() {
            _ if self.has_files.get() => DROPEFFECT_COPY,
            _ if !self.is_at_home() => DROPEFFECT_NONE,
            Cursor::DragCopy => DROPEFFECT_COPY,
            Cursor::DragLink => DROPEFFECT_LINK,
            Cursor::ClosedHand => DROPEFFECT_MOVE,
            _ => DROPEFFECT_NONE,
        };
        Ok(window.point_at(window.in_content(at)))
    }

    fn enter(
        &self,
        data: Borrowed<IDataObject>,
        _: u32,
        at: DevicePoint,
        effect: &mut u32,
    ) -> Outcome {
        let paths = files_in(data.get()?);
        self.has_files.set(!paths.is_empty());
        let here = self.answer(at, effect)?;
        self.helper
            .replace(com::create(CLSID_DRAG_DROP_HELPER).ok());
        if let Some(helper) = &*self.helper.borrow() {
            _ = helper.drag_enter(
                window::handle_of(Some(self.window)),
                data.get()?.borrowed(),
                &at,
                *effect,
            );
        }
        if self.has_files.get() {
            self.tell(Input::DragEnter {
                at: here,
                paths: paths.into_iter().map(Into::into).collect(),
            });
        }
        Ok(())
    }

    fn over(&self, _: u32, at: DevicePoint, effect: &mut u32) -> Outcome {
        let here = self.answer(at, effect)?;
        self.helper
            .borrow()
            .iter()
            .for_each(|it| _ = it.drag_over(&at, *effect));
        if self.is_at_home() {
            self.tell(Input::MouseMove {
                at: here,
                is_pressed: true,
                modifiers: modifiers(),
            });
        } else if self.has_files.get() {
            self.tell(Input::DragOver { at: here });
        }
        Ok(())
    }

    fn leave(&self) -> Outcome {
        self.helper.take().iter().for_each(|it| _ = it.drag_leave());
        if self.is_at_home() {
            self.tell(Input::MouseMove {
                at: ELSEWHERE,
                is_pressed: true,
                modifiers: modifiers(),
            });
        } else if self.has_files.take() {
            self.tell(Input::DragLeave);
        }
        Ok(())
    }

    fn dropped(
        &self,
        data: Borrowed<IDataObject>,
        _: u32,
        at: DevicePoint,
        effect: &mut u32,
    ) -> Outcome {
        let here = self.answer(at, effect)?;
        if let Some(helper) = self.helper.take() {
            _ = helper.drop(data.get()?.borrowed(), &at, *effect);
        }
        if self.is_at_home() {
            DROPPED_AT.set(Some(here));
        } else if self.has_files.take() {
            self.tell(Input::Drop { at: here });
        }
        Ok(())
    }
}

pub fn accept_drops(window: &Window) {
    _ = RegisterDragDrop(
        window.handle,
        Object::create(Target {
            window: window.id,
            has_files: Cell::default(),
            helper: RefCell::default(),
        })
        .borrowed(),
    );
}
