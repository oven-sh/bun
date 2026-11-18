//! https://svgwg.org/svg2-draft/types.html#DOMInterfacesForReflectingSVGAttributes

use bun_jsc::bindgen::{self, JsHeap, JsInterface as _, JsLocal, JsScope};
use bun_jsc::{JSString, JSValue, JsCell};

use super::lists::ValueList;
use super::syntax::{Data, Reflected, Syntax};
use super::values::{Attribute, Owner, Value, element_in};
use crate::api::core::{DomString, Edge, Element, Kind, atom};
use crate::api::graphics::Failure;
use crate::generated_bindgen::svg::*;

/// What is an object for scripts is in the fields `baseVal` and `animVal`, and not here.
pub(crate) struct Animated {
    attributes: [Attribute; 2],
    data: [JsCell<Data>; 2],
}

const BASE: usize = 0;
const ANIMATED: usize = 1;

#[optimize(size)]
fn object(heap: &JsHeap<'_>, element: &Element, attribute: Attribute) -> Option<JSValue> {
    let value: &Value = match attribute.reflected.syntax {
        Syntax::Length(..) => js_SVGLength::create(heap, Value::reflecting(attribute)),
        Syntax::OrientAngle => js_SVGAngle::create(heap, Value::reflecting(attribute)),
        Syntax::ViewBox => js_SVGRect::create(heap, Value::reflecting(attribute)),
        Syntax::Ratio => js_SVGPreserveAspectRatio::create(heap, Value::reflecting(attribute)),
        Syntax::Numbers | Syntax::Lengths(_) | Syntax::Transforms => {
            return Some(ValueList::create(heap, element, attribute).to_js());
        }
        _ => return None,
    };
    value.attach(Owner::Element, element.to_js());
    Some(value.to_js())
}

fn reflection(heap: &JsHeap<'_>, element: &Element, reflected: &'static Reflected) -> JSValue {
    let attribute = |is_animated| Attribute::new(reflected, is_animated);
    let payload = || Animated {
        attributes: [false, true].map(attribute),
        data: [(); 2].map(|()| reflected.syntax.initial().into()),
    };
    let animated: &Animated = match reflected.syntax {
        Syntax::Length(..) => js_SVGAnimatedLength::create(heap, payload()),
        Syntax::Number(_) | Syntax::NumberOrPercentage | Syntax::NumberPair(_) => {
            js_SVGAnimatedNumber::create(heap, payload())
        }
        Syntax::Integer(_) | Syntax::Order => js_SVGAnimatedInteger::create(heap, payload()),
        Syntax::Keyword(..) | Syntax::OrientType => {
            js_SVGAnimatedEnumeration::create(heap, payload())
        }
        Syntax::Text => js_SVGAnimatedString::create(heap, payload()),
        Syntax::Boolean => js_SVGAnimatedBoolean::create(heap, payload()),
        Syntax::OrientAngle => js_SVGAnimatedAngle::create(heap, payload()),
        Syntax::ViewBox => js_SVGAnimatedRect::create(heap, payload()),
        Syntax::Ratio => js_SVGAnimatedPreserveAspectRatio::create(heap, payload()),
        Syntax::Numbers => js_SVGAnimatedNumberList::create(heap, payload()),
        Syntax::Lengths(_) => js_SVGAnimatedLengthList::create(heap, payload()),
        Syntax::Transforms => js_SVGAnimatedTransformList::create(heap, payload()),
        Syntax::Points | Syntax::Tokens | Syntax::Languages => {
            return ValueList::create(heap, element, attribute(reflected.is_animated)).to_js();
        }
    };
    js_SvgAnimated::set_element(animated, element.to_js());
    js_SvgAnimated::set_base_val(
        animated,
        object(heap, element, attribute(false)).unwrap_or_default(),
    );
    js_SvgAnimated::set_anim_val(
        animated,
        object(heap, element, attribute(true)).unwrap_or_default(),
    );
    animated.to_js()
}

impl SvgReflection {
    pub(crate) fn get(&self, heap: &JsHeap<'_>, reflected: &'static Reflected) -> JSValue {
        let (known, key) = (
            self.edge_list(heap, Edge::SvgReflections),
            JSValue::from_ptr_address(core::ptr::from_ref(reflected).addr()),
        );
        if let Some(at) = known.position_of_key(key) {
            return known.get(at + 1);
        }
        let object = reflection(heap, self, reflected);
        known.push(heap, key);
        known.push(heap, object);
        object
    }
}

