//! The types of values. Every value has one, which the engine takes for a fact. It is what the operation yields by itself, or what the
//! value has been held to. One invariant does the rest: the value of an expression is of the checker's type of the expression, and what
//! enters a place is of the type of the place. `coerce_to` sees to both. A read of a place that other code may have stored to since the
//! checker last looked at it is the exception: its value is of the type of the place, and of more only once a use has made sure of that.

use super::types::MAX_DESCRIPTION_DEPTH;
use super::{FileBuild, Fx, Source};
use crate::builder::Var;
use crate::declared::{Declared, Part, prim};
use crate::id::{FuncId, LayoutId, StrId, TyId, V};
use crate::ir::{BinOp, FuncKind, LayoutKind, MethodKind, Op, Operation, Prediction, Term, UnOp, CoerceReason, field_flags, func_flags};
use bun_sema::atom::Atom;
use bun_sema::bind::Parent;
use bun_sema::check::kind;
use bun_sema::hir::{self, ExprId, ExprKind};
use bun_sema::types::TypeId;
use std::rc::Rc;

/// A type as the engine reads it, and as the checker has it, which says more: what a function returns, what a map holds.
/// `TypeId::UNRESOLVED`: the checker has none.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct Ty {
    pub(crate) id: TyId,
    pub(crate) checked: TypeId,
}

impl Ty {
    pub(crate) const NONE: Ty = Ty { id: TyId::NONE, checked: TypeId::UNRESOLVED };

    pub(crate) fn of(id: TyId) -> Ty {
        Ty { id, checked: TypeId::UNRESOLVED }
    }
}

/// The types that operations yield whatever the program.
pub(crate) struct Known {
    pub(crate) undefined: TyId,
    pub(crate) null: TyId,
    pub(crate) no: TyId,
    pub(crate) yes: TyId,
    pub(crate) boolean: TyId,
    pub(crate) number: TyId,
    pub(crate) int32: TyId,
    pub(crate) uint32: TyId,
    /// How many steps a loop has taken.
    pub(crate) counter: TyId,
    pub(crate) numeric: TyId,
    pub(crate) string: TyId,
    pub(crate) literal_string: TyId,
    pub(crate) bigint: TyId,
    pub(crate) sum: TyId,
    pub(crate) function: TyId,
    pub(crate) object: TyId,
    pub(crate) array: TyId,
}

impl Known {
    pub(crate) fn new(tys: &mut crate::declared::DeclaredTable) -> Known {
        let anything = tys.anything;
        Known {
            undefined: tys.intern(Declared::prims(prim::UNDEFINED)),
            null: tys.intern(Declared::prims(prim::NULL)),
            no: tys.intern(Declared::prims(prim::FALSE)),
            yes: tys.intern(Declared::prims(prim::TRUE)),
            boolean: tys.intern(Declared::prims(prim::BOOLEAN)),
            number: tys.intern(Declared::prims(prim::NUMBER)),
            int32: tys.intern(Declared::ints(i32::MIN as i64, i32::MAX as i64)),
            uint32: tys.intern(Declared::ints(0, u32::MAX as i64)),
            counter: tys.intern(Declared::ints(0, 1 << 52)),
            numeric: tys.intern(Declared::prims(prim::NUMBER | prim::BIGINT)),
            string: tys.intern(Declared::prims(prim::STRING)),
            literal_string: tys.intern(Declared::prims(prim::LITERAL_STRING)),
            bigint: tys.intern(Declared::prims(prim::BIGINT)),
            sum: tys.intern(Declared::prims(prim::NUMBER | prim::BIGINT | prim::STRING)),
            function: tys.intern(Declared::any_function()),
            object: tys.intern(Declared::any_object()),
            array: tys.intern(Declared::part(Part::Array(anything))),
        }
    }
}

/// The checker's types of the places of a function.
#[derive(Default, Clone)]
pub(crate) struct Signature {
    pub(crate) this: Option<TypeId>,
    pub(crate) params: Vec<TypeId>,
    pub(crate) result: Option<TypeId>,
    /// The type of the result is written down.
    pub(crate) is_result_annotated: bool,
}

/// Which of the numbers that an expression has to do with an operation computes.
#[derive(Copy, Clone)]
pub(crate) enum NumberRole {
    /// Its value.
    Value,
    /// Of `target++`, `--target` and the like: what the target holds, as a number.
    Before,
    /// Of those, and of `target op= value`: what is stored to the target.
    Stored,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    #[inline]
    pub(crate) fn ty(&self, fx: &Fx, v: V) -> TyId {
        fx.b.func.ty(v)
    }

    pub(crate) fn checked(&self, fx: &Fx, v: V) -> TypeId {
        fx.checked.get(v).copied().unwrap_or(TypeId::UNRESOLVED)
    }

    /// The value is that of an expression of the type. `x as any` yields the value of `x`, of which more is known.
    fn set_checked(&self, fx: &mut Fx, value: V, checked: TypeId) {
        if self.c.is_uninformative(checked) {
            fx.checked.entry(value).or_insert(checked);
        } else {
            fx.checked.insert(value, checked);
        }
    }

    pub(crate) fn or_anything(&self, ty: TyId) -> TyId {
        if ty.is_none() { self.out.tys.anything } else { ty }
    }

    // ───────────────────────────── what operations yield ─────────────────────────────

    pub(crate) fn op_result_type(&mut self, fx: &Fx, op: &Op) -> Ty {
        let known = &self.known;
        let id = match *op {
            Op::Undefined => known.undefined,
            Op::Null => known.null,
            Op::Bool(value) => return Ty { id: if value { known.yes } else { known.no }, checked: if value { TypeId::TRUE } else { TypeId::FALSE } },
            Op::Int(value) => return Ty { id: self.out.tys.intern(Declared::int(value)), checked: TypeId::NUMBER },
            Op::Double(_) => return Ty { id: known.number, checked: TypeId::NUMBER },
            Op::Str(_) | Op::ToStr(_) | Op::StrConcat(_) | Op::TypeOf(_) => return Ty { id: known.string, checked: TypeId::STRING },
            Op::BigInt(_) => return Ty { id: known.bigint, checked: TypeId::BIGINT },
            Op::FuncRef(_) | Op::Closure { .. } | Op::ClosureOnce { .. } => known.function,
            Op::GlobalGet(global) => {
                let checked = self.checked_globals.get(&global).copied().unwrap_or(TypeId::UNRESOLVED);
                return Ty { id: self.or_anything(self.out.globals[global.idx()].declared), checked };
            }
            Op::New(layout) | Op::NewWith { layout, .. } => {
                let checked = self.layout_types.get(&layout).copied().unwrap_or(TypeId::UNRESOLVED);
                return Ty { id: self.out.tys.intern(Declared::part(Part::Class(layout))), checked };
            }
            Op::FieldGet { layout, field, .. } => return self.field_type(layout, field),
            Op::PropGet { obj, name } => return self.property_read_type(self.ty(fx, obj), name),
            Op::NewArray(_) => known.array,
            Op::NewObject => known.object,
            // Whatever the operands are. What more there is to say of an operation of the source, the checker says: `emit_arithmetic`.
            Op::Binary { op: BinOp::Add, .. } => known.sum,
            Op::Binary { op: BinOp::UShr, .. } => known.uint32,
            Op::Unary { op: UnOp::ToNumber, .. } => known.number,
            Op::Binary { .. } | Op::Unary { .. } => known.numeric,
            Op::Relational { .. }
            | Op::StrictEq { .. }
            | Op::LooseEq { .. }
            | Op::Not(_)
            | Op::Truthy(_)
            | Op::InstanceOf { .. }
            | Op::IsNullish(_)
            | Op::IsInstance { .. }
            | Op::PropHas { .. }
            | Op::PropDelete { .. }
            | Op::ElemHas { .. }
            | Op::ElemDelete { .. }
            | Op::IterHas { .. } => return Ty { id: known.boolean, checked: TypeId::BOOLEAN },
            Op::CallDirect { func, .. } => {
                let checked = self.signatures.get(&func).and_then(|signature| signature.result).unwrap_or(TypeId::UNRESOLVED);
                return Ty { id: self.or_anything(self.out.funcs[func.idx()].result), checked };
            }
            Op::Coerce { to, .. } => to,
            Op::ResumeMode => self.out.tys.intern(Declared::ints(0, 2)),
            Op::GlobalSet(..)
            | Op::FreeSet { .. }
            | Op::FieldSet { .. }
            | Op::PropSet { .. }
            | Op::ElemSet { .. }
            | Op::IterClose(_)
            | Op::IterCloseForThrow(_)
            | Op::Poll => known.undefined,
            // Nothing vouches for what these come back with.
            Op::FreeGet { .. }
            | Op::ElemGet { .. }
            | Op::ToKey(_)
            | Op::IterOpen(_)
            | Op::IterGet { .. }
            | Op::Call { .. }
            | Op::Construct { .. }
            | Op::CallMethod { .. }
            | Op::Caught
            | Op::CaughtException
            | Op::Operation { .. }
            | Op::Yield(_)
            | Op::ExternalModule(_)
            | Op::Await(_) => self.out.tys.anything,
        };
        Ty::of(id)
    }

    pub(crate) fn field_type(&mut self, layout: LayoutId, field: u32) -> Ty {
        self.resolve_field_types(layout);
        let checked = self.checked_fields.get(&(layout, field)).copied().unwrap_or(TypeId::UNRESOLVED);
        Ty { id: self.or_anything(self.out.layouts[layout.idx()].fields[field as usize].declared), checked }
    }

    /// Of an object that is looked at as one type of the program, what the type has by the name. Of anything else, anything.
    fn property_read_type(&mut self, obj: TyId, name: StrId) -> Ty {
        let anything = Ty::of(self.out.tys.anything);
        let Some(layout) = self.out.tys.get(obj).single_layout() else { return anything };
        // The object need not be what the view says: see `coerce_read_through_cast`.
        if self.layout_types.get(&layout).is_some_and(|&ty| self.c.is_coercion_result_type(ty)) {
            return anything;
        }
        if let Some(field) = self.out.layouts[layout.idx()].field(name) {
            return self.field_type(layout, field);
        }
        let mut at = layout;
        while at.is_some() {
            if let Some(&(file, class)) = self.fixed_layout_classes.get(&at) {
                self.define_class(file, class);
            }
            for method in &self.out.layouts[at.idx()].methods {
                if method.name != name || method.flags & crate::ir::method_flags::STATIC != 0 {
                    continue;
                }
                return match method.kind {
                    MethodKind::Method => Ty::of(self.known.function),
                    MethodKind::Getter => {
                        let checked = self.signatures.get(&method.func).and_then(|signature| signature.result).unwrap_or(TypeId::UNRESOLVED);
                        Ty { id: self.or_anything(self.out.funcs[method.func.idx()].result), checked }
                    }
                    MethodKind::Setter => continue,
                };
            }
            at = self.out.layouts[at.idx()].base;
        }
        anything
    }

    /// CoerceReason what enters the field is held to its type.
    pub(crate) fn field_cast_reason(&mut self, layout: LayoutId, field: u32) -> CoerceReason {
        self.resolve_field_types(layout);
        if self.annotated_fields.contains(&(layout, field)) { CoerceReason::Cast } else { CoerceReason::Store }
    }

    /// The field a store by name to an object of the type goes to.
    pub(crate) fn store_target_field(&mut self, obj: TyId, name: StrId) -> Option<(Ty, CoerceReason)> {
        let layout = self.out.tys.get(obj).single_layout()?;
        let field = self.out.layouts[layout.idx()].field(name)?;
        Some((self.field_type(layout, field), self.field_cast_reason(layout, field)))
    }

    /// The description with the numbers among it narrowed to the integers from the least to the most, which is what the checker has found
    /// them to be. Where it has found nothing, there are no numbers, or the type says nothing: the description as it is.
    pub(crate) fn with_integers(&mut self, ty: TyId, integers: Option<(i64, i64)>) -> TyId {
        let Some(integers) = integers else { return ty };
        if ty.is_none() || ty == self.out.tys.anything || self.out.tys.get(ty).prims & prim::NUMBER == 0 {
            return ty;
        }
        let mut narrowed = self.out.tys.get(ty).clone();
        narrowed.prims &= !prim::NUMBER;
        narrowed.ints = Some(integers);
        self.out.tys.intern(narrowed)
    }

    /// The description of `checked`, which is the checker's type of the expression `e`, with what the checker knows of its numbers.
    pub(crate) fn expression_ty(&mut self, fx: &Fx, e: ExprId, checked: TypeId) -> TyId {
        self.c.record_expression_type(checked);
        let described = self.ty_of(checked);
        if described == self.out.tys.anything || self.out.tys.get(described).prims & prim::NUMBER == 0 {
            return described;
        }
        let integers = self.c.expr_integer_range(fx.file, e);
        self.with_integers(described, integers)
    }

    /// What the text of the expression shows its value to be, whatever the types say: `Checker::result_kinds_of`, and the integers that
    /// are found without a type. For a file whose types nothing holds the program to. `NONE`: nothing.
    pub(crate) fn ty_from_syntax(&mut self, fx: &Fx, e: ExprId, computes: NumberRole) -> TyId {
        let kinds = self.c.result_kinds_of(fx.file, e);
        let described = self.kinds_ty(kinds);
        let integers = match computes {
            // Not `bigint | integers 0..9`, which no typed code has ever come up with.
            _ if kinds & (kind::NUMBER | kind::BIGINT) != kind::NUMBER => None,
            NumberRole::Value => self.c.expr_integer_range(fx.file, e),
            NumberRole::Before => self.c.integer_range_before_update(fx.file, e),
            NumberRole::Stored => self.c.stored_integer_range(fx.file, e),
        };
        let described = self.with_integers(described, integers);
        self.none_if_unranged_number(described)
    }

    /// An operation on numbers, bigints or strings that the expression `e` of the source asks for. In TypeScript what it yields is of the
    /// checker's type of `e`, and which integers that is, is for the checker as well. Nothing is made of the types of the operands.
    pub(crate) fn emit_arithmetic(&mut self, fx: &mut Fx, op: Op, e: ExprId, computes: NumberRole) -> V {
        let value = self.emit_throwing(fx, op);
        if matches!(computes, NumberRole::Stored) {
            self.record_stored_value_span(fx, value, e);
        }
        if !fx.is_typed {
            let shown = self.ty_from_syntax(fx, e, computes);
            if shown.is_some() {
                fx.b.func.values[value.idx()].ty = shown;
            }
            return value;
        }
        let checked = self.c.result_type_of(fx.file, e);
        let described = self.ty_of(checked);
        // Of `any` the checker says nothing. The operator still does.
        if described == self.out.tys.anything || self.out.tys.get(described).is_never() {
            return value;
        }
        // It yields a number, a string or a bigint, whatever else the type has room for.
        let described = Declared { prims: self.out.tys.get(described).prims & !prim::NULLISH, ..self.out.tys.get(described).clone() };
        let described = self.out.tys.intern(described);
        let integers = match computes {
            _ if self.out.tys.get(described).prims & prim::NUMBER == 0 => None,
            NumberRole::Value => self.c.expr_integer_range(fx.file, e),
            NumberRole::Before => self.c.integer_range_before_update(fx.file, e),
            NumberRole::Stored => self.c.stored_integer_range(fx.file, e),
        };
        let integers = integers.or_else(|| self.integer_range_from_operands(fx, value));
        fx.b.func.values[value.idx()].ty = self.with_integers(described, integers);
        fx.checked.insert(value, checked);
        value
    }

