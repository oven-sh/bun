//! https://svgwg.org/svg2-draft/types.html#DOMInterfacesForBasicDataTypes

use core::cell::Cell;

use bun_jsc::bindgen::{JsHeap, JsInterface as _, JsScope};
use bun_jsc::{DOMExceptionCode, JSValue, JsCell};

use super::elements::{animated_attribute, commit_zoom, resolve_length};
use super::lists::ValueList;
use super::syntax::{
    ALIGNMENTS, Angle, Axis, Data, Function, Length, Reflected, Transform, rotation, skew,
};
use crate::api::core::{Atom, DomString, Element, Node, Ns, atom};
use crate::api::graphics::{Affine, Failure};
use crate::calc::Unit;
use crate::generated_bindgen::geometry::DOMMatrix2DInit;
use crate::generated_bindgen::svg::{
    SVGAngle, SVGLength, SVGMatrix, SVGPoint, SVGPreserveAspectRatio, SVGRect, SVGTransform,
    SvgDouble, SvgFloat, js_SVGMatrix, js_SVGPoint, js_SVGRect, js_SVGTransform, js_SvgValue,
};
use crate::values::{Out, text};

/// The base value or the animated value of an attribute.
pub(super) struct Attribute {
    pub(super) reflected: &'static Reflected,
    pub(super) is_animated: bool,
    /// What was parsed or written last.
    known: JsCell<Option<Option<DomString>>>,
}

impl Attribute {
    pub(super) fn new(reflected: &'static Reflected, is_animated: bool) -> Attribute {
        Attribute {
            reflected,
            is_animated,
            known: JsCell::new(None),
        }
    }

    #[optimize(size)]
    fn base(&self, element: &Element) -> Option<DomString> {
        let name = self.reflected.attribute;
        element.attr(name).or_else(|| {
            element.attr_ns(
                &Ns::XLink,
                &(name == atom!("href")).then(|| Atom::from(name))?,
            )
        })
    }

    /// The text, unless it is known.
    pub(super) fn take_change<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        element: &'a Element,
    ) -> Option<Option<DomString>> {
        let animated = if self.is_animated {
            animated_attribute(cx, element, self.reflected.attribute)
        } else {
            None
        };
        let text = Some(animated.or_else(|| self.base(element)));
        (text != *self.known.get()).then(|| self.known.set(text.clone()))?;
        text
    }

    #[optimize(size)]
    pub(super) fn refresh<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        element: &'a Element,
        data: &JsCell<Data>,
    ) {
        if let Some(text) = self.take_change(cx, element) {
            let syntax = self.reflected.syntax;
            data.set(
                text.and_then(|it| syntax.parse(&it))
                    .unwrap_or_else(|| syntax.initial()),
            );
        }
    }

    #[optimize(size)]
    pub(super) fn write<'a>(&'a self, cx: &mut JsScope<'a>, element: &'a Element, text: DomString) {
        let name = self.reflected.attribute;
        self.known.set(Some(Some(text.clone())));
        let is_legacy = name == atom!("href") && !element.has_attr(name);
        match is_legacy
            .then(|| element.attr_name_ns(&Ns::XLink, &name.into()))
            .flatten()
        {
            Some(legacy) => element.set_attr_ns(cx, legacy, text),
            None => element.set_attr(cx, name, text),
        }
    }

    #[optimize(size)]
    pub(super) fn commit<'a>(&'a self, cx: &mut JsScope<'a>, element: &'a Element, data: &Data) {
        self.write(
            cx,
            element,
            self.reflected.syntax.serialize(data, self.base(element)),
        );
    }
}

/// What the field `owner` is.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Owner {
    None,
    Element,
    List,
    /// It has the data.
    Transform,
    ZoomedElement,
}

pub(crate) struct Value {
    pub(super) data: JsCell<Data>,
    pub(super) owner: Cell<Owner>,
    attribute: Option<Attribute>,
}

