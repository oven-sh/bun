//! <https://drafts.css-houdini.org/css-typed-om/#transformvalue-objects>

use core::cell::Cell;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{Class, ClassStructure, JsHeap, JsInterface, JsList, Result};

use super::CSSStyleValue;
use super::numeric::{self, Reader};
use crate::api::core::List;
use crate::api::geometry::{DOMMatrix, DOMMatrixReadOnly, Matrix};
use crate::calc::{Kind, Node, Unit};
use crate::generated_bindgen::typed::*;
use crate::prelude::written;
use crate::transform::{Name, specified_functions};
use crate::values::{Out, eq, write_list};

#[derive(Clone, Copy, PartialEq)]
enum Function {
    Translate,
    Rotate,
    Scale,
    Skew,
    SkewX,
    SkewY,
    Perspective,
    Matrix,
}

pub(crate) struct CSSTransformComponent {
    function: Function,
    is_2d: Cell<bool>,
}

impl Function {
    fn component(self, is_2d: bool) -> CSSTransformComponent {
        CSSTransformComponent {
            function: self,
            is_2d: is_2d.into(),
        }
    }

    fn class(self) -> Class<CSSTransformComponent> {
        match self {
            Function::Translate => js_CSSTranslate::CLASS.widen(),
            Function::Rotate => js_CSSRotate::CLASS.widen(),
            Function::Scale => js_CSSScale::CLASS.widen(),
            Function::Skew => js_CSSSkew::CLASS.widen(),
            Function::SkewX => js_CSSSkewX::CLASS.widen(),
            Function::SkewY => js_CSSSkewY::CLASS.widen(),
            Function::Perspective => js_CSSPerspective::CLASS.widen(),
            Function::Matrix => js_CSSMatrixComponent::CLASS.widen(),
        }
    }

    fn check<'a>(self, heap: &JsHeap<'a>, index: usize, value: &CSSNumericValue) -> Result<'a, ()> {
        let given = value.numeric_type();
        let (is_valid, wanted) = match (self, index) {
            (Function::Translate, 0 | 1) => (
                given.matches_or_percentage(Kind::Length),
                "a length or a percentage",
            ),
            (Function::Translate | Function::Perspective, _) => {
                (given.matches(Kind::Length), "a length")
            }
            (Function::Scale, _) | (Function::Rotate, 0..3) => {
                (given.matches(Kind::Number), "a number")
            }
            _ => (given.matches(Kind::Angle), "an angle"),
        };
        is_valid.ok_or_else(|| heap.type_error(format_args!("Must pass {wanted}.")))
    }
}

impl CSSTransformComponent {
    fn slot(&self, index: usize) -> JSValue {
        use js_CSSTransformComponent as js;
        [js::first, js::second, js::third, js::fourth][index](self).unwrap_or(JSValue::UNDEFINED)
    }

    fn set_slot(&self, index: usize, value: JSValue) {
        use js_CSSTransformComponent as js;
        [js::set_first, js::set_second, js::set_third, js::set_fourth][index](self, value);
    }

