//! Who gets the input of a surface.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::{JSGlobalObject, JSValue, JsResult, Strong};

use crate::protocol::{Command, Input, Key};

#[derive(Clone)]
enum Listener {
    Native(fn(Input) -> JsResult<()>),
    Closure(Rc<dyn Fn(News) -> JsResult<()>>),
}

pub enum News {
    Input(Input),
    AccessibilityChanged,
}

impl Listener {
    fn tell(&self, input: Input) -> JsResult<()> {
        match self {
            Listener::Native(function) => function(input),
            Listener::Closure(function) => function(News::Input(input)),
        }
    }
}

/// What is shown as an image has an accessibility tree of its own, from this id on.
const FIRST_IMAGE: u32 = 1 << 31;

/// Returns whether it took the input.
type Filter = fn(u32, &Input) -> JsResult<bool>;

type OnFrame = fn(&JSGlobalObject, JSValue);

#[derive(Default)]
struct Surfaces {
    last_id: Cell<u32>,
    listeners: RefCell<Vec<(u32, Listener)>>,
    /// They get the frames instead of the listener.
    pages: RefCell<Vec<(u32, Strong, OnFrame)>>,
    /// While a menu is open, it gets the keys.
    keys: Cell<Option<fn(&Key) -> JsResult<()>>>,
    early: Cell<Option<Filter>>,
    is_accessibility_active: Cell<bool>,
    has_screen_reader: Cell<bool>,
}

crate::state!(fn surfaces() -> Surfaces);

pub fn next_id() -> u32 {
    surfaces().last_id.update(|it| it + 1);
    surfaces().last_id.get()
}

fn add(id: u32, listener: Listener) {
    ignore(id);
    surfaces().listeners.borrow_mut().push((id, listener));
}

pub fn listen(id: u32, function: fn(Input) -> JsResult<()>) {
    add(id, Listener::Native(function));
}

pub fn listen_with(id: u32, function: impl Fn(News) -> JsResult<()> + 'static) {
    add(id, Listener::Closure(Rc::new(function)));
}

pub fn send_frames_to(global: &JSGlobalObject, id: u32, page: JSValue, function: OnFrame) {
    let mut pages = surfaces().pages.borrow_mut();
    pages.retain(|it| it.0 != id && it.1.get() != page);
    pages.push((id, Strong::create(page, global), function));
}

pub fn send_no_frames_to(page: JSValue) {
    surfaces()
        .pages
        .borrow_mut()
        .retain(|it| it.1.get() != page);
}

pub(crate) fn forget_page(id: u32) {
    surfaces().pages.borrow_mut().retain(|it| it.0 != id);
}

pub fn ignore(id: u32) {
    surfaces().listeners.borrow_mut().retain(|it| it.0 != id);
}

pub fn tree_of_image(image: u32) -> u32 {
    FIRST_IMAGE + image
}

pub fn ids() -> Vec<u32> {
    surfaces()
        .listeners
        .borrow()
        .iter()
        .map(|it| it.0)
        .filter(|it| *it < FIRST_IMAGE)
        .collect()
}

pub fn trap_keys(trap: Option<fn(&Key) -> JsResult<()>>) {
    surfaces().keys.set(trap);
}

/// It sees keys, text and the mouse first.
pub fn filter(filter: Option<Filter>) {
    surfaces().early.set(filter);
}

pub fn is_filtered() -> bool {
    surfaces().early.get().is_some()
}

pub fn is_accessibility_active() -> bool {
    surfaces().is_accessibility_active.get()
}

pub fn has_screen_reader() -> bool {
    surfaces().has_screen_reader.get()
}

pub fn accessibility_changed(is_active: bool, has_screen_reader: bool) -> JsResult<()> {
    surfaces().is_accessibility_active.set(is_active);
    surfaces().has_screen_reader.set(has_screen_reader);
    let listeners = surfaces().listeners.borrow().clone();
    for (_, listener) in listeners {
        match listener {
            Listener::Native(_) => {}
            Listener::Closure(function) => function(News::AccessibilityChanged)?,
        }
    }
    Ok(())
}

/// Past the trap and the filter.
pub fn send(id: u32, input: Input) -> JsResult<()> {
    let listener =
        (surfaces().listeners.borrow().iter()).find_map(|it| (it.0 == id).then(|| it.1.clone()));
    listener.map_or(Ok(()), |it| it.tell(input))
}

pub(crate) fn deliver(global: &JSGlobalObject, id: u32, input: Input) -> JsResult<()> {
    if let Input::Frame { .. } = input {
        let page = (surfaces().pages.borrow().iter())
            .find_map(|it| (it.0 == id).then(|| (it.1.get(), it.2)));
        if let Some((page, function)) = page {
            function(global, page);
            return Ok(());
        }
    }
    if let Input::Key(_) | Input::Text { .. } | Input::Mouse(_) = input {
        match (surfaces().keys.get(), &input) {
            (Some(_), Input::Text { .. }) => return Ok(()),
            (Some(trap), Input::Key(key)) => {
                crate::tell(global, Command::KeyWasHandled)?;
                return trap(key);
            }
            _ => {}
        }
        if let Some(filter) = surfaces().early.get()
            && filter(id, &input)?
        {
            return Ok(());
        }
    }
    send(id, input)
}
