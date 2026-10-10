#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/linkComponents.js` of eslint-plugin-react.

use bun_lint::prelude::*;
use smallvec::{SmallVec, smallvec};

/// The names of the attributes of a component that have a URL.
type Attributes<'a> = SmallVec<[&'a [u8]; 2]>;

/// What `getFormComponents` and `getLinkComponents` differ in.
struct Components {
    /// The key in the settings.
    setting: &'static [u8],
    default_component: &'static [u8],
    /// The key in an element of the setting.
    attribute: &'static [u8],
    default_attribute: &'static [u8],
}

const FORM_COMPONENTS: Components = Components {
    setting: b"formComponents",
    default_component: b"form",
    attribute: b"formAttribute",
    default_attribute: b"action",
};

const LINK_COMPONENTS: Components = Components {
    setting: b"linkComponents",
    default_component: b"a",
    attribute: b"linkAttribute",
    default_attribute: b"href",
};

/// `[].concat(value)`, of which only strings can be the name of an attribute.
fn concat(value: Option<&Json>) -> Attributes<'_> {
    match value {
        Some(Json::Array(all)) => all.iter().filter_map(Json::as_str).collect(),
        Some(Json::String(one)) => smallvec![one.as_slice()],
        _ => SmallVec::new(),
    }
}

impl Components {
    /// `settings[..] || []`, as `concat` adds it to the default: what is no array is one element.
    fn of_settings<'a>(&self, file: &'a File<'a>) -> &'a [Json] {
        match file.settings().get(self.setting) {
            Some(Json::Array(all)) => all.as_slice(),
            Some(Json::String(falsy)) if falsy.is_empty() => &[],
            Some(one) => std::slice::from_ref(one),
            None => &[],
        }
    }

    fn default_attributes<'a>(&self) -> Attributes<'a> {
        smallvec![self.default_attribute]
    }

    /// `new Map(..).get(name)`: of two entries with one name the map has the later.
    fn get<'a>(&self, file: &'a File<'a>, name: &[u8]) -> Option<Attributes<'a>> {
        let of_settings = self.of_settings(file).iter().rev().find_map(|value| {
            if let Some(value) = value.as_str() {
                return (value == name).then(|| self.default_attributes());
            }
            (value.get(b"name")?.as_str()? == name).then(|| concat(value.get(self.attribute)))
        });
        let is_default = name == self.default_component;
        of_settings.or_else(|| is_default.then(|| self.default_attributes()))
    }
}

/// `getFormComponents(context).get(name)`
pub(crate) fn get_form_component<'a>(
    file: &'a File<'a>,
    name: &[u8],
) -> Option<SmallVec<[&'a [u8]; 2]>> {
    FORM_COMPONENTS.get(file, name)
}

/// `getLinkComponents(context).get(name)`
pub(crate) fn get_link_component<'a>(
    file: &'a File<'a>,
    name: &[u8],
) -> Option<SmallVec<[&'a [u8]; 2]>> {
    LINK_COMPONENTS.get(file, name)
}