pub(super) const READ_ONLY: Failure = Failure::Dom(
    DOMExceptionCode::NoModificationAllowedError,
    "The attribute is read-only.",
);
const INVALID: Failure = Failure::Dom(
    DOMExceptionCode::SyntaxError,
    "The value provided is invalid.",
);
const UNKNOWN_UNIT: Failure = Failure::Dom(
    DOMExceptionCode::NotSupportedError,
    "Unknown or invalid units.",
);

pub(super) fn element_in<'a>(heap: &JsHeap<'a>, value: Option<JSValue>) -> Option<&'a Element> {
    Node::from_js(heap, value?)?.as_element()
}

impl Value {
    pub(super) fn detached(data: Data) -> Value {
        Value {
            data: JsCell::new(data),
            owner: Cell::new(Owner::None),
            attribute: None,
        }
    }

    pub(super) fn reflecting(attribute: Attribute) -> Value {
        let initial = attribute.reflected.syntax.initial();
        Value {
            attribute: Some(attribute),
            ..Value::detached(initial)
        }
    }

    pub(super) fn attach(&self, owner: Owner, object: JSValue) {
        self.owner.set(owner);
        js_SvgValue::set_owner(self, object);
    }

    fn list<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a ValueList> {
        ValueList::from_js(heap, js_SvgValue::owner(self)?)
    }

    fn transform<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Value> {
        Value::from_js(heap, js_SvgValue::owner(self)?)
    }

    fn element<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Element> {
        self.list(heap).map_or_else(
            || element_in(heap, js_SvgValue::owner(self)),
            |it| it.element(heap),
        )
    }

    #[optimize(size)]
    pub(super) fn read<'a>(&'a self, cx: &mut JsScope<'a>) -> Data {
        match (self.owner.get(), &self.attribute) {
            (Owner::Element, Some(attribute)) => self
                .element(&cx.heap)
                .into_iter()
                .for_each(|it| attribute.refresh(cx, it, &self.data)),
            (Owner::List, _) => self
                .list(&cx.heap)
                .into_iter()
                .for_each(|it| it.refresh(cx)),
            (Owner::Transform, _)
                if let Some(Data::Transform(it)) =
                    self.transform(&cx.heap).map(|it| it.read(cx)) =>
            {
                return Data::Numbers(it.matrix.0);
            }
            _ => {}
        }
        self.data.get().clone()
    }

    /// `read` for what is going to be given to `commit`.
    fn edit<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<Data, Failure> {
        let is_read_only = match self.owner.get() {
            Owner::List => self
                .list(&cx.heap)
                .is_some_and(|it| it.attribute.is_animated),
            Owner::Transform => self
                .transform(&cx.heap)
                .is_some_and(|it| it.edit(cx).is_err()),
            _ => self.attribute.as_ref().is_some_and(|it| it.is_animated),
        };
        if is_read_only {
            Err(READ_ONLY)
        } else {
            Ok(self.read(cx))
        }
    }

    #[optimize(size)]
    fn commit<'a>(&'a self, cx: &mut JsScope<'a>, data: Data) {
        self.data.set(data);
        let data = self.data.get().clone();
        match (self.owner.get(), &self.attribute, &data) {
            (Owner::Element, Some(attribute), _) => self
                .element(&cx.heap)
                .into_iter()
                .for_each(|it| attribute.commit(cx, it, &data)),
            (Owner::List, ..) => self.list(&cx.heap).into_iter().for_each(|it| it.commit(cx)),
            (Owner::Transform, _, Data::Numbers(matrix)) => {
                self.transform(&cx.heap).into_iter().for_each(|it| {
                    it.commit(cx, Data::Transform(Transform::of_matrix(Affine(*matrix))))
                });
            }
            (Owner::ZoomedElement, ..) => self
                .element(&cx.heap)
                .into_iter()
                .for_each(|it| commit_zoom(cx, it)),
            _ => {}
        }
    }

    pub(super) fn numbers<'a>(&'a self, cx: &mut JsScope<'a>) -> [f64; 6] {
        if let Data::Numbers(numbers) = self.read(cx) {
            numbers
        } else {
            [0.0; 6]
        }
    }

    fn set_number<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: usize,
        value: f64,
    ) -> Result<(), Failure> {
        if let Data::Numbers(mut numbers) = self.edit(cx)? {
            numbers[index] = value;
            self.commit(cx, Data::Numbers(numbers));
        }
        Ok(())
    }
}

