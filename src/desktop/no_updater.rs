//! `updater.rs` where there are no app bundles.

use crate::generated_bindgen::electron::ElectronAutoUpdater;
use crate::prelude::*;

pub(crate) fn all_windows_closed() -> JsResult<()> {
    Ok(())
}

pub(crate) fn move_to_applications(_: JSValue) -> JsResult<bool> {
    Err(unsupported("moveToApplicationsFolder"))
}

impl ElectronAutoUpdater {
    pub(crate) fn set_feed_url<'a>(_: Cx<'a, '_>, _: JsLocal<'a>, _: JsLocal<'a>) -> JsResult<()> {
        Err(unsupported("autoUpdater"))
    }

    pub(crate) fn get_feed_url() -> String {
        String::new()
    }

    pub(crate) fn check_for_updates(_: Cx<'_, '_>) -> JsResult<()> {
        Err(unsupported("autoUpdater"))
    }

    pub(crate) fn quit_and_install(_: Cx<'_, '_>) -> JsResult<()> {
        Err(unsupported("autoUpdater"))
    }
}