    fn set_argument<'a>(
        &self,
        heap: &JsHeap<'a>,
        index: usize,
        value: &'a CSSNumericValue,
    ) -> Result<'a, ()> {
        self.function.check(heap, index, value)?;
        self.set_slot(index, value.to_js());
        Ok(())
    }

    fn fill<'a>(&self, heap: &JsHeap<'a>, arguments: &[&'a CSSNumericValue]) -> Result<'a, ()> {
        arguments
            .iter()
            .enumerate()
            .try_for_each(|(index, it)| self.set_argument(heap, index, it))
    }

    fn matrix<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, Matrix> {
        let (mut matrix, is_2d) = (Matrix::IDENTITY, self.is_2d.get());
        let amount = |index, unit| {
            CSSNumericValue::from_js(heap, self.slot(index))
                .map_or(Ok(0.0), |it| it.amount(heap, unit))
        };
        match self.function {
            Function::Translate => matrix.translate(
                amount(0, Unit::Px)?,
                amount(1, Unit::Px)?,
                if is_2d { 0.0 } else { amount(2, Unit::Px)? },
            ),
            Function::Scale => matrix.scale(
                [
                    amount(0, Unit::Number)?,
                    amount(1, Unit::Number)?,
                    if is_2d { 1.0 } else { amount(2, Unit::Number)? },
                ],
                [0.0; 3],
            ),
            Function::Rotate => {
                let axis = [
                    amount(0, Unit::Number)?,
                    amount(1, Unit::Number)?,
                    amount(2, Unit::Number)?,
                ];
                matrix.rotate_axis_angle(
                    if is_2d { [0.0, 0.0, 1.0] } else { axis },
                    amount(3, Unit::Deg)?,
                );
            }
            Function::Skew => matrix.skew(amount(0, Unit::Deg)?, amount(1, Unit::Deg)?),
            Function::SkewX => matrix.skew(amount(0, Unit::Deg)?, 0.0),
            Function::SkewY => matrix.skew(0.0, amount(0, Unit::Deg)?),
            Function::Perspective
                if CSSNumericValue::is(self.slot(0)) && !CSSKeywordValue::is(self.slot(0)) =>
            {
                matrix.perspective(Some(amount(0, Unit::Px)?.max(1.0)))
            }
            Function::Perspective => {}
            Function::Matrix => {
                matrix = DOMMatrix::from_js(heap, self.slot(0)).map_or(matrix, |it| it.matrix());
                matrix = if is_2d {
                    Matrix::from_2d(matrix.flat())
                } else {
                    matrix
                };
            }
        }
        Ok(matrix)
    }

    /// <https://drafts.css-houdini.org/css-typed-om/#transformvalue-serialization>
    fn write<'a>(&'a self, heap: &JsHeap<'a>, reader: Reader, out: &mut Out) {
        let (is_2d, argument) = (self.is_2d.get(), |index: usize| {
            CSSStyleValue::from_js(heap, self.slot(index))
        });
        let (name, shown) = match self.function {
            Function::Translate => {
                if is_2d {
                    (Name::Translate, 0..2)
                } else {
                    (Name::Translate3d, 0..3)
                }
            }
            Function::Scale => {
                if is_2d {
                    (Name::Scale, 0..2)
                } else {
                    (Name::Scale3d, 0..3)
                }
            }
            Function::Rotate => {
                if is_2d {
                    (Name::Rotate, 3..4)
                } else {
                    (Name::Rotate3d, 0..4)
                }
            }
            Function::Skew => (
                Name::Skew,
                0..if matches!(argument(1).and_then(CSSStyleValue::unit), Some((0.0, _))) {
                    1
                } else {
                    2
                },
            ),
            Function::SkewX => (Name::SkewX, 0..1),
            Function::SkewY => (Name::SkewY, 0..1),
            Function::Perspective => (Name::Perspective, 0..1),
            Function::Matrix => (if is_2d { Name::Matrix } else { Name::Matrix3d }, 0..0),
        };
        out.extend([name.name(), "("].concat().bytes());
        match (
            DOMMatrix::from_js(heap, self.slot(0)).map(|it| it.matrix()),
            argument(0).and_then(CSSStyleValue::unit),
        ) {
            (Some(matrix), _) => write_list(
                &Matrix { is_2d, ..matrix }.values(),
                ", ",
                out,
                |it, out| numeric::write_number(*it, reader, out),
            ),
            (_, Some((value @ ..0.0, unit))) if self.function == Function::Perspective => {
                numeric::write(&Node::Sum(vec![Node::Value(value, unit)]), reader, out)
            }
            _ => write_list(&shown.collect::<Vec<_>>(), ", ", out, |it, out| {
                argument(*it)
                    .into_iter()
                    .for_each(|it| it.write(heap, reader, out))
            }),
        }
        out.push(b')');
    }

    /// <https://drafts.css-houdini.org/css-typed-om/#reify-a-transform-function>
    fn reify<'a>(heap: &JsHeap<'a>, name: Name, arguments: &[Node]) -> Option<&'a Self> {
        let given: Vec<_> = arguments
            .iter()
            .map(|it| numeric::reify(it, true))
            .collect::<Option<_>>()?;
        let number = |it| Node::Value(it, Unit::Number);
        let at = |index: usize, unit| match given.get(index) {
            Some(Node::Value(value, Unit::Percent)) if unit == Unit::Number => {
                number(value / 100.0)
            }
            None | Some(Node::Value(0.0, Unit::Number)) => Node::Value(0.0, unit),
            Some(it) => it.clone(),
        };
        let (px, zero, one) = (
            |index| at(index, Unit::Px),
            || Node::Value(0.0, Unit::Px),
            || number(1.0),
        );
        let (factor, angle) = (
            |index| at(index, Unit::Number),
            |index| at(index, Unit::Deg),
        );
        let (function, all) = match name {
            Name::Translate | Name::TranslateX | Name::Translate3d => {
                (Function::Translate, vec![px(0), px(1), px(2)])
            }
            Name::TranslateY => (Function::Translate, vec![zero(), px(0), zero()]),
            Name::TranslateZ => (Function::Translate, vec![zero(), zero(), px(0)]),
            Name::Scale => (
                Function::Scale,
                vec![factor(0), factor(given.len() - 1), one()],
            ),
            Name::ScaleX => (Function::Scale, vec![factor(0), one(), one()]),
            Name::ScaleY => (Function::Scale, vec![one(), factor(0), one()]),
            Name::ScaleZ => (Function::Scale, vec![one(), one(), factor(0)]),
            Name::Scale3d => (Function::Scale, vec![factor(0), factor(1), factor(2)]),
            Name::Rotate | Name::RotateZ => (
                Function::Rotate,
                vec![number(0.0), number(0.0), one(), angle(0)],
            ),
            Name::RotateX => (
                Function::Rotate,
                vec![one(), number(0.0), number(0.0), angle(0)],
            ),
            Name::RotateY => (
                Function::Rotate,
                vec![number(0.0), one(), number(0.0), angle(0)],
            ),
            Name::Rotate3d => (
                Function::Rotate,
                vec![factor(0), factor(1), factor(2), angle(3)],
            ),
            Name::Skew => (Function::Skew, vec![angle(0), angle(1)]),
            Name::SkewX => (Function::SkewX, vec![angle(0)]),
            Name::SkewY => (Function::SkewY, vec![angle(0)]),
            Name::Perspective => (Function::Perspective, given.iter().map(|_| px(0)).collect()),
            Name::Matrix | Name::Matrix3d => (Function::Matrix, Vec::new()),
        };
        let made = function
            .class()
            .create(heap, function.component(!name.is_3d()));
        match function {
            Function::Matrix => {
                let values: Vec<_> = given
                    .iter()
                    .map(|it| numeric::amount(it, Unit::Number))
                    .collect::<Option<_>>()?;
                made.set_slot(
                    0,
                    DOMMatrix::new(heap, Matrix::from_values(&values)?).to_js(),
                );
            }
            Function::Perspective if all.is_empty() => {
                made.set_slot(0, CSSKeywordValue::new(heap, b"none").to_js())
            }
            _ => all
                .iter()
                .enumerate()
                .try_for_each(|(index, it)| {
                    made.set_argument(heap, index, CSSNumericValue::of_node(heap, it)?)
                })
                .ok()?,
        }
        Some(made)
    }

    pub(crate) fn get_is_2d(&self) -> bool {
        self.is_2d.get()
    }

    pub(crate) fn set_is_2d(&self, value: bool) {
        if !matches!(
            self.function,
            Function::Skew | Function::SkewX | Function::SkewY | Function::Perspective
        ) {
            self.is_2d.set(value);
        }
    }

    pub(crate) fn to_matrix<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, &'a DOMMatrix> {
        Ok(DOMMatrix::new(self.realm(heap), self.matrix(heap)?))
    }

    pub(crate) fn stringify<'a>(&'a self, heap: &JsHeap<'a>) -> Out {
        written(|out| self.write(heap, Reader::Script, out))
    }
}