pub(crate) struct Field(pub(crate) usize);

impl SvgFloat {
    pub(crate) fn get<'a>(&'a self, cx: &mut JsScope<'a>, &Field(index): &'static Field) -> f32 {
        self.numbers(cx)[index] as f32
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        &Field(index): &'static Field,
        value: f32,
    ) -> Result<(), Failure> {
        self.set_number(cx, index, value.into())
    }
}

impl SvgDouble {
    pub(crate) fn get<'a>(&'a self, cx: &mut JsScope<'a>, &Field(index): &'static Field) -> f64 {
        self.numbers(cx)[index]
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        &Field(index): &'static Field,
        value: f64,
    ) -> Result<(), Failure> {
        self.set_number(cx, index, value)
    }
}

impl SVGRect {
    pub(super) fn new<'a>(heap: &JsHeap<'a>, rect: [f32; 4]) -> &'a SVGRect {
        js_SVGRect::create(heap, Value::detached(Data::of(rect)))
    }
}

impl SVGPoint {
    pub(super) fn new<'a>(heap: &JsHeap<'a>, point: [f32; 2]) -> &'a SVGPoint {
        js_SVGPoint::create(heap, Value::detached(Data::of(point)))
    }

    pub(crate) fn matrix_transform<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        matrix: &DOMMatrix2DInit,
    ) -> Result<&'a SVGPoint, Failure> {
        let [x, y, ..] = self.numbers(cx);
        Ok(SVGPoint::new(
            &cx.heap,
            Affine::from_init(matrix)?.map([x, y]).map(|it| it as f32),
        ))
    }
}

impl SVGMatrix {
    pub(super) fn new<'a>(heap: &JsHeap<'a>, matrix: Affine) -> &'a SVGMatrix {
        js_SVGMatrix::create(heap, Value::detached(Data::Numbers(matrix.0)))
    }

    fn times<'a>(&'a self, cx: &mut JsScope<'a>, other: [f64; 6]) -> &'a SVGMatrix {
        let product = Affine(self.numbers(cx)).then(other);
        SVGMatrix::new(&cx.heap, product)
    }

    pub(crate) fn multiply<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        other: &DOMMatrix2DInit,
    ) -> Result<&'a SVGMatrix, Failure> {
        Ok(self.times(cx, Affine::from_init(other)?.0))
    }

    pub(crate) fn inverse<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<&'a SVGMatrix, Failure> {
        let inverse = Affine(self.numbers(cx))
            .inverse()
            .ok_or(Failure::invalid_state("The matrix is not invertible."))?;
        Ok(SVGMatrix::new(&cx.heap, inverse))
    }

    pub(crate) fn translate<'a>(&'a self, cx: &mut JsScope<'a>, x: f32, y: f32) -> &'a SVGMatrix {
        self.times(cx, [1.0, 0.0, 0.0, 1.0, x.into(), y.into()])
    }

    pub(crate) fn scale<'a>(&'a self, cx: &mut JsScope<'a>, factor: f32) -> &'a SVGMatrix {
        self.scale_non_uniform(cx, factor, factor)
    }

    pub(crate) fn scale_non_uniform<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        x: f32,
        y: f32,
    ) -> &'a SVGMatrix {
        self.times(cx, [x.into(), 0.0, 0.0, y.into(), 0.0, 0.0])
    }

    pub(crate) fn rotate<'a>(&'a self, cx: &mut JsScope<'a>, angle: f32) -> &'a SVGMatrix {
        self.times(cx, rotation(angle.into()))
    }

    pub(crate) fn rotate_from_vector<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        x: f32,
        y: f32,
    ) -> Result<&'a SVGMatrix, Failure> {
        if x == 0.0 || y == 0.0 {
            return Err(Failure::Dom(
                DOMExceptionCode::InvalidAccessError,
                "Arguments cannot be zero.",
            ));
        }
        Ok(self.times(cx, rotation(f64::from(y).atan2(x.into()).to_degrees())))
    }

    pub(crate) fn flip_x<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a SVGMatrix {
        self.scale_non_uniform(cx, -1.0, 1.0)
    }

    pub(crate) fn flip_y<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a SVGMatrix {
        self.scale_non_uniform(cx, 1.0, -1.0)
    }

    pub(crate) fn skew_x<'a>(&'a self, cx: &mut JsScope<'a>, angle: f32) -> &'a SVGMatrix {
        self.times(cx, skew(angle, 0.0))
    }

    pub(crate) fn skew_y<'a>(&'a self, cx: &mut JsScope<'a>, angle: f32) -> &'a SVGMatrix {
        self.times(cx, skew(0.0, angle))
    }
}