    fn integer_range_from_operands(&self, fx: &Fx, value: V) -> Option<(i64, i64)> {
        const MOST: i64 = 1 << 52;
        let range_of = |operand: V| {
            let described = self.out.tys.get(self.ty(fx, operand));
            let is_integer_only = described.prims == 0 && described.parts.is_empty() && !described.any_object && !described.any_function;
            described.ints.filter(|_| is_integer_only)
        };
        let (least, most) = match *fx.b.func.op(value)? {
            Op::Unary { op: UnOp::ToNumber | UnOp::ToNumeric, a } => range_of(a)?,
            Op::Binary { op: BinOp::Add, a, b } => {
                let (a, b) = (range_of(a)?, range_of(b)?);
                (a.0.checked_add(b.0)?, a.1.checked_add(b.1)?)
            }
            Op::Binary { op: BinOp::Sub, a, b } => {
                let (a, b) = (range_of(a)?, range_of(b)?);
                (a.0.checked_sub(b.1)?, a.1.checked_sub(b.0)?)
            }
            _ => return None,
        };
        (least >= -MOST && most <= MOST).then_some((least, most))
    }

    /// `value`, that of `e`, where it is used as the string, number or boolean that the checker takes it for: the receiver of a member read or a call, an operand of arithmetic or of
    /// `<`, a part of a template. It may be an object that an `as` has let through, `(x as string).length`: it is asserted to be none. See `Checker::is_primitive_by_type`.
    pub(crate) fn as_checked_primitive(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        let have = self.ty(fx, value);
        let described = self.out.tys.get(have);
        if !fx.is_typed || !described.has_objects() || described.prims == 0 && described.ints.is_none() || have == self.out.tys.anything || fx.b.func.prediction(value) != Prediction::None {
            return value;
        }
        if !self.c.is_primitive_by_type(fx.file, e) {
            return value;
        }
        let declared = self.c.type_of_expr(fx.file, e);
        let primitives = Declared { prims: described.prims, ints: described.ints, ..Declared::default() };
        if self.c.is_external_data_prediction(declared) {
            let expected = self.out.tys.intern(Declared { prims: primitives.prims & !prim::NULLISH, ..primitives });
            fx.b.func.values[value.idx()].set_prediction(Prediction::Ty(expected));
            return value;
        }
        let primitives = self.out.tys.intern(primitives);
        self.coerce_to(fx, value, Ty { id: primitives, checked: declared }, CoerceReason::Claim)
    }

    // ───────────────────────────── holding values to types ─────────────────────────────

    /// If the value is an ordinary object that stays one (`Fx::uncoercible_objects`) and is of the type, by what the checker has for it or because the type is written down here: the value as it enters.
    /// A cast would refuse an accessor, and make a copy of the rest. Note is taken that the views admit it.
    fn try_pass_uncoerced(&mut self, fx: &mut Fx, value: V, want: Ty, why: CoerceReason) -> Option<V> {
        if fx.uncoercible_objects.is_empty() {
            return None;
        }
        let &own = fx.uncoercible_objects.get(&value)?;
        let views = self.layout_types_in(want.id);
        if !self.c.accepts_untyped(own, &views) && !(why == CoerceReason::Cast && want.checked != TypeId::UNRESOLVED && self.c.accepts_untyped(want.checked, &views)) {
            return None;
        }
        let have = Ty { id: self.ty(fx, value), checked: own };
        let mut held = value;
        // Of what a call yields the operation does not say that it is an object.
        if self.out.tys.get(have.id).prims != 0 {
            self.record_cast(have, want.id, CoerceReason::Claim);
            held = self.emit_throwing(fx, Op::Coerce { value, to: want.id, why: CoerceReason::Claim });
            fx.uncoercible_objects.insert(held, if want.checked != TypeId::UNRESOLVED { want.checked } else { own });
            if want.checked != TypeId::UNRESOLVED {
                fx.checked.insert(held, want.checked);
            }
        }
        fx.fitted.insert((fx.b.block, value, want.id), held);
        Some(held)
    }

    /// The value as one of the type. Nothing is done where it is known to be one.
    pub(crate) fn coerce_to(&mut self, fx: &mut Fx, value: V, want: Ty, why: CoerceReason) -> V {
        let value = if want.id.is_none() || self.out.tys.get(want.id).has_literal_string() { value } else { self.widen_literal_string(fx, value) };
        if want.id.is_none() || want.id == self.out.tys.anything || self.out.tys.get(want.id).is_never() {
            if want.id == self.out.tys.anything && want.checked != TypeId::UNRESOLVED && !self.c.is_uninformative(want.checked) {
                let entering = self.checked(fx, value);
                self.record_untyped_inflow_into_host_object(entering, want);
            }
            return value;
        }
        let (mut value, mut have) = (value, Ty { id: self.ty(fx, value), checked: self.checked(fx, value) });
        if self.out.tys.get(want.id).has_literal_string() && !self.out.tys.get(have.id).has_literal_string() {
            if matches!(why, CoerceReason::Claim | CoerceReason::Flow | CoerceReason::NonNull(_) | CoerceReason::Upcast | CoerceReason::ArgumentClaim(_)) {
                let as_string = self.out.tys.get(want.id).clone().with_literal_string_widened();
                let as_string = Ty { id: self.out.tys.intern(as_string), ..want };
                let held = self.coerce_to(fx, value, as_string, why);
                return self.coerce_to(fx, held, want, CoerceReason::Store);
            } else if let Some(&Op::Str(text)) = fx.b.func.op(value) {
                let is_newest = fx.b.func.blocks[fx.b.block.idx()].ops.last() == Some(&value);
                let literal = if is_newest { value } else { fx.b.emit(Op::Str(text), self.known.literal_string) };
                fx.b.func.values[literal.idx()].ty = self.known.literal_string;
                fx.checked.insert(literal, if want.checked != TypeId::UNRESOLVED { want.checked } else { have.checked });
                return literal;
            }
        }
        // What a test leaves of primitives of several kinds keeps the room that those have for an object: where `typeof v` is neither "number" nor "string" the checker takes a
        // `boolean | number | string` for a boolean, by elimination. Whoever looks sees the object. A use asserts: `as_checked_primitive`.
        let want = {
            let (had, wanted) = (self.out.tys.get(have.id), self.out.tys.get(want.id));
            let has_room = had.any_object && had.parts.is_empty() && (had.prims & !prim::NULLISH != 0 || had.ints.is_some()) && have.id != self.out.tys.anything;
            if why == CoerceReason::Flow && has_room && !wanted.has_objects() {
                let with_nullish = wanted.or(&Declared::any_object()).nullable();
                Ty { id: self.out.tys.intern(with_nullish), ..want }
            } else {
                want
            }
        };
        // `Math`, what `Object.assign(() => 1, { .. })` yields: the operation says nothing of the value, and the checker's type says that it
        // is no plain data. It is held to that type first, and enters as what that says.
        if have.id == self.out.tys.anything
            && let Some(own) = self.ty_if_never_plain_data(have.checked)
            && own != want.id
        {
            value = self.coerce_to(fx, value, Ty { id: own, checked: have.checked }, CoerceReason::Claim);
            have.id = self.ty(fx, value);
        }
        if self.is_within(have, want) {
            let described = self.out.tys.get(have.id);
            let has_no_layout = described.has_objects() && !described.parts.iter().any(|part| matches!(part, Part::Class(_)));
            if fx.is_typed && has_no_layout && !self.c.is_uninformative(have.checked) && !self.type_has_fixed_layout(have.checked) && !self.layout_types_in(want.id).is_empty() {
                fx.uncoercible_objects.entry(value).or_insert(have.checked);
            }
            return value;
        }
        if let Some(&held) = fx.fitted.get(&(fx.b.block, value, want.id)) {
            return held;
        }
        let is_external_value = have.id == self.out.tys.anything
            && match fx.b.func.op(value) {
                Some(&(Op::PropGet { obj, .. } | Op::ElemGet { obj, .. })) => {
                    let of_object = self.checked(fx, obj);
                    self.c.is_beyond_layouts(of_object)
                }
                _ => false,
            };
        if is_external_value {
            self.c.record_untyped_source(want.checked);
            for view in self.layout_types_in(want.id) {
                self.c.record_untyped_source(view);
            }
        }
        if let Some(held) = self.try_pass_uncoerced(fx, value, want, why) {
            return held;
        }
        // The nil that a cast has let through, `return s.codePointAt(i) as number`, is converted where the value enters a declared place that cannot hold it: `as` coerces, and does not
        // end in a TypeError a step later.
        if matches!(why, CoerceReason::Cast | CoerceReason::Store) && fx.nullish_after_cast.contains(&value) {
            // `x as number` of an `x` that may be anything may be an object as well. That one is asserted to be none here, where the nil is converted then.
            let (had, wanted) = (self.out.tys.get(have.id), self.out.tys.get(want.id));
            if had.has_objects() && !wanted.has_objects() && had.prims & prim::NULLISH & !wanted.prims != 0 && wanted.prims & !prim::NULLISH != 0 {
                let primitives = Declared { prims: had.prims, ints: had.ints, ..Declared::default() };
                let without_nullish = Declared { prims: had.prims & (wanted.prims | !prim::NULLISH), ..primitives.clone() };
                let without_nullish = self.out.tys.intern(without_nullish);
                if self.is_within(Ty { id: without_nullish, checked: want.checked }, want) {
                    let primitives = self.out.tys.intern(primitives);
                    let claimed = self.coerce_to(fx, value, Ty { id: primitives, checked: want.checked }, CoerceReason::Claim);
                    fx.nullish_after_cast.insert(claimed);
                    return self.coerce_to(fx, claimed, want, why);
                }
            }
            let (had, wanted) = (self.out.tys.get(have.id), self.out.tys.get(want.id));
            let is_also_nullish = !had.has_objects() && !wanted.has_objects() && had.prims & prim::NULLISH & !wanted.prims != 0 && wanted.prims & !prim::NULLISH != 0;
            if is_also_nullish {
                let without_nullish = self.out.tys.intern(Declared { prims: had.prims & (wanted.prims | !prim::NULLISH), ..had.clone() });
                if self.is_within(Ty { id: without_nullish, checked: want.checked }, want) {
                    let converted = self.coerce(fx, value, want, want, why);
                    return self.coerce_to(fx, converted, want, why);
                }
            }
        }
        let is_nullish = {
            let had = self.out.tys.get(have.id);
            !had.has_objects() && had.prims & !prim::NULLISH == 0
        };
        if !is_nullish && self.c.is_untyped(have.checked) {
            self.record_untyped_inflow(want);
        }
        if !is_nullish && self.c.is_any_like(have.checked) {
            self.record_any_inflow(want);
        }
        if have.id == self.out.tys.anything && have.checked != TypeId::UNRESOLVED && self.is_engine_declared_type(have.checked) {
            let views = self.layout_types_in(want.id);
            self.c.accepts_untyped(have.checked, &views);
        }
        // A cast that can make nothing of the value only makes sure of what it is.
        let only_verifies = matches!(why, CoerceReason::Claim | CoerceReason::NonNull(_)) || why == CoerceReason::Cast && !self.cast_may_allocate(want.id);
        if only_verifies && have.id == self.out.tys.anything && self.try_set_result_type(fx, value, want.id) {
            self.record_cast(have, want.id, why);
            if want.checked != TypeId::UNRESOLVED {
                fx.checked.insert(value, want.checked);
            }
            return value;
        }
        let mut to = want.id;
        if why == CoerceReason::Cast {
            to = self.cast_target_ty(to);
            if let ([source], [target]) = (&self.layout_types_in(have.id)[..], &self.layout_types_in(to)[..])
                && !self.out.tys.get(have.id).any_object
                && let Some(both) = self.c.intersection_for_forced_cast(*source, *target)
            {
                let described = self.out.tys.get(to).clone();
                let mut joined = Declared { parts: Default::default(), ..described.clone() };
                for part in described.parts.iter().filter(|part| !matches!(part, Part::Class(_))) {
                    joined = joined.or(&Declared::part(part.clone()));
                }
                let of_both = self.ty_of(both);
                joined = joined.or(self.out.tys.get(of_both));
                to = self.out.tys.intern(joined);
            }
        }
        self.record_cast(have, to, why);
        if why == CoerceReason::Cast && matches!(fx.b.func.op(value), Some(Op::NewObject)) {
            self.record_defined_field_casts(fx, value, to);
        }
        // The caller takes the result for a `want`, untested: an upcast like any other, which the soundness closure has to hear of. Whether
        // the sets bear it out in the end is checked at the link (`verify.rs`).
        if to != want.id {
            self.is_within(Ty { id: to, checked: want.checked }, want);
        }
        if self.shared.constants.logs_type_errors
            && let Some(road) = if self.c.is_untyped(have.checked) { Some(0) } else { self.external_origin_path(fx, value, 4) }
        {
            let mut views = Vec::new();
            self.layout_types_within(to, 3, &mut views);
            for view in views {
                self.c.record_log_build_check(view, road);
            }
        }
        let block = fx.b.block;
        let held = self.emit_throwing(fx, Op::Coerce { value, to, why });
        fx.fitted.insert((block, value, want.id), held);
        fx.fitted.insert((fx.b.block, value, want.id), held);
        if want.checked != TypeId::UNRESOLVED {
            fx.checked.insert(held, want.checked);
        }
        held
    }

    /// `e as T`, which coerces and does not assert. `value`: that of `e`, held to its own type. `tries`: `T`. `result`: what is known of the
    /// value afterwards, `Checker::coerced_type`: a `T`, or the object that `e` was.
    ///
    /// `asserts`: how an engine kind is asserted. `Cast` for a cast in the source, which also walks the elements of an array. `Claim` for a
    /// read, which tests the kind and walks nothing.
    pub(crate) fn coerce(&mut self, fx: &mut Fx, value: V, tries: Ty, result: Ty, asserts: CoerceReason) -> V {
        if tries.id.is_none() || tries.id == self.out.tys.anything || self.out.tys.get(tries.id).is_never() {
            return value;
        }
        let have = Ty { id: self.ty(fx, value), checked: self.checked(fx, value) };
        if self.is_within(have, tries) {
            return value;
        }
        // `e as Error`: whatever it is, it stays that.
        if self.c.is_noop_cast_target(tries.checked) {
            for view in self.layout_types_in(result.id) {
                if self.c.is_coerced_unknown_type(view) {
                    self.c.record_untyped(view, have.checked);
                }
            }
            return value;
        }
        // Which string, number or boolean comes of a conversion is not looked at: `0 as true` is a boolean.
        let to = self.cast_target_ty(tries.id);
        let mut widened = self.out.tys.get(to).clone();
        if widened.ints.take().is_some() {
            widened.prims |= prim::NUMBER;
        }
        if widened.prims & prim::BOOLEAN != 0 {
            widened.prims |= prim::BOOLEAN;
        }
        // The primitives of the result are those of `T`, and the nil that `e` may be. A view that `e` is of may take a string: that one is converted like any other.
        let nil = self.out.tys.get(result.id).prims & prim::NULLISH;
        let described = Declared { prims: widened.prims | nil, ints: None, ..self.out.tys.get(result.id).clone() };
        let (to, result) = (self.out.tys.intern(widened), Ty { id: self.out.tys.intern(described), checked: result.checked });
        if self.is_within(have, Ty { id: to, checked: tries.checked }) {
            return value;
        }
        // Nothing can be made an array, a function or an object of a class of the engine. Of an object that may be anything it is asserted
        // to be one. Not to be a function: the call asserts that.
        let tried = self.out.tys.get(to);
        let is_engine_only = tried.has_objects() && !tried.any_object && !tried.parts.iter().any(|part| matches!(part, Part::Class(_)));
        let is_function_only = tried.any_function && tried.parts.is_empty();
        if is_engine_only && !is_function_only && self.out.tys.get(have.id).any_object {
            return self.convert_and_assert(fx, value, to, tries.checked, asserts);
        }
        // An object stays an object, so the result has to have room for every object that the value can be and for every `T`. Where it
        // has not, the cast asserts.
        if self.out.tys.get(to).has_objects() {
            let on_anything: Vec<TypeId> = self.layout_types_in(result.id).into_iter().filter(|&view| self.c.is_coerced_unknown_type(view)).collect();
            for &view in &on_anything {
                self.c.record_untyped(view, have.checked);
            }
            let (tried, had) = (self.without_primitives(to), self.without_primitives(have.id));
            let has_room = self.is_within(Ty { id: tried, checked: tries.checked }, result) && (!on_anything.is_empty() || self.is_within(Ty { id: had, checked: have.checked }, result));
            if !has_room {
                return self.convert_and_assert(fx, value, to, tries.checked, asserts);
            }
        }
        // `{} as T`: the literal lacks what `T` requires, so it was made an ordinary object and stays one. It is looked at as a `T` from here on.
        if matches!(fx.b.func.op(value), Some(Op::NewObject)) {
            for view in self.layout_types_in(to) {
                self.c.record_untyped(view, have.checked);
            }
        }
        self.record_cast(have, to, CoerceReason::Coerce);
        let why = if fx.is_coercing_fresh_graph { CoerceReason::CoerceFreshGraph } else { CoerceReason::Coerce };
        let held = self.emit_throwing(fx, Op::Coerce { value, to, why });
        fx.b.func.values[held.idx()].ty = result.id;
        fx.checked.insert(held, result.checked);
        if nil & !self.out.tys.get(to).prims != 0 {
            fx.nullish_after_cast.insert(held);
        }
        held
    }

