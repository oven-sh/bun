//! <https://drafts.css-houdini.org/css-typed-om/#numeric-objects>

use bun_jsc::bindgen::{Class, ClassStructure, JsHeap, JsInterface, JsList, JsLocal, Result};
use bun_jsc::{JSString, JSValue};

use super::numeric::{self, Type};
use super::{CSSStyleValue, MAX_DEPTH};
use crate::api::core::{DomError, DomString, List, dom_error};
use crate::calc::{Function, Modifier, Node, Unit};
use crate::generated_bindgen::typed::*;

use CSSMathOperator as Operator;

pub(crate) struct Operation {
    operator: Operator,
    numeric_type: Type,
    depth: usize,
    /// Of the tree, in which an object may be more than once.
    size: usize,
}

const MAX_SIZE: usize = 1 << 17;

type Numbers<'a> = JsList<'a, CSSNumberish<'a>>;

impl Operator {
    fn class(self) -> Class<CSSStyleValue> {
        match self {
            Operator::Sum => js_CSSMathSum::CLASS.widen(),
            Operator::Product => js_CSSMathProduct::CLASS.widen(),
            Operator::Negate => js_CSSMathNegate::CLASS.widen(),
            Operator::Invert => js_CSSMathInvert::CLASS.widen(),
            Operator::Min => js_CSSMathMin::CLASS.widen(),
            Operator::Max => js_CSSMathMax::CLASS.widen(),
            Operator::Clamp => js_CSSMathClamp::CLASS.widen(),
        }
    }

    fn has_array(self) -> bool {
        !matches!(self, Operator::Negate | Operator::Invert | Operator::Clamp)
    }
}

fn numbers_in<'a>(heap: &JsHeap<'a>, list: List<'a>) -> impl Iterator<Item = &'a CSSNumericValue> {
    list.values()
        .filter_map(|it| CSSNumericValue::from_js(heap, it))
}

fn list_of<'a>(
    heap: &JsHeap<'a>,
    values: impl IntoIterator<Item = &'a CSSNumericValue>,
) -> List<'a> {
    let list = List::new(heap);
    values
        .into_iter()
        .for_each(|it| list.push(heap, it.to_js()));
    list
}

fn operate<'a>(
    heap: &JsHeap<'a>,
    operator: Operator,
    operands: List<'a>,
    create: impl FnOnce(CSSStyleValue) -> &'a CSSStyleValue,
) -> Result<'a, &'a CSSStyleValue> {
    let made = create(CSSStyleValue::Math(operation(heap, operator, operands)?));
    hold(heap, made, operator, operands);
    Ok(made)
}

fn operation<'a>(
    heap: &JsHeap<'a>,
    operator: Operator,
    operands: List<'a>,
) -> Result<'a, Operation> {
    let types = numbers_in(heap, operands).map(|it| Some(it.numeric_type()));
    let combined = types.reduce(|a, b| {
        if operator == Operator::Product {
            a?.multiply(b?)
        } else {
            a?.add(b?)
        }
    });
    let combined = combined
        .ok_or_else(|| dom_error(heap, DomError::SyntaxError, "Arguments can't be empty"))?;
    let combined = combined.ok_or_else(|| heap.type_error(format_args!("Incompatible types")))?;
    let extent = |it: &CSSNumericValue| {
        if let CSSStyleValue::Math(it) = &**it {
            (it.depth, it.size)
        } else {
            (0, 1)
        }
    };
    let (depth, size) = numbers_in(heap, operands)
        .map(extent)
        .fold((1, 1), |all, it| (all.0.max(it.0 + 1), all.1 + it.1));
    (depth <= MAX_DEPTH && size <= MAX_SIZE)
        .ok_or_else(|| heap.range_error(format_args!("The expression is too large")))?;
    let numeric_type = if operator == Operator::Invert {
        combined.inverted()
    } else {
        combined
    };
    Ok(Operation {
        operator,
        numeric_type,
        depth,
        size,
    })
}

fn hold<'a>(heap: &JsHeap<'a>, made: &'a CSSStyleValue, operator: Operator, operands: List<'a>) {
    if operator.has_array() {
        let array = js_CSSNumericArray::create(heap, CSSNumericArray::default());
        js_CSSNumericArray::set_items(array, operands.to_js());
        made.set_slot(0, array.to_js());
    } else {
        operands
            .values()
            .enumerate()
            .for_each(|(index, it)| made.set_slot(index, it));
    }
}

