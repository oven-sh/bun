use std::cell::RefCell;
use std::rc::Rc;

use super::displays;
use super::menu::Menu;
use super::pixels::Icon;
use crate::abi::Rect;
use crate::bridge;
use crate::error::{Context as _, Result};
use crate::host::system;
use crate::protocol::{SystemEvent, TrayCommand, TrayEvent};
use crate::win32::com::Guid;
use crate::win32::*;

pub const MESSAGE: u32 = WM_APP + 16;

struct Tray {
    id: u32,
    icon: Icon,
    tool_tip: String,
    menu: Option<Rc<Menu>>,
    guid: Option<Guid>,
}

thread_local! {
    static TRAYS: RefCell<Vec<Tray>> = RefCell::default();
}

impl Tray {
    fn describe(&self) -> NotifyIconDataW {
        let mut data = NotifyIconDataW {
            cb_size: size_of::<NotifyIconDataW>() as u32,
            h_wnd: system::window(),
            u_id: self.id,
            u_flags: NIF_MESSAGE
                | NIF_ICON
                | NIF_TIP
                | NIF_SHOWTIP
                | if self.guid.is_some() { NIF_GUID } else { 0 },
            guid_item: self.guid.unwrap_or(Guid::new(0)),
            u_callback_message: MESSAGE,
            h_icon: self.icon.0,
            u_version: NOTIFYICON_VERSION_4,
            ..Default::default()
        };
        copy_into(&mut data.sz_tip, &self.tool_tip);
        data
    }
}

/// Messages to this thread are delivered meanwhile.
fn tell(message: u32, tray: &NotifyIconDataW) -> Result<()> {
    succeeded(Shell_NotifyIconW(message, tray)).context("the notification area has refused")
}

fn add(tray: &NotifyIconDataW) -> Result<()> {
    tell(NIM_ADD, tray)?;
    tell(NIM_SETVERSION, tray)
}

fn describe(id: u32) -> Option<NotifyIconDataW> {
    TRAYS.with_borrow(|all| all.iter().find(|it| it.id == id).map(Tray::describe))
}

impl Drop for Tray {
    fn drop(&mut self) {
        _ = tell(NIM_DELETE, &self.describe());
    }
}

fn dpi() -> u32 {
    (displays::all().first().map_or(1., |it| it.scale) * 96.) as u32
}

fn icon(from: &crate::protocol::Icon) -> Result<Icon> {
    Icon::decode(&from.bytes, GetSystemMetricsForDpi(SM_CXSMICON, dpi()))
        .context("could not decode the icon")
}

pub fn command(id: u32, command: TrayCommand) -> Result<()> {
    if let TrayCommand::Create {
        icon: from, guid, ..
    } = &command
    {
        let tray = Tray {
            id,
            icon: icon(from)?,
            tool_tip: String::new(),
            menu: None,
            guid: guid.as_ref().and_then(|it| Guid::parse(it)),
        };
        add(&tray.describe())?;
        TRAYS.with_borrow_mut(|all| all.push(tray));
        return Ok(());
    }
    let destroyed = TRAYS.with_borrow_mut(|all| -> Result<_> {
        let index = all
            .iter()
            .position(|it| it.id == id)
            .context("the tray icon was destroyed")?;
        match command {
            TrayCommand::Destroy => return Ok(Some(all.remove(index))),
            TrayCommand::Icon(from) => all[index].icon = icon(&from)?,
            TrayCommand::ToolTip(text) => all[index].tool_tip = text.into_string(),
            TrayCommand::Menu(items) => {
                all[index].menu = items.as_ref().map(|it| Menu::new(it).into())
            }
            TrayCommand::Create { .. } | TrayCommand::Title(_) => {}
        }
        Ok(None)
    })?;
    drop(destroyed);
    describe(id).map_or(Ok(()), |it| tell(NIM_MODIFY, &it))
}

/// Without content it goes away.
pub fn show_balloon(
    id: u32,
    title: &str,
    content: &str,
    icon: Option<&crate::protocol::Icon>,
    flags: u32,
) -> bool {
    let side = GetSystemMetricsForDpi(
        if flags & NIIF_LARGE_ICON != 0 {
            SM_CXICON
        } else {
            SM_CXSMICON
        },
        dpi(),
    );
    let icon = icon.and_then(|it| Icon::decode(&it.bytes, side));
    let Some(mut data) = describe(id) else {
        return false;
    };
    (data.u_flags, data.dw_info_flags, data.h_balloon_icon) = (
        data.u_flags | NIF_INFO,
        flags,
        icon.as_ref().map_or(0, |it| it.0),
    );
    copy_into(&mut data.sz_info_title, title);
    copy_into(&mut data.sz_info, content);
    Shell_NotifyIconW(NIM_MODIFY, &data) != 0
}

pub fn focus(id: u32) -> bool {
    describe(id).is_some_and(|it| tell(NIM_SETFOCUS, &it).is_ok())
}

pub fn bounds(id: u32) -> Rect {
    let guid_item = TRAYS
        .with_borrow(|all| all.iter().find(|it| it.id == id)?.guid)
        .unwrap_or(Guid::new(0));
    let icon = NotifyIconIdentifier {
        cb_size: size_of::<NotifyIconIdentifier>() as u32,
        h_wnd: system::window(),
        u_id: id,
        guid_item,
    };
    crate::win32::com::filled(|it| Shell_NotifyIconGetRect(&icon, it))
        .map(displays::logical_area)
        .unwrap_or_default()
}

pub fn message(w: usize, l: isize) {
    let (id, at) = (
        high(l) as u32,
        DevicePoint {
            x: low(w),
            y: high(w),
        },
    );
    let event = match low(l) as u32 {
        NIN_SELECT | NIN_KEYSELECT => TrayEvent::Click,
        WM_CONTEXTMENU => TrayEvent::RightClick,
        WM_MBUTTONUP => TrayEvent::MiddleClick,
        WM_LBUTTONDBLCLK => TrayEvent::DoubleClick,
        WM_MOUSEMOVE => TrayEvent::MouseMove,
        NIN_POPUPOPEN => TrayEvent::MouseEnter,
        NIN_POPUPCLOSE => TrayEvent::MouseLeave,
        NIN_BALLOONSHOW => TrayEvent::BalloonShow,
        NIN_BALLOONUSERCLICK => TrayEvent::BalloonClick,
        NIN_BALLOONTIMEOUT | NIN_BALLOONHIDE => TrayEvent::BalloonClosed,
        _ => return,
    };
    match TRAYS
        .with_borrow(|all| all.iter().find(|it| it.id == id)?.menu.clone())
        .filter(|_| event == TrayEvent::RightClick)
    {
        Some(menu) => system::later(move || menu.pop_up(at)),
        None => bridge::emit_system(SystemEvent::Tray {
            id,
            event,
            at: displays::logical(at),
        }),
    }
}

/// The taskbar is new.
pub fn add_again() {
    TRAYS
        .with_borrow(|all| all.iter().map(Tray::describe).collect::<Vec<_>>())
        .iter()
        .for_each(|it| bridge::report(add(it)));
}

pub fn remove_all() {
    TRAYS.take();
}