impl Dimension {
    pub(crate) fn get<'a>(&self, _: &JsHeap<'a>, index: usize) -> Result<'a, JSValue> {
        Ok(self.slot(index))
    }

    pub(crate) fn set<'a>(
        &self,
        heap: &JsHeap<'a>,
        index: usize,
        value: &'a CSSNumericValue,
    ) -> Result<'a, ()> {
        self.set_argument(heap, index, value)
    }
}

impl Factor {
    pub(crate) fn get<'a>(&self, _: &JsHeap<'a>, index: usize) -> Result<'a, JSValue> {
        Ok(self.slot(index))
    }

    pub(crate) fn set<'a>(
        &self,
        heap: &JsHeap<'a>,
        index: usize,
        value: CSSNumberish<'a>,
    ) -> Result<'a, ()> {
        self.set_argument(heap, index, value.rectify(heap))
    }
}

macro_rules! constructors {
    ($($Class:ident::$name:ident($heap:ident, $($argument:ident: $Type:ty),+) $Function:ident, $is_2d:expr, $all:expr;)+) => {
        $(impl $Class {
            pub(crate) fn $name<'a>($heap: &JsHeap<'a>, structure: ClassStructure<'a, Self>, $($argument: $Type),+) -> Result<'a, &'a Self> {
                let made = structure.create($heap, Function::$Function.component($is_2d));
                made.fill($heap, &$all).map(|()| made)
            }
        })+
    };
}

