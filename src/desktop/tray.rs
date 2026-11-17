//! `Tray`

use bun_ui::protocol::{Icon, TrayCommand, TrayEvent};

use crate::generated_bindgen::system::{BalloonOptions, js_DesktopTray as fields};
use crate::menu::{self, Menu, Slot};
use crate::prelude::*;
use crate::{app, notification, paths};

#[derive(Default)]
struct State {
    all: RefCell<Vec<Root<Tray>>>,
    last_id: Cell<u32>,
}

state!(fn state() -> State);

pub(crate) struct Tray {
    id: u32,
    guid: Option<String>,
    title: RefCell<String>,
    /// A desktop that has no tray shows no icon.
    is_shown: Cell<bool>,
    is_destroyed: Cell<bool>,
    ignores_double_clicks: Cell<bool>,
}

fn icon(image: JsLocal<'_>) -> JsResult<Icon> {
    NativeImage::with(global(), image.to_js(), |it| it.icon(global()))
}

pub(crate) fn handle(id: u32, event: TrayEvent, at: Point) -> JsResult<()> {
    let Some(tray) = state()
        .all
        .borrow()
        .iter()
        .map(Root::get)
        .find(|it| it.id == id)
    else {
        return Ok(());
    };
    let name = match event {
        TrayEvent::DoubleClick if tray.ignores_double_clicks.get() => "click",
        TrayEvent::Click => "click",
        TrayEvent::RightClick => "right-click",
        TrayEvent::MiddleClick => "middle-click",
        TrayEvent::DoubleClick => "double-click",
        TrayEvent::MouseEnter => return announce(tray.to_js(), "mouse-enter", &[js(at)?]),
        TrayEvent::MouseLeave => return announce(tray.to_js(), "mouse-leave", &[js(at)?]),
    };
    announce(tray.to_js(), name, &[js(tray.bounds()?)?, js(at)?])
}

impl Tray {
    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        image: JsLocal<'a>,
        guid: Option<&[u8]>,
    ) -> JsResult<&'a Self> {
        state().last_id.update(|it| it + 1);
        let id = state().last_id.get();
        let create = || {
            let command = TrayCommand::Create {
                name: paths::app_name()?.into(),
                icon: icon(image)?,
            };
            perform(SystemCommand::Tray { id, command })
        };
        let is_shown = if app::is_electron() {
            catch(create())?.is_ok()
        } else {
            create().map(|()| true)?
        };
        let tray = Tray {
            id,
            guid: guid.map(string),
            title: RefCell::default(),
            is_shown: is_shown.into(),
            is_destroyed: false.into(),
            ignores_double_clicks: false.into(),
        };
        let tray = structure.create(&cx.heap, tray);
        if is_shown {
            state().all.borrow_mut().push(Root::new(tray));
            bun_ui::hold();
        }
        Ok(tray)
    }

    fn perform(&self, command: TrayCommand) -> JsResult<()> {
        if self.is_shown.get() {
            perform(SystemCommand::Tray {
                id: self.id,
                command,
            })
        } else {
            Ok(())
        }
    }

    fn bounds(&self) -> JsResult<Rect> {
        if self.is_shown.get() {
            answer((ui()?.tray_bounds)(self.id))
        } else {
            Ok(Rect::default())
        }
    }

    pub(crate) fn nothing(&self) {}

    pub(crate) fn set_image<'a>(&self, _: Cx<'a, '_>, image: JsLocal<'a>) -> JsResult<()> {
        self.perform(TrayCommand::Icon(icon(image)?))
    }

    pub(crate) fn set_tool_tip(&self, _: Cx<'_, '_>, text: &[u8]) -> JsResult<()> {
        self.perform(TrayCommand::ToolTip(Text::lossy(text)))
    }

    pub(crate) fn set_title(&self, _: Cx<'_, '_>, title: &[u8]) -> JsResult<()> {
        self.title.replace(string(title));
        self.perform(TrayCommand::Title(Text::lossy(title)))
    }

    pub(crate) fn get_title(&self) -> String {
        self.title.borrow().clone()
    }

    pub(crate) fn set_context_menu(&self, _: Cx<'_, '_>, menu: Option<&Menu>) -> JsResult<()> {
        fields::set_menu(self, menu);
        if self.is_shown.get() {
            menu::attach(Slot::Tray(self.id), menu)
        } else {
            Ok(())
        }
    }

    pub(crate) fn pop_up_context_menu<'a>(&self, _: Cx<'a, '_>, menu: JsLocal<'a>) -> JsResult<()> {
        let menu = cast(menu.to_js())
            .or_else(|| fields::menu(self))
            .filter(|_| IS_MAC && self.is_shown.get());
        fields::set_open_menu(self, menu);
        menu.map_or(Ok(()), |it| it.pop_up_under_tray(self.id))
    }

    pub(crate) fn close_context_menu(&self, _: Cx<'_, '_>) -> JsResult<()> {
        fields::open_menu(self).map_or(Ok(()), Menu::close)
    }

    pub(crate) fn get_bounds(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(self.bounds()?)
    }

    pub(crate) fn destroy(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.is_destroyed.set(true);
        if !self.is_shown.take() {
            return Ok(());
        }
        state().all.borrow_mut().retain(|it| !same(it.get(), self));
        menu::detach(Slot::Tray(self.id));
        bun_ui::release();
        perform(SystemCommand::Tray {
            id: self.id,
            command: TrayCommand::Destroy,
        })
    }

    pub(crate) fn is_destroyed(&self) -> bool {
        self.is_destroyed.get()
    }

    pub(crate) fn display_balloon(&self, _: Cx<'_, '_>, it: &BalloonOptions) -> JsResult<()> {
        notification::show_plain(
            it.title.as_deref().unwrap_or_default(),
            it.content.as_deref().unwrap_or_default(),
        )
    }

    pub(crate) fn get_guid(&self) -> Option<&str> {
        self.guid.as_deref()
    }

    pub(crate) fn set_ignore_double_click_events(&self, ignores: bool) {
        self.ignores_double_clicks.set(ignores);
    }

    pub(crate) fn get_ignore_double_click_events(&self) -> bool {
        self.ignores_double_clicks.get()
    }
}
