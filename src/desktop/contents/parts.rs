//! What belongs to a `WebContents`, and what finds one.

use bun_jsc::JSString;

use super::history::{Document, Entry};
use super::page::Page;
use super::{
    Contents, Kind, Methods, NOTHING, Numbers as _, Values, bind, field, focused, nothing, of_app,
    or_undefined, with_id,
};
use crate::generated_bindgen::contents::{
    ElectronWebContentsModule, ElectronWebFrameMainModule, js_ElectronWebFrameMain as frames,
};
use crate::ipc::IpcMain;
use crate::prelude::*;
use crate::webview::remote::Remote;
use crate::{devtools, ports, process};

pub(crate) struct WebFrameMain {
    name: RefCell<String>,
    is_known: Cell<bool>,
}

pub(super) fn visible_url(page: &Page) -> String {
    Some(page.url_in_history())
        .filter(|it| it != "about:blank" || !page.is_initial())
        .unwrap_or_default()
}

/// In the tree of `top`.
pub(super) fn find_frame(
    top: JSValue,
    process: JSValue,
    member: &str,
    value: JSValue,
) -> JsResult<Option<JSValue>> {
    with_elements(get(top, "framesInSubtree")?, |all| {
        for &frame in all {
            if get(frame, "processId")?.is_same_value(process, global())?
                && get(frame, member)?.is_same_value(value, global())?
            {
                return Ok(Some(frame));
            }
        }
        Ok(None)
    })
}

impl WebFrameMain {
    pub(super) fn create(page: &Page, name: String) -> &'static WebFrameMain {
        let frame = frames::create(
            heap(),
            WebFrameMain {
                name: name.into(),
                is_known: false.into(),
            },
        );
        frames::set_page(frame, Some(page));
        frame
    }

    pub(super) fn rename(&self, name: &str) {
        self.name.replace(name.to_owned());
    }

    pub(super) fn swap_pages(&self, other: &WebFrameMain, name: &str) {
        let (own, others) = (self.page(), other.page());
        frames::set_page(self, Some(others));
        frames::set_page(other, Some(own));
        frames::set_ipc(other, frames::ipc(self).unwrap_or(JSValue::UNDEFINED));
        other.name.replace(self.name.replace(name.to_owned()));
    }

    /// False if that has been done.
    pub(super) fn introduce(&self) -> bool {
        !self.is_known.replace(true)
    }

    fn page(&self) -> &Page {
        frames::page(self).expect("it was made with one")
    }

    pub(super) fn with_descendants(&self) -> JsResult<JSValue> {
        let all = array(&[self.to_js()])?;
        with_elements(self.page().frames_if_any()?, |frames| {
            let add = |below: &[JSValue]| below.iter().try_for_each(|it| all.push(global(), *it));
            frames
                .iter()
                .try_for_each(|it| match cast::<Contents>(*it) {
                    Some(it) => with_elements(get(it.page().handle(), "framesInSubtree")?, add),
                    None => {
                        cast(*it).map_or(Ok(()), |it| with_elements(Remote::all_frames(it), add))
                    }
                })
        })?;
        Ok(all)
    }

    pub(crate) fn get_ipc(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        super::lazily(frames::ipc(self), IpcMain::create, |it| {
            frames::set_ipc(self, it)
        })
    }

    pub(crate) fn get_name(&self) -> String {
        self.name.borrow().clone()
    }

    pub(crate) fn get_url(&self) -> String {
        match self.page().contents().crashed_at.borrow().is_some() {
            true => String::new(),
            false => visible_url(self.page()),
        }
    }

    pub(crate) fn get_origin(&self) -> String {
        self.page().origin()
    }

    pub(crate) fn get_parent(&self) -> JSValue {
        self.page().parent().map_or(JSValue::NULL, Page::handle)
    }

    pub(crate) fn get_top(&self) -> JSValue {
        field(
            core::iter::successors(Some(self.page()), |it| it.parent())
                .last()
                .map(Page::handle),
        )
    }

    pub(crate) fn get_frames(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let children = array(&[])?;
        with_elements(self.with_descendants()?, |all| {
            all.iter().try_for_each(|it| {
                if get(*it, "parent")? == self.to_js() {
                    children.push(global(), *it)
                } else {
                    Ok(())
                }
            })
        })?;
        Ok(children)
    }

    pub(crate) fn get_frames_in_subtree(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        self.with_descendants()
    }

    pub(crate) fn get_detached(&self) -> bool {
        self.page().is_disposed()
    }

    pub(crate) fn get_os_process_id(&self) -> u32 {
        process::id()
    }

    pub(crate) fn get_process_id(&self) -> u32 {
        self.page().owner().id
    }

    pub(crate) fn get_routing_id(&self) -> u32 {
        self.page().id
    }

    pub(crate) fn get_frame_token(&self) -> &[u8] {
        self.page().token()
    }

    pub(crate) fn get_frame_tree_node_id(&self) -> u32 {
        self.page().contents().id
    }

    pub(crate) fn get_visibility_state(&self, _: Cx<'_, '_>) -> JsResult<&'static str> {
        Ok(if self.page().contents().is_visible()? {
            "visible"
        } else {
            "hidden"
        })
    }

    pub(crate) fn execute_java_script<'a>(
        &self,
        _: Cx<'a, '_>,
        code: JsLocal<'a>,
        is_by_user: bool,
    ) -> JsResult<JSValue> {
        let code = code.to_js().to_js_string(global())?.to_js();
        Ok(self.page().execute(0, code, is_by_user))
    }

    pub(crate) fn send<'a>(
        &self,
        _: Cx<'a, '_>,
        channel: JsLocal<'a>,
        values: Values<'a, '_>,
    ) -> JsResult<()> {
        if !channel.to_js().is_string() {
            return Err(type_error(format_args!(
                "Missing required channel argument"
            )));
        }
        self.page().send(
            channel.to_js(),
            array(JsLocal::to_js_slice(values))?,
            array(&[])?,
        )
    }

    pub(crate) fn post_message<'a>(
        &self,
        _: Cx<'a, '_>,
        channel: JsLocal<'a, JSString>,
        message: JsLocal<'a>,
        transfer: JsLocal<'a>,
    ) -> JsResult<()> {
        self.page().send(
            channel.to_js(),
            array(&[message.to_js()])?,
            ports::move_all(transfer.to_js())?,
        )
    }

    pub(crate) fn reload(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        if self.page().is_disposed() {
            Ok(false)
        } else {
            self.page()
                .contents()
                .reload_for_app("reload")
                .map(|()| true)
        }
    }

    pub(crate) fn collect_java_script_call_stack(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        resolved("")
    }

    pub(crate) fn print_to_pdf(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        Err(unsupported("printToPDF"))
    }
}