/// From the constant 1 on.
const LENGTH_UNITS: [Unit; 10] = [
    Unit::Number,
    Unit::Percent,
    Unit::Em,
    Unit::Ex,
    Unit::Px,
    Unit::Cm,
    Unit::Mm,
    Unit::In,
    Unit::Pt,
    Unit::Pc,
];
const ANGLE_UNITS: [Unit; 4] = [Unit::Number, Unit::Deg, Unit::Rad, Unit::Grad];

fn unit_for(units: &[Unit], constant: u16) -> Result<Unit, Failure> {
    units
        .get(usize::from(constant).wrapping_sub(1))
        .copied()
        .ok_or(UNKNOWN_UNIT)
}

fn constant_for(units: &[Unit], unit: Unit) -> u16 {
    units
        .iter()
        .position(|it| *it == unit)
        .map_or(0, |it| it as u16 + 1)
}

fn length_in(data: Data) -> Length {
    if let Data::Length(length) = data {
        length
    } else {
        Length::new(0.0, Unit::Number, Axis::Other)
    }
}

fn finite_or_zero(value: f64) -> f32 {
    Some(value as f32)
        .filter(|it| it.is_finite())
        .unwrap_or(0.0)
}

impl SVGLength {
    fn pixels<'a>(&'a self, cx: &mut JsScope<'a>, length: &Length) -> Result<f64, Failure> {
        let is_absolute = length.calculation.is_none() && length.unit != Unit::Percent;
        if let Some(pixels) = length
            .unit
            .canonical(length.value.into(), None)
            .filter(|_| is_absolute)
        {
            return Ok(pixels);
        }
        let mut source = Out::new();
        length.write(&mut source);
        let pixels = self
            .element(&cx.heap)
            .and_then(|it| resolve_length(cx, it, text(&source), length.axis));
        pixels.ok_or(Failure::Dom(
            DOMExceptionCode::NotSupportedError,
            "Could not resolve relative length.",
        ))
    }

    fn set_pixels<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        pixels: f32,
        unit: Unit,
        axis: Axis,
    ) -> Result<(), Failure> {
        let per_unit = self.pixels(cx, &Length::new(100.0, unit, axis))? / 100.0;
        self.commit(
            cx,
            Data::Length(Length::new(
                finite_or_zero(f64::from(pixels) / per_unit),
                unit,
                axis,
            )),
        );
        Ok(())
    }

    pub(crate) fn get_unit_type<'a>(&'a self, cx: &mut JsScope<'a>) -> u16 {
        let length = length_in(self.read(cx));
        if length.calculation.is_some() {
            0
        } else {
            constant_for(&LENGTH_UNITS, length.unit)
        }
    }

    pub(crate) fn get_value<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<f32, Failure> {
        let length = length_in(self.read(cx));
        Ok(self.pixels(cx, &length)? as f32)
    }

    pub(crate) fn set_value<'a>(&'a self, cx: &mut JsScope<'a>, value: f32) -> Result<(), Failure> {
        let length = length_in(self.edit(cx)?);
        self.set_pixels(cx, value, length.unit, length.axis)
    }

    pub(crate) fn get_value_in_specified_units<'a>(&'a self, cx: &mut JsScope<'a>) -> f32 {
        length_in(self.read(cx)).value
    }

    pub(crate) fn set_value_in_specified_units<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: f32,
    ) -> Result<(), Failure> {
        let length = length_in(self.edit(cx)?);
        self.commit(
            cx,
            Data::Length(Length::new(value, length.unit, length.axis)),
        );
        Ok(())
    }

    pub(crate) fn get_value_as_string<'a>(&'a self, cx: &mut JsScope<'a>) -> Out {
        let mut out = Out::new();
        length_in(self.read(cx)).write(&mut out);
        out
    }

    pub(crate) fn set_value_as_string<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: &[u8],
    ) -> Result<(), Failure> {
        let parsed = Length::parse(text(value), length_in(self.edit(cx)?).axis).ok_or(INVALID)?;
        self.commit(cx, Data::Length(parsed));
        Ok(())
    }

    pub(crate) fn new_value_specified_units<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        unit: u16,
        value: f32,
    ) -> Result<(), Failure> {
        let axis = length_in(self.edit(cx)?).axis;
        self.commit(
            cx,
            Data::Length(Length::new(value, unit_for(&LENGTH_UNITS, unit)?, axis)),
        );
        Ok(())
    }

    pub(crate) fn convert_to_specified_units<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        unit: u16,
    ) -> Result<(), Failure> {
        let (length, unit) = (length_in(self.edit(cx)?), unit_for(&LENGTH_UNITS, unit)?);
        let pixels = self.pixels(cx, &length)? as f32;
        self.set_pixels(cx, pixels, unit, length.axis)
    }
}