    /// `5 as string | string[]`, `"5" as number | Date`: nothing can be made the objects of `to`, so an object is asserted to be one. A primitive
    /// is converted all the same, to the primitives that `to` has besides.
    fn convert_and_assert(&mut self, fx: &mut Fx, value: V, to: TyId, checked: TypeId, asserts: CoerceReason) -> V {
        let prims = self.out.tys.get(to).prims;
        let mut value = value;
        if prims & !prim::NULLISH != 0 {
            let have = self.checked(fx, value);
            let converted = self.out.tys.intern(Declared { prims, any_object: true, any_function: true, ..Declared::default() });
            value = self.emit_throwing(fx, Op::Coerce { value, to, why: CoerceReason::Coerce });
            fx.b.func.values[value.idx()].ty = converted;
            fx.checked.insert(value, have);
        }
        self.coerce_to(fx, value, Ty { id: to, checked }, asserts)
    }

    /// `(x as T).name`: `value` is what has been read for the expression `e`. The object need not be a `T`, so the read is a coercion itself.
    fn coerce_read_through_cast(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        // What has been read, and nothing else: an expression is fitted more than once, and `l?.kind` once more where the chain ends, with
        // the `undefined` of a chain that is cut short.
        if !matches!(fx.b.func.op(value), Some(Op::PropGet { .. })) {
            return value;
        }
        let Some((found, target)) = self.c.coerced_property_read(fx.file, e) else { return value };
        if self.c.is_predicted(fx.file, e) {
            return value;
        }
        let known = self.c.coerced_type(found, target);
        let mut value = value;
        if self.ty(fx, value) == self.out.tys.anything && !self.c.is_untyped(found) {
            let found = Ty { id: self.ty_of(found), checked: found };
            value = self.coerce_to(fx, value, found, CoerceReason::Claim);
        }
        let (tries, result) = (Ty { id: self.ty_of(target), checked: target }, Ty { id: self.ty_of(known), checked: known });
        self.coerce(fx, value, tries, result, CoerceReason::Claim)
    }

    /// The type without its primitives.
    fn without_primitives(&mut self, ty: TyId) -> TyId {
        let objects = Declared { prims: 0, ints: None, ..self.out.tys.get(ty).clone() };
        self.out.tys.intern(objects)
    }

    /// The type without `undefined` and `null`, which `x!` asserts the value not to be.
    pub(crate) fn strip_nullish(&mut self, ty: TyId) -> TyId {
        if ty.is_none() || ty == self.out.tys.anything {
            return ty;
        }
        let described = self.out.tys.get(ty);
        let narrowed = Declared { prims: described.prims & !prim::NULLISH, ..described.clone() };
        if narrowed.is_never() { ty } else { self.out.tys.intern(narrowed) }
    }

    /// The description of the checker's type, if a value of it has objects among what it can be and none of them can be plain data: they
    /// are arrays, functions, objects of classes that the program only knows the declaration of.
    fn ty_if_never_plain_data(&mut self, checked: TypeId) -> Option<TyId> {
        if checked == TypeId::UNRESOLVED || self.c.is_uninformative(checked) {
            return None;
        }
        let own = self.ty_of(checked);
        let described = self.out.tys.get(own);
        (own != self.out.tys.anything && described.has_objects() && !described.any_object && !self.cast_may_allocate(own)).then_some(own)
    }

    /// `setTextRange(factory.createX(..), node)`, `finishNode(node, pos)`, `Debug.checkDefined(x)`. `value`: the value of the expression `e`. If it is what a
    /// direct call of a function yields that hands back one of its parameters (`Checker::returned_parameter`), and what the argument is
    /// known to be says as much as the type of `e` or more: the argument. It goes by the operation, not by `e`: whatever expression it
    /// is the value of, such a call yields that operand, and `e` is looked at more than once.
    fn returned_argument(&mut self, fx: &mut Fx, value: V, e: ExprId) -> Option<V> {
        let Some(Op::CallDirect { func: called, args }) = fx.b.func.op(value) else { return None };
        let Source::Function { file, func, .. } = self.sources[called.idx()] else { return None };
        let number = self.c.returned_parameter(file, func)?;
        // The last operands are the arguments, one for each parameter.
        let at = (args.len() + number as usize).checked_sub(self.out.funcs[called.idx()].params.len())?;
        let argument = *args.get(at)?;
        let checked = self.c.type_of_expr(fx.file, e);
        let (known, want) = (Ty { id: self.ty(fx, argument), checked: self.checked(fx, argument) }, Ty { id: self.ty_of(checked), checked });
        // `const hide = (v: unknown): any => v`: whoever writes that wants nothing to be known of the value. With `hide(makeB())` taken for a `B`, `const x: A =
        // hide(makeB())` is a cast from `B` to `A`, which lists a transition that a store from untyped code then makes (ty_r1_never_throws, w6).
        (known.id != self.out.tys.anything && want.id != self.out.tys.anything && self.is_within(known, want)).then_some(argument)
    }

    /// `Object.assign(target, ..)` yields `target` itself, and so do `Object.freeze(o)` and the like, as a type that says more. `value`: what
    /// the call `e` has yielded. If the argument is an object of the program, it is the value of the call, looked at as the type of the
    /// call says, and nothing is tested: what the object was made as is a member of that type from here on, and what it lacks of it is
    /// found among the properties it has been given.
    fn as_returned_argument(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        if let Some(argument) = self.returned_argument(fx, value, e) {
            return argument;
        }
        let Some(first) = self.c.returned_argument_of(fx.file, e) else { return value };
        let Some(Op::CallMethod { args, .. } | Op::Call { args, .. }) = fx.b.func.op(value) else { return value };
        let Some(&target) = args.first() else { return value };
        if self.is_object_assign_target(fx, first) {
            return value;
        }
        let checked = self.c.type_of_expr(fx.file, e);
        let want = self.ty_of(checked);
        let have = self.out.tys.get(self.ty(fx, target)).clone();
        let Some(to) = self.out.tys.get(want).single_layout() else { return value };
        let is_program_defined = !have.parts.is_empty() && have.parts.iter().all(|part| matches!(part, Part::Class(_)));
        if !is_program_defined || have.prims & !prim::NULLISH != 0 || have.ints.is_some() || have.any_object || have.any_function {
            return value;
        }
        if have.single_layout() == Some(to) {
            return target;
        }
        for part in &have.parts {
            if let &Part::Class(from) = part
                && from != to
                && let (Some(&source), Some(&seen_as)) = (self.layout_types.get(&from), self.layout_types.get(&to))
            {
                self.c.record_upcast(source, seen_as);
            }
        }
        let to = if have.prims & prim::NULLISH == 0 { self.without_nullish(want) } else { want };
        let viewed = self.emit(fx, Op::Coerce { value: target, to, why: CoerceReason::Upcast });
        fx.checked.insert(viewed, checked);
        viewed
    }

    /// The checker's type of the expression. An object literal is made as what it is checked against, if that is known, and not as the type
    /// of its own that the checker gives it. That goes for what yields one or another literal as well: `flag ? { a: 1 } : { a: 2 }`. Checked
    /// against the type of the objects of a class, it is made as its own type, which is assignable to that.
    ///
    /// `a && { .. }`, `a || { .. }`, `a ?? { .. }` yield one operand or the other, and `a` need not be of what the whole is checked against.
    pub(crate) fn value_type(&mut self, fx: &Fx, e: ExprId) -> TypeId {
        let yields_literal = self.evaluates_to_object_literal(fx, e);
        if yields_literal && self.is_copy_source_only(fx, e) {
            return TypeId::UNKNOWN;
        }
        if let ExprKind::Binary { op: hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish, left, right } = self.hir(fx.file)[e].kind
            && yields_literal
        {
            let operands = [self.value_type(fx, left), self.value_type(fx, right)];
            return self.c.union(&operands);
        }
        let own = self.c.result_type_of(fx.file, e);
        if yields_literal
            && let Some(expected) = self.c.contextual_type_of_literal(fx.file, e)
            && !self.c.is_uninformative(expected)
            && !self.c.is_checked_against_class(expected)
            && !self.is_cast_beyond_own_type(fx, e, expected)
            // `{ constructor: { value: F } }` as a dictionary: TypeScript checks the inner literal against `Object.prototype.constructor`.
            && let described = self.ty_of(expected)
            && let described = self.out.tys.get(described)
            && (described.any_object || !described.parts.is_empty())
        {
            return expected;
        }
        own
    }

