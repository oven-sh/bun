//! `lib/util/linkComponents.js` of eslint-plugin-react.

use bun_lint::prelude::*;
use smallvec::{SmallVec, smallvec};

/// Names of a component's attributes that hold a URL.
type Attributes<'a> = SmallVec<[&'a [u8]; 2]>;

/// The parts where `getFormComponents` and `getLinkComponents` differ.
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

/// `[].concat(value)`. Only strings are kept, because nothing else can be an attribute name.
fn concat(value: Option<&Json>) -> Attributes<'_> {
    match value {
        Some(Json::Array(all)) => all.iter().filter_map(Json::as_str).collect(),
        Some(Json::String(one)) => smallvec![one.as_slice()],
        _ => SmallVec::new(),
    }
}

impl Components {
    /// `settings[..] || []`, the way `concat` appends it to the default: a non-array value becomes one element.
    fn from_settings<'a>(&self, file: &'a File<'a>) -> &'a [Json] {
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

    /// `new Map(..).get(name)`. If two entries have the same name, the later one wins.
    fn get<'a>(&self, file: &'a File<'a>, name: &[u8]) -> Option<Attributes<'a>> {
        let from_settings = self.from_settings(file).iter().rev().find_map(|value| {
            if let Some(value) = value.as_str() {
                return (value == name).then(|| self.default_attributes());
            }
            (value.get(b"name")?.as_str()? == name).then(|| concat(value.get(self.attribute)))
        });
        let is_default = name == self.default_component;
        from_settings.or_else(|| is_default.then(|| self.default_attributes()))
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
