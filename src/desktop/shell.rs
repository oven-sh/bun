//! `shell` and `net`

use bun_ui::protocol::{Request, SystemRequest, WindowCommand};
use bun_ui::queue;

use crate::generated_bindgen::system::{DesktopNet, DesktopShell};
use crate::prelude::*;
use crate::{files, realm, window};

pub(crate) fn open_url(url: &[u8]) -> JsResult<()> {
    let href = bun_url::whatwg::href_from_string(&bun_core::String::clone_utf8(url));
    if href.is_dead() {
        return Err(type_error(format_args!("Invalid URL")));
    }
    perform(SystemCommand::OpenUrl(Text::lossy(&href.to_utf8())))
}

impl DesktopShell {
    pub(crate) fn open_external(_: Cx<'_, '_>, url: &[u8]) -> JsResult<JSValue> {
        open_url(url)?;
        resolved(JSValue::UNDEFINED)
    }

    pub(crate) fn open_path(_: Cx<'_, '_>, path: &[u8]) -> JsResult<JSValue> {
        let path = string(path);
        if !files::exists(&path) {
            return resolved(format!("{path} does not exist"));
        }
        perform(SystemCommand::OpenPath(files::absolute(&path).into()))?;
        resolved("")
    }

    pub(crate) fn show_item_in_folder(_: Cx<'_, '_>, path: &[u8]) -> JsResult<()> {
        perform(SystemCommand::RevealPath(
            files::absolute(&string(path)).into(),
        ))
    }

    pub(crate) fn trash_item(_: Cx<'_, '_>, path: &[u8]) -> JsResult<JSValue> {
        let request = Request::System(SystemRequest::Trash(files::absolute(&string(path)).into()));
        queue::promise_of(global(), request, |_, _| Ok(JSValue::UNDEFINED))
    }

    pub(crate) fn beep(_: Cx<'_, '_>) -> JsResult<()> {
        if let Some(window) = window::of_app().first() {
            return window.get().tell(WindowCommand::Beep);
        }
        let _ = bun_sys::write(bun_sys::Fd::stdout(), b"\x07");
        Ok(())
    }

    pub(crate) fn read_shortcut_link(_: Cx<'_, '_>) -> JsResult<()> {
        Err(unsupported("readShortcutLink"))
    }

    pub(crate) fn write_shortcut_link() -> bool {
        false
    }
}

impl DesktopNet {
    pub(crate) fn fetch<'a>(
        _: Cx<'a, '_>,
        input: JsLocal<'a>,
        init: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        call(
            realm::native(global(), "fetch")?,
            &[input.to_js(), init.to_js()],
        )
    }

    #[cfg(unix)]
    pub(crate) fn get_online() -> bool {
        let mut first = core::ptr::null_mut();
        // SAFETY: it makes a list, which is read before it is freed.
        unsafe {
            if libc::getifaddrs(&raw mut first) != 0 {
                return false;
            }
            let is_online =
                core::iter::successors(first.as_ref(), |it| it.ifa_next.as_ref()).any(|it| {
                    let (wanted, unwanted) = (
                        (libc::IFF_UP | libc::IFF_RUNNING) as u32,
                        libc::IFF_LOOPBACK as u32,
                    );
                    let family = it.ifa_addr.as_ref().map(|it| i32::from(it.sa_family));
                    it.ifa_flags & (wanted | unwanted) == wanted
                        && matches!(family, Some(libc::AF_INET | libc::AF_INET6))
                });
            libc::freeifaddrs(first);
            is_online
        }
    }

    #[cfg(not(unix))]
    pub(crate) fn get_online() -> bool {
        true
    }
}
