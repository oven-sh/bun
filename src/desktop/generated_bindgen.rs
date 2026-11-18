//! What `src/codegen/bindgen.ts` generates from this crate's `.bind.ts` files.

include!(concat!(
    env!("BUN_CODEGEN_DIR"),
    "/generated_bindgen_bun_desktop.rs"
));

pub(crate) use self::{
    desktop_app as app, desktop_base as base, desktop_contents as contents,
    desktop_dialog as dialog, desktop_electron as electron, desktop_ipc as ipc,
    desktop_menu as menu, desktop_renderer as renderer, desktop_script as script,
    desktop_session as session, desktop_system as system, desktop_touch_bar as touch_bar,
    desktop_webview as webview, desktop_window as window,
};