impl<'a> CSSNumberish<'a> {
    /// <https://drafts.css-houdini.org/css-typed-om/#rectify-a-numberish-value>
    pub(super) fn rectify(self, heap: &JsHeap<'a>) -> &'a CSSNumericValue {
        match self {
            CSSNumberish::Value(it) => it,
            CSSNumberish::Number(it) => CSSNumericValue::of_unit(heap, it, Unit::Number),
        }
    }
}

impl CSSStyleValue {
    pub(super) fn unit(&self) -> Option<(f64, Unit)> {
        if let CSSStyleValue::Unit(value, unit) = self {
            Some((value.get(), *unit))
        } else {
            None
        }
    }

    fn operator(&self) -> Option<Operator> {
        if let CSSStyleValue::Math(it) = self {
            Some(it.operator)
        } else {
            None
        }
    }

    fn operands<'a>(&'a self, heap: &JsHeap<'a>) -> impl Iterator<Item = &'a CSSNumericValue> {
        let array = CSSNumericArray::from_js(heap, self.slot(0)).map(CSSNumericArray::items);
        array
            .into_iter()
            .flat_map(List::values)
            .chain((0..3).map(|it| self.slot(it)))
            .filter_map(|it| CSSNumericValue::from_js(heap, it))
    }

    /// Of a number, as it is now.
    pub(crate) fn node<'a>(&'a self, heap: &JsHeap<'a>) -> Node {
        let Some(operator) = self.operator() else {
            return self.unit().map_or(Node::None, |it| Node::Value(it.0, it.1));
        };
        let mut all: Vec<_> = self.operands(heap).map(|it| it.node(heap)).collect();
        match operator {
            Operator::Sum => Node::Sum(all),
            Operator::Product => Node::Product(all),
            Operator::Negate => Node::Negate(Box::new(all.swap_remove(0))),
            Operator::Invert => Node::Invert(Box::new(all.swap_remove(0))),
            Operator::Min => Node::Call(Function::Min, Modifier::Nearest, all),
            Operator::Max => Node::Call(Function::Max, Modifier::Nearest, all),
            Operator::Clamp => Node::Call(Function::Clamp, Modifier::Nearest, all),
        }
    }
}

fn unit_or_syntax_error<'a>(heap: &JsHeap<'a>, name: &[u8]) -> Result<'a, Unit> {
    numeric::unit_named(name)
        .ok_or_else(|| dom_error(heap, DomError::SyntaxError, "Invalid unit for conversion"))
}