type Numeric<'a> = &'a CSSNumericValue;

constructors! {
    CSSTranslate::constructor(heap, x: Numeric<'a>, y: Numeric<'a>, z: Option<Numeric<'a>>)
        Translate, z.is_none(), [x, y, z.unwrap_or_else(|| CSSNumericValue::of_unit(heap, 0.0, Unit::Px))];
    CSSRotate::constructor(heap, angle: Numeric<'a>)
        Rotate, true, [CSSNumberish::Number(0.0), CSSNumberish::Number(0.0), CSSNumberish::Number(1.0), CSSNumberish::Value(angle)].map(|it| it.rectify(heap));
    CSSRotate::around(heap, x: CSSNumberish<'a>, y: CSSNumberish<'a>, z: CSSNumberish<'a>, angle: Numeric<'a>)
        Rotate, false, [x, y, z, CSSNumberish::Value(angle)].map(|it| it.rectify(heap));
    CSSScale::constructor(heap, x: CSSNumberish<'a>, y: CSSNumberish<'a>, z: Option<CSSNumberish<'a>>)
        Scale, z.is_none(), [x, y, z.unwrap_or(CSSNumberish::Number(1.0))].map(|it| it.rectify(heap));
    CSSSkew::constructor(heap, ax: Numeric<'a>, ay: Numeric<'a>) Skew, true, [ax, ay];
    CSSSkewX::constructor(heap, ax: Numeric<'a>) SkewX, true, [ax];
    CSSSkewY::constructor(heap, ay: Numeric<'a>) SkewY, true, [ay];
}

impl CSSPerspective {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        length: CSSPerspectiveValue<'a>,
    ) -> Result<'a, &'a Self> {
        let made = structure.create(heap, Function::Perspective.component(false));
        made.set_length(heap, length).map(|()| made)
    }

    pub(crate) fn get_length<'a>(&self, _: &JsHeap<'a>) -> Result<'a, JSValue> {
        Ok(self.slot(0))
    }

    pub(crate) fn set_length<'a>(
        &self,
        heap: &JsHeap<'a>,
        value: CSSPerspectiveValue<'a>,
    ) -> Result<'a, ()> {
        let keyword = match value {
            CSSPerspectiveValue::Length(it) => return self.set_argument(heap, 0, it),
            CSSPerspectiveValue::Keyword(it) => it,
            CSSPerspectiveValue::Text(it) => CSSKeywordValue::new(heap, it),
        };
        eq(&keyword.stringify(heap), "none").ok_or_else(|| {
            heap.type_error(format_args!("Must pass length or none to CSSPerspective"))
        })?;
        self.set_slot(0, keyword.to_js());
        Ok(())
    }
}