fn index_in(given: &[JSValue]) -> usize {
    argument(given, 0).as_i32() as usize
}

fn restore(it: &'static Contents, given: &[JSValue]) -> JsResult<JSValue> {
    let options = argument(given, 0);
    let entry = |it: &JSValue| {
        Ok(Entry::new(
            text_of(get(*it, "url")?)?,
            text_of(get(*it, "title")?)?,
            Document::None,
        ))
    };
    let entries = with_elements(get(options, "entries")?, |all| {
        all.iter().map(entry).collect::<JsResult<Vec<_>>>()
    })?;
    let index = get(options, "index")?
        .get_number()
        .map_or_else(|| entries.len().wrapping_sub(1), |it| it as i64 as usize);
    let Some(url) = entries.get(index).map(|it| it.url()) else {
        return Err(error(format_args!(
            "Invalid index. Index must be between 0 and the length of entries - 1."
        )));
    };
    let mut history = it.history.borrow_mut();
    (history.entries, history.index) = (entries, index);
    drop(history);
    it.restore(index, &url)
}

fn remove_entry(it: &'static Contents, given: &[JSValue]) -> JsResult<JSValue> {
    let index = index_in(given);
    let entry = it.history.borrow().entries.get(index).cloned();
    let Some(entry) = entry.filter(|_| index != it.history.borrow().index) else {
        return Ok(JSValue::FALSE);
    };
    it.guest()
        .into_iter()
        .for_each(|it| it.remove_entry(&entry));
    let mut history = it.history.borrow_mut();
    history.entries.remove(index);
    history.index -= usize::from(index < history.index);
    Ok(JSValue::TRUE)
}

pub(super) fn all_entries(it: &Contents) -> JsResult<JSValue> {
    let (all, entries) = (array(&[])?, it.history.borrow().entries.clone());
    entries
        .iter()
        .try_for_each(|it| all.push(global(), it.describe()?))
        .map(|()| all)
}

