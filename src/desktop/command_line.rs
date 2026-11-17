//! `app.commandLine`

use crate::generated_bindgen::app::DesktopCommandLine;
use crate::prelude::*;
use crate::text;

state!(fn switches() -> RefCell<Vec<(String, String)>>);

pub(crate) fn read(arguments: &[String]) {
    for argument in arguments.iter().take_while(|it| *it != "--") {
        let Some(rest) = argument
            .strip_prefix("--")
            .or_else(|| argument.strip_prefix('-'))
        else {
            continue;
        };
        let (name, value) = text::split_once(rest, "=").unwrap_or((rest, ""));
        if !name.is_empty() {
            set(name, value);
        }
    }
}

pub(crate) fn set(name: &str, value: &str) {
    let mut switches = switches().borrow_mut();
    match switches.iter_mut().find(|it| it.0 == name) {
        Some(known) => known.1 = value.into(),
        None => switches.push((name.into(), value.into())),
    }
}

pub(crate) fn switch(name: &str) -> Option<String> {
    (switches().borrow().iter()).find_map(|it| (it.0 == name).then(|| it.1.clone()))
}

/// `None` if it is empty.
pub(crate) fn value(name: &str) -> Option<String> {
    switch(name).filter(|it| !it.is_empty())
}

pub(crate) fn all() -> Vec<(String, String)> {
    switches().borrow().clone()
}

impl DesktopCommandLine {
    pub(crate) fn append_argument() {}

    pub(crate) fn append_switch(name: &[u8], value: &[u8]) {
        set(&string(name), &string(value));
    }

    pub(crate) fn get_switch_value(name: &[u8]) -> String {
        switch(&string(name)).unwrap_or_default()
    }

    pub(crate) fn has_switch(name: &[u8]) -> bool {
        switch(&string(name)).is_some()
    }

    pub(crate) fn remove_switch(name: &[u8]) {
        switches().borrow_mut().retain(|it| it.0.as_bytes() != name);
    }
}