impl CSSMatrixComponent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        matrix: &'a DOMMatrixReadOnly,
        options: &CSSMatrixComponentOptions,
    ) -> &'a Self {
        let made = structure.create(
            heap,
            Function::Matrix.component(options.is_2d.unwrap_or_else(|| matrix.matrix().is_2d)),
        );
        made.set_matrix(DOMMatrix::new(heap, matrix.matrix()));
        made
    }

    pub(crate) fn get_matrix(&self) -> JSValue {
        self.slot(0)
    }

    pub(crate) fn set_matrix(&self, value: &DOMMatrix) {
        self.set_slot(0, value.to_js());
    }
}

impl CSSTransformValue {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        transforms: JsList<'a, &'a CSSTransformComponent>,
    ) -> Result<'a, &'a Self> {
        (transforms.len() > 0).ok_or_else(|| {
            heap.type_error(format_args!(
                "CSSTransformValue must have at least one component"
            ))
        })?;
        let (made, items) = (
            structure.create(heap, CSSStyleValue::Compound),
            List::new(heap),
        );
        made.set_slot(0, items.to_js());
        transforms
            .iter()
            .for_each(|it| items.push(heap, it.to_js()));
        Ok(made)
    }

    pub(super) fn reify<'a>(heap: &JsHeap<'a>, source: &[u8]) -> Option<&'a Self> {
        let (made, items) = (
            js_CSSTransformValue::create(heap, CSSStyleValue::Compound),
            List::new(heap),
        );
        made.set_slot(0, items.to_js());
        for (name, arguments) in specified_functions(source)? {
            items.push(
                heap,
                CSSTransformComponent::reify(heap, name, &arguments)?.to_js(),
            );
        }
        Some(made)
    }

    fn components<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> impl Iterator<Item = &'a CSSTransformComponent> {
        self.items()
            .values()
            .filter_map(|it| CSSTransformComponent::from_js(heap, it))
    }

    pub(super) fn write_components<'a>(&'a self, heap: &JsHeap<'a>, reader: Reader, out: &mut Out) {
        for (index, it) in self.components(heap).enumerate() {
            out.extend_from_slice(&b" "[..index.min(1)]);
            it.write(heap, reader, out);
        }
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.items().len()
    }

    pub(crate) fn indexed_get<'a>(
        &self,
        _: &JsHeap<'a>,
        index: u32,
    ) -> Result<'a, Option<JSValue>> {
        Ok(Some(self.items().get(index)).filter(|it| !it.is_empty()))
    }

    pub(crate) fn indexed_set<'a>(
        &self,
        heap: &JsHeap<'a>,
        index: u32,
        value: &'a CSSTransformComponent,
    ) -> Result<'a, ()> {
        self.set_item(heap, index, value.to_js())
    }

    pub(crate) fn get_is_2d<'a>(&'a self, heap: &JsHeap<'a>) -> bool {
        self.components(heap).all(CSSTransformComponent::get_is_2d)
    }

    pub(crate) fn to_matrix<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, &'a DOMMatrix> {
        let mut matrix = Matrix::IDENTITY;
        self.components(heap)
            .try_for_each(|it| it.matrix(heap).map(|it| matrix.multiply(&it)))?;
        Ok(DOMMatrix::new(self.realm(heap), matrix))
    }
}