impl CSSNumericValue {
    pub(crate) fn of_unit<'a>(heap: &JsHeap<'a>, value: f64, unit: Unit) -> &'a Self {
        js_CSSUnitValue::create(heap, CSSStyleValue::Unit(value.into(), unit))
    }

    fn of_operation<'a>(
        heap: &JsHeap<'a>,
        operator: Operator,
        operands: List<'a>,
    ) -> Result<'a, &'a Self> {
        Ok(operate(heap, operator, operands, |it| {
            operator.class().create(heap, it)
        })?
        .downcast()
        .expect("it is numeric"))
    }

    pub(crate) fn of_node<'a>(heap: &JsHeap<'a>, node: &Node) -> Result<'a, &'a Self> {
        let (operator, operands) = match node {
            Node::Value(value, unit) => return Ok(Self::of_unit(heap, *value, *unit)),
            Node::Sum(all) => (Operator::Sum, &all[..]),
            Node::Product(all) => (Operator::Product, &all[..]),
            Node::Negate(it) => (Operator::Negate, core::slice::from_ref(&**it)),
            Node::Invert(it) => (Operator::Invert, core::slice::from_ref(&**it)),
            Node::Call(Function::Min, _, all) => (Operator::Min, &all[..]),
            Node::Call(Function::Max, _, all) => (Operator::Max, &all[..]),
            Node::Call(Function::Clamp, _, all) => (Operator::Clamp, &all[..]),
            _ => return Err(heap.type_error(format_args!("Unsupported value"))),
        };
        let list = List::new(heap);
        operands
            .iter()
            .try_for_each(|it| Self::of_node(heap, it).map(|it| list.push(heap, it.to_js())))?;
        Self::of_operation(heap, operator, list)
    }

    pub(crate) fn numeric_type(&self) -> Type {
        match &**self {
            CSSStyleValue::Math(it) => it.numeric_type,
            it => it
                .unit()
                .map_or_else(Type::default, |it| Type::of_unit(it.1)),
        }
    }

    pub(crate) fn amount<'a>(&'a self, heap: &JsHeap<'a>, unit: Unit) -> Result<'a, f64> {
        numeric::amount(&self.node(heap), unit).ok_or_else(|| {
            heap.type_error(format_args!("Cannot convert to {}", numeric::name_of(unit)))
        })
    }

    /// <https://drafts.css-houdini.org/css-typed-om/#cssmath-negate-a-cssnumericvalue>
    fn negate<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, &'a Self> {
        match (
            self.unit(),
            self.operands(heap)
                .next()
                .filter(|_| self.operator() == Some(Operator::Negate)),
        ) {
            (Some((value, unit)), _) => Ok(Self::of_unit(heap, -value, unit)),
            (_, Some(inner)) => Ok(inner),
            _ => Self::of_operation(heap, Operator::Negate, list_of(heap, [self])),
        }
    }

    /// <https://drafts.css-houdini.org/css-typed-om/#cssmath-invert-a-cssnumericvalue>
    fn invert<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, &'a Self> {
        match (
            self.unit(),
            self.operands(heap)
                .next()
                .filter(|_| self.operator() == Some(Operator::Invert)),
        ) {
            (Some((0.0, Unit::Number)), _) => {
                Err(heap.range_error(format_args!("Can't divide-by-zero")))
            }
            (Some((value, Unit::Number)), _) => Ok(Self::of_unit(heap, 1.0 / value, Unit::Number)),
            (_, Some(inner)) => Ok(inner),
            _ => Self::of_operation(heap, Operator::Invert, list_of(heap, [self])),
        }
    }

    fn combine<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        operator: Operator,
        values: Numbers<'a>,
        prepare: fn(&'a Self, &JsHeap<'a>) -> Result<'a, &'a Self>,
    ) -> Result<'a, &'a Self> {
        let all = if self.operator() == Some(operator) {
            list_of(heap, self.operands(heap))
        } else {
            list_of(heap, [self])
        };
        values.iter().try_for_each(|it| {
            prepare(it.rectify(heap), heap).map(|it| all.push(heap, it.to_js()))
        })?;
        let folded =
            numbers_in(heap, all)
                .map(|it| it.unit())
                .reduce(|a, b| match (operator, a?, b?) {
                    (Operator::Product, (a, Unit::Number), (b, unit))
                    | (Operator::Product, (a, unit), (b, Unit::Number)) => Some((a * b, unit)),
                    (Operator::Sum, (a, unit), (b, other)) if unit == other => Some((a + b, unit)),
                    (Operator::Min, (a, unit), (b, other)) if unit == other => {
                        Some((numeric::min(a, b), unit))
                    }
                    (Operator::Max, (a, unit), (b, other)) if unit == other => {
                        Some((numeric::max(a, b), unit))
                    }
                    _ => None,
                });
        folded.flatten().map_or_else(
            || Self::of_operation(heap, operator, all),
            |it| Ok(Self::of_unit(heap, it.0, it.1)),
        )
    }

    pub(crate) fn add<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        values: Numbers<'a>,
    ) -> Result<'a, &'a Self> {
        self.combine(heap, Operator::Sum, values, |it, _| Ok(it))
    }

    pub(crate) fn sub<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        values: Numbers<'a>,
    ) -> Result<'a, &'a Self> {
        self.combine(heap, Operator::Sum, values, Self::negate)
    }

    pub(crate) fn mul<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        values: Numbers<'a>,
    ) -> Result<'a, &'a Self> {
        self.combine(heap, Operator::Product, values, |it, _| Ok(it))
    }

    pub(crate) fn div<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        values: Numbers<'a>,
    ) -> Result<'a, &'a Self> {
        self.combine(heap, Operator::Product, values, Self::invert)
    }

    pub(crate) fn min<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        values: Numbers<'a>,
    ) -> Result<'a, &'a Self> {
        self.combine(heap, Operator::Min, values, |it, _| Ok(it))
    }

    pub(crate) fn max<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        values: Numbers<'a>,
    ) -> Result<'a, &'a Self> {
        self.combine(heap, Operator::Max, values, |it, _| Ok(it))
    }

    pub(crate) fn equals<'a>(&'a self, heap: &JsHeap<'a>, values: Numbers<'a>) -> bool {
        let own = self.node(heap);
        values.iter().all(|it| it.rectify(heap).node(heap) == own)
    }

    pub(crate) fn to<'a>(&'a self, heap: &JsHeap<'a>, unit: &[u8]) -> Result<'a, &'a Self> {
        let unit = unit_or_syntax_error(heap, unit)?;
        Ok(Self::of_unit(heap, self.amount(heap, unit)?, unit))
    }

    pub(crate) fn to_sum<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        units: JsList<'a, JsLocal<'a, JSString>>,
    ) -> Result<'a, &'a Self> {
        let units: Vec<_> = units
            .iter()
            .map(|it| {
                unit_or_syntax_error(
                    heap,
                    DomString::from_js_string(heap, it)?.to_utf8().as_bytes(),
                )
            })
            .collect::<Result<'a, _>>()?;
        Self::of_node(
            heap,
            &numeric::to_sum(&self.node(heap), &units)
                .ok_or_else(|| heap.type_error(format_args!("Invalid value for conversion")))?,
        )
    }

    pub(crate) fn r#type(&self) -> CSSNumericType {
        use CSSNumericBaseType::*;
        let Type {
            powers,
            percent_hint,
        } = self.numeric_type();
        let [length, angle, time, frequency, resolution, flex, percent] =
            powers.map(|it| Some(it).filter(|it| *it != 0));
        let percent_hint =
            percent_hint.map(|it| [Length, Angle, Time, Frequency, Resolution, Flex, Percent][it]);
        CSSNumericType {
            length,
            angle,
            time,
            frequency,
            resolution,
            flex,
            percent,
            percent_hint,
        }
    }

    pub(crate) fn parse<'a>(heap: &JsHeap<'a>, source: &[u8]) -> Result<'a, &'a Self> {
        Self::of_node(
            heap,
            &numeric::parse(source)
                .ok_or_else(|| dom_error(heap, DomError::SyntaxError, "Invalid math expression"))?,
        )
    }
}