fn angle_in(data: &Data) -> Angle {
    if let Data::Angle(angle) = data {
        *angle
    } else {
        Angle::ZERO
    }
}

fn degrees(value: f32, unit: Unit) -> f64 {
    unit.canonical(value.into(), None).unwrap_or_default()
}

impl SVGAngle {
    fn change<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        change: impl FnOnce(Angle) -> Result<Angle, Failure>,
    ) -> Result<(), Failure> {
        let angle = change(angle_in(&self.edit(cx)?))?;
        self.commit(cx, Data::Angle(angle));
        Ok(())
    }

    pub(crate) fn get_unit_type<'a>(&'a self, cx: &mut JsScope<'a>) -> u16 {
        constant_for(&ANGLE_UNITS, angle_in(&self.read(cx)).unit)
    }

    pub(crate) fn get_value<'a>(&'a self, cx: &mut JsScope<'a>) -> f32 {
        let angle = angle_in(&self.read(cx));
        degrees(angle.value, angle.unit) as f32
    }

    pub(crate) fn set_value<'a>(&'a self, cx: &mut JsScope<'a>, value: f32) -> Result<(), Failure> {
        self.change(cx, |it| {
            Ok(Angle {
                value: (f64::from(value) / degrees(1.0, it.unit)) as f32,
                ..it
            })
        })
    }

    pub(crate) fn get_value_in_specified_units<'a>(&'a self, cx: &mut JsScope<'a>) -> f32 {
        angle_in(&self.read(cx)).value
    }

    pub(crate) fn set_value_in_specified_units<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: f32,
    ) -> Result<(), Failure> {
        self.change(cx, |it| Ok(Angle { value, ..it }))
    }

    pub(crate) fn get_value_as_string<'a>(&'a self, cx: &mut JsScope<'a>) -> Out {
        let mut out = Out::new();
        angle_in(&self.read(cx)).write(&mut out);
        out
    }

    pub(crate) fn set_value_as_string<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: &[u8],
    ) -> Result<(), Failure> {
        self.change(cx, |_| {
            if value.is_empty() {
                Ok(Angle::ZERO)
            } else {
                Angle::parse(text(value)).ok_or(INVALID)
            }
        })
    }

    pub(crate) fn new_value_specified_units<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        unit: u16,
        value: f32,
    ) -> Result<(), Failure> {
        self.change(cx, |_| {
            Ok(Angle {
                value,
                unit: unit_for(&ANGLE_UNITS, unit)?,
            })
        })
    }

    pub(crate) fn convert_to_specified_units<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        unit: u16,
    ) -> Result<(), Failure> {
        self.change(cx, |it| {
            let unit = unit_for(&ANGLE_UNITS, unit)?;
            Ok(Angle {
                value: (f64::from(degrees(it.value, it.unit) as f32) / degrees(1.0, unit)) as f32,
                unit,
            })
        })
    }
}