    /// `{} as P`, `[{}] as P[]`, `{ child: {} } as Q`, `(c ? {} : y) as P`: the literal `e` has what it is checked against, `expected`, from a cast,
    /// and is not of that type. Nothing is written down for it to be, so it is made as what it is by itself, and the cast makes of it
    /// what it can. `{} satisfies P`, `{} as const satisfies P`: it is only compared with `P`, and the expression is of its own type.
    pub(crate) fn is_cast_beyond_own_type(&mut self, fx: &Fx, e: ExprId, expected: TypeId) -> bool {
        let (hir, bound) = (self.hir(fx.file), self.c.bound(fx.file));
        let mut at = e;
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::Prop(prop) if bound.prop_owner[prop.idx()].is_some() => bound.prop_owner[prop.idx()],
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::As { .. } => break,
                    ExprKind::Satisfies { .. } => return true,
                    ExprKind::Array(_) | ExprKind::AsConst(_) | ExprKind::Binary { op: hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish, .. } => parent,
                    ExprKind::Cond { test, .. } if test != at => parent,
                    _ => return false,
                },
                _ => return false,
            };
        }
        let own = self.c.type_of_expr(fx.file, e);
        let own = self.c.layout_defining_type(own);
        !self.c.is_provably_assignable(own, expected)
    }

    /// `.then(() => ({ ...base(), b }))`. `value`: that of the literal `e`, which has a spread or a computed name and was built as an ordinary object; nobody else has seen it. `want`: what it
    /// goes straight to. Whether that holds it to nothing, or names a layout and has room besides for an object that is not laid out, `T | PromiseLike<T>`: then nothing there makes it
    /// what its type says, and whoever gets it in the end goes by that type. Not where what is spread is no object of the program's: `{ ...process.env, more }`: what the type of that
    /// requires is a wish. Nor where it is written for `any`.
    fn stays_plain_for(&mut self, fx: &Fx, value: V, e: ExprId, want: TyId) -> bool {
        let hir = self.hir(fx.file);
        let ExprKind::Object(props) = hir[e].kind else { return false };
        // `function f(r: R): any { return { ...r, more } }`: whoever has an object as `any` may delete a property of it, redefine one, give it another prototype: it stays what it was built as.
        let is_for_any = self.c.contextual_type_of_literal(fx.file, e).is_some_and(|expected| self.c.is_any(expected) || expected == TypeId::UNKNOWN);
        let has_room = want.is_none() && !is_for_any || want.is_some() && {
            let wanted = self.out.tys.get(want);
            wanted.parts.iter().any(|part| matches!(part, Part::Class(_))) && (wanted.any_object || wanted.parts.iter().any(|part| matches!(part, Part::Global(..))) || !self.cast_may_allocate(want))
        };
        fx.is_typed
            && has_room
            && props.iter().filter(|&p| hir[p].kind == hir::PropKind::Spread).all(|p| {
                let spread = self.c.type_of_expr(fx.file, hir[p].value);
                self.type_has_fixed_layout(spread)
            })
            && matches!(fx.b.func.op(value), Some(Op::NewObject | Op::Operation { .. }))
            && self.c.has_declared_type(fx.file, e)
            && !(self.is_explicitly_dynamic(fx, e) || self.defines_accessor(fx, e) || self.is_object_assign_target(fx, e) || self.is_copy_source_only(fx, e))
            && !self.c.contextual_type_of_literal(fx.file, e).is_some_and(|expected| self.c.is_checked_against_inferred_type(fx.file, e, expected))
            && self.methods_needing_home_object(fx, props).is_empty()
    }

    fn stays_plain_for_generic_spread(&mut self, fx: &Fx, e: ExprId) -> bool {
        let hir = self.hir(fx.file);
        let ExprKind::Object(props) = hir[e].kind else { return false };
        if props.iter().len() < 2 {
            return false;
        }
        let (mut spreads_a_generic_type, mut holds_an_object_without_a_layout) = (false, false);
        for p in props.iter() {
            let held = self.c.type_of_expr(fx.file, hir[p].value);
            match hir[p].kind {
                hir::PropKind::Spread => spreads_a_generic_type |= self.c.is_generic(held),
                hir::PropKind::Init | hir::PropKind::Shorthand => {
                    let described = self.ty_of(held);
                    holds_an_object_without_a_layout |= self.out.tys.get(described).any_object;
                }
                _ => {}
            }
        }
        if !spreads_a_generic_type || holds_an_object_without_a_layout {
            return spreads_a_generic_type;
        }
        if self.is_returned_directly(fx, e) {
            return false;
        }
        let Some(expected) = self.c.contextual_type_of_literal_before_bounds(fx.file, e) else { return false };
        self.c.parts(expected).to_vec().into_iter().any(|part| self.has_type_variable_without_layout(part))
    }

    fn has_type_variable_without_layout(&mut self, ty: TypeId) -> bool {
        let bun_sema::types::TypeData::Intersection(parts) = self.c.data(ty) else { return false };
        parts.to_vec().into_iter().any(|part| self.c.is_generic(part) && !self.type_has_fixed_layout(part))
    }

    fn is_returned_directly(&self, fx: &Fx, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(fx.file), self.c.bound(fx.file));
        let mut at = e;
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) | ExprKind::AsConst(_) => parent,
                    ExprKind::Cond { test, .. } if test != at => parent,
                    ExprKind::Binary { op: hir::BinOp::Comma, right, .. } if right == at => parent,
                    _ => return false,
                },
                Parent::Stmt(statement) => return statement.is_some() && matches!(hir[statement].kind, hir::StmtKind::Return(_)),
                Parent::FnBody(_) => return true,
                _ => return false,
            };
        }
    }

    fn is_engine_declared_type(&mut self, checked: TypeId) -> bool {
        self.c.parts(checked).to_vec().into_iter().any(|part| match self.c.data(part) {
            bun_sema::types::TypeData::Ref { target, .. } => self.hir(target.file).kind == hir::FileKind::Declaration && self.c.global_type_symbol(self.files.symbol(*target).name) == Some(*target),
            _ => false,
        })
    }

    fn defines_accessor(&self, fx: &Fx, e: ExprId) -> bool {
        let hir = self.hir(fx.file);
        matches!(hir[e].kind, ExprKind::Object(props) if props.iter().any(|p| matches!(hir[p].kind, hir::PropKind::Getter | hir::PropKind::Setter)))
    }

    fn evaluates_to_object_literal(&self, fx: &Fx, e: ExprId) -> bool {
        match self.hir(fx.file)[e].kind {
            ExprKind::Object(_) => true,
            ExprKind::Cond { yes, no, .. } => self.evaluates_to_object_literal(fx, yes) || self.evaluates_to_object_literal(fx, no),
            ExprKind::Binary { op: hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish, left, right } => {
                self.evaluates_to_object_literal(fx, left) || self.evaluates_to_object_literal(fx, right)
            }
            ExprKind::Binary { op: hir::BinOp::Comma, right, .. } => self.evaluates_to_object_literal(fx, right),
            ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => self.evaluates_to_object_literal(fx, expr),
            _ => false,
        }
    }

    /// Whether a cast to the type can make something of a value that is not of it: an object with a layout out of plain data, by itself or
    /// in an array.
    pub(crate) fn cast_may_allocate(&self, ty: TyId) -> bool {
        ty.is_some()
            && self.out.tys.get(ty).parts.iter().any(|part| match *part {
                Part::Class(layout) => self.out.layouts[layout.idx()].kind == LayoutKind::Record,
                Part::Array(elements) => elements != ty && self.cast_may_allocate(elements),
                Part::Global(..) => false,
            })
    }

    fn record_defined_field_casts(&mut self, fx: &Fx, object: V, to: TyId) {
        let func = &fx.b.func;
        let defined: Vec<(StrId, TyId)> = (func.values[object.idx() + 1..].iter())
            .filter_map(|value| match &value.def {
                crate::ir::Def::Op(Op::Operation { which: Operation::DefineField, args }) if args.len() == 3 && args[0] == object => match func.op(args[1]) {
                    Some(&Op::Str(key)) => Some((key, func.ty(args[2]))),
                    _ => None,
                },
                _ => None,
            })
            .collect();
        let layouts: Vec<LayoutId> = self.out.tys.get(to).parts.iter().filter_map(|part| if let Part::Class(layout) = part { Some(*layout) } else { None }).filter(|layout| layout.is_some()).collect();
        for layout in layouts {
            self.resolve_field_types(layout);
            for &(key, have) in &defined {
                let declared = self.out.layouts[layout.idx()].fields.iter().find(|field| field.name == key).map(|field| field.declared);
                if let Some(declared) = declared
                    && declared.is_some()
                    && have.is_some()
                    && declared != have
                {
                    self.record_cast(Ty::of(have), declared, CoerceReason::Cast);
                }
            }
        }
    }

    /// An object that has just been made for the purpose, and that nobody else has seen, as one of the type.
    pub(crate) fn coerce_fresh(&mut self, fx: &mut Fx, value: V, checked: TypeId) -> V {
        if !fx.is_typed {
            return value;
        }
        let want = Ty { id: self.ty_of(checked), checked };
        if fx.b.func.prediction(value) == Prediction::None && want.id != self.out.tys.anything {
            fx.b.func.values[value.idx()].set_prediction(Prediction::Ty(want.id));
        }
        let held = self.coerce_to(fx, value, want, CoerceReason::Cast);
        self.mark_fresh_cast(fx, held, value);
        held
    }

    fn is_fresh_call_result(&mut self, fx: &Fx, value: V, e: ExprId) -> bool {
        let (mut made, mut written) = (value, e);
        while let Some(&Op::Coerce { value: of, .. }) = fx.b.func.op(made) {
            made = of;
        }
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) = self.hir(fx.file)[written].kind {
            written = expr;
        }
        matches!(fx.b.func.op(made), Some(Op::CallDirect { .. })) && self.c.returns_fresh_call_result(fx.file, written)
    }

    pub(crate) fn mark_fresh_cast(&mut self, fx: &mut Fx, held: V, value: V) {
        if let Some(&Op::Coerce { value: of, to, why: CoerceReason::Cast }) = fx.b.func.op(held)
            && (of == value || held == value && matches!(fx.b.func.op(of), Some(Op::NewObject | Op::Operation { .. })))
        {
            fx.b.func.values[held.idx()].def = crate::ir::Def::Op(Op::Coerce { value: of, to, why: CoerceReason::CastFresh });
        }
    }

    pub(crate) fn mark_call_in_tail_position(&mut self, fx: &mut Fx, value: V) {
        let is_call = match fx.b.func.op(value) {
            Some(Op::CallDirect { .. } | Op::Call { .. } | Op::CallMethod { .. }) => true,
            Some(Op::Operation { which, .. }) => *which == Operation::Apply,
            _ => false,
        };
        if is_call {
            fx.b.func.values[value.idx()].set_is_in_tail_position(true);
        }
    }

    /// The value of the expression `e` as the checker's type of `e`. Where the program is not held to that, or it says nothing, the value
    /// is only expected to be something. Where the value goes straight to what holds it to a type that is written down, it is held to
    /// that type instead.
    ///
    /// What the checker has found out about a place on the way to a read of it may no longer hold: see `reference_read`. Then the
    /// value is what the place is declared to hold, and the use that needs more makes sure of it: see `as_narrowed`.
    pub(crate) fn coerce_to_expr_type(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        self.record_span(fx, value, e);
        if fx.calls_in_tail_position.contains(&e) {
            self.mark_call_in_tail_position(fx, value);
        }
        // The expressions within it have been translated since `expr` said so.
        let pos = self.hir(fx.file)[e].pos;
        self.c.set_current_site(fx.file, pos);
        if matches!(self.hir(fx.file)[e].kind, ExprKind::Ident(_) | ExprKind::This) {
            fx.narrowed.remove(&value);
        }
        let said = self.ty(fx, value);
        if fx.is_typed && (said.is_none() || self.out.tys.get(said).any_object) {
            let instances = self.c.find_predicted_nested_class_types(fx.file, e);
            self.record_untyped_inflow_to_nested_classes(instances);
        }
        if fx.is_typed
            && let Some(returned) = self.c.returned_argument_of(fx.file, e)
            && self.c.is_inside_any_context(fx.file, returned)
        {
            return value;
        }
        let value = if fx.is_typed
            && matches!(self.hir(fx.file)[e].kind, ExprKind::Call(_))
            && matches!(fx.b.func.op(value), Some(Op::CallMethod { .. }))
            && self.ty(fx, value) == self.out.tys.anything
            && let Some(made) = self.call_result_ty(fx.file, e)
        {
            let checked = self.c.type_of_expr(fx.file, e);
            self.coerce_to(fx, value, Ty { id: made, checked }, CoerceReason::Claim)
        } else {
            value
        };
        let operation_type = self.ty(fx, value);
        if fx.is_typed
            && operation_type.is_some()
            && self.out.tys.get(operation_type).any_object
            && matches!(fx.b.func.op(value), Some(Op::CallDirect { .. } | Op::Call { .. } | Op::CallMethod { .. }))
            && let Some(made) = self.c.generic_call_allocation(fx.file, e)
        {
            let allocated_as = self.c.type_of_expr(fx.file, e);
            self.c.record_generic_function_result(&made, allocated_as);
            if let Some(sink) = fx.sink
                && sink.e == e
            {
                self.c.record_generic_function_result(&made, sink.want.checked);
            }
        }
        if fx.is_typed && matches!(self.hir(fx.file)[e].kind, ExprKind::Call(_) | ExprKind::New(_)) {
            self.c.record_type_argument_proxies(fx.file, e);
            if self.c.receives_generic_proxy_factory(fx.file, e) {
                let yielded = self.c.type_of_expr(fx.file, e);
                self.c.record_nested_proxies(yielded);
                if let Some(sink) = fx.sink
                    && sink.e == e
                {
                    self.c.record_nested_proxies(sink.want.checked);
                }
            }
        }
        if fx.is_typed && self.ty(fx, value) == self.out.tys.anything && self.c.is_read_from_beyond_layouts(fx.file, e) {
            let read_as = self.c.type_of_expr(fx.file, e);
            self.c.record_untyped_source(read_as);
        }
        // `String(a)`, `list.length`, `this.#count`: the operation says less of what it yields than the text shows. Only of an operation that was made for `e`: a name, `a = b`,
        // `(a, b)` hand on a value that was made elsewhere, and that other paths look at as well.
        if !fx.is_typed
            && matches!(self.hir(fx.file)[e].kind, ExprKind::Call(_) | ExprKind::Dot { .. })
            && !matches!(fx.b.func.op(value), None | Some(Op::Coerce { .. } | Op::FieldGet { .. } | Op::GlobalGet(_)))
        {
            let (shown, have) = (self.ty_from_syntax(fx, e, NumberRole::Value), self.ty(fx, value));
            if shown.is_some() && shown != have && self.is_within(Ty::of(shown), Ty::of(have)) {
                fx.b.func.values[value.idx()].ty = shown;
            }
        }
        // A name, behind a test that it has passed or a store: the variable may hold more than it does here. The cast is tested, and cannot fail.
        let value = if !fx.is_typed && matches!(self.hir(fx.file)[e].kind, ExprKind::Ident(_)) {
            let shown = self.ty_from_syntax(fx, e, NumberRole::Value);
            let shows_a_symbol = shown.is_some() && *self.out.tys.get(shown) == Declared::prims(prim::SYMBOL);
            if shows_a_symbol && self.ty(fx, value) == self.out.tys.intern(Declared::prims(prim::UNDEFINED | prim::SYMBOL)) { value } else { self.coerce_to(fx, value, Ty::of(shown), CoerceReason::Flow) }
        } else {
            value
        };
        let yielded = value;
        let value = if fx.is_typed && !fx.handed_back.contains(&e) { self.as_returned_argument(fx, value, e) } else { value };
        // `e` is looked at more than once, and the next time `value` is the argument already.
        if value != yielded {
            fx.handed_back.insert(e);
        }
        let is_returned_argument = fx.handed_back.contains(&e);
        let is_tested = self.is_tested(fx, e);
        let value = if fx.is_typed && !is_tested { self.coerce_read_through_cast(fx, value, e) } else { value };
        let read = if fx.is_typed { self.c.reference_read(fx.file, e) } else { None };
        // `let a!: T`: wherever the value goes, the read makes sure that something has been stored.
        let value = match read {
            Some(read) if read.is_asserted && !is_tested => {
                // A reference may be nil as it is kept. Not this one from here on, but for a `null` that the type names.
                let described = self.expression_ty(fx, e, read.declared);
                let named = if self.c.parts(read.declared).iter().any(|part| part.is_null()) { prim::NULL } else { 0 };
                let described = Declared { prims: self.out.tys.get(described).prims & !(prim::NULLISH & !named), ..self.out.tys.get(described).clone() };
                let declared = Ty { id: self.out.tys.intern(described), checked: read.declared };
                let text = self.reference_text(fx, e);
                self.coerce_to(fx, value, declared, CoerceReason::NonNull(text))
            }
            _ => value,
        };
        let stays_dictionary = fx.is_typed
            && matches!(fx.b.func.op(value), Some(Op::NewObject))
            && matches!(self.hir(fx.file)[e].kind, ExprKind::Object(_))
            && self.c.contextual_type_of_literal(fx.file, e).is_none_or(|expected| self.ty_of(expected) == self.out.tys.anything)
            && {
                let own = self.c.type_of_expr(fx.file, e);
                self.c.members(own).is_some_and(|members| !members.shape().index.is_empty())
            };
        let may_be_overridden = fx.is_typed && matches!(fx.b.func.op(value), Some(Op::NewObject)) && self.may_be_overridden_by_spread(fx, e);
        let extends_generic_spread = fx.is_typed && matches!(fx.b.func.op(value), Some(Op::NewObject | Op::Operation { .. })) && self.stays_plain_for_generic_spread(fx, e);
        let flows_into_class_as_built = fx.is_typed
            && matches!(fx.b.func.op(value), Some(Op::NewObject | Op::Operation { .. }))
            && matches!(self.hir(fx.file)[e].kind, ExprKind::Object(_))
            && fx.sink.is_some_and(|sink| sink.e == e && sink.want.id.is_some() && self.out.tys.get(sink.want.id).parts.iter().any(|part| matches!(part, Part::Class(_))) && !self.cast_may_allocate(sink.want.id))
            && fx.sink.is_some_and(|sink| !self.stays_plain_for(fx, value, e, sink.want.id));
        if fx.is_typed && (matches!(fx.b.func.op(value), Some(Op::NewObject)) && self.defines_accessor(fx, e) || self.c.returns_redefined_literal(fx.file, e) || stays_dictionary || may_be_overridden || flows_into_class_as_built || extends_generic_spread) {
            let own = self.c.type_of_expr(fx.file, e);
            fx.uncoercible_objects.insert(value, own);
            for slot_type in [Some(own), Some(self.c.widened(own)), self.c.contextual_type_of_literal(fx.file, e)].into_iter().flatten() {
                let slot_type = self.ty_of(slot_type);
                let views = self.layout_types_in(slot_type);
                self.c.accepts_untyped(own, &views);
            }
        }
        if let Some(sink) = fx.sink
            && sink.e == e
            && !self.needs_own_type_before_cast(fx, e, sink.want.id)
        {
            let value = if self.stays_plain_for(fx, value, e, sink.want.id) {
                let own = self.c.type_of_expr(fx.file, e);
                self.coerce_fresh(fx, value, own)
            } else {
                value
            };
            if sink.want.id.is_some()
                && let Some(held) = self.try_pass_uncoerced(fx, value, sink.want, sink.why)
            {
                return held;
            }
            let known_before = fx.checked.get(value).copied();
            if self.c.has_declared_type(fx.file, e) {
                let checked = match read {
                    Some(read) if !read.is_narrowing_reliable && read.declared != TypeId::UNRESOLVED && self.c.coerced_property_read(fx.file, e).is_none() => read.declared,
                    _ => self.value_type(fx, e),
                };
                self.set_checked(fx, value, checked);
            }
            let is_new = matches!(self.hir(fx.file)[e].kind, ExprKind::New(_));
            let want = if is_new { Ty { id: self.without_nullish(sink.want.id), ..sink.want } } else { sink.want };
            // A prediction enters a place that the user annotated: it is asserted here. A host object is no subtype of a record type, so
            // the supertypes that its predicted type is assignable to admit foreign objects.
            if fx.is_typed && self.c.is_predicted(fx.file, e) {
                let (predicted, supertypes) = (self.c.type_of_expr(fx.file, e), self.layout_types_in(want.id));
                self.c.accepts_untyped(predicted, &supertypes);
                self.c.record_untyped_inflow_to_nested(want.checked);
                self.record_untyped_inflow_to_nested_classes_of(want.checked);
                for (held, slot_type) in self.c.nested_inflow_pairs(predicted, want.checked) {
                    self.record_type_flow(held, slot_type);
                    let described = self.ty_of(slot_type);
                    let views = self.layout_types_in(described);
                    self.c.accepts_untyped(held, &views);
                }
            }
            if !is_returned_argument {
                self.record_declared_result_cast(fx, e, want.id);
            }
            let is_literal_as_built = matches!(self.hir(fx.file)[e].kind, ExprKind::Object(_)) && matches!(fx.b.func.op(value), Some(Op::NewObject | Op::Operation { .. }));
            let why = if is_literal_as_built && matches!(sink.why, CoerceReason::NonNull(_)) { CoerceReason::Cast } else { sink.why };
            let held = self.coerce_to(fx, value, want, why);
            if fx.is_typed && why == CoerceReason::Cast && self.is_fresh_call_result(fx, value, e) {
                self.mark_fresh_cast(fx, held, value);
            }
            self.clear_narrowing(fx, e, value, known_before);
            return held;
        }
        if !fx.is_typed || !self.c.has_declared_type(fx.file, e) {
            // The engine holds a value to its type again wherever it resolves the operation. So a prediction has none.
            // The value of a name or of a cast was made for another expression: it may be known for more than this one says, and may have been used as that: `const s = c.d!; if (guard(s)) s.m()` with an `s` that the guard narrows to a tainted type.
            let is_allocated_for_other_type = matches!(
                self.hir(fx.file)[e].kind,
                ExprKind::Ident(_)
                    | ExprKind::As { .. }
                    | ExprKind::Satisfies { .. }
                    | ExprKind::NonNull(_)
                    | ExprKind::AsConst(_)
                    | ExprKind::Assign { op: None, .. }
                    | ExprKind::Cond { .. }
                    | ExprKind::Binary { op: hir::BinOp::Comma | hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish, .. }
            );
            if !is_allocated_for_other_type && matches!(fx.b.func.op(value), Some(Op::PropGet { .. })) {
                self.mark_read_unchecked(fx, value);
            }
            if fx.is_typed && !is_allocated_for_other_type && !is_returned_argument && self.is_checked_at_creation(fx, value) {
                self.problem(fx.file, pos, "this expression (internal error: a predicted type was checked as a declared type; please report it)");
            }
            let predicted = self.predict_expression(fx, value, e);
            if let Some(&own) = fx.uncoercible_objects.get(&value) {
                fx.uncoercible_objects.insert(predicted, own);
            }
            return predicted;
        }
        let why = match fx.b.func.op(value) {
            // What has just been made says itself what it is, and more than the type of the expression does. What a name that the
            // program does not bind stands for, the engine knows. A variable that holds it is read as the variable is written: `coerce_as_annotated`.
            Some(Op::New(_) | Op::NewWith { .. }) if !matches!(self.hir(fx.file)[e].kind, ExprKind::Ident(_)) => return value,
            // So does a function. Which properties it has been given, only the checker's type says, and so with what `Math` has.
            Some(Op::Closure { .. } | Op::ClosureOnce { .. } | Op::FuncRef(_) | Op::FreeGet { .. }) => {
                let checked = self.c.type_of_expr(fx.file, e);
                fx.checked.insert(value, checked);
                return value;
            }
            // A literal with a spread or a computed name, which nobody else has seen: it is made one of its type. One with an accessor
            // besides stays what it is: the type does not tell the accessor from a field.
            Some(Op::NewObject) if self.is_plain_copy_literal(fx, e) || self.is_explicitly_dynamic(fx, e) || self.defines_accessor(fx, e) || self.is_object_assign_target(fx, e) || self.is_copy_source_only(fx, e) => return value,
            Some(Op::NewObject) if self.c.contextual_type_of_literal(fx.file, e).is_some_and(|expected| self.c.is_checked_against_inferred_type(fx.file, e, expected)) => return value,
            Some(Op::NewObject)
                if self.c.contextual_type_of_literal(fx.file, e).is_none_or(|expected| self.ty_of(expected) == self.out.tys.anything) && {
                    let own = self.c.type_of_expr(fx.file, e);
                    self.c.members(own).is_some_and(|members| !members.shape().index.is_empty())
                } =>
            {
                return value;
            }
            Some(Op::NewObject) => CoerceReason::Cast,
            // `{ ...x }`, which is one operation.
            Some(Op::Operation { .. }) if matches!(self.hir(fx.file)[e].kind, ExprKind::Object(_)) => {
                if self.is_explicitly_dynamic(fx, e) || self.is_object_assign_target(fx, e) || self.is_copy_source_only(fx, e) {
                    return value;
                }
                CoerceReason::Cast
            }
            Some(Op::CallDirect { .. } | Op::Call { .. } | Op::CallMethod { .. } | Op::Operation { .. }) if self.is_result_cast_like(fx, e) => CoerceReason::Cast,
            _ if self.ty(fx, value) == self.out.tys.anything => CoerceReason::Claim,
            _ => CoerceReason::Flow,
        };
        let checked = self.value_type(fx, e);
        if why == CoerceReason::Claim && read.is_some_and(|read| self.c.is_uninformative(read.declared)) && self.c.parts(checked).to_vec().into_iter().any(|part| self.c.is_array(part)) {
            return self.predict_expression(fx, value, e);
        }
        let mut want = Ty { id: self.expression_ty(fx, e, checked), checked };
        // What a literal is checked against is what it is made as. `async () => ({ ...base(), b })`, `resolve({ b, ...base() })`: `T | PromiseLike<T>`.
        let value = if why == CoerceReason::Cast && self.stays_plain_for(fx, value, e, want.id) {
            let own = self.c.type_of_expr(fx.file, e);
            self.coerce_fresh(fx, value, own)
        } else {
            value
        };
        if !is_returned_argument {
            self.record_declared_result_cast(fx, e, want.id);
        }
        // Outside the array, where the object has no such key, or before anything is stored to the variable, a read yields `undefined`,
        // which the checker's type leaves out. Whether that matters is for whoever uses the value: `a[i] || 0` is fine, a place for a
        // number is not.
        let may_be_undefined = read.is_some_and(|read| read.may_be_undefined)
            || matches!(fx.b.func.op(value), Some(Op::ElemGet { .. }))
            || matches!(self.hir(fx.file)[e].kind, ExprKind::Index { .. })
            || self.c.is_optional_chain(fx.file, e)
            || self.c.may_return_uninitialized_variable(fx.file, e);
        if may_be_undefined {
            want.id = self.or_undefined_unless_any(want.id);
        }
        if matches!(self.hir(fx.file)[e].kind, ExprKind::New(_)) {
            want.id = self.without_nullish(want.id);
        }
        if let Some(read) = read
            && !read.is_narrowing_reliable
        {
            let mut value = value;
            if why == CoerceReason::Claim && read.declared != TypeId::UNRESOLVED {
                let mut declared = Ty { id: self.expression_ty(fx, e, read.declared), checked: read.declared };
                if may_be_undefined {
                    declared.id = self.or_undefined_unless_any(declared.id);
                }
                value = self.coerce_to(fx, value, declared, why);
            }
            return self.remember_narrowing(fx, value, read.declared, want, e);
        }
        let made = value;
        if matches!(fx.b.func.op(value), Some(Op::Str(_))) {
            let as_string = self.out.tys.get_widened(want.id).clone();
            want.id = self.out.tys.intern(as_string);
        }
        let value = self.coerce_to(fx, value, want, why);
        let mut written = e;
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) = self.hir(fx.file)[written].kind {
            written = expr;
        }
        if let ExprKind::Object(props) = self.hir(fx.file)[written].kind
            && self.methods_needing_home_object(fx, props).is_empty()
        {
            self.mark_fresh_cast(fx, value, made);
        }
        if why == CoerceReason::Cast && self.is_fresh_call_result(fx, made, e) {
            self.mark_fresh_cast(fx, value, made);
        }
        let value = self.coerce_as_annotated(fx, value, want);
        self.set_checked(fx, value, checked);
        // Which function a function is, its type does not say.
        if want.id == self.out.tys.anything || self.out.tys.get(want.id).any_function {
            let predicted = self.predict_expression(fx, value, e);
            self.set_checked(fx, predicted, checked);
            return predicted;
        }
        value
    }

    /// `if (p instanceof URL) return f(p as URL); if (typeof p !== "string") throw ..; p.startsWith(..)`. A name yields the same value wherever it is read, and what a test has shown of
    /// it holds behind that test only. So the checker's type of the name `e` at one read is not left on a value that may be anything: `known_before` is what was known of it.
    fn clear_narrowing(&self, fx: &mut Fx, e: ExprId, value: V, known_before: Option<TypeId>) {
        if !matches!(self.hir(fx.file)[e].kind, ExprKind::Ident(_) | ExprKind::This) || self.ty(fx, value) != self.out.tys.anything {
            return;
        }
        match known_before {
            Some(known) => fx.checked.insert(value, known),
            None => fx.checked.remove(value),
        };
    }

    /// Whether the engine makes sure of the type of the value where it is made: the type says more than the operation vouches for, or the
    /// operation is a cast that may throw.
    fn is_checked_at_creation(&self, fx: &Fx, value: V) -> bool {
        self.ty(fx, value) != self.out.tys.anything
            && matches!(
                fx.b.func.op(value),
                Some(
                    Op::PropGet { .. }
                        | Op::ElemGet { .. }
                        | Op::Call { .. }
                        | Op::CallMethod { .. }
                        | Op::Construct { .. }
                        | Op::Await(_)
                        | Op::Operation { .. }
                        | Op::IterGet { .. }
                        | Op::Coerce { why: CoerceReason::Cast | CoerceReason::CastFresh | CoerceReason::Store | CoerceReason::Flow | CoerceReason::Claim | CoerceReason::NonNull(_), .. }
                )
            )
    }

    /// What a generic function makes goes by the bounds of its type parameters until the test on the way out. `e`: an expression whose value is
    /// held to `want`. If it is a call of such a function: what the function is declared to yield is cast to that.
    fn record_declared_result_cast(&mut self, fx: &Fx, e: ExprId, want: TyId) {
        if want.is_some()
            && matches!(self.hir(fx.file)[e].kind, ExprKind::Call(_))
            && let Some(declared) = self.c.declared_call_result(fx.file, e)
        {
            let declared = Ty { id: self.ty_of(declared), checked: declared };
            self.record_cast(declared, want, CoerceReason::Flow);
            if let Some(operand) = self.c.returned_forced_cast_operand(fx.file, e) {
                let sources = self.layout_types_in(declared.id);
                let may_have_no_layout = self.c.has_unknown_fields(operand);
                for target in self.layout_types_in(want) {
                    self.c.record_forced_cast(&sources, target);
                }
                if may_have_no_layout {
                    let mut held = Vec::new();
                    self.layout_types_within(want, MAX_DESCRIPTION_DEPTH as u32, &mut held);
                    for target in held {
                        self.c.record_untyped(target, operand);
                    }
                }
            }
        }
    }

    /// Whether the value of the expression `e`, which goes straight to a cast to `want`, is held to the checker's type of `e` first all the
    /// same. What a cast makes of an object depends on what the object is known to be: one that `new` has made is turned into one of a
    /// type that extends its own, a function or an object of a class enters as it is. Only what may be plain data is left to the cast
    /// alone: what has a type that says nothing, that a declaration file declares, or that plain data is made one of.
    fn needs_own_type_before_cast(&mut self, fx: &Fx, e: ExprId, want: TyId) -> bool {
        if !self.cast_may_allocate(want) || !self.c.has_declared_type(fx.file, e) {
            return false;
        }
        if matches!(self.hir(fx.file)[e].kind, ExprKind::New(_)) {
            return true;
        }
        let checked = self.value_type(fx, e);
        let own = self.ty_of(checked);
        let described = self.out.tys.get(own);
        own != self.out.tys.anything
            && described.has_objects()
            && !described.any_object
            && (!self.cast_may_allocate(own)
                || matches!(self.hir(fx.file)[e].kind, ExprKind::Dot { .. } | ExprKind::Index { .. }) && matches!((described.single_layout(), self.out.tys.get(want).single_layout()), (Some(read_as), Some(supertypes_of)) if read_as != supertypes_of))
    }

    /// `const wide: Loose = narrow; wide.n = "text"`: an object is accessed as the type of the expression says, whatever else is known of
    /// the value. So what a program does never depends on what the compiler sees through.
    fn coerce_as_annotated(&mut self, fx: &mut Fx, value: V, want: Ty) -> V {
        let have = self.out.tys.get(self.ty(fx, value));
        let (Some(known), Some(written)) = (have.single_layout(), self.out.tys.get(want.id).single_layout()) else { return value };
        if known == written {
            return value;
        }
        let to = if have.prims & prim::NULLISH == 0 { self.without_nullish(want.id) } else { want.id };
        if let Some(&viewed) = fx.fitted.get(&(fx.b.block, value, to)) {
            return viewed;
        }
        let viewed = self.emit(fx, Op::Coerce { value, to, why: CoerceReason::Upcast });
        fx.fitted.insert((fx.b.block, value, to), viewed);
        viewed
    }

    fn or_undefined_unless_any(&mut self, ty: TyId) -> TyId {
        if ty == self.out.tys.anything || self.out.tys.get(ty).is_never() { ty } else { self.or_undefined(ty) }
    }

    /// The type of what `new` yields, which is an object.
    fn without_nullish(&mut self, ty: TyId) -> TyId {
        if ty.is_none() || ty == self.out.tys.anything {
            return ty;
        }
        let described = self.out.tys.get(ty);
        if !described.has_objects() {
            return ty;
        }
        let narrowed = Declared { prims: described.prims & !prim::NULLISH, ..described.clone() };
        self.out.tys.intern(narrowed)
    }

    /// `value`: what the expression `e` yields, which is of the type `declared`. `want`: the checker's type of `e`, which it is not held to.
    fn remember_narrowing(&mut self, fx: &mut Fx, value: V, declared: TypeId, want: Ty, e: ExprId) -> V {
        let have = Ty { id: self.ty(fx, value), checked: declared };
        let is_narrowed = !self.out.tys.get(want.id).is_never() && !self.is_within(have, want);
        let checked = if is_narrowed { declared } else { want.checked };
        if !self.c.is_uninformative(checked) {
            fx.checked.insert(value, checked);
        }
        let read = value;
        let value = if have.id == self.out.tys.anything { self.predict_expression(fx, value, e) } else { value };
        let wanted = self.out.tys.get(want.id);
        let is_only_nullish = wanted.prims & !prim::NULLISH == 0 && wanted.ints.is_none() && !wanted.has_objects();
        if is_narrowed && !is_only_nullish {
            fx.narrowed.insert(value, want);
        } else {
            fx.narrowed.remove(&read);
            fx.narrowed.remove(&value);
        }
        value
    }

    /// The value for a use that goes by its type: what a property, an element or a method is looked for in. If it was read from a place
    /// without being held to the checker's type of the read, it is now, which throws if the place holds something else by now.
    pub(crate) fn as_narrowed(&mut self, fx: &mut Fx, value: V) -> V {
        match fx.narrowed.get(&value) {
            Some(&want) => self.coerce_to(fx, value, want, CoerceReason::Flow),
            None => value,
        }
    }

    /// Whether the type of what the call `e` yields is written down where the function that is called does not make sure of it, or the
    /// call yields an object that nobody else has seen.
    fn is_result_cast_like(&mut self, fx: &Fx, e: ExprId) -> bool {
        let hir = self.hir(fx.file);
        let ExprKind::Call(call) = hir[e].kind else { return false };
        if self.c.is_call_result_annotated(fx.file, e) {
            return true;
        }
        hir.ids(hir[call].args).next().is_some_and(|first| self.is_object_assign_target(fx, first))
    }

    /// `Object.assign({ .. }, a, b)` is `{ .., ...a, ...b }` in other words. Whether `e` is such a literal: it is built as an ordinary
    /// object, and what the call yields is made one of its type. Likewise `Object.defineProperties({ .. }, descriptors)` and the like: what they install under
    /// the name of a member need not be of the type that the member has in the literal.
    pub(crate) fn is_object_assign_target(&mut self, fx: &Fx, e: ExprId) -> bool {
        self.c.is_object_assign_target_literal(fx.file, e)
    }

    /// Whether the value of the expression is only there for its properties to be copied out of it at once: the operand of a spread in an
    /// object literal, an argument of `Object.assign` after the first, or what yields one. Nobody else ever sees it, so a literal there is
    /// an ordinary object. The checker checks it against what the whole is checked against, which it need not be. Also what `Object.create` or `Object.setPrototypeOf` makes a prototype: who reads it holds the heir.
    pub(crate) fn is_copy_source_only(&mut self, fx: &Fx, e: ExprId) -> bool {
        self.c.is_copy_source_only(fx.file, e)
    }

    /// An operation that may throw, and that nothing vouches for the result of, is given the type as the type of what it yields: the
    /// engine makes sure of it there, unless it knows better. Whether that was done.
    fn try_set_result_type(&mut self, fx: &mut Fx, value: V, ty: TyId) -> bool {
        if ty == self.out.tys.anything || self.out.tys.get(ty).is_never() {
            return true;
        }
        if self.shared.constants.logs_type_errors && self.out.tys.get(ty).parts.iter().any(|part| matches!(part, Part::Class(_))) {
            return false;
        }
        let may_throw = matches!(
            fx.b.func.op(value),
            Some(Op::PropGet { .. } | Op::ElemGet { .. } | Op::Call { .. } | Op::CallMethod { .. } | Op::Construct { .. } | Op::Await(_) | Op::Operation { .. } | Op::IterGet { .. })
        );
        // Only where it has just been emitted. A variable that is narrowed later on holds the same value, which is of the narrower type
        // only from there on.
        if value.idx() + 1 != fx.b.func.values.len() {
            return false;
        }
        // Under a handler, what may throw ends its block.
        if !may_throw || !fx.handlers.is_empty() && fx.b.func.blocks[fx.b.block.idx()].ops.contains(&value) {
            return false;
        }
        fx.b.func.values[value.idx()].ty = ty;
        true
    }

    pub(crate) fn new_var(&mut self, fx: &mut Fx, ty: Ty) -> Var {
        let ty = if ty.id.is_some() && self.out.tys.get(ty.id).is_never() { Ty::NONE } else { ty };
        let var = fx.b.new_var(self.or_anything(ty.id));
        let blank = self.default_value_op(ty.id);
        if blank != Op::Undefined {
            let default_ty = self.op_result_type(fx, &blank).id;
            fx.b.set_var_initial_value(var, blank, default_ty);
        }
        if ty.checked != TypeId::UNRESOLVED {
            fx.checked_vars.insert(var, ty.checked);
        }
        var
    }

    /// What a place of the type holds that nothing has been stored to: `undefined`. Where the type has no room for that, the checker has
    /// found every read of the place to come after a store, so nobody gets to see what it holds, and any value of the type does.
    fn default_value_op(&mut self, ty: TyId) -> Op {
        if ty.is_none() {
            return Op::Undefined;
        }
        let (empty, zero) = (self.out.strs.intern(b""), self.out.strs.intern(b"0"));
        let ty = self.out.tys.get(ty);
        match ty.ints {
            _ if ty.prims & prim::UNDEFINED != 0 => Op::Undefined,
            Some((least, _)) => Op::Int(least),
            None if ty.prims & prim::NUMBER != 0 => Op::Int(0),
            None if ty.prims & prim::FALSE != 0 => Op::Bool(false),
            None if ty.prims & prim::TRUE != 0 => Op::Bool(true),
            None if ty.prims & prim::NULL != 0 => Op::Null,
            // In a file that is held to its types a reference has room for nil.
            None if ty.prims & prim::STRING != 0 => Op::Str(empty),
            None if ty.prims & prim::BIGINT != 0 => Op::BigInt(zero),
            None => Op::Undefined,
        }
    }

    pub(crate) fn emit_default_value(&mut self, fx: &mut Fx, ty: TyId) -> V {
        let blank = self.default_value_op(ty);
        self.emit(fx, blank)
    }

    /// An object of exactly the layout.
    pub(crate) fn layout_ty(&mut self, layout: LayoutId) -> TyId {
        self.out.tys.intern(Declared::part(Part::Class(layout)))
    }

    /// What the function is handed next.
    pub(crate) fn add_entry_param(&mut self, fx: &mut Fx, ty: Ty) -> V {
        let value = fx.b.func.add_param(crate::ir::Func::ENTRY, self.or_anything(ty.id));
        if ty.checked != TypeId::UNRESOLVED {
            fx.checked.insert(value, ty.checked);
        }
        value
    }

    pub(crate) fn push_env(&mut self, fx: &mut Fx, layout: LayoutId, env: V) {
        let var = fx.b.new_var(self.layout_ty(layout));
        fx.b.write(var, env);
        fx.envs.push(super::EnvScope { layout, var, shares_activation_with_previous: false });
    }

    /// A variable for the value of the expression `e`, which more than one path yields.
    pub(crate) fn new_result(&mut self, fx: &mut Fx, e: Option<ExprId>) -> Var {
        match e {
            Some(e) if fx.sink.is_some_and(|sink| sink.e == e) => {
                let want = fx.sink.map_or(Ty::NONE, |sink| sink.want);
                self.new_var(fx, want)
            }
            Some(e) if fx.is_typed && self.c.has_declared_type(fx.file, e) => {
                let checked = self.value_type(fx, e);
                let mut ty = Ty { id: self.expression_ty(fx, e, checked), checked };
                if self.c.is_optional_chain(fx.file, e) || self.c.may_return_uninitialized_variable(fx.file, e) {
                    ty.id = self.or_undefined_unless_any(ty.id);
                }
                self.new_var(fx, ty)
            }
            Some(e) if !fx.is_typed => {
                let shown = self.ty_from_syntax(fx, e, NumberRole::Value);
                self.new_var(fx, Ty::of(shown))
            }
            _ => self.new_temporary(fx),
        }
    }

    /// A variable the compiler keeps to itself: whether something has happened.
    pub(crate) fn new_flag(&mut self, fx: &mut Fx) -> Var {
        fx.b.new_var(self.known.boolean)
    }

    /// The same for one of a few numbers.
    pub(crate) fn new_selector(&mut self, fx: &mut Fx) -> Var {
        fx.b.new_var(self.known.int32)
    }

    /// The same for the number of steps a loop has taken, from `first` on.
    pub(crate) fn new_counter(&mut self, fx: &mut Fx, first: i64) -> Var {
        let var = fx.b.new_var(self.known.counter);
        let first = self.emit(fx, Op::Int(first));
        fx.b.write(var, first);
        var
    }

    /// One more step. No loop takes as many as the type has room for.
    pub(crate) fn count(&mut self, fx: &mut Fx, counter: Var, at: V) {
        let one = self.emit(fx, Op::Int(1));
        let next = self.emit(fx, Op::Binary { op: BinOp::Add, a: at, b: one });
        fx.b.func.values[next.idx()].ty = self.known.counter;
        fx.b.write(counter, next);
    }

    /// A variable the compiler keeps to itself, for anything.
    pub(crate) fn new_temporary(&mut self, fx: &mut Fx) -> Var {
        fx.b.new_var(self.out.tys.anything)
    }

    pub(crate) fn write(&mut self, fx: &mut Fx, var: Var, value: V) {
        self.write_as(fx, var, value, CoerceReason::Store);
    }

    /// `why`: `Cast`, if the variable has its type from an annotation.
    pub(crate) fn write_as(&mut self, fx: &mut Fx, var: Var, value: V, why: CoerceReason) {
        let want = Ty { id: fx.b.var_type(var), checked: fx.checked_vars.get(&var).copied().unwrap_or(TypeId::UNRESOLVED) };
        let value = self.coerce_to(fx, value, want, why);
        fx.b.write(var, value);
    }

    /// The same for the left operand of `&&` on the falsy path. No object is falsy: `declaration && diagnosticOf(declaration)` hands on
    /// `undefined`, never a declaration, so no declaration is cast to a diagnostic.
    pub(crate) fn write_falsy_as(&mut self, fx: &mut Fx, var: Var, value: V, why: CoerceReason) {
        let want = Ty { id: fx.b.var_type(var), checked: fx.checked_vars.get(&var).copied().unwrap_or(TypeId::UNRESOLVED) };
        let have = Ty { id: self.ty(fx, value), checked: self.checked(fx, value) };
        let described = self.out.tys.get(have.id);
        let falsy = Declared { prims: described.prims, ints: described.ints, ..Declared::never() };
        let is_narrowable = have.id != self.out.tys.anything && described.has_objects() && !falsy.is_never();
        if !is_narrowable || want.id.is_none() || self.is_within(have, want) {
            return self.write_as(fx, var, value, why);
        }
        let to = self.out.tys.intern(falsy);
        let value = self.emit_throwing(fx, Op::Coerce { value, to, why: CoerceReason::Flow });
        self.write_as(fx, var, value, why);
    }

    pub(crate) fn read(&mut self, fx: &mut Fx, var: Var) -> V {
        let value = fx.b.read(var);
        if let Some(&checked) = fx.checked_vars.get(&var) {
            fx.checked.entry(value).or_insert(checked);
        }
        value
    }

    /// Goes one way if the value is truthy, else the other.
    pub(crate) fn branch(&mut self, fx: &mut Fx, cond: V, then: crate::id::BlockId, otherwise: crate::id::BlockId) {
        let boolean = Ty::of(self.known.boolean);
        let have = Ty::of(self.ty(fx, cond));
        let cond = if self.is_within(have, boolean) { cond } else { self.emit(fx, Op::Truthy(cond)) };
        fx.b.branch(cond, then, otherwise);
    }

    /// `return value`. `NONE`: `undefined`.
    pub(crate) fn terminate_with_return(&mut self, fx: &mut Fx, value: V) {
        if !fx.b.is_open() {
            return;
        }
        // Where every path has returned, nothing gets here.
        if value.is_none() && fx.b.block != crate::ir::Func::ENTRY && !fx.b.has_preds(fx.b.block) {
            return fx.b.terminate(Term::Unreachable);
        }
        let mut value = value;
        if let Some((want, why)) = self.return_coercion(fx) {
            if value.is_none() {
                value = self.emit(fx, Op::Undefined);
            }
            value = self.coerce_to(fx, value, want, why);
        }
        fx.b.terminate(Term::Return(value));
    }

    /// What the function holds to what it returns, and why. What an async function or a generator is declared to yield is the promise
    /// or the generator, which the engine makes.
    pub(crate) fn return_coercion(&self, fx: &Fx) -> Option<(Ty, CoerceReason)> {
        let func = &self.out.funcs[fx.id.idx()];
        if func.result.is_none() || func.has(func_flags::ASYNC | func_flags::GENERATOR) {
            return None;
        }
        let signature = self.signatures.get(&fx.id);
        let want = Ty { id: func.result, checked: signature.and_then(|signature| signature.result).unwrap_or(TypeId::UNRESOLVED) };
        Some((want, if signature.is_some_and(|signature| signature.is_result_annotated) { CoerceReason::Cast } else { CoerceReason::Store }))
    }

    /// An object that is one of several types of the program, looked at as what those have in common: that is all that can be got at
    /// without knowing which it is. So whatever is accessed by name is looked at as one type.
    fn as_common_supertype(&mut self, fx: &mut Fx, obj: V, name: StrId) -> V {
        // A narrowed type that is not reliable is applied, and tested, only where the use needs it. A field of the declared type does not:
        // `cur = a; change(); cur.flags`, where `change` assigns the captured `cur` and `flags` is in every member of its union.
        let obj = if fx.narrowed.contains_key(&obj) && self.has_declared_field(fx, obj, name) { obj } else { self.as_narrowed(fx, obj) };
        let ty = self.out.tys.get(self.ty(fx, obj));
        let is_of_several = ty.parts.len() > 1 && ty.parts.iter().all(|part| matches!(part, Part::Class(_)));
        // A union of many types is described by what they have in common and nothing else (`MAX_LAYOUTS_IN_UNION`), which need not have the
        // field: `(type as ObjectFlagsType).objectFlags`.
        let has_shared_description = matches!(ty.parts[..], [Part::Class(layout)] if self.out.layouts[layout.idx()].field(name).is_none());
        if !(is_of_several || has_shared_description) || ty.prims & !prim::NULLISH != 0 || ty.ints.is_some() || ty.any_object || ty.any_function {
            return obj;
        }
        let checked = self.checked(fx, obj);
        if self.c.is_uninformative(checked) {
            return obj;
        }
        let union = self.c.non_nullable(checked);
        if has_shared_description && self.c.parts(union).len() < 2 {
            return obj;
        }
        let mut common = self.c.common_supertype_of_union(union);
        // `(node as NamedDeclaration).name`, where the object may be any node: not all of them have it. Then it is looked at as what has
        // the properties of all of them, and what the object lacks is found the general way.
        // So where one of the parts is a view of anything, `const get = () => x as P; get().s`: what the parts have in common says nothing
        // of what such an object has.
        let lacks_it = |b: &Self, layout: Option<LayoutId>| layout.is_none_or(|layout| b.out.layouts[layout.idx()].field(name).is_none());
        let in_common = self.record_layout(common);
        let may_be_anything = self.c.parts(union).iter().any(|&part| self.c.is_coerced_unknown_type(part));
        if may_be_anything || lacks_it(self, in_common) {
            let either = self.c.union_all_members_type(union);
            let of_either = self.record_layout(either);
            if !lacks_it(self, of_either) {
                common = either;
            }
        }
        if self.record_layout(common).is_none() {
            return obj;
        }
        let want = Ty { id: self.ty_of(common), checked: common };
        let have = Ty { id: self.ty(fx, obj), checked };
        if !self.is_within(have, want) {
            return obj;
        }
        if let Some(&viewed) = fx.fitted.get(&(fx.b.block, obj, want.id)) {
            return viewed;
        }
        let viewed = self.emit(fx, Op::Coerce { value: obj, to: want.id, why: CoerceReason::Upcast });
        fx.fitted.insert((fx.b.block, obj, want.id), viewed);
        fx.checked.insert(viewed, common);
        viewed
    }

    /// Whether every layout the value can have by its own type has the field.
    fn has_declared_field(&mut self, fx: &Fx, obj: V, name: StrId) -> bool {
        let ty = self.out.tys.get(self.ty(fx, obj)).clone();
        !ty.parts.is_empty()
            && !ty.any_object
            && !ty.any_function
            && ty.prims & !prim::NULLISH == 0
            && ty.ints.is_none()
            && ty.parts.iter().all(|part| matches!(part, Part::Class(layout) if self.out.layouts[layout.idx()].field(name).is_some() || self.has_class_method(*layout, name)))
    }

    fn has_class_method(&mut self, mut layout: LayoutId, name: StrId) -> bool {
        while layout.is_some() {
            if let Some(&(file, class)) = self.fixed_layout_classes.get(&layout) {
                self.define_class(file, class);
            }
            let described = &self.out.layouts[layout.idx()];
            if described.methods.iter().any(|method| method.name == name && method.flags & crate::ir::method_flags::STATIC == 0) {
                return true;
            }
            layout = described.base;
        }
        false
    }

    pub(crate) fn widen_literal_string(&mut self, fx: &mut Fx, value: V) -> V {
        if value.is_none() || !fx.b.is_open() || !self.out.tys.get(self.ty(fx, value)).has_literal_string() {
            return value;
        }
        let checked = self.checked(fx, value);
        let as_string = self.out.tys.get(self.ty(fx, value)).clone().with_literal_string_widened();
        let to = self.out.tys.intern(as_string);
        if let Some(&held) = fx.fitted.get(&(fx.b.block, value, to)) {
            return held;
        }
        let held = match fx.b.func.op(value) {
            Some(&Op::Str(text)) => fx.b.emit(Op::Str(text), self.known.string),
            _ => fx.b.emit(Op::Coerce { value, to, why: CoerceReason::Upcast }, to),
        };
        fx.fitted.insert((fx.b.block, value, to), held);
        if checked != TypeId::UNRESOLVED {
            fx.checked.insert(held, checked);
        }
        held
    }

    fn widen_literal_string_operands(&mut self, fx: &mut Fx, op: Op) -> Op {
        let mut has_one = false;
        op.for_each_operand(|operand| has_one |= operand.is_some() && self.out.tys.get(fx.b.func.ty(operand)).has_literal_string());
        if !has_one {
            return op;
        }
        match op {
            Op::GlobalSet(..) | Op::FieldSet { .. } | Op::NewWith { .. } | Op::Coerce { .. } | Op::Closure { .. } | Op::ClosureOnce { .. } | Op::CallDirect { .. } | Op::Not(_) | Op::Truthy(_) | Op::IsNullish(_) => op,
            Op::PropSet { obj, name, value } => Op::PropSet { obj: self.widen_literal_string(fx, obj), name, value },
            Op::StrictEq { a, b } => {
                let compares_unconverted = |this: &Self, other: V| {
                    let described = this.out.tys.get(fx.b.func.ty(other));
                    described.has_literal_string() || matches!(fx.b.func.op(other), Some(Op::Str(_))) || !described.has_objects() && described.ints.is_none() && described.prims & !prim::NULLISH == 0
                };
                if compares_unconverted(self, a) && compares_unconverted(self, b) {
                    return op;
                }
                Op::StrictEq { a: self.widen_literal_string(fx, a), b: self.widen_literal_string(fx, b) }
            }
            mut op => {
                let mut operands: Vec<V> = Vec::new();
                op.for_each_operand(|operand| operands.push(operand));
                let mut held: Vec<V> = Vec::with_capacity(operands.len());
                for operand in operands {
                    held.push(self.widen_literal_string(fx, operand));
                }
                let mut next = held.into_iter();
                op.for_each_operand_mut(|operand| {
                    if let Some(held) = next.next() {
                        *operand = held;
                    }
                });
                op
            }
        }
    }

    /// The operands that enter places, as what the places hold. What is stored to a variable of the source has been seen to by
    /// `write_sym`, which knows whether the type of the variable is written down.
    pub(crate) fn coerce_operands(&mut self, fx: &mut Fx, op: Op) -> Op {
        let op = self.widen_literal_string_operands(fx, op);
        if let Op::PropSet { obj, .. } | Op::ElemSet { obj, .. } = op {
            let stored_to = self.checked(fx, obj);
            for dictionary in self.c.dictionaries_in(stored_to) {
                self.c.record_read_only_passed_on(dictionary);
            }
        }
        let op = match op {
            Op::PropGet { obj, name } => Op::PropGet { obj: self.as_common_supertype(fx, obj, name), name },
            Op::PropSet { obj, name, value } => Op::PropSet { obj: self.as_common_supertype(fx, obj, name), name, value },
            Op::PropHas { obj, name } => Op::PropHas { obj: self.as_common_supertype(fx, obj, name), name },
            Op::PropDelete { obj, name } => Op::PropDelete { obj: self.as_narrowed(fx, obj), name },
            Op::CallMethod { obj, name, args } => Op::CallMethod { obj: self.as_common_supertype(fx, obj, name), name, args },
            Op::ElemGet { obj, key } => Op::ElemGet { obj: self.as_narrowed(fx, obj), key },
            Op::ElemSet { obj, key, value } => Op::ElemSet { obj: self.as_narrowed(fx, obj), key, value },
            Op::ElemHas { obj, key } => Op::ElemHas { obj: self.as_narrowed(fx, obj), key },
            Op::ElemDelete { obj, key } => Op::ElemDelete { obj: self.as_narrowed(fx, obj), key },
            op => op,
        };
        match op {
            Op::GlobalSet(global, value) => {
                let want = Ty { id: self.out.globals[global.idx()].declared, checked: self.checked_globals.get(&global).copied().unwrap_or(TypeId::UNRESOLVED) };
                Op::GlobalSet(global, self.coerce_to(fx, value, want, CoerceReason::Store))
            }
            Op::FieldSet { obj, layout, field, value } => {
                let (want, why) = (self.field_type(layout, field), self.field_cast_reason(layout, field));
                Op::FieldSet { obj, layout, field, value: self.coerce_to(fx, value, want, why) }
            }
            Op::PropSet { obj, name, value } => match self.store_target_field(self.ty(fx, obj), name) {
                Some((want, why)) => Op::PropSet { obj, name, value: self.coerce_to(fx, value, want, why) },
                None => op,
            },
            Op::CallDirect { func, mut args } => {
                let callee = &self.out.funcs[func.idx()];
                let (this, params) = (callee.declared_this_type, callee.params.clone());
                let reasons: Vec<CoerceReason> = (0..params.len()).map(|i| callee.param_cast_reason(i)).collect();
                let mut at = callee.captures.len();
                let has_this = callee.has(func_flags::HAS_THIS);
                let signature = self.signatures.get(&func).cloned().unwrap_or_default();
                if has_this {
                    if at < args.len() {
                        let want = Ty { id: this, checked: signature.this.unwrap_or(TypeId::UNRESOLVED) };
                        args[at] = self.coerce_to(fx, args[at], want, CoerceReason::Store);
                    }
                    at += 1;
                }
                for (i, &param) in params.iter().enumerate() {
                    if at + i >= args.len() {
                        break;
                    }
                    let want = Ty { id: param, checked: signature.params.get(i).copied().unwrap_or(TypeId::UNRESOLVED) };
                    args[at + i] = self.coerce_to(fx, args[at + i], want, reasons[i]);
                }
                Op::CallDirect { func, args }
            }
            op => op,
        }
    }

    // ───────────────────────────── one type within another ─────────────────────────────

    /// Whether every value of the one type is one of the other, so that nothing has to be tested.
    pub(crate) fn is_within(&mut self, have: Ty, want: Ty) -> bool {
        // What an array, a map or a dictionary holds enters with it, and is described by neither type.
        let entering = self.c.nested_inflow_pairs(have.checked, want.checked);
        if !entering.is_empty() {
            self.c.descend_into_checked_value();
            for (held, slot_type) in entering {
                self.record_type_flow(held, slot_type);
            }
            self.c.ascend_from_checked_value();
        }
        if have.checked != want.checked && !self.c.dictionaries_in(want.checked).is_empty() {
            for record in self.layout_types_in(have.id) {
                for dictionary in self.c.dictionaries_wider_than(want.checked, record) {
                    self.c.record_stored_read_only(record, dictionary);
                }
            }
            if have.id.is_some() && want.id.is_some() && self.out.tys.get(have.id).has_objects() && self.out.tys.get(want.id).has_objects() {
                let held = self.c.dictionaries_in(have.checked);
                if !held.is_empty() {
                    let others = self.c.dictionaries_in(want.checked);
                    for &dictionary in &held {
                        for &other in others.iter().filter(|&&other| other != dictionary) {
                            self.c.record_stored_read_only(dictionary, other);
                        }
                    }
                }
            }
        }
        if have.id == want.id || want.id == self.out.tys.anything {
            return true;
        }
        if have.id == self.out.tys.anything && self.is_ambient_only(have.checked) {
            let views = self.layout_types_in(want.id);
            self.c.accepts_untyped(have.checked, &views);
        }
        let (a, b) = (self.out.tys.get(have.id), self.out.tys.get(want.id));
        let lacked = a.prims & !b.prims;
        if (if b.prims & prim::STRING != 0 { lacked & !prim::LITERAL_STRING } else { lacked }) != 0 {
            return false;
        }
        if let Some((least, most)) = a.ints
            && b.prims & prim::NUMBER == 0
            && !b.ints.is_some_and(|within| within.0 <= least && most <= within.1)
        {
            return false;
        }
        if b.any_object {
            return true;
        }
        let found = match self.layout_subset_pairs.get(&(have.id, want.id)) {
            Some(known) => known.clone(),
            None => {
                let not_known_before = self.c.unknown_count();
                let found = self.find_layout_subset_pairs(have.id, want.id);
                if self.c.unknown_count() == not_known_before {
                    self.layout_subset_pairs.insert((have.id, want.id), found.clone());
                }
                found
            }
        };
        let Some((upcasts, is_foreign)) = found else { return false };
        // An object that is not laid out, an array, a function, what a package makes, is of a type of the program if the checker's type
        // of it is assignable to that. The layout then stands for such objects too.
        if is_foreign {
            // What is of a type of the program and not laid out is a literal that has yet to be made one of that type.
            if self.type_has_fixed_layout(have.checked) {
                return false;
            }
            let views = self.layout_types_in(want.id);
            if !self.c.accepts_untyped(have.checked, &views) {
                return false;
            }
            if want.checked == TypeId::UNRESOLVED {
                self.c.descend_into_checked_value();
                for view in views {
                    for (held, slot_type) in self.c.nested_inflow_pairs(have.checked, view) {
                        self.record_type_flow(held, slot_type);
                    }
                }
                self.c.ascend_from_checked_value();
            }
        }
        // Whoever asks leaves out a test. The checker sees to it that the members of the one layout are members of the other.
        for &(from, to) in upcasts.iter() {
            self.c.record_upcast(self.layout_types[&from], self.layout_types[&to]);
        }
        true
    }

    fn find_layout_subset_pairs(&mut self, have: TyId, want: TyId) -> Option<(Rc<[(LayoutId, LayoutId)]>, bool)> {
        let (a, b) = (self.out.tys.get(have).clone(), self.out.tys.get(want).clone());
        let mut upcasts: Vec<(LayoutId, LayoutId)> = Vec::new();
        let mut is_foreign = a.any_object || a.any_function && !b.any_function;
        for part in &a.parts {
            match (part, b.parts.iter().find(|other| self.is_part_subset(part, other))) {
                (&Part::Class(from), Some(&Part::Class(to))) if from != to => upcasts.push((from, to)),
                (_, Some(_)) => {}
                (Part::Class(_), None) => return None,
                (_, None) => is_foreign = true,
            }
        }
        Some((upcasts.into(), is_foreign))
    }

    pub(crate) fn type_has_fixed_layout(&mut self, checked: TypeId) -> bool {
        if checked == TypeId::UNRESOLVED || self.c.is_uninformative(checked) {
            return false;
        }
        let described = self.ty_of(checked);
        self.out.tys.get(described).parts.iter().any(|part| matches!(part, Part::Class(_)))
    }

    fn is_part_subset(&mut self, part: &Part, other: &Part) -> bool {
        match (part, other) {
            (&Part::Class(a), &Part::Class(b)) => a == b || self.is_upcast(a, b),
            (Part::Array(_), Part::Array(_)) => true,
            (Part::Global(a, _), Part::Global(b, _)) => a == b,
            _ => false,
        }
    }

    /// Whether an object that is looked at as the one layout says can be looked at as the other says without a test.
    fn is_upcast(&mut self, from: LayoutId, to: LayoutId) -> bool {
        let (Some(&source), Some(&target)) = (self.layout_types.get(&from), self.layout_types.get(&to)) else { return false };
        self.c.is_upcast_safe(source, target)
    }

    // ───────────────────────────── what the checker is told ─────────────────────────────

    /// The value of the expression `value` is stored to the field `name` of an object of the layout, which may hold a function. `is_birth`:
    /// as a part of its allocation.
    pub(crate) fn record_stored_callee(&mut self, fx: &Fx, layout: LayoutId, name: Atom, value: ExprId, is_birth: bool) {
        if !self.layout_types.contains_key(&layout) {
            return;
        }
        let field = self.str(name);
        let Some(field) = self.out.layouts[layout.idx()].field(field) else { return };
        self.record_field_stored_callee(fx, layout, field, name, value, is_birth);
    }

    pub(crate) fn record_field_stored_callee(&mut self, fx: &Fx, layout: LayoutId, field: u32, name: Atom, value: ExprId, is_birth: bool) {
        let Some(&holder) = self.layout_types.get(&layout) else { return };
        let declared = self.out.layouts[layout.idx()].fields[field as usize].declared;
        if declared.is_none() || self.out.tys.get(declared).any_function {
            self.c.record_stored_callee(holder, name, fx.file, value, is_birth);
        }
    }

    /// Objects of the layout are made.
    pub(crate) fn record_allocation(&mut self, layout: LayoutId) {
        match self.layout_types.get(&layout) {
            Some(&ty) => self.c.record_allocation(ty),
            // An environment: no type stands for it, and it is looked at as nothing else.
            None => self.out.layouts[layout.idx()].is_allocated = true,
        }
    }

    /// The checker's types of the layouts that an object of the type is looked at as.
    pub(crate) fn layout_types_in(&self, ty: TyId) -> Vec<TypeId> {
        if ty.is_none() {
            return Vec::new();
        }
        (self.out.tys.get(ty).parts.iter()).filter_map(|part| if let Part::Class(layout) = part { self.layout_types.get(layout).copied() } else { None }).collect()
    }

    /// A value of the type `have` is held to `want`, and a test is made: a flow that only what passes takes. `why`: `as` and a place whose type
    /// is written down make an object of a layout of `want` of plain data, those and a type guard may turn an object into one where it
    /// is, and anything else only makes sure.
    ///
    /// Where the operations say nothing of the value, the checker's type vouches for it: an element, what an indirect call yields.
    pub(crate) fn record_cast(&mut self, have: Ty, want: TyId, why: CoerceReason) {
        self.record_cast_at_depth(have, want, why, 0);
    }

    fn record_cast_at_depth(&mut self, have: Ty, want: TyId, why: CoerceReason, depth: u8) {
        let (may_copy, may_convert) = (matches!(why, CoerceReason::Cast | CoerceReason::Coerce), matches!(why, CoerceReason::Cast | CoerceReason::Coerce | CoerceReason::Flow));
        let is_trusted = self.out.tys.get(have.id).any_object;
        let is_told = is_trusted && have.checked != TypeId::UNRESOLVED && !self.c.is_untyped(have.checked);
        let known = if is_told { self.ty_of(have.checked) } else { have.id };
        let sources = self.layout_types_in(known);
        let targets = self.layout_types_in(want);
        if is_trusted {
            self.c.record_untyped_inflow_to_union_members(&targets);
        }
        for target in targets {
            self.c.record_cast(&sources, target, may_copy && is_trusted, is_trusted, may_convert, may_convert && !may_copy);
        }
        // The elements of an array are cast with it, or where they are read.
        let elements_in = |this: &Self, ty: TyId| -> Vec<TyId> { (this.out.tys.get(ty).parts.iter()).filter_map(|part| if let Part::Array(elements) = part { Some(*elements) } else { None }).collect() };
        if depth == MAX_DESCRIPTION_DEPTH {
            return;
        }
        let held = elements_in(self, known);
        for slot_type in elements_in(self, want) {
            if held.is_empty() && is_trusted {
                self.record_cast_at_depth(Ty::of(have.id), slot_type, why, depth + 1);
            }
            for &held in &held {
                self.record_cast_at_depth(Ty::of(held), slot_type, why, depth + 1);
            }
        }
    }

    pub(crate) fn layout_types_within(&self, ty: TyId, further: u32, found: &mut Vec<TypeId>) {
        found.extend(self.layout_types_in(ty));
        if ty.is_none() || further == 0 {
            return;
        }
        for part in &self.out.tys.get(ty).parts {
            match part {
                Part::Class(_) => {}
                Part::Array(elements) => self.layout_types_within(*elements, further - 1, found),
                Part::Global(_, arguments) => arguments.iter().for_each(|&argument| self.layout_types_within(argument, further - 1, found)),
            }
        }
    }

    fn external_origin_path(&self, fx: &Fx, value: V, further: u32) -> Option<usize> {
        let is_uninformative = |v: V| {
            let ty = self.ty(fx, v);
            ty.is_none() || ty == self.out.tys.anything || self.out.tys.get(ty).parts.is_empty()
        };
        let behind = |from: V| if further > 0 { self.external_origin_path(fx, from, further - 1) } else { None };
        match fx.b.func.op(value) {
            Some(&Op::Call { callee, .. }) => behind(callee).map(|_| 1),
            Some(&Op::Construct { callee, .. }) => behind(callee).map(|_| 2),
            Some(Op::FreeGet { .. } | Op::ExternalModule(_)) => Some(3),
            Some(Op::Caught | Op::CaughtException | Op::Yield(_)) => Some(4),
            Some(&(Op::PropGet { obj, .. } | Op::ElemGet { obj, .. } | Op::CallMethod { obj, .. })) => is_uninformative(obj).then_some(5),
            Some(&(Op::Await(from) | Op::IterGet { iter: from, .. } | Op::IterOpen(from) | Op::Coerce { value: from, .. })) => behind(from),
            None => (self.ty(fx, value) == self.out.tys.anything && fx.b.func.blocks[0].params.contains(&value)).then_some(6),
            _ => None,
        }
    }

    /// The value of an expression whose type says nothing of it is held to the type. If that is the type of a function, what the
    /// function yields is as little known, and is held to what the type says it yields.
    fn record_untyped_inflow_into_wide_data(&mut self, want: TypeId) {
        for wide in self.c.wide_data_records_in(want) {
            let described = self.ty_of(wide);
            for view in self.layout_types_in(described) {
                self.c.record_untyped_inflow(view);
            }
        }
    }

    pub(crate) fn record_produced_types(&mut self, checked: TypeId, admits_anything: bool) {
        for result in self.c.produced_types(checked) {
            let awaited = self.c.awaited(result);
            self.record_untyped_inflow_to_nested_classes_of(result);
            self.record_untyped_inflow_to_nested_classes_of(awaited);
            let mut targets = Vec::new();
            for held in [result, awaited] {
                let held = self.ty_of(held);
                self.layout_types_within(held, 3, &mut targets);
            }
            for target in targets {
                self.c.record_untyped_inflow(target);
                if admits_anything || self.c.is_instance_type(target) {
                    self.c.record_untyped(target, TypeId::ANY);
                }
            }
        }
    }

    pub(crate) fn record_any_inflow(&mut self, want: Ty) {
        for target in self.layout_types_in(want.id) {
            self.c.record_any_inflow(target);
        }
        let mut records = self.c.records_in(want.checked);
        for result in self.c.call_results(want.checked) {
            records.extend(self.c.records_in(result));
        }
        for record in records {
            let described = self.ty_of(record);
            for view in self.layout_types_in(described) {
                self.c.record_any_inflow(view);
            }
        }
    }

    fn record_untyped_inflow_into_nested_unions(&mut self, ty: TyId, further: u32) {
        let arms = self.layout_types_in(ty);
        self.c.record_untyped_inflow_to_union_members(&arms);
        if ty.is_none() || further == 0 {
            return;
        }
        for part in self.out.tys.get(ty).parts.clone() {
            match part {
                Part::Class(_) => {}
                Part::Array(elements) => self.record_untyped_inflow_into_nested_unions(elements, further - 1),
                Part::Global(_, arguments) => arguments.iter().for_each(|&argument| self.record_untyped_inflow_into_nested_unions(argument, further - 1)),
            }
        }
    }

    pub(crate) fn record_untyped_inflow_to_nested_classes_of(&mut self, checked: TypeId) {
        let instances = self.c.find_nested_class_types(checked);
        self.record_untyped_inflow_to_nested_classes(instances);
    }

    pub(crate) fn record_untyped_inflow_to_nested_classes(&mut self, types_of_instances: Vec<TypeId>) {
        for instances in types_of_instances {
            let described = self.ty_of(instances);
            for view in self.layout_types_in(described) {
                self.c.record_untyped_inflow(view);
                self.c.record_untyped(view, TypeId::ANY);
            }
        }
    }

    fn record_untyped_inflow_into_host_object(&mut self, entering: TypeId, want: Ty) {
        if want.id == self.out.tys.anything && want.checked != TypeId::UNRESOLVED && self.c.is_untyped(entering) && self.is_ambient_only(want.checked) {
            self.record_untyped_inflow(want);
        }
    }

    pub(crate) fn record_untyped_inflow(&mut self, want: Ty) {
        self.record_untyped_inflow_into_nested_unions(want.id, 4);
        for target in self.layout_types_in(want.id) {
            self.c.record_untyped_inflow(target);
            if self.c.is_instance_type(target) {
                self.c.record_untyped(target, TypeId::ANY);
            }
        }
        self.record_untyped_inflow_to_nested_classes_of(want.checked);
        self.record_produced_types(want.checked, false);
        self.record_untyped_inflow_into_wide_data(want.checked);
        for result in self.c.call_results(want.checked) {
            let result = self.ty_of(result);
            self.record_untyped_inflow_into_nested_unions(result, 4);
            for target in self.layout_types_in(result) {
                self.c.record_untyped_inflow(target);
            }
        }
        self.c.record_untyped_inflow_to_nested(want.checked);
    }

    /// `{}`, `b ? {} : { a: 1 }`: the checker's type of an empty literal says nothing, but the object is made here, as what it is checked against. Where it is
    /// made an ordinary object after all, the cast that lets it in says so (`record_cast`).
    fn is_object_literal(&self, fx: &Fx, e: ExprId) -> bool {
        match self.hir(fx.file)[e].kind {
            ExprKind::Object(_) => true,
            ExprKind::Cond { yes, no, .. } => self.is_object_literal(fx, yes) && self.is_object_literal(fx, no),
            _ => false,
        }
    }

    /// The expression `e` is cast to `want`, or goes to a place whose type is written down. It is the text that counts: `f as unknown as
    /// Maker` yields the value of `f`, of which more is known, and says that nothing is.
    pub(crate) fn record_cast_source(&mut self, fx: &Fx, e: ExprId, want: Ty) {
        if e.is_none() || self.c.is_syntactically_nullish(fx.file, e) {
            return;
        }
        self.c.record_proxies_returned_through(fx.file, e, want.checked);
        let source = self.c.type_of_expr(fx.file, e);
        if self.c.is_untyped(source) && !self.is_object_literal(fx, e) {
            self.record_untyped_inflow(want);
            if self.c.is_any_like(source) {
                self.record_any_inflow(want);
            }
        }
        if self.c.may_return_namespace(fx.file, e) || self.c.creates_proxy(fx.file, e) {
            self.c.set_current_site(fx.file, self.hir(fx.file)[e].pos);
            for view in self.layout_types_in(want.id) {
                self.c.record_untyped(view, source);
            }
        }
        if let Some(origin) = self.c.data_origin(fx.file, e) {
            self.c.set_current_site(fx.file, self.hir(fx.file)[e].pos);
            self.c.record_types_staying_untyped(want.checked, false, origin);
        }
    }

    /// The value of `e` goes where the checker has a type for it, and the translated program need not have a place of that type: an
    /// argument of `map.set`, an element of an array literal. What `coerce_to` takes note of where a value enters a place is taken note of
    /// all the same. A function that is handed to code that is not compiled with the program is called with what the type there says,
    /// which enters its parameters.
    pub(crate) fn record_implicit_flow(&mut self, fx: &Fx, e: ExprId) {
        let untyped_target = self.c.destination_type_of_untyped_expr(fx.file, e);
        if fx.is_typed
            && let Some(target) = untyped_target
        {
            self.record_untyped_inflow_into_wide_data(target);
            let source = self.c.type_of_expr(fx.file, e);
            if self.c.is_any_like(source) {
                let id = self.ty_of(target);
                self.record_any_inflow(Ty { id, checked: target });
            }
        }
        if let Some((source, target)) = self.c.spread_destination_types(fx.file, e) {
            self.record_type_flow(source, target);
        }
        for (declared, parameter) in self.c.generic_callback_parameters(fx.file, e) {
            let (have, want) = (Ty { id: self.ty_of(declared), checked: declared }, self.ty_of(parameter));
            self.record_cast(have, want, CoerceReason::Flow);
        }
        // What the sources have enters what the target has by the same names.
        if let ExprKind::Call(call) = self.hir(fx.file)[e].kind
            && self.c.is_object_assign(fx.file, e)
        {
            let hir = self.hir(fx.file);
            let mut arguments = hir.ids(hir[call].args);
            if let Some(target) = arguments.next() {
                let target = self.c.type_of_expr(fx.file, target);
                let described = self.ty_of(target);
                if self.layout_types_in(described).is_empty() {
                    let yielded = self.c.type_of_expr(fx.file, e);
                    let yielded = self.ty_of(yielded);
                    for view in self.layout_types_in(yielded) {
                        self.c.record_untyped(view, target);
                    }
                }
                for source in arguments {
                    for (of, name, value) in self.c.copied_named_values(fx.file, source) {
                        if self.c.is_predicted(of, value)
                            && let Some(slot_type) = self.c.type_of_property(target, name)
                        {
                            let (predicted, described) = (self.c.type_of_expr(of, value), self.ty_of(slot_type));
                            let views = self.layout_types_in(described);
                            self.c.accepts_untyped(predicted, &views);
                        }
                    }
                    let source = self.c.type_of_expr(fx.file, source);
                    for (held, slot_type) in self.c.assigned_property_types(source, target) {
                        self.record_type_flow(held, slot_type);
                    }
                }
            }
        }
        if let Some(target) = untyped_target {
            return self.record_type_flow(TypeId::ANY, target);
        }
        let Some(target) = self.c.destination_type_of_expr(fx.file, e) else { return };
        if fx.is_typed && self.c.is_predicted(fx.file, e) {
            let described = self.ty_of(target);
            let (predicted, supertypes) = (self.c.type_of_expr(fx.file, e), self.layout_types_in(described));
            self.c.accepts_untyped(predicted, &supertypes);
            for (held, slot_type) in self.c.nested_inflow_pairs(predicted, target) {
                self.record_type_flow(held, slot_type);
                let described = self.ty_of(slot_type);
                let views = self.layout_types_in(described);
                self.c.accepts_untyped(held, &views);
            }
        }
        let source = self.value_type(fx, e);
        // A literal that is only copied from is no object.
        if source == TypeId::UNKNOWN {
            return;
        }
        self.record_type_flow(source, target);
        let is_host_bound = fx.is_typed && self.c.is_host_bound(fx.file, e);
        for (argument, parameter) in self.c.callback_argument_types(source, target) {
            self.record_type_flow(argument, parameter);
            if is_host_bound {
                self.c.record_untyped_inflow_to_nested(parameter);
            }
        }
    }

    pub(crate) fn record_type_flow(&mut self, source: TypeId, target: TypeId) {
        if target.is_never() && !source.is_any() {
            let entering = self.c.nested_inflow_pairs(source, target);
            if !entering.is_empty() {
                self.c.descend_into_checked_value();
                for (held, slot_type) in entering {
                    self.record_type_flow(held, slot_type);
                }
                self.c.ascend_from_checked_value();
            }
            return;
        }
        let (have, want) = (Ty { id: self.ty_of(source), checked: source }, Ty { id: self.ty_of(target), checked: target });
        self.record_untyped_inflow_into_host_object(source, want);
        // What is not within it is tested where it is read, or on the way into the function.
        if !self.is_within(have, want) {
            if source.is_any() {
                self.record_untyped_inflow(want);
            }
            self.record_cast(have, want.id, CoerceReason::Store);
        }
    }

    fn record_union_parts_upcast(&mut self, ty: TyId) {
        let views: Vec<LayoutId> = self.out.tys.get(ty).parts.iter().filter_map(|part| if let &Part::Class(view) = part { Some(view) } else { None }).collect();
        for view in views {
            let (Some(parts), Some(&target)) = (self.union_part_layouts.get(&view).cloned(), self.layout_types.get(&view)) else { continue };
            for part in parts {
                let Some(&source) = self.layout_types.get(&part) else { continue };
                if self.c.is_upcast_safe(source, target) {
                    self.c.record_upcast(source, target);
                }
            }
        }
    }

    /// Whoever calls the function without knowing it hands it anything, and the engine holds that to the types of the parameters on the
    /// way in: as `as` does, where they are written down.
    pub(crate) fn record_argument_casts(&mut self, func: FuncId, only_tests: bool) {
        let anything = self.out.tys.anything;
        self.c.set_current_site(self.file, self.out.funcs[func.idx()].pos);
        // `method.call(other)`
        let this = self.out.funcs[func.idx()].declared_this_type;
        if this.is_some() {
            self.record_cast(Ty::of(anything), this, CoerceReason::Store);
            if self.out.funcs[func.idx()].kind != FuncKind::Constructor {
                for view in self.layout_types_in(this) {
                    self.c.record_untyped_inflow(view);
                }
            }
        }
        for k in 0..self.out.funcs[func.idx()].params.len() {
            let param = self.out.funcs[func.idx()].params[k];
            if param.is_some() {
                let why = self.out.funcs[func.idx()].param_cast_reason(k);
                let target = if why == CoerceReason::Cast { self.cast_target_ty(param) } else { param };
                let why = if only_tests { CoerceReason::Claim } else { why };
                self.record_cast(Ty::of(anything), target, why);
                self.record_union_parts_upcast(param);
            }
        }
    }

    /// Whoever stores to a field of the layout without knowing the layout, by a key that is computed or from code that is not compiled
    /// with the program, hands it anything, and the engine holds that to the type of the field: as `as` does, where it is written
    /// down. The engine is told which fields those are. Yields whether there are any.
    pub(crate) fn record_field_casts(&mut self, layout: LayoutId) -> bool {
        let mut held: Vec<TyId> = Vec::new();
        for (i, field) in self.out.layouts[layout.idx()].fields.iter_mut().enumerate() {
            if self.annotated_fields.contains(&(layout, i as u32)) {
                field.flags |= field_flags::ANNOTATED;
                held.push(field.declared);
            }
        }
        held.extend(self.out.layouts[layout.idx()].static_fields.iter().map(|field| field.1));
        held.retain(|declared| declared.is_some());
        let anything = self.out.tys.anything;
        for &declared in &held {
            let target = self.cast_target_ty(declared);
            self.record_cast(Ty::of(anything), target, CoerceReason::Cast);
        }
        !held.is_empty()
    }

    /// The function as the checker has it.
    pub(crate) fn set_signature(&mut self, func: FuncId, signature: Signature) {
        self.signatures.insert(func, signature);
    }
}