impl Animated {
    fn element<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Element> {
        element_in(heap, js_SvgAnimated::element(self))
    }

    #[optimize(size)]
    fn read<'a>(&'a self, cx: &mut JsScope<'a>, which: usize) -> &'a Data {
        self.element(&cx.heap)
            .into_iter()
            .for_each(|it| self.attributes[which].refresh(cx, it, &self.data[which]));
        self.data[which].get()
    }

    fn number<'a>(&'a self, cx: &mut JsScope<'a>, which: usize) -> f64 {
        if let Data::Numbers(numbers) = self.read(cx, which) {
            numbers[self.attributes[which].reflected.index]
        } else {
            0.0
        }
    }

    fn text<'a>(&'a self, cx: &mut JsScope<'a>, which: usize) -> DomString {
        if let Data::Text(text) = self.read(cx, which) {
            text.clone()
        } else {
            DomString::default()
        }
    }

    #[optimize(size)]
    fn commit<'a>(&'a self, cx: &mut JsScope<'a>, data: &Data) {
        self.data[BASE].set(data.clone());
        self.element(&cx.heap)
            .into_iter()
            .for_each(|it| self.attributes[BASE].commit(cx, it, data));
    }

    fn set_number<'a>(&'a self, cx: &mut JsScope<'a>, value: f64) {
        if let Data::Numbers(mut numbers) = *self.read(cx, BASE) {
            numbers[self.attributes[BASE].reflected.index] = value;
            self.commit(cx, &Data::Numbers(numbers));
        }
    }
}

macro_rules! numeric {
    ($($Interface:ident: $Type:ty = $from_number:expr;)+) => {$(
        impl $Interface {
            pub(crate) fn get_base_val<'a>(&'a self, cx: &mut JsScope<'a>) -> $Type {
                $from_number(self.number(cx, BASE))
            }

            pub(crate) fn get_anim_val<'a>(&'a self, cx: &mut JsScope<'a>) -> $Type {
                $from_number(self.number(cx, ANIMATED))
            }
        }
    )+};
}

numeric! {
    SVGAnimatedBoolean: bool = |it| it != 0.0;
    SVGAnimatedInteger: i32 = |it| it as i32;
    SVGAnimatedNumber: f32 = |it| it as f32;
    SVGAnimatedEnumeration: u16 = |it| it as u16;
}

impl SVGAnimatedBoolean {
    pub(crate) fn set_base_val<'a>(&'a self, cx: &mut JsScope<'a>, value: bool) {
        self.set_number(cx, value.into());
    }
}

impl SVGAnimatedInteger {
    pub(crate) fn set_base_val<'a>(&'a self, cx: &mut JsScope<'a>, value: i32) {
        self.set_number(cx, value.into());
    }
}

impl SVGAnimatedNumber {
    pub(crate) fn set_base_val<'a>(&'a self, cx: &mut JsScope<'a>, value: f32) {
        self.set_number(cx, value.into());
    }
}

impl SVGAnimatedEnumeration {
    pub(crate) fn set_base_val<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: u16,
    ) -> Result<(), Failure> {
        if !(1..=self.attributes[BASE].reflected.syntax.keywords().len()).contains(&value.into()) {
            return Err(Failure::Type("The enumeration value is invalid."));
        }
        self.set_number(cx, value.into());
        Ok(())
    }
}

impl SVGAnimatedString {
    pub(crate) fn get_base_val<'a>(&'a self, cx: &mut JsScope<'a>) -> JsLocal<'a, JSString> {
        self.text(cx, BASE).to_js(&cx.heap)
    }

    pub(crate) fn set_base_val<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: JsLocal<'a>,
    ) -> bindgen::Result<'a, ()> {
        let script = self.element(&cx.heap).filter(|it| {
            it.kind() == Kind::SvgScript
                && self.attributes[BASE].reflected.attribute == atom!("href")
        });
        let text = match script {
            Some(script) => crate::api::trusted::Trusted::ScriptUrl.string_for(
                cx,
                script,
                value,
                "SVGScriptElement href",
            )?,
            None => DomString::from_js(cx, value)?,
        };
        self.commit(cx, &Data::Text(text));
        Ok(())
    }

    pub(crate) fn get_anim_val<'a>(&'a self, cx: &mut JsScope<'a>) -> JsLocal<'a, JSString> {
        self.text(cx, ANIMATED).to_js(&cx.heap)
    }
}