pub(super) fn transform_in(data: &Data) -> Transform {
    if let Data::Transform(transform) = data {
        *transform
    } else {
        Transform::of_matrix(Affine::default())
    }
}

impl SVGTransform {
    pub(super) fn new<'a>(heap: &JsHeap<'a>, matrix: Affine) -> &'a SVGTransform {
        js_SVGTransform::create(
            heap,
            Value::detached(Data::Transform(Transform::of_matrix(matrix))),
        )
    }

    fn set<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        function: Function,
        arguments: &[f32],
    ) -> Result<(), Failure> {
        self.edit(cx)?;
        Transform::new(function, arguments)
            .into_iter()
            .for_each(|it| self.commit(cx, Data::Transform(it)));
        Ok(())
    }

    pub(crate) fn get_type<'a>(&'a self, cx: &mut JsScope<'a>) -> u16 {
        transform_in(&self.read(cx)).function as u16
    }

    pub(crate) fn get_matrix<'a>(&self, heap: &JsHeap<'a>) -> &'a SVGMatrix {
        let matrix = SVGMatrix::new(heap, Affine::default());
        matrix.attach(Owner::Transform, self.to_js());
        matrix
    }

    pub(crate) fn get_angle<'a>(&'a self, cx: &mut JsScope<'a>) -> f32 {
        transform_in(&self.read(cx)).angle
    }

    pub(crate) fn set_matrix<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        matrix: &DOMMatrix2DInit,
    ) -> Result<(), Failure> {
        let matrix = Affine::from_init(matrix)?;
        self.edit(cx)?;
        self.commit(cx, Data::Transform(Transform::of_matrix(matrix)));
        Ok(())
    }

    pub(crate) fn set_translate<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        x: f32,
        y: f32,
    ) -> Result<(), Failure> {
        self.set(cx, Function::Translate, &[x, y])
    }

    pub(crate) fn set_scale<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        x: f32,
        y: f32,
    ) -> Result<(), Failure> {
        self.set(cx, Function::Scale, &[x, y])
    }

    pub(crate) fn set_rotate<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        angle: f32,
        x: f32,
        y: f32,
    ) -> Result<(), Failure> {
        self.set(cx, Function::Rotate, &[angle, x, y])
    }

    pub(crate) fn set_skew_x<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        angle: f32,
    ) -> Result<(), Failure> {
        self.set(cx, Function::SkewX, &[angle])
    }

    pub(crate) fn set_skew_y<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        angle: f32,
    ) -> Result<(), Failure> {
        self.set(cx, Function::SkewY, &[angle])
    }
}

impl SVGPreserveAspectRatio {
    fn set<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: usize,
        value: u16,
        count: usize,
    ) -> Result<(), Failure> {
        self.edit(cx)?;
        if !(1..=count).contains(&value.into()) {
            return Err(Failure::Dom(
                DOMExceptionCode::NotSupportedError,
                "The value provided is invalid.",
            ));
        }
        self.set_number(cx, index, value.into())
    }

    pub(crate) fn get_align<'a>(&'a self, cx: &mut JsScope<'a>) -> u16 {
        self.numbers(cx)[0] as u16
    }

    pub(crate) fn set_align<'a>(&'a self, cx: &mut JsScope<'a>, value: u16) -> Result<(), Failure> {
        self.set(cx, 0, value, ALIGNMENTS.len())
    }

    pub(crate) fn get_meet_or_slice<'a>(&'a self, cx: &mut JsScope<'a>) -> u16 {
        self.numbers(cx)[1] as u16
    }

    pub(crate) fn set_meet_or_slice<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: u16,
    ) -> Result<(), Failure> {
        self.set(cx, 1, value, 2)
    }
}
