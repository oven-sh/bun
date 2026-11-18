//! Shortcuts, jump lists, and the button of a window in the taskbar.

use super::pixels::Icon;
use super::shell::{item, with_taskbar};
use super::window::Window;
use crate::abi::Rect;
use crate::error::Result;
use crate::protocol::{self, Preference, PreferenceValue as Value, ThumbnailButton};
use crate::win32::com::{
    self, Guid, Interface as _, Outcome, Status, Unknown, Variant, filled, made,
};
use crate::win32::*;

const OF_APP: Guid = Guid::new(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3);
const RELAUNCH_COMMAND: PropertyKey = PropertyKey(OF_APP, 2);
const RELAUNCH_ICON: PropertyKey = PropertyKey(OF_APP, 3);
const RELAUNCH_NAME: PropertyKey = PropertyKey(OF_APP, 4);
const APP_ID: PropertyKey = PropertyKey(OF_APP, 5);
const IS_SEPARATOR: PropertyKey = PropertyKey(OF_APP, 6);
const TOAST_ACTIVATOR: PropertyKey = PropertyKey(OF_APP, 26);
const TITLE: PropertyKey = PropertyKey(Guid::new(0xf29f85e0_4ff9_1068_ab91_08002b27b3d9), 2);

fn get<'a>(from: &'a Value, key: &str) -> Option<&'a Value> {
    let Value::Dictionary(all) = from else {
        return None;
    };
    all.iter().find(|it| &*it.key == key).map(|it| &it.value)
}

fn text<'a>(from: &'a Value, key: &str) -> Option<&'a str> {
    if let Value::Text(it) = get(from, key)? {
        Some(it)
    } else {
        None
    }
}

fn number(from: &Value, key: &str) -> i32 {
    if let Some(Value::Number(it)) = get(from, key) {
        *it as i32
    } else {
        0
    }
}

fn items(from: Option<&Value>) -> &[Value] {
    if let Some(Value::Array(it)) = from {
        it
    } else {
        &[]
    }
}

pub fn dictionary<const N: usize>(all: [(&str, Value); N]) -> Value {
    Value::Dictionary(
        all.into_iter()
            .map(|(key, value)| Preference {
                key: key.into(),
                value,
            })
            .collect(),
    )
}

fn read(ask: impl FnOnce(Raw<u16>, i32) -> Status) -> Value {
    let mut buffer = vec![0; 2084];
    // SAFETY: the buffer with its length.
    _ = ask(
        unsafe { Raw::new(buffer.as_mut_ptr()) },
        buffer.len() as i32,
    );
    Value::Text(string_in(&buffer).into())
}

fn property(of: &IPropertyStore, key: &PropertyKey) -> Value {
    Value::Text(
        filled(|it| of.get_value(key, it))
            .map(|it: Variant| it.describe())
            .unwrap_or_default()
            .into(),
    )
}

/// `keys` are what the program, its arguments and its working directory are called.
fn fill(link: &IShellLinkW, from: &Value, keys: [&str; 5]) -> Outcome {
    let setters = [
        IShellLinkW::set_path,
        IShellLinkW::set_arguments,
        IShellLinkW::set_working_directory,
        IShellLinkW::set_description,
    ];
    for (set, value) in setters
        .into_iter()
        .zip(keys)
        .filter_map(|(set, key)| Some((set, text(from, key)?)))
    {
        set(link, Wide::new(value).str()).ok()?;
    }
    text(from, keys[4]).map_or(Ok(()), |it| {
        link.set_icon_location(Wide::new(it).str(), number(from, "iconIndex"))
            .ok()
    })
}

pub fn read_shortcut(path: &str) -> Result<Value> {
    let link: IShellLinkW = com::create(CLSID_SHELL_LINK)?;
    link.cast::<IPersistFile>()?
        .load(Wide::new(path).str(), 0)
        .ok()?;
    let (properties, mut index) = (link.cast()?, 0);
    Ok(dictionary([
        (
            "target",
            read(|to, size| link.get_path(to, size, 0, SLGP_UNCPRIORITY)),
        ),
        ("cwd", read(|to, size| link.get_working_directory(to, size))),
        ("args", read(|to, size| link.get_arguments(to, size))),
        (
            "description",
            read(|to, size| link.get_description(to, size)),
        ),
        (
            "icon",
            read(|to, size| link.get_icon_location(to, size, &mut index)),
        ),
        ("iconIndex", Value::Number(index.into())),
        ("appUserModelId", property(&properties, &APP_ID)),
        (
            "toastActivatorClsid",
            property(&properties, &TOAST_ACTIVATOR),
        ),
    ]))
}