impl CSSUnitValue {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        value: f64,
        unit: &[u8],
    ) -> Result<'a, CSSStyleValue> {
        let unit = numeric::unit_named(unit).ok_or_else(|| {
            heap.type_error(format_args!("Invalid unit: {}", crate::values::text(unit)))
        })?;
        Ok(CSSStyleValue::Unit(value.into(), unit))
    }

    pub(crate) fn get_value(&self) -> f64 {
        self.unit().map_or(0.0, |it| it.0)
    }

    pub(crate) fn set_value(&self, value: f64) {
        if let CSSStyleValue::Unit(it, _) = &***self {
            it.set(value);
        }
    }

    pub(crate) fn get_unit(&self) -> &'static str {
        self.unit().map_or("", |it| numeric::name_of(it.1))
    }
}

impl CSSNumericArray {
    fn items(&self) -> List<'_> {
        List::from_value(js_CSSNumericArray::items(self).expect("it is made with them"))
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.items().len()
    }

    pub(crate) fn indexed_get(&self, index: u32) -> Option<JSValue> {
        Some(self.items().get(index)).filter(|it| !it.is_empty())
    }
}

impl CSSMathValue {
    pub(crate) fn get_operator(&self) -> Operator {
        self.operator().unwrap_or(Operator::Sum)
    }
}

macro_rules! constructors {
    ($($Class:ident $Operator:ident($($argument:ident: $Type:ty),+) $all:expr;)+) => {
        $(impl $Class {
            pub(crate) fn constructor<'a>(heap: &JsHeap<'a>, structure: ClassStructure<'a, Self>, $($argument: $Type),+) -> Result<'a, &'a Self> {
                let operands = list_of(heap, $all.into_iter().map(|it| it.rectify(heap)));
                Ok(operate(heap, Operator::$Operator, operands, |it| structure.create(heap, it))?.downcast().expect("it was made with that structure"))
            }
        })+
    };
}

constructors! {
    CSSMathSum Sum(args: Numbers<'a>) args.iter();
    CSSMathProduct Product(args: Numbers<'a>) args.iter();
    CSSMathMin Min(args: Numbers<'a>) args.iter();
    CSSMathMax Max(args: Numbers<'a>) args.iter();
    CSSMathNegate Negate(arg: CSSNumberish<'a>) [arg];
    CSSMathInvert Invert(arg: CSSNumberish<'a>) [arg];
    CSSMathClamp Clamp(lower: CSSNumberish<'a>, value: CSSNumberish<'a>, upper: CSSNumberish<'a>) [lower, value, upper];
}
