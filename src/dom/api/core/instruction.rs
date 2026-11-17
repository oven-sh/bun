//! The pseudo-attributes of processing instructions.

use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use bun_jsc::{JSString, JSValue};
use bun_markup::names::pseudo_attributes;

use super::*;
use crate::generated_bindgen::core::ProcessingInstruction;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Str<'a> = JsLocal<'a, JSString>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

fn valid_name<'a>(heap: &JsHeap<'a>, name: Str<'a>) -> Result<'a, DomString> {
    let name = Atom::from_js_string(heap, name)?;
    validate_attribute_name(heap, &name).map(|()| name.to_dom_string())
}

impl ProcessingInstruction {
    pub(crate) fn pseudo_attributes(&self) -> Vec<(DomString, DomString)> {
        self.with_inert(|it| {
            pseudo_attributes(it.data.chars())
                .iter()
                .map(|it| {
                    (
                        DomString::from_chars(it.0),
                        DomString::from_chars(it.1.chars()),
                    )
                })
                .collect()
        })
    }

    pub(crate) fn pseudo_attribute(&self, name: &DomString) -> Option<DomString> {
        self.pseudo_attributes()
            .into_iter()
            .find(|it| it.0 == *name)
            .map(|it| it.1)
    }

    fn change<'a>(&'a self, cx: Cx<'_, 'a>, name: DomString, value: Option<DomString>) {
        let mut all = self.pseudo_attributes();
        match (all.iter().position(|it| it.0 == name), value) {
            (Some(index), Some(value)) => all[index].1 = value,
            (Some(index), None) => _ = all.remove(index),
            (None, Some(value)) => all.push((name, value)),
            (None, None) => return,
        }
        let mut data = StringBuilder::default();
        for (name, value) in &all {
            data.push_str(if data.is_empty() { "" } else { " " });
            data.push(name);
            data.push_str("=\"");
            for unit in value.units() {
                match u8::try_from(unit) {
                    Ok(b'&') => data.push_str("&amp;"),
                    Ok(b'<') => data.push_str("&lt;"),
                    Ok(b'>') => data.push_str("&gt;"),
                    Ok(b'"') => data.push_str("&quot;"),
                    _ => data.push_unit(unit),
                }
            }
            data.push_str("\"");
        }
        self.replace_all_data(cx, &data.finish());
    }

    pub(crate) fn has_attributes(&self) -> bool {
        !self.pseudo_attributes().is_empty()
    }

    pub(crate) fn get_attribute_names<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        let all = self.pseudo_attributes();
        List::from_fn(heap, all.len() as u32, |it| {
            all[it as usize].0.to_js(heap).to_js()
        })
        .to_js()
    }

    pub(crate) fn get_attribute<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: Str<'a>,
    ) -> Result<'a, Option<Str<'a>>> {
        Ok(self
            .pseudo_attribute(&DomString::from_js_string(heap, name)?)
            .map(|it| it.to_js(heap)))
    }

    pub(crate) fn has_attribute<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: Str<'a>,
    ) -> Result<'a, bool> {
        Ok(self
            .pseudo_attribute(&DomString::from_js_string(heap, name)?)
            .is_some())
    }

    pub(crate) fn set_attribute<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Str<'a>,
        value: Str<'a>,
    ) -> Result<'a> {
        let (name, value) = (
            valid_name(&cx.heap, name)?,
            DomString::from_js_string(&cx.heap, value)?,
        );
        self.change(cx, name, Some(value));
        Ok(())
    }

    pub(crate) fn remove_attribute<'a>(&'a self, cx: Cx<'_, 'a>, name: Str<'a>) -> Result<'a> {
        let name = DomString::from_js_string(&cx.heap, name)?;
        self.change(cx, name, None);
        Ok(())
    }

    pub(crate) fn toggle_attribute<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Str<'a>,
        force: Option<bool>,
    ) -> Result<'a, bool> {
        let name = valid_name(&cx.heap, name)?;
        let has = self.pseudo_attribute(&name).is_some();
        let wants = force.unwrap_or(!has);
        if wants != has {
            self.change(cx, name, wants.then(DomString::default));
        }
        Ok(wants)
    }
}