pub fn write_shortcut(path: &str, operation: &str, details: &Value) -> Outcome {
    let (link, file): (IShellLinkW, _) = (com::create(CLSID_SHELL_LINK)?, Wide::new(path));
    let storage: IPersistFile = link.cast()?;
    if operation != "update" && text(details, "target").is_none() {
        return Err(Status::INVALID_ARGUMENT);
    }
    if operation != "create" {
        let old: IShellLinkW = if operation == "update" {
            link.clone()
        } else {
            com::create(CLSID_SHELL_LINK)?
        };
        old.cast::<IPersistFile>()?
            .load(file.str(), STGM_READWRITE)
            .ok()?;
        if let Value::Text(arguments) = read(|to, size| old.get_arguments(to, size)) {
            link.set_arguments(Wide::new(&*arguments).str()).ok()?;
        }
    }
    fill(
        &link,
        details,
        ["target", "args", "cwd", "description", "icon"],
    )?;
    let properties: IPropertyStore = link.cast()?;
    if let Some(id) = text(details, "appUserModelId") {
        properties.set_value(&APP_ID, &Variant::of_text(id)).ok()?;
    }
    if let Some(class) = text(details, "toastActivatorClsid") {
        properties
            .set_value(
                &TOAST_ACTIVATOR,
                &Variant::of_class(Guid::parse(class).ok_or(Status::INVALID_ARGUMENT)?),
            )
            .ok()?;
    }
    properties.commit().ok()?;
    storage.save(file.str(), 1).ok()?;
    // SAFETY: a string, as the second argument says.
    unsafe {
        SHChangeNotify(
            if operation == "create" {
                SHCNE_CREATE
            } else {
                SHCNE_ASSOCCHANGED
            },
            SHCNF_PATHW,
            file.as_ptr().cast(),
            std::ptr::null(),
        )
    };
    Ok(())
}

fn objects_in(array: &IObjectArray) -> impl Iterator<Item = Unknown> {
    (0..filled(|it| array.get_count(it)).unwrap_or(0))
        .filter_map(|index| made(|it| array.get_at(index, &Unknown::ID, it)).ok())
}

fn path_of(object: &Unknown) -> Option<Value> {
    Some(Value::Text(
        made(|it| {
            object
                .cast::<IShellItem>()
                .map_or_else(|it| it, |item| item.get_display_name(SIGDN_FILESYSPATH, it))
        })
        .ok()?
        .text()
        .into(),
    ))
}

fn describe(object: Unknown) -> Option<Value> {
    if let Some(path) = path_of(&object) {
        return Some(dictionary([
            ("type", Value::Text("file".into())),
            ("path", path),
        ]));
    }
    let (link, mut index): (IShellLinkW, _) = (object.cast().ok()?, 0);
    Some(dictionary([
        ("type", Value::Text("task".into())),
        ("program", read(|to, size| link.get_path(to, size, 0, 0))),
        ("args", read(|to, size| link.get_arguments(to, size))),
        ("title", property(&link.cast().ok()?, &TITLE)),
        (
            "iconPath",
            read(|to, size| link.get_icon_location(to, size, &mut index)),
        ),
        ("iconIndex", Value::Number(index.into())),
        (
            "description",
            read(|to, size| link.get_description(to, size)),
        ),
        (
            "workingDirectory",
            read(|to, size| link.get_working_directory(to, size)),
        ),
    ]))
}

/// And how many items there is room for, and those that the user has removed.
fn begin_list(app: &str) -> Outcome<(ICustomDestinationList, u32, Unknown)> {
    let (list, mut room): (ICustomDestinationList, _) = (com::create(CLSID_DESTINATION_LIST)?, 0);
    list.set_app_id(Wide::new(app).str()).ok()?;
    let removed = made(|it| list.begin_list(&mut room, &IObjectArray::ID, it))?;
    Ok((list, room, removed))
}

pub fn jump_list_settings(app: &str) -> Value {
    let (room, removed) = match begin_list(app)
        .and_then(|(list, room, removed)| Ok((list.abort_list(), room, removed.cast()?)))
    {
        Ok((_, room, removed)) => (room, objects_in(&removed).filter_map(describe).collect()),
        Err(_) => (10, Default::default()),
    };
    dictionary([
        ("minItems", Value::Number(room.into())),
        ("removedItems", Value::Array(removed)),
    ])
}

