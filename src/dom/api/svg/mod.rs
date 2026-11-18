//! The SVG DOM.

mod animated;
mod animation;
mod elements;
mod lists;
pub(crate) mod syntax;
mod values;

pub(crate) use animated::Animated;
pub(crate) use animation::ANIMATION_STEPS;
pub(crate) use lists::ValueList;
pub(crate) use values::{Field, Value};

use crate::api::core::{DomString, Element, Ns, atom};

pub(crate) fn href(element: &Element) -> Option<DomString> {
    element
        .attr(atom!("href"))
        .or_else(|| element.attr_ns(&Ns::XLink, &atom!("href").into()))
}
