use std::path::PathBuf;

use anyhow::Result;
use gpui::{App, PromptButton, PromptLevel, Window};
use rfd::{AsyncFileDialog, FileHandle};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{bridge, window};

#[derive(Deserialize)]
struct Filter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileOptions {
    window: Option<u32>,
    title: Option<String>,
    directory: Option<PathBuf>,
    file_name: Option<String>,
    filters: Vec<Filter>,
    save: bool,
    directories: bool,
    multiple: bool,
    create_directories: bool,
}

fn paths(handles: Option<Vec<FileHandle>>) -> Value {
    json!(handles.map(|handles| {
        let paths = handles.iter().map(|handle| handle.path().to_owned());
        paths.collect::<Vec<_>>()
    }))
}

/// Replies with the chosen paths, or `null`.
pub fn pick_files(reply: u64, options: &Value, cx: &mut App) -> Result<()> {
    let options = FileOptions::deserialize(options)?;
    let mut dialog = AsyncFileDialog::new().set_can_create_directories(options.create_directories);
    if let Some(title) = &options.title {
        dialog = dialog.set_title(title);
    }
    if let Some(directory) = &options.directory {
        dialog = dialog.set_directory(directory);
    }
    if let Some(name) = &options.file_name {
        dialog = dialog.set_file_name(name);
    }
    for filter in &options.filters {
        dialog = dialog.add_filter(&filter.name, &filter.extensions);
    }
    if let Some(parent) = options.window {
        let parented = dialog.clone();
        let parented = window::update(parent, cx, |window: &mut Window, _| {
            parented.set_parent(&*window)
        })?;
        dialog = parented.unwrap_or(dialog);
    }
    cx.foreground_executor()
        .spawn(async move {
            let one = |handle: Option<FileHandle>| handle.map(|handle| vec![handle]);
            let chosen = match (options.directories, options.multiple) {
                _ if options.save => one(dialog.save_file().await),
                (true, true) => dialog.pick_folders().await,
                (true, false) => one(dialog.pick_folder().await),
                (false, true) => dialog.pick_files().await,
                (false, false) => one(dialog.pick_file().await),
            };
            bridge::reply(reply, Ok(paths(chosen)));
        })
        .detach();
    Ok(())
}

/// Replies with the index of the button, or `null` if the window went away, and the state of a checkbox that there is not.
pub fn message_box(reply: u64, options: &Value, cx: &mut App) -> Result<()> {
    let level = match options["type"].as_str() {
        Some("warning") => PromptLevel::Warning,
        Some("error") => PromptLevel::Critical,
        _ => PromptLevel::Info,
    };
    let labels = options["buttons"].as_array().into_iter().flatten();
    let buttons: Vec<PromptButton> = labels
        .enumerate()
        .map(|(index, label)| {
            let label = label.as_str().unwrap_or("").to_owned();
            if options["cancelId"] == index {
                PromptButton::cancel(label)
            } else if options["defaultId"] == index {
                PromptButton::ok(label)
            } else {
                PromptButton::new(label)
            }
        })
        .collect();
    let parent = options["window"].as_u64().unwrap_or(0) as u32;
    let answer = window::update(parent, cx, |window, cx| {
        let message = options["message"].as_str().unwrap_or("");
        window.prompt(level, message, options["detail"].as_str(), &buttons, cx)
    })?;
    cx.foreground_executor()
        .spawn(async move {
            let answer = match answer {
                Some(answer) => answer.await.ok(),
                None => None,
            };
            bridge::reply(reply, Ok(json!([answer, false])));
        })
        .detach();
    Ok(())
}