const NAVIGATION_HISTORY: Methods<Contents> = &[
    ("canGoBack", |it, _| js(it.can_go_back())),
    ("canGoForward", |it, _| js(it.can_go_forward())),
    ("canGoToOffset", |it, given| {
        js(it.can_go_to_offset(argument(given, 0).as_i32()))
    }),
    ("clear", |it, _| {
        it.forget_history();
        NOTHING
    }),
    ("getActiveIndex", |it, _| {
        js(it.history.borrow().index as u32)
    }),
    ("getAllEntries", |it, _| all_entries(it)),
    ("getEntryAtIndex", |it, given| {
        let entry = it.history.borrow().entries.get(index_in(given)).cloned();
        entry.map_or(Ok(JSValue::NULL), |it| it.describe())
    }),
    ("goBack", |it, _| nothing(it.go_by(-1))),
    ("goForward", |it, _| nothing(it.go_by(1))),
    ("goToIndex", |it, given| {
        nothing(it.traverse(index_in(given), true))
    }),
    ("goToOffset", |it, given| {
        nothing(it.go_by(argument(given, 0).as_i32()))
    }),
    ("length", |it, _| {
        js(it.history.borrow().entries.len() as u32)
    }),
    ("removeEntryAtIndex", remove_entry),
    ("restore", restore),
];

pub(super) fn navigation_history(contents: &Contents) -> JsResult<JSValue> {
    bind(object!({}), contents, NAVIGATION_HISTORY)
}

fn first_with(wanted: JSValue, value_of: fn(&Contents) -> JsResult<JSValue>) -> JsResult<JSValue> {
    for contents in of_app() {
        if value_of(contents)?.is_same_value(wanted, global())? {
            return Ok(contents.to_js());
        }
    }
    Ok(JSValue::UNDEFINED)
}

pub(super) fn contents_of_frame(frame: JSValue) -> JsResult<JSValue> {
    first_with(get(frame, "top")?, Contents::main_frame)
}

impl ElectronWebContentsModule {
    pub(crate) fn create<'a>(_: Cx<'a, '_>, preferences: JsLocal<'a>) -> JsResult<JSValue> {
        Contents::create(preferences.to_js(), Kind::Remote).map(JsInterface::to_js)
    }

    pub(crate) fn from_id(_: Cx<'_, '_>, id: Option<f64>) -> JsResult<JSValue> {
        let found = id
            .and_then(|it| with_id(it as u32))
            .filter(|it| !matches!(it.kind.get(), Kind::Frame | Kind::Print));
        or_undefined(found.map(JsInterface::to_js))
    }

    pub(crate) fn from_frame<'a>(_: Cx<'a, '_>, frame: JsLocal<'a, JSObject>) -> JsResult<JSValue> {
        contents_of_frame(frame.to_js())
    }

    pub(crate) fn from_dev_tools_target_id<'a>(
        _: Cx<'a, '_>,
        id: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        first_with(id.to_js(), |it| js(&*devtools::target_id_of(it.to_js())))
    }

    pub(crate) fn all(_: Cx<'_, '_>) -> JsResult<JSValue> {
        js(of_app().map(JsInterface::to_js).collect::<Vec<_>>())
    }

    pub(crate) fn focused(_: Cx<'_, '_>) -> JsResult<JSValue> {
        js(focused().map(JsInterface::to_js))
    }
}

fn find_anywhere(
    process: JsLocal<'_>,
    member: &str,
    value: JsLocal<'_>,
) -> JsResult<Option<JSValue>> {
    let find = |it: &Contents| find_frame(it.main_frame()?, process.to_js(), member, value.to_js());
    of_app().find_map(|it| find(it).transpose()).transpose()
}

impl ElectronWebFrameMainModule {
    pub(crate) fn from_id<'a>(
        _: Cx<'a, '_>,
        process: JsLocal<'a>,
        routing_id: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        or_undefined(find_anywhere(process, "routingId", routing_id)?)
    }

    pub(crate) fn from_frame_token<'a>(
        _: Cx<'a, '_>,
        process: JsLocal<'a>,
        token: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        js(find_anywhere(process, "frameToken", token)?)
    }
}
