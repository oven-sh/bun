use std::cell::RefCell;

use anyhow::{Context as _, Result};
use block2::RcBlock;
use gpui::App;
use objc2::rc::Retained;
use objc2::{MainThreadMarker, MainThreadOnly as _};
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSAlertStyle, NSApplication, NSModalResponse,
    NSModalResponseAbort, NSModalResponseOK, NSOpenPanel, NSSavePanel, NSView, NSWindow,
};
use objc2_foundation::{NSArray, NSString, NSURL};
use rustc_hash::FxHashMap;
use serde_json::{Value, json};

use crate::native::{self, NativeWindow};
use crate::{bridge, host, window};

thread_local! {
    static ALERTS: RefCell<FxHashMap<u64, Retained<NSAlert>>> = RefCell::default();
}

fn parent(options: &Value, cx: &mut App) -> Option<Retained<NSWindow>> {
    let handle = window::handle(options["window"].as_u64()? as u32)?;
    let view = handle
        .update(cx, |_, window, _| NativeWindow::of(window))
        .ok()?
        .view()?;
    view.downcast::<NSView>()
        .ok()?
        .window()
        .filter(|window| window.isVisible())
}

fn text(value: &Value) -> Option<Retained<NSString>> {
    value
        .as_str()
        .filter(|it| !it.is_empty())
        .map(NSString::from_str)
}

/// Replies with the chosen paths, or `null`.
pub fn pick_files(reply: u64, options: &Value, cx: &mut App) -> Result<()> {
    let mtm = MainThreadMarker::new().context("this is not the main thread")?;
    let open = (options["save"] != true).then(|| NSOpenPanel::openPanel(mtm));
    let panel = open
        .clone()
        .map_or_else(|| NSSavePanel::savePanel(mtm), Retained::into_super);
    if let Some(open) = &open {
        open.setCanChooseFiles(options["files"] == true);
        open.setCanChooseDirectories(options["directories"] == true);
        open.setAllowsMultipleSelection(options["multiple"] == true);
        open.setResolvesAliases(options["keepsAliases"] != true);
    }
    panel.setCanCreateDirectories(options["createDirectories"] == true);
    panel.setShowsHiddenFiles(options["showsHiddenFiles"] == true);
    panel.setTreatsFilePackagesAsDirectories(options["entersPackages"] == true);
    text(&options["title"]).inspect(|title| panel.setTitle(Some(title)));
    text(&options["message"]).inspect(|message| panel.setMessage(Some(message)));
    text(&options["buttonLabel"]).inspect(|label| panel.setPrompt(Some(label)));
    text(&options["fileName"]).inspect(|name| panel.setNameFieldStringValue(name));
    text(&options["directory"])
        .inspect(|path| panel.setDirectoryURL(Some(&NSURL::fileURLWithPath(path))));
    let filters = options["filters"].as_array().into_iter().flatten();
    let extensions: Vec<_> = filters
        .flat_map(|it| it["extensions"].as_array())
        .flatten()
        .filter_map(text)
        .collect();
    if !extensions.is_empty() && extensions.iter().all(|it| it.to_string() != "*") {
        #[expect(deprecated, reason = "its successor does not know every extension")]
        panel.setAllowedFileTypes(Some(&NSArray::from_retained_slice(&extensions)));
    }
    let (parent, shown) = (parent(options, cx), panel.clone());
    let done = RcBlock::new(move |response: NSModalResponse| {
        let urls = open.as_ref().map_or_else(
            || shown.URL().into_iter().collect(),
            |open| open.URLs().to_vec(),
        );
        let paths: Vec<_> = urls
            .iter()
            .filter_map(|url| Some(url.path()?.to_string()))
            .collect();
        bridge::reply(
            reply,
            Ok(json!((response == NSModalResponseOK).then_some(paths))),
        );
    });
    native::cancel_quit();
    host::run_when_idle(move || match parent {
        Some(parent) => panel.beginSheetModalForWindow_completionHandler(&parent, &done),
        None => panel.beginWithCompletionHandler(&done),
    });
    Ok(())
}

/// Replies with the index of the button, or `null` if it went away, and the state of the checkbox.
pub fn message_box(reply: u64, options: &Value, cx: &mut App) -> Result<()> {
    let alert = NSAlert::new(MainThreadMarker::new().context("this is not the main thread")?);
    alert.setAlertStyle(match options["type"].as_str() {
        Some("warning" | "error") => NSAlertStyle::Critical,
        _ => NSAlertStyle::Informational,
    });
    alert.setMessageText(&text(&options["message"]).unwrap_or_default());
    alert.setInformativeText(&text(&options["detail"]).unwrap_or_default());
    for (index, label) in options["buttons"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let button =
            alert.addButtonWithTitle(&text(label).unwrap_or_else(|| NSString::from_str("(empty)")));
        let key = match index {
            _ if options["defaultId"] == index => "\r",
            _ if options["cancelId"] == index => "\x1b",
            _ => "",
        };
        button.setKeyEquivalent(&NSString::from_str(key));
    }
    if let Some(label) = text(&options["checkboxLabel"]) {
        alert.setShowsSuppressionButton(true);
        if let Some(checkbox) = alert.suppressionButton() {
            checkbox.setTitle(&label);
            checkbox.setState((options["checkboxChecked"] == true).into());
        }
    }
    let (parent, id) = (parent(options, cx), options["id"].as_u64().unwrap_or(0));
    ALERTS.with_borrow_mut(|alerts| alerts.insert(id, alert.clone()));
    let shown = alert.clone();
    let done = move |response: NSModalResponse| {
        ALERTS.with_borrow_mut(|alerts| alerts.remove(&id));
        let is_checked = shown.showsSuppressionButton()
            && shown.suppressionButton().is_some_and(|it| it.state() != 0);
        bridge::reply(
            reply,
            Ok(json!([
                usize::try_from(response - NSAlertFirstButtonReturn).ok(),
                is_checked
            ])),
        );
    };
    native::cancel_quit();
    host::run_when_idle(move || match parent {
        _ if !ALERTS.with_borrow(|alerts| alerts.contains_key(&id)) => done(NSModalResponseAbort),
        Some(parent) => {
            alert.beginSheetModalForWindow_completionHandler(&parent, Some(&RcBlock::new(done)))
        }
        None => done(alert.runModal()),
    });
    Ok(())
}

pub fn close_message_box(id: &Value) {
    let Some(alert) = ALERTS.with_borrow_mut(|alerts| alerts.remove(&id.as_u64()?)) else {
        return;
    };
    let window = alert.window();
    match window.sheetParent() {
        Some(parent) => parent.endSheet_returnCode(&window, NSModalResponseAbort),
        None if window.isVisible() => {
            NSApplication::sharedApplication(alert.mtm()).stopModalWithCode(NSModalResponseAbort);
            host::post_empty_event();
        }
        None => {}
    }
}