fn entry(from: &Value) -> Outcome<Unknown> {
    const LONGEST_DESCRIPTION: usize = 260;
    let kind = text(from, "type").unwrap_or("task");
    if kind == "file" {
        return item(text(from, "path").ok_or(Status::INVALID_ARGUMENT)?);
    }
    let link: IShellLinkW = com::create(CLSID_SHELL_LINK)?;
    let properties: IPropertyStore = link.cast()?;
    match (kind, text(from, "title")) {
        ("separator", _) => properties.set_value(&IS_SEPARATOR, &true.into()).ok()?,
        ("task", Some(title))
            if text(from, "description")
                .is_none_or(|it| it.encode_utf16().count() <= LONGEST_DESCRIPTION) =>
        {
            fill(
                &link,
                from,
                [
                    "program",
                    if get(from, "args").is_some() {
                        "args"
                    } else {
                        "arguments"
                    },
                    "workingDirectory",
                    "description",
                    "iconPath",
                ],
            )?;
            properties
                .set_value(&TITLE, &Variant::of_text(title))
                .ok()?;
        }
        _ => return Err(Status::INVALID_ARGUMENT),
    }
    properties.commit().ok()?;
    link.cast()
}

fn append(list: &ICustomDestinationList, category: &Value) -> Outcome<&'static str> {
    const NOT_REGISTERED: Status = Status(0x8004_0F03_u32 as i32);
    const ACCESS_DENIED: Status = Status(0x8007_0005_u32 as i32);
    let kind = text(category, "type").unwrap_or(if text(category, "name").is_some() {
        "custom"
    } else {
        "tasks"
    });
    match kind {
        "frequent" => return list.append_known_category(KDC_FREQUENT).ok().map(|()| "ok"),
        "recent" => return list.append_known_category(KDC_RECENT).ok().map(|()| "ok"),
        _ => {}
    }
    let (collection, mut result, mut is_empty): (IObjectCollection, _, _) =
        (com::create(CLSID_ENUMERABLE_OBJECT_COLLECTION)?, "ok", true);
    for it in items(get(category, "items")) {
        match entry(it) {
            _ if kind != "tasks" && text(it, "type") == Some("separator") => {
                result = "invalidSeparatorError"
            }
            Ok(it) => is_empty &= collection.add_object(it.borrowed()).ok().is_err(),
            Err(_) => result = if result == "ok" { "error" } else { result },
        }
    }
    if is_empty {
        return Ok(result);
    }
    let array: IObjectArray = collection.cast()?;
    let status = match kind {
        "tasks" => list.add_user_tasks(array.borrowed()),
        _ => list.append_category(
            Wide::new(text(category, "name").unwrap_or_default()).str(),
            array.borrowed(),
        ),
    };
    match status {
        NOT_REGISTERED => Ok("fileTypeRegistrationError"),
        ACCESS_DENIED => Ok("customCategoryAccessDeniedError"),
        status => status.ok().map(|()| result),
    }
}

pub fn set_jump_list(app: &str, categories: Option<&Value>) -> Outcome<&'static str> {
    if categories.is_none() {
        return com::create::<ICustomDestinationList>(CLSID_DESTINATION_LIST)?
            .delete_list(Wide::new(app).str())
            .ok()
            .map(|()| "ok");
    }
    let (list, ..) = begin_list(app)?;
    let results: Vec<_> = items(categories)
        .iter()
        .map(|it| append(&list, it).unwrap_or("error"))
        .collect();
    list.commit_list().ok()?;
    let most_telling = results
        .iter()
        .find(|it| !matches!(**it, "ok" | "error"))
        .or_else(|| results.iter().find(|it| **it != "ok"));
    Ok(most_telling.unwrap_or(&"ok"))
}

pub fn recent_documents(app: &str) -> Outcome<Value> {
    let lists: IApplicationDocumentLists = com::create(CLSID_APPLICATION_DOCUMENT_LISTS)?;
    lists.set_app_id(Wide::new(app).str()).ok()?;
    let recent = made(|it| lists.get_list(ADLT_RECENT, 0, &IObjectArray::ID, it))?.cast()?;
    Ok(Value::Array(
        objects_in(&recent).filter_map(|it| path_of(&it)).collect(),
    ))
}

