use super::pixels::Bitmap;
use crate::bridge;
use crate::host::system;
use crate::protocol::{MenuItem, MenuItemKind, SystemEvent};
use crate::win32::*;

pub struct Menu {
    handle: Handle,
    /// By the number that the system knows them by, which starts at 1.
    items: Vec<u32>,
    icons: Vec<Bitmap>,
}

fn icon(encoded: &[u8]) -> Option<Bitmap> {
    let image = crate::images::decode_pixmap(encoded)?;
    Bitmap::of(
        image.width(),
        image.height(),
        image
            .data()
            .as_chunks()
            .0
            .iter()
            .map(|&[r, g, b, a]| [b, g, r, a]),
    )
}

impl Menu {
    pub fn new(items: &[MenuItem]) -> Menu {
        let mut menu = Menu {
            handle: 0,
            items: Vec::new(),
            icons: Vec::new(),
        };
        menu.handle = menu.add(items);
        menu
    }

    fn add(&mut self, items: &[MenuItem]) -> Handle {
        let menu = CreatePopupMenu();
        for (position, item) in (0..).zip(items) {
            let (label, is_enabled) = (
                Wide::new(&*item.label),
                item.is_enabled && item.kind != MenuItemKind::Header,
            );
            let icon = item.icon.as_ref().and_then(|it| icon(&it.bytes));
            self.items.push(item.id);
            let description = MenuItemInfoW {
                cb_size: size_of::<MenuItemInfoW>() as u32,
                f_mask: MIIM_FTYPE
                    | MIIM_STATE
                    | MIIM_ID
                    | MIIM_SUBMENU
                    | MIIM_STRING
                    | MIIM_BITMAP,
                f_type: match item.kind {
                    MenuItemKind::Separator => MFT_SEPARATOR,
                    MenuItemKind::Radio => MFT_RADIOCHECK,
                    _ => MFT_STRING,
                },
                f_state: if is_enabled { 0 } else { MFS_DISABLED }
                    | if item.is_checked { MFS_CHECKED } else { 0 },
                w_id: self.items.len() as u32,
                h_sub_menu: item.submenu.as_ref().map_or(0, |it| self.add(it)),
                dw_type_data: label.str(),
                hbmp_item: icon.as_ref().map_or(0, Bitmap::handle),
                ..Default::default()
            };
            InsertMenuItemW(menu, position, 1, &description);
            self.icons.extend(icon);
        }
        menu
    }

    /// Returns when it is closed.
    pub fn pop_up(&self, at: DevicePoint) {
        // Or else a click elsewhere would not close it.
        let before = GetForegroundWindow();
        SetForegroundWindow(system::window());
        let chosen = TrackPopupMenuEx(
            self.handle,
            TPM_RETURNCMD | TPM_RIGHTBUTTON,
            at.x,
            at.y,
            system::window(),
            0,
        );
        PostMessageW(system::window(), WM_NULL, 0, 0);
        if let Some(&item) = self.items.get((chosen as usize).wrapping_sub(1)) {
            bridge::emit_system(SystemEvent::Menu {
                item,
                is_by_key: false,
            });
        }
        if GetForegroundWindow() == system::window()
            && super::window::all().iter().any(|it| it.handle == before)
        {
            SetForegroundWindow(before);
        }
    }
}

impl Drop for Menu {
    fn drop(&mut self) {
        DestroyMenu(self.handle);
    }
}