pub fn clear_recent_documents(app: &str) -> Outcome {
    let destinations: IApplicationDestinations = com::create(CLSID_APPLICATION_DESTINATIONS)?;
    destinations.set_app_id(Wide::new(app).str()).ok()?;
    destinations.remove_all_destinations().ok()
}

impl Window {
    fn small_icon(&self, from: &protocol::Icon) -> Option<Icon> {
        Icon::decode(&from.bytes, self.metric(SM_CXSMICON))
    }

    pub fn set_overlay_icon(&self, icon: Option<&protocol::Icon>, description: &str) {
        let icon = icon.and_then(|it| self.small_icon(it));
        _ = with_taskbar(|it| {
            it.set_overlay_icon(
                self.handle,
                icon.as_ref().map_or(0, |it| it.0),
                Wide::new(description).str(),
            )
        });
    }

    /// They cannot be removed, so there are always as many as there can be.
    pub fn set_thumbnail_buttons(&self, wanted: &[ThumbnailButton]) -> Outcome {
        let mut buttons = [ThumbButton::default(); 7];
        let icons: Vec<_> = wanted.iter().map(|it| self.small_icon(&it.icon)).collect();
        for (index, button) in buttons.iter_mut().enumerate() {
            (button.dw_mask, button.i_id, button.dw_flags) = (
                THB_FLAGS | THB_ICON | THB_TOOLTIP,
                index as u32,
                THBF_HIDDEN,
            );
            if let Some(it) = wanted.get(index) {
                (button.dw_flags, button.h_icon) =
                    (it.flags, icons[index].as_ref().map_or(0, |it| it.0));
                copy_into(&mut button.sz_tip, &it.tool_tip);
            }
        }
        match self.has_thumbnail_buttons.get() {
            true => with_taskbar(|it| it.thumb_bar_update_buttons(self.handle, 7, &buttons)),
            false => with_taskbar(|it| it.thumb_bar_add_buttons(self.handle, 7, &buttons))
                .inspect(|()| self.has_thumbnail_buttons.set(true)),
        }
    }

    pub fn set_thumbnail_clip(
        &self,
        Rect {
            x,
            y,
            width,
            height,
        }: Rect,
    ) {
        let [left, top, right, bottom] = [x, y, x + width, y + height].map(|it| it as i32);
        _ = with_taskbar(|it| {
            it.set_thumbnail_clip(
                self.handle,
                (width * height > 0.).then_some(&DeviceRect {
                    left,
                    top,
                    right,
                    bottom,
                }),
            )
        });
    }

    pub fn set_thumbnail_tool_tip(&self, text: &str) {
        _ = with_taskbar(|it| it.set_thumbnail_tooltip(self.handle, Wide::new(text).str()));
    }

    pub fn show_progress(&self, done: f32, mode: &str) {
        let state = match mode {
            _ if done < 0. || mode == "none" => TBPF_NOPROGRESS,
            _ if done > 1. || mode == "indeterminate" => TBPF_INDETERMINATE,
            "error" => TBPF_ERROR,
            "paused" => TBPF_PAUSED,
            _ => TBPF_NORMAL,
        };
        _ = with_taskbar(|it| it.set_progress_state(self.handle, state));
        if state > TBPF_INDETERMINATE {
            _ = with_taskbar(|it| it.set_progress_value(self.handle, (done * 1000.) as u64, 1000));
        }
    }

    pub fn set_app_details(&self, details: &Value) -> Outcome {
        let properties: IPropertyStore =
            made(|it| SHGetPropertyStoreForWindow(self.handle, &IPropertyStore::ID, it))?.cast()?;
        let icon = text(details, "appIconPath")
            .map(|it| format!("{it},{}", number(details, "appIconIndex")));
        let relaunch = text(details, "relaunchCommand")
            .zip(text(details, "relaunchDisplayName"))
            .unzip();
        for (key, value) in [
            (APP_ID, text(details, "appId")),
            (RELAUNCH_ICON, icon.as_deref()),
            (RELAUNCH_COMMAND, relaunch.0),
            (RELAUNCH_NAME, relaunch.1),
        ] {
            value.filter(|it| !it.is_empty()).map_or(Ok(()), |it| {
                properties.set_value(&key, &Variant::of_text(it)).ok()
            })?;
        }
        properties.commit().ok()
    }
}
