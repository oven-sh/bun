//! The types of values. Every value has one, which the engine takes for a fact. It is what the operation yields by itself, or what the
//! value has been held to. One invariant does the rest: the value of an expression is of the checker's type of the expression, and what
//! enters a place is of the type of the place. `fit` sees to both. A read of a place that other code may have stored to since the
//! checker last looked at it is the exception: its value is of the type of the place, and of more only once a use has made sure of that.

use super::types::MOST_HELD_WITHIN_EACH_OTHER;
use super::{FileBuild, Fx, Source};
use crate::builder::Var;
use crate::declared::{Declared, Part, prim};
use crate::id::{FuncId, LayoutId, StrId, TyId, V};
use crate::ir::{BinOp, LayoutKind, MethodKind, Op, Prediction, Term, UnOp, Why, field_flags, func_flags};
use bun_sema::atom::Atom;
use bun_sema::bind::Parent;
use bun_sema::check::{Recovery, kind};
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
pub(crate) enum Computes {
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
        fx.checked.get(&v).copied().unwrap_or(TypeId::UNRESOLVED)
    }

    /// The value is that of an expression of the type. `x as any` yields the value of `x`, of which more is known.
    fn set_checked(&self, fx: &mut Fx, value: V, checked: TypeId) {
        if self.c.says_nothing(checked) {
            fx.checked.entry(value).or_insert(checked);
        } else {
            fx.checked.insert(value, checked);
        }
    }

    pub(crate) fn or_anything(&self, ty: TyId) -> TyId {
        if ty.is_none() { self.out.tys.anything } else { ty }
    }

    // ───────────────────────────── what operations yield ─────────────────────────────

    pub(crate) fn type_of_op(&mut self, fx: &Fx, op: &Op) -> Ty {
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
            Op::FieldGet { layout, field, .. } => return self.type_of_field(layout, field),
            Op::PropGet { obj, name } => return self.type_of_property_read(self.ty(fx, obj), name),
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

    pub(crate) fn type_of_field(&mut self, layout: LayoutId, field: u32) -> Ty {
        self.type_fields_of(layout);
        let checked = self.checked_fields.get(&(layout, field)).copied().unwrap_or(TypeId::UNRESOLVED);
        Ty { id: self.or_anything(self.out.layouts[layout.idx()].fields[field as usize].declared), checked }
    }

    /// Of an object that is looked at as one type of the program, what the type has by the name. Of anything else, anything.
    fn type_of_property_read(&mut self, obj: TyId, name: StrId) -> Ty {
        let anything = Ty::of(self.out.tys.anything);
        let Some(layout) = self.out.tys.get(obj).only_layout() else { return anything };
        // The object need not be what the view says: see `as_read_of_coerced`.
        if self.layout_types.get(&layout).is_some_and(|&ty| self.c.is_view_made_by_coercion(ty)) {
            return anything;
        }
        if let Some(field) = self.out.layouts[layout.idx()].field(name) {
            return self.type_of_field(layout, field);
        }
        let mut at = layout;
        while at.is_some() {
            if let Some(&(file, class)) = self.laid_out_classes.get(&at) {
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

    /// Why what enters the field is held to its type.
    pub(crate) fn why_of_field(&mut self, layout: LayoutId, field: u32) -> Why {
        self.type_fields_of(layout);
        if self.annotated_fields.contains(&(layout, field)) { Why::Cast } else { Why::Store }
    }

    /// The field a store by name to an object of the type goes to.
    pub(crate) fn field_stored_to(&mut self, obj: TyId, name: StrId) -> Option<(Ty, Why)> {
        let layout = self.out.tys.get(obj).only_layout()?;
        let field = self.out.layouts[layout.idx()].field(name)?;
        Some((self.type_of_field(layout, field), self.why_of_field(layout, field)))
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
    pub(crate) fn ty_of_expression(&mut self, fx: &Fx, e: ExprId, checked: TypeId) -> TyId {
        self.c.note_type_of_expression(checked);
        let described = self.ty_of(checked);
        if described == self.out.tys.anything || self.out.tys.get(described).prims & prim::NUMBER == 0 {
            return described;
        }
        let integers = self.c.integers_of_expr(fx.file, e);
        self.with_integers(described, integers)
    }

    /// What the text of the expression shows its value to be, whatever the types say: `Checker::kinds_yielded_by`, and the integers that
    /// are found without a type. For a file whose types nothing holds the program to. `NONE`: nothing.
    pub(crate) fn ty_shown_by_text(&mut self, fx: &Fx, e: ExprId, computes: Computes) -> TyId {
        let kinds = self.c.kinds_yielded_by(fx.file, e);
        let described = self.ty_of_kinds(kinds);
        let integers = match computes {
            // Not `bigint | integers 0..9`, which no typed code has ever come up with.
            _ if kinds & (kind::NUMBER | kind::BIGINT) != kind::NUMBER => None,
            Computes::Value => self.c.integers_of_expr(fx.file, e),
            Computes::Before => self.c.integers_before_update(fx.file, e),
            Computes::Stored => self.c.integers_stored_by(fx.file, e),
        };
        let described = self.with_integers(described, integers);
        self.unless_plain_number(described)
    }

    /// An operation on numbers, bigints or strings that the expression `e` of the source asks for. In TypeScript what it yields is of the
    /// checker's type of `e`, and which integers that is, is for the checker as well. Nothing is made of the types of the operands.
    pub(crate) fn emit_arithmetic(&mut self, fx: &mut Fx, op: Op, e: ExprId, computes: Computes) -> V {
        let value = self.emit_throwing(fx, op);
        if matches!(computes, Computes::Stored) {
            self.note_span_of_what_is_stored(fx, value, e);
        }
        if !fx.is_typed {
            let shown = self.ty_shown_by_text(fx, e, computes);
            if shown.is_some() {
                fx.b.func.values[value.idx()].ty = shown;
            }
            return value;
        }
        let checked = self.c.type_yielded_by(fx.file, e);
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
            Computes::Value => self.c.integers_of_expr(fx.file, e),
            Computes::Before => self.c.integers_before_update(fx.file, e),
            Computes::Stored => self.c.integers_stored_by(fx.file, e),
        };
        fx.b.func.values[value.idx()].ty = self.with_integers(described, integers);
        fx.checked.insert(value, checked);
        value
    }

    /// `value`, that of `e`, where it is used as the string, number or boolean that the checker takes it for: the receiver of a member read or a call, an operand of arithmetic or of
    /// `<`, a part of a template. It may be an object that an `as` has let through, `(x as string).length`: it is asserted to be none. See `Checker::has_no_objects_by_its_type`.
    pub(crate) fn used_as_its_type(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        let have = self.ty(fx, value);
        let described = self.out.tys.get(have);
        if !fx.is_typed || !described.has_objects() || described.prims == 0 && described.ints.is_none() || have == self.out.tys.anything || fx.b.func.prediction(value) != Prediction::None {
            return value;
        }
        if !self.c.has_no_objects_by_its_type(fx.file, e) {
            return value;
        }
        let declared = self.c.type_of_expr(fx.file, e);
        let primitives = Declared { prims: described.prims, ints: described.ints, ..Declared::default() };
        if self.c.is_prediction_about_what_is_given(declared) {
            let expected = self.out.tys.intern(Declared { prims: primitives.prims & !prim::NULLISH, ..primitives });
            fx.b.func.values[value.idx()].prediction = Prediction::Ty(expected);
            return value;
        }
        let primitives = self.out.tys.intern(primitives);
        self.fit(fx, value, Ty { id: primitives, checked: declared }, Why::Claim)
    }

    // ───────────────────────────── holding values to types ─────────────────────────────

    /// If the value is an ordinary object that stays one (`Fx::stays_ordinary`) and is of the type, by what the checker has for it or because the type is written down here: the value as it enters.
    /// A cast would refuse an accessor, and make a copy of the rest. Note is taken that the views admit it.
    fn enters_as_it_is(&mut self, fx: &mut Fx, value: V, want: Ty, why: Why) -> Option<V> {
        if fx.stays_ordinary.is_empty() {
            return None;
        }
        let &own = fx.stays_ordinary.get(&value)?;
        let views = self.types_of_layouts_in(want.id);
        if !self.c.admits_foreign(own, &views) && !(why == Why::Cast && want.checked != TypeId::UNRESOLVED && self.c.admits_foreign(want.checked, &views)) {
            return None;
        }
        let have = Ty { id: self.ty(fx, value), checked: own };
        let mut held = value;
        // Of what a call yields the operation does not say that it is an object.
        if self.out.tys.get(have.id).prims != 0 {
            self.note_cast(have, want.id, Why::Claim);
            held = self.emit_throwing(fx, Op::Coerce { value, to: want.id, why: Why::Claim });
            fx.stays_ordinary.insert(held, if want.checked != TypeId::UNRESOLVED { want.checked } else { own });
            if want.checked != TypeId::UNRESOLVED {
                fx.checked.insert(held, want.checked);
            }
        }
        fx.fitted.insert((fx.b.block, value, want.id), held);
        Some(held)
    }

    /// The value as one of the type. Nothing is done where it is known to be one.
    pub(crate) fn fit(&mut self, fx: &mut Fx, value: V, want: Ty, why: Why) -> V {
        if want.id.is_none() || want.id == self.out.tys.anything || self.out.tys.get(want.id).is_never() {
            return value;
        }
        let (mut value, mut have) = (value, Ty { id: self.ty(fx, value), checked: self.checked(fx, value) });
        // What a test leaves of primitives of several kinds keeps the room that those have for an object: where `typeof v` is neither "number" nor "string" the checker takes a
        // `boolean | number | string` for a boolean, by elimination. Whoever looks sees the object. A use asserts: `used_as_its_type`.
        let want = {
            let (had, wanted) = (self.out.tys.get(have.id), self.out.tys.get(want.id));
            let has_room = had.any_object && had.parts.is_empty() && (had.prims & !prim::NULLISH != 0 || had.ints.is_some()) && have.id != self.out.tys.anything;
            if why == Why::Flow && has_room && !wanted.has_objects() {
                let with_room = wanted.or(&Declared::any_object()).nilable();
                Ty { id: self.out.tys.intern(with_room), ..want }
            } else {
                want
            }
        };
        // `Math`, what `Object.assign(() => 1, { .. })` yields: the operation says nothing of the value, and the checker's type says that it
        // is no plain data. It is held to that type first, and enters as what that says.
        if have.id == self.out.tys.anything
            && let Some(own) = self.ty_unless_plain_data(have.checked)
            && own != want.id
        {
            value = self.fit(fx, value, Ty { id: own, checked: have.checked }, Why::Claim);
            have.id = self.ty(fx, value);
        }
        if self.is_within(have, want) {
            return value;
        }
        if let Some(&held) = fx.fitted.get(&(fx.b.block, value, want.id)) {
            return held;
        }
        let is_taken_from_beyond = have.id == self.out.tys.anything
            && match fx.b.func.op(value) {
                Some(&(Op::PropGet { obj, .. } | Op::ElemGet { obj, .. })) => {
                    let of_object = self.checked(fx, obj);
                    self.c.is_beyond_the_layouts(of_object)
                }
                _ => false,
            };
        if is_taken_from_beyond {
            self.c.note_what_comes_from_beyond_the_layouts(want.checked);
            for view in self.types_of_layouts_in(want.id) {
                self.c.note_what_comes_from_beyond_the_layouts(view);
            }
        }
        if let Some(held) = self.enters_as_it_is(fx, value, want, why) {
            return held;
        }
        // The nil that a cast has let through, `return s.codePointAt(i) as number`, is converted where the value enters a declared place that cannot hold it: `as` coerces, and does not
        // end in a TypeError a step later.
        if matches!(why, Why::Cast | Why::Store) && fx.nil_left_by_cast.contains(&value) {
            // `x as number` of an `x` that may be anything may be an object as well. That one is asserted to be none here, where the nil is converted then.
            let (had, wanted) = (self.out.tys.get(have.id), self.out.tys.get(want.id));
            if had.has_objects() && !wanted.has_objects() && had.prims & prim::NULLISH & !wanted.prims != 0 && wanted.prims & !prim::NULLISH != 0 {
                let primitives = Declared { prims: had.prims, ints: had.ints, ..Declared::default() };
                let without_nil = Declared { prims: had.prims & (wanted.prims | !prim::NULLISH), ..primitives.clone() };
                let without_nil = self.out.tys.intern(without_nil);
                if self.is_within(Ty { id: without_nil, checked: want.checked }, want) {
                    let primitives = self.out.tys.intern(primitives);
                    let claimed = self.fit(fx, value, Ty { id: primitives, checked: want.checked }, Why::Claim);
                    fx.nil_left_by_cast.insert(claimed);
                    return self.fit(fx, claimed, want, why);
                }
            }
            let (had, wanted) = (self.out.tys.get(have.id), self.out.tys.get(want.id));
            let is_nil_besides = !had.has_objects() && !wanted.has_objects() && had.prims & prim::NULLISH & !wanted.prims != 0 && wanted.prims & !prim::NULLISH != 0;
            if is_nil_besides {
                let without_nil = self.out.tys.intern(Declared { prims: had.prims & (wanted.prims | !prim::NULLISH), ..had.clone() });
                if self.is_within(Ty { id: without_nil, checked: want.checked }, want) {
                    let converted = self.coerce(fx, value, want, want, why);
                    return self.fit(fx, converted, want, why);
                }
            }
        }
        if self.c.is_untyped(have.checked) {
            self.note_untyped_inflow(want);
        }
        // A cast that can make nothing of the value only makes sure of what it is.
        let only_makes_sure = matches!(why, Why::Claim | Why::NonNull(_)) || why == Why::Cast && !self.is_made_by_casts(want.id);
        if only_makes_sure && have.id == self.out.tys.anything && self.yields_as(fx, value, want.id) {
            self.note_cast(have, want.id, why);
            if want.checked != TypeId::UNRESOLVED {
                fx.checked.insert(value, want.checked);
            }
            return value;
        }
        let mut to = want.id;
        if why == Why::Cast {
            to = self.ty_of_cast_target(to);
            if let ([source], [target]) = (&self.types_of_layouts_in(have.id)[..], &self.types_of_layouts_in(to)[..])
                && !self.out.tys.get(have.id).any_object
                && let Some(both) = self.c.type_of_both(*source, *target)
            {
                to = self.ty_of(both);
            }
        }
        self.note_cast(have, to, why);
        // The caller takes the result for a `want`, untested: an upcast like any other, which the soundness closure has to hear of. Whether
        // the sets bear it out in the end is checked at the link (`verify.rs`).
        if to != want.id {
            self.is_within(Ty { id: to, checked: want.checked }, want);
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
    /// value afterwards, `Checker::type_coerced`: a `T`, or the object that `e` was.
    ///
    /// `asserts`: how an engine kind is asserted. `Cast` for a cast in the source, which also walks the elements of an array. `Claim` for a
    /// read, which tests the kind and walks nothing.
    pub(crate) fn coerce(&mut self, fx: &mut Fx, value: V, tries: Ty, result: Ty, asserts: Why) -> V {
        if tries.id.is_none() || tries.id == self.out.tys.anything || self.out.tys.get(tries.id).is_never() {
            return value;
        }
        let have = Ty { id: self.ty(fx, value), checked: self.checked(fx, value) };
        if self.is_within(have, tries) {
            return value;
        }
        // `e as Error`: whatever it is, it stays that.
        if self.c.lets_everything_through(tries.checked) {
            for view in self.types_of_layouts_in(result.id) {
                if self.c.is_view_of_anything(view) {
                    self.c.note_foreign(view, have.checked);
                }
            }
            return value;
        }
        // Which string, number or boolean comes of a conversion is not looked at: `0 as true` is a boolean.
        let to = self.ty_of_cast_target(tries.id);
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
        let is_of_the_engine_only = tried.has_objects() && !tried.any_object && !tried.parts.iter().any(|part| matches!(part, Part::Class(_)));
        let is_function_only = tried.any_function && tried.parts.is_empty();
        if is_of_the_engine_only && !is_function_only && self.out.tys.get(have.id).any_object {
            return self.convert_and_assert(fx, value, to, tries.checked, asserts);
        }
        // An object stays an object, so the result has to have room for every object that the value can be and for every `T`. Where it
        // has not, the cast asserts.
        if self.out.tys.get(to).has_objects() {
            let of_anything: Vec<TypeId> = self.types_of_layouts_in(result.id).into_iter().filter(|&view| self.c.is_view_of_anything(view)).collect();
            for &view in &of_anything {
                self.c.note_foreign(view, have.checked);
            }
            let (tried, had) = (self.objects_of(to), self.objects_of(have.id));
            let has_room = self.is_within(Ty { id: tried, checked: tries.checked }, result) && (!of_anything.is_empty() || self.is_within(Ty { id: had, checked: have.checked }, result));
            if !has_room {
                return self.convert_and_assert(fx, value, to, tries.checked, asserts);
            }
        }
        // `{} as T`: the literal lacks what `T` requires, so it was made an ordinary object and stays one. It is looked at as a `T` from here on.
        if matches!(fx.b.func.op(value), Some(Op::NewObject)) {
            for view in self.types_of_layouts_in(to) {
                self.c.note_foreign(view, have.checked);
            }
        }
        self.note_cast(have, to, Why::Coerce);
        let why = if fx.is_coercing_fresh_graph { Why::CoerceFreshGraph } else { Why::Coerce };
        let held = self.emit_throwing(fx, Op::Coerce { value, to, why });
        fx.b.func.values[held.idx()].ty = result.id;
        fx.checked.insert(held, result.checked);
        if nil & !self.out.tys.get(to).prims != 0 {
            fx.nil_left_by_cast.insert(held);
        }
        held
    }

    /// `5 as string | string[]`, `"5" as number | Date`: nothing can be made the objects of `to`, so an object is asserted to be one. A primitive
    /// is converted all the same, to the primitives that `to` has besides.
    fn convert_and_assert(&mut self, fx: &mut Fx, value: V, to: TyId, checked: TypeId, asserts: Why) -> V {
        let prims = self.out.tys.get(to).prims;
        let mut value = value;
        if prims & !prim::NULLISH != 0 {
            let have = self.checked(fx, value);
            let converted = self.out.tys.intern(Declared { prims, any_object: true, any_function: true, ..Declared::default() });
            value = self.emit_throwing(fx, Op::Coerce { value, to, why: Why::Coerce });
            fx.b.func.values[value.idx()].ty = converted;
            fx.checked.insert(value, have);
        }
        self.fit(fx, value, Ty { id: to, checked }, asserts)
    }

    /// For `--aot-explain=predictions`.
    fn note_prediction(&mut self, fx: &Fx, e: ExprId) {
        if fx.is_typed
            && let Some(claim) = self.c.unvouched_claim(fx.file, e)
        {
            self.c.note_prediction(fx.file, e, claim);
        }
    }

    /// `(x as T).name`: `value` is what has been read for the expression `e`. The object need not be a `T`, so the read is a coercion itself.
    fn as_read_of_coerced(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        // What has been read, and nothing else: an expression is fitted more than once, and `l?.kind` once more where the chain ends, with
        // the `undefined` of a chain that is cut short.
        if !matches!(fx.b.func.op(value), Some(Op::PropGet { .. })) {
            return value;
        }
        let Some((found, target)) = self.c.property_read_of_coerced(fx.file, e) else { return value };
        let known = self.c.type_coerced(found, target);
        let mut value = value;
        if self.ty(fx, value) == self.out.tys.anything && !self.c.is_untyped(found) {
            let found = Ty { id: self.ty_of(found), checked: found };
            value = self.fit(fx, value, found, Why::Claim);
        }
        let (tries, result) = (Ty { id: self.ty_of(target), checked: target }, Ty { id: self.ty_of(known), checked: known });
        self.coerce(fx, value, tries, result, Why::Claim)
    }

    /// The type without its primitives.
    fn objects_of(&mut self, ty: TyId) -> TyId {
        let objects = Declared { prims: 0, ints: None, ..self.out.tys.get(ty).clone() };
        self.out.tys.intern(objects)
    }

    /// The type without `undefined` and `null`, which `x!` asserts the value not to be.
    pub(crate) fn not_nil(&mut self, ty: TyId) -> TyId {
        if ty.is_none() || ty == self.out.tys.anything {
            return ty;
        }
        let described = self.out.tys.get(ty);
        let narrowed = Declared { prims: described.prims & !prim::NULLISH, ..described.clone() };
        if narrowed.is_never() { ty } else { self.out.tys.intern(narrowed) }
    }

    /// The description of the checker's type, if a value of it has objects among what it can be and none of them can be plain data: they
    /// are arrays, functions, objects of classes that the program only knows the declaration of.
    fn ty_unless_plain_data(&mut self, checked: TypeId) -> Option<TyId> {
        if checked == TypeId::UNRESOLVED || self.c.says_nothing(checked) {
            return None;
        }
        let own = self.ty_of(checked);
        let described = self.out.tys.get(own);
        (own != self.out.tys.anything && described.has_objects() && !described.any_object && !self.is_made_by_casts(own)).then_some(own)
    }

    /// `setTextRange(factory.createX(..), node)`, `finishNode(node, pos)`, `Debug.checkDefined(x)`. `value`: the value of the expression `e`. If it is what a
    /// direct call of a function yields that hands back one of its parameters (`Checker::parameter_handed_back_by`), and what the argument is
    /// known to be says as much as the type of `e` or more: the argument. It goes by the operation, not by `e`: whatever expression it
    /// is the value of, such a call yields that operand, and `e` is looked at more than once.
    fn argument_handed_back(&mut self, fx: &mut Fx, value: V, e: ExprId) -> Option<V> {
        let Some(Op::CallDirect { func: called, args }) = fx.b.func.op(value) else { return None };
        let Source::Function { file, func, .. } = self.sources[called.idx()] else { return None };
        let number = self.c.parameter_handed_back_by(file, func)?;
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
    fn as_handed_back(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        if let Some(argument) = self.argument_handed_back(fx, value, e) {
            return argument;
        }
        let Some(first) = self.c.argument_handed_back_by(fx.file, e) else { return value };
        let Some(Op::CallMethod { args, .. } | Op::Call { args, .. }) = fx.b.func.op(value) else { return value };
        let Some(&target) = args.first() else { return value };
        if self.is_assigned_onto(fx, first) {
            return value;
        }
        let checked = self.c.type_of_expr(fx.file, e);
        let want = self.ty_of(checked);
        let have = self.out.tys.get(self.ty(fx, target)).clone();
        let Some(to) = self.out.tys.get(want).only_layout() else { return value };
        let is_of_the_program = !have.parts.is_empty() && have.parts.iter().all(|part| matches!(part, Part::Class(_)));
        if !is_of_the_program || have.prims & !prim::NULLISH != 0 || have.ints.is_some() || have.any_object || have.any_function {
            return value;
        }
        if have.only_layout() == Some(to) {
            return target;
        }
        for part in &have.parts {
            if let &Part::Class(from) = part
                && from != to
                && let (Some(&source), Some(&seen_as)) = (self.layout_types.get(&from), self.layout_types.get(&to))
            {
                self.c.note_upcast(source, seen_as);
            }
        }
        let to = if have.prims & prim::NULLISH == 0 { self.without_nil(want) } else { want };
        let viewed = self.emit(fx, Op::Coerce { value: target, to, why: Why::Upcast });
        fx.checked.insert(viewed, checked);
        viewed
    }

    /// The checker's type of the expression. An object literal is made as what it is checked against, if that is known, and not as the type
    /// of its own that the checker gives it. That goes for what yields one or another literal as well: `flag ? { a: 1 } : { a: 2 }`. Checked
    /// against the type of the objects of a class, it is made as its own type, which is assignable to that.
    ///
    /// `a && { .. }`, `a || { .. }`, `a ?? { .. }` yield one operand or the other, and `a` need not be of what the whole is checked against.
    pub(crate) fn type_of_value(&mut self, fx: &Fx, e: ExprId) -> TypeId {
        if self.yields_object_literal(fx, e) && self.is_only_copied_from(fx, e) {
            return TypeId::UNKNOWN;
        }
        if let ExprKind::Binary { op: hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish, left, right } = self.hir(fx.file)[e].kind
            && self.yields_object_literal(fx, e)
        {
            let operands = [self.type_of_value(fx, left), self.type_of_value(fx, right)];
            return self.c.union(&operands);
        }
        let own = self.c.type_yielded_by(fx.file, e);
        if self.yields_object_literal(fx, e)
            && let Some(expected) = self.c.contextual_type_of_literal(fx.file, e)
            && !self.c.says_nothing(expected)
            && !self.c.is_checked_against_a_class(expected)
            && !self.is_coerced_to_more(fx, e, expected)
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
    pub(crate) fn is_coerced_to_more(&mut self, fx: &Fx, e: ExprId, expected: TypeId) -> bool {
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
        let own = self.c.laid_out_as(own);
        !self.c.is_provably_assignable(own, expected)
    }

    /// `.then(() => ({ ...base(), b }))`. `value`: that of the literal `e`, which has a spread or a computed name and was built as an ordinary object; nobody else has seen it. `want`: what it
    /// goes straight to. Whether that holds it to nothing, or names a layout and has room besides for an object that is not laid out, `T | PromiseLike<T>`: then nothing there makes it
    /// what its type says, and whoever gets it in the end goes by that type. Not where what is spread is no object of the program's: `{ ...process.env, more }`: what the type of that
    /// requires is a wish. Nor where it is written for `any`.
    fn is_left_ordinary_by(&mut self, fx: &Fx, value: V, e: ExprId, want: TyId) -> bool {
        let hir = self.hir(fx.file);
        let ExprKind::Object(props) = hir[e].kind else { return false };
        // `function f(r: R): any { return { ...r, more } }`: whoever has an object as `any` may delete a property of it, redefine one, give it another prototype: it stays what it was built as.
        let is_for_any = self.c.contextual_type_of_literal(fx.file, e).is_some_and(|expected| self.c.is_any(expected) || expected == TypeId::UNKNOWN);
        let has_room = want.is_none() && !is_for_any || want.is_some() && {
            let wanted = self.out.tys.get(want);
            wanted.parts.iter().any(|part| matches!(part, Part::Class(_))) && (wanted.any_object || wanted.parts.iter().any(|part| matches!(part, Part::Global(..))))
        };
        fx.is_typed
            && has_room
            && props.iter().filter(|&p| hir[p].kind == hir::PropKind::Spread).all(|p| {
                let spread = self.c.type_of_expr(fx.file, hir[p].value);
                self.is_type_laid_out(spread)
            })
            && matches!(fx.b.func.op(value), Some(Op::NewObject | Op::Operation { .. }))
            && self.c.has_declared_type(fx.file, e)
            && !(self.is_asked_to_be_dynamic(fx, e) || self.defines_accessor(fx, e) || self.is_assigned_onto(fx, e) || self.is_only_copied_from(fx, e))
            && !self.c.contextual_type_of_literal(fx.file, e).is_some_and(|expected| self.c.is_checked_against_what_is_inferred(fx.file, e, expected))
    }

    fn defines_accessor(&self, fx: &Fx, e: ExprId) -> bool {
        let hir = self.hir(fx.file);
        matches!(hir[e].kind, ExprKind::Object(props) if props.iter().any(|p| matches!(hir[p].kind, hir::PropKind::Getter | hir::PropKind::Setter)))
    }

    fn yields_object_literal(&self, fx: &Fx, e: ExprId) -> bool {
        match self.hir(fx.file)[e].kind {
            ExprKind::Object(_) => true,
            ExprKind::Cond { yes, no, .. } => self.yields_object_literal(fx, yes) || self.yields_object_literal(fx, no),
            ExprKind::Binary { op: hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish, left, right } => {
                self.yields_object_literal(fx, left) || self.yields_object_literal(fx, right)
            }
            ExprKind::Binary { op: hir::BinOp::Comma, right, .. } => self.yields_object_literal(fx, right),
            ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => self.yields_object_literal(fx, expr),
            _ => false,
        }
    }

    /// Whether a cast to the type can make something of a value that is not of it: an object with a layout out of plain data, by itself or
    /// in an array.
    pub(crate) fn is_made_by_casts(&self, ty: TyId) -> bool {
        ty.is_some()
            && self.out.tys.get(ty).parts.iter().any(|part| match *part {
                Part::Class(layout) => self.out.layouts[layout.idx()].kind == LayoutKind::Record,
                Part::Array(elements) => elements != ty && self.is_made_by_casts(elements),
                Part::Global(..) => false,
            })
    }

    /// An object that has just been made for the purpose, and that nobody else has seen, as one of the type.
    pub(crate) fn fit_fresh(&mut self, fx: &mut Fx, value: V, checked: TypeId) -> V {
        if !fx.is_typed {
            return value;
        }
        let want = Ty { id: self.ty_of(checked), checked };
        if fx.b.func.prediction(value) == Prediction::None && want.id != self.out.tys.anything {
            fx.b.func.values[value.idx()].prediction = Prediction::Ty(want.id);
        }
        let held = self.fit(fx, value, want, Why::Cast);
        self.mark_cast_of_what_is_fresh(fx, held, value);
        held
    }

    pub(crate) fn mark_cast_of_what_is_fresh(&mut self, fx: &mut Fx, held: V, value: V) {
        if let Some(&Op::Coerce { value: of, to, why: Why::Cast }) = fx.b.func.op(held)
            && (of == value || held == value && matches!(fx.b.func.op(of), Some(Op::NewObject | Op::Operation { .. })))
        {
            fx.b.func.values[held.idx()].def = crate::ir::Def::Op(Op::Coerce { value: of, to, why: Why::CastFresh });
        }
    }

    /// The value of the expression `e` as the checker's type of `e`. Where the program is not held to that, or it says nothing, the value
    /// is only expected to be something. Where the value goes straight to what holds it to a type that is written down, it is held to
    /// that type instead.
    ///
    /// What the checker has found out about a place on the way to a read of it may no longer hold: see `reference_read_by`. Then the
    /// value is what the place is declared to hold, and the use that needs more makes sure of it: see `as_narrowed`.
    pub(crate) fn fit_to_expression(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        self.note_span(fx, value, e);
        // The expressions within it have been translated since `expr` said so.
        let pos = self.hir(fx.file)[e].pos;
        self.c.note_place(fx.file, pos);
        if matches!(self.hir(fx.file)[e].kind, ExprKind::Ident(_) | ExprKind::This) {
            fx.narrowed.remove(&value);
        }
        let said_by_the_operation = self.ty(fx, value);
        if fx.is_typed
            && said_by_the_operation.is_some()
            && self.out.tys.get(said_by_the_operation).any_object
            && matches!(fx.b.func.op(value), Some(Op::CallDirect { .. } | Op::Call { .. } | Op::CallMethod { .. }))
            && let Some(made) = self.c.what_a_generic_function_may_have_made(fx.file, e)
        {
            let made_as = self.c.type_of_expr(fx.file, e);
            self.c.note_what_a_generic_function_made(&made, made_as);
            if let Some(sink) = fx.sink
                && sink.e == e
            {
                self.c.note_what_a_generic_function_made(&made, sink.want.checked);
            }
        }
        if fx.is_typed && self.ty(fx, value) == self.out.tys.anything && self.c.is_read_from_beyond_the_layouts(fx.file, e) {
            let read_as = self.c.type_of_expr(fx.file, e);
            self.c.note_what_comes_from_beyond_the_layouts(read_as);
        }
        // `String(a)`, `list.length`, `this.#count`: the operation says less of what it yields than the text shows. Only of an operation that was made for `e`: a name, `a = b`,
        // `(a, b)` hand on a value that was made elsewhere, and that other paths look at as well.
        if !fx.is_typed
            && matches!(self.hir(fx.file)[e].kind, ExprKind::Call(_) | ExprKind::Dot { .. })
            && !matches!(fx.b.func.op(value), None | Some(Op::Coerce { .. } | Op::FieldGet { .. } | Op::GlobalGet(_)))
        {
            let (shown, have) = (self.ty_shown_by_text(fx, e, Computes::Value), self.ty(fx, value));
            if shown.is_some() && shown != have && self.is_within(Ty::of(shown), Ty::of(have)) {
                fx.b.func.values[value.idx()].ty = shown;
            }
        }
        // A name, behind a test that it has passed or a store: the variable may hold more than it does here. The cast is tested, and cannot fail.
        let value = if !fx.is_typed && matches!(self.hir(fx.file)[e].kind, ExprKind::Ident(_)) {
            let shown = self.ty_shown_by_text(fx, e, Computes::Value);
            let shows_a_symbol = shown.is_some() && *self.out.tys.get(shown) == Declared::prims(prim::SYMBOL);
            if shows_a_symbol && self.ty(fx, value) == self.out.tys.intern(Declared::prims(prim::UNDEFINED | prim::SYMBOL)) { value } else { self.fit(fx, value, Ty::of(shown), Why::Flow) }
        } else {
            value
        };
        let value = if fx.is_typed { self.or_recovered(fx, value, e) } else { value };
        let yielded = value;
        let value = if fx.is_typed && !fx.handed_back.contains(&e) { self.as_handed_back(fx, value, e) } else { value };
        // `e` is looked at more than once, and the next time `value` is the argument already.
        if value != yielded {
            fx.handed_back.insert(e);
        }
        let is_handed_back = fx.handed_back.contains(&e);
        let is_tested = self.is_tested(fx, e);
        let value = if fx.is_typed && !is_tested { self.as_read_of_coerced(fx, value, e) } else { value };
        let read = if fx.is_typed { self.c.reference_read_by(fx.file, e) } else { None };
        // `let a!: T`: wherever the value goes, the read makes sure that something has been stored.
        let value = match read {
            Some(read) if read.is_asserted && !is_tested => {
                // A reference may be nil as it is kept. Not this one from here on, but for a `null` that the type names.
                let described = self.ty_of_expression(fx, e, read.declared);
                let named = if self.c.parts(read.declared).iter().any(|part| part.is_null()) { prim::NULL } else { 0 };
                let described = Declared { prims: self.out.tys.get(described).prims & !(prim::NULLISH & !named), ..self.out.tys.get(described).clone() };
                let declared = Ty { id: self.out.tys.intern(described), checked: read.declared };
                let text = self.text_of_reference(fx, e);
                self.fit(fx, value, declared, Why::NonNull(text))
            }
            _ => value,
        };
        if fx.is_typed && (matches!(fx.b.func.op(value), Some(Op::NewObject)) && self.defines_accessor(fx, e) || self.c.yields_redefined_literal(fx.file, e)) {
            let own = self.c.type_of_expr(fx.file, e);
            fx.stays_ordinary.insert(value, own);
            for held_as in [Some(own), Some(self.c.widened(own)), self.c.contextual_type_of_literal(fx.file, e)].into_iter().flatten() {
                let held_as = self.ty_of(held_as);
                let views = self.types_of_layouts_in(held_as);
                self.c.admits_foreign(own, &views);
            }
        }
        if let Some(sink) = fx.sink
            && sink.e == e
            && !self.says_more_than_a_cast_finds(fx, e, sink.want.id)
        {
            let value = if self.is_left_ordinary_by(fx, value, e, sink.want.id) {
                let own = self.c.type_of_expr(fx.file, e);
                self.fit_fresh(fx, value, own)
            } else {
                value
            };
            if sink.want.id.is_some()
                && let Some(held) = self.enters_as_it_is(fx, value, sink.want, sink.why)
            {
                return held;
            }
            let known_before = fx.checked.get(&value).copied();
            if self.c.has_declared_type(fx.file, e) {
                let checked = match read {
                    Some(read) if !read.is_narrowing_reliable && read.declared != TypeId::UNRESOLVED && self.c.property_read_of_coerced(fx.file, e).is_none() => read.declared,
                    _ => self.type_of_value(fx, e),
                };
                self.set_checked(fx, value, checked);
            }
            let is_new = matches!(self.hir(fx.file)[e].kind, ExprKind::New(_));
            let want = if is_new { Ty { id: self.without_nil(sink.want.id), ..sink.want } } else { sink.want };
            // A prediction enters a place that the user annotated: it is asserted here. A host object is no subtype of a record type, so
            // the supertypes that its predicted type is assignable to admit foreign objects.
            if fx.is_typed && self.c.is_predicted(fx.file, e) {
                self.note_prediction(fx, e);
                let (predicted, supertypes) = (self.c.type_of_expr(fx.file, e), self.types_of_layouts_in(want.id));
                self.c.admits_foreign(predicted, &supertypes);
                for (held, held_as) in self.c.types_held_entering(predicted, want.checked) {
                    self.note_entry_of_type(held, held_as);
                    let described = self.ty_of(held_as);
                    let views = self.types_of_layouts_in(described);
                    self.c.admits_foreign(held, &views);
                }
            }
            if !is_handed_back {
                self.note_cast_of_declared_result(fx, e, want.id);
            }
            let held = self.fit(fx, value, want, sink.why);
            self.forget_what_a_test_showed(fx, e, value, known_before);
            return held;
        }
        if !fx.is_typed || !self.c.has_declared_type(fx.file, e) {
            self.note_prediction(fx, e);
            // The engine holds a value to its type again wherever it resolves the operation. So a prediction has none.
            // The value of a name or of a cast was made for another expression: it may be known for more than this one says, and may have been used as that: `const s = c.d!; if (guard(s)) s.m()` with an `s` that the guard narrows to a tainted type.
            let is_made_for_another = matches!(self.hir(fx.file)[e].kind, ExprKind::Ident(_) | ExprKind::As { .. });
            if !is_made_for_another && matches!(fx.b.func.op(value), Some(Op::PropGet { .. })) {
                self.leave_unheld(fx, value);
            }
            if fx.is_typed && !is_made_for_another && self.is_held_where_it_is_made(fx, value) {
                self.problem(fx.file, pos, "this expression (internal error: a predicted type was checked as a declared type; please report it)");
            }
            let predicted = self.predict_expression(fx, value, e);
            if let Some(&own) = fx.stays_ordinary.get(&value) {
                fx.stays_ordinary.insert(predicted, own);
            }
            return predicted;
        }
        let why = match fx.b.func.op(value) {
            // What has just been made says itself what it is, and more than the type of the expression does. What a name that the
            // program does not bind stands for, the engine knows. A variable that holds it is read as the variable is written: `as_written`.
            Some(Op::New(_) | Op::NewWith { .. }) if !matches!(self.hir(fx.file)[e].kind, ExprKind::Ident(_)) => return value,
            // So does a function. Which properties it has been given, only the checker's type says, and so with what `Math` has.
            Some(Op::Closure { .. } | Op::ClosureOnce { .. } | Op::FuncRef(_) | Op::FreeGet { .. }) => {
                let checked = self.c.type_of_expr(fx.file, e);
                fx.checked.insert(value, checked);
                return value;
            }
            // A literal with a spread or a computed name, which nobody else has seen: it is made one of its type. One with an accessor
            // besides stays what it is: the type does not tell the accessor from a field.
            Some(Op::NewObject) if self.is_literal_left_ordinary(fx, e) || self.is_asked_to_be_dynamic(fx, e) || self.defines_accessor(fx, e) || self.is_assigned_onto(fx, e) || self.is_only_copied_from(fx, e) => return value,
            Some(Op::NewObject) if self.c.contextual_type_of_literal(fx.file, e).is_some_and(|expected| self.c.is_checked_against_what_is_inferred(fx.file, e, expected)) => return value,
            Some(Op::NewObject)
                if self.c.contextual_type_of_literal(fx.file, e).is_none_or(|expected| self.ty_of(expected) == self.out.tys.anything) && {
                    let own = self.c.type_of_expr(fx.file, e);
                    self.c.members(own).is_some_and(|members| !members.shape().index.is_empty())
                } =>
            {
                return value;
            }
            Some(Op::NewObject) => Why::Cast,
            // `{ ...x }`, which is one operation.
            Some(Op::Operation { .. }) if matches!(self.hir(fx.file)[e].kind, ExprKind::Object(_)) => {
                if self.is_asked_to_be_dynamic(fx, e) || self.is_assigned_onto(fx, e) || self.is_only_copied_from(fx, e) {
                    return value;
                }
                Why::Cast
            }
            Some(Op::CallDirect { .. } | Op::Call { .. } | Op::CallMethod { .. } | Op::Operation { .. }) if self.is_held_like_a_cast(fx, e) => Why::Cast,
            _ if self.ty(fx, value) == self.out.tys.anything => Why::Claim,
            _ => Why::Flow,
        };
        let checked = self.type_of_value(fx, e);
        let mut want = Ty { id: self.ty_of_expression(fx, e, checked), checked };
        // What a literal is checked against is what it is made as. `async () => ({ ...base(), b })`, `resolve({ b, ...base() })`: `T | PromiseLike<T>`.
        let value = if why == Why::Cast && self.is_left_ordinary_by(fx, value, e, want.id) {
            let own = self.c.type_of_expr(fx.file, e);
            self.fit_fresh(fx, value, own)
        } else {
            value
        };
        if !is_handed_back {
            self.note_cast_of_declared_result(fx, e, want.id);
        }
        // Outside the array, where the object has no such key, or before anything is stored to the variable, a read yields `undefined`,
        // which the checker's type leaves out. Whether that matters is for whoever uses the value: `a[i] || 0` is fine, a place for a
        // number is not.
        let may_be_undefined = read.is_some_and(|read| read.may_be_undefined)
            || matches!(fx.b.func.op(value), Some(Op::ElemGet { .. }))
            || matches!(self.hir(fx.file)[e].kind, ExprKind::Index { .. })
            || self.c.is_optional_chain(fx.file, e)
            || self.c.may_yield_blank_variable(fx.file, e);
        if may_be_undefined {
            want.id = self.or_undefined_if_telling(want.id);
        }
        if matches!(self.hir(fx.file)[e].kind, ExprKind::New(_)) {
            want.id = self.without_nil(want.id);
        }
        if let Some(read) = read
            && !read.is_narrowing_reliable
        {
            let mut value = value;
            if why == Why::Claim && read.declared != TypeId::UNRESOLVED {
                let mut declared = Ty { id: self.ty_of_expression(fx, e, read.declared), checked: read.declared };
                if may_be_undefined {
                    declared.id = self.or_undefined_if_telling(declared.id);
                }
                value = self.fit(fx, value, declared, why);
            }
            return self.remember_narrowing(fx, value, read.declared, want, e);
        }
        let made = value;
        let value = self.fit(fx, value, want, why);
        if matches!(self.hir(fx.file)[e].kind, ExprKind::Object(_)) {
            self.mark_cast_of_what_is_fresh(fx, value, made);
        }
        let value = self.as_written(fx, value, want);
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
    fn forget_what_a_test_showed(&self, fx: &mut Fx, e: ExprId, value: V, known_before: Option<TypeId>) {
        if !matches!(self.hir(fx.file)[e].kind, ExprKind::Ident(_) | ExprKind::This) || self.ty(fx, value) != self.out.tys.anything {
            return;
        }
        match known_before {
            Some(known) => fx.checked.insert(value, known),
            None => fx.checked.remove(&value),
        };
    }

    /// Whether the engine makes sure of the type of the value where it is made: the type says more than the operation vouches for, or the
    /// operation is a cast that may throw.
    fn is_held_where_it_is_made(&self, fx: &Fx, value: V) -> bool {
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
                        | Op::Coerce { why: Why::Cast | Why::CastFresh | Why::Store | Why::Flow | Why::Claim | Why::NonNull(_), .. }
                )
            )
    }

    /// What a generic function makes goes by the bounds of its type parameters until the test on the way out. `e`: an expression whose value is
    /// held to `want`. If it is a call of such a function: what the function is declared to yield is cast to that.
    fn note_cast_of_declared_result(&mut self, fx: &Fx, e: ExprId, want: TyId) {
        if want.is_some()
            && matches!(self.hir(fx.file)[e].kind, ExprKind::Call(_))
            && let Some(declared) = self.c.declared_result_of_call(fx.file, e)
        {
            let declared = Ty { id: self.ty_of(declared), checked: declared };
            self.note_cast(declared, want, Why::Flow);
            if let Some(operand) = self.c.operand_of_forced_cast_returned_by(fx.file, e) {
                let sources = self.types_of_layouts_in(declared.id);
                let may_be_laid_out_as_nothing = self.c.says_nothing_of_fields(operand);
                for target in self.types_of_layouts_in(want) {
                    self.c.note_forced_cast(&sources, target);
                    if may_be_laid_out_as_nothing {
                        self.c.note_foreign(target, operand);
                    }
                }
            }
        }
    }

    /// Whether the value of the expression `e`, which goes straight to a cast to `want`, is held to the checker's type of `e` first all the
    /// same. What a cast makes of an object depends on what the object is known to be: one that `new` has made is turned into one of a
    /// type that extends its own, a function or an object of a class enters as it is. Only what may be plain data is left to the cast
    /// alone: what has a type that says nothing, that a declaration file declares, or that plain data is made one of.
    fn says_more_than_a_cast_finds(&mut self, fx: &Fx, e: ExprId, want: TyId) -> bool {
        if !self.is_made_by_casts(want) || !self.c.has_declared_type(fx.file, e) {
            return false;
        }
        if matches!(self.hir(fx.file)[e].kind, ExprKind::New(_)) {
            return true;
        }
        let checked = self.type_of_value(fx, e);
        let own = self.ty_of(checked);
        let described = self.out.tys.get(own);
        own != self.out.tys.anything && described.has_objects() && !described.any_object && !self.is_made_by_casts(own)
    }

    /// `const wide: Loose = narrow; wide.n = "text"`: an object is accessed as the type of the expression says, whatever else is known of
    /// the value. So what a program does never depends on what the compiler sees through.
    fn as_written(&mut self, fx: &mut Fx, value: V, want: Ty) -> V {
        let have = self.out.tys.get(self.ty(fx, value));
        let (Some(known), Some(written)) = (have.only_layout(), self.out.tys.get(want.id).only_layout()) else { return value };
        if known == written {
            return value;
        }
        let to = if have.prims & prim::NULLISH == 0 { self.without_nil(want.id) } else { want.id };
        if let Some(&viewed) = fx.fitted.get(&(fx.b.block, value, to)) {
            return viewed;
        }
        let viewed = self.emit(fx, Op::Coerce { value, to, why: Why::Upcast });
        fx.fitted.insert((fx.b.block, value, to), viewed);
        viewed
    }

    fn or_undefined_if_telling(&mut self, ty: TyId) -> TyId {
        if ty == self.out.tys.anything || self.out.tys.get(ty).is_never() { ty } else { self.or_undefined(ty) }
    }

    /// The type of what `new` yields, which is an object.
    fn without_nil(&mut self, ty: TyId) -> TyId {
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
        if !self.c.says_nothing(checked) {
            fx.checked.insert(value, checked);
        }
        let read = value;
        let value = if have.id == self.out.tys.anything { self.predict_expression(fx, value, e) } else { value };
        if is_narrowed {
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
            Some(&want) => self.fit(fx, value, want, Why::Flow),
            None => value,
        }
    }

    /// Whether the type of what the call `e` yields is written down where the function that is called does not make sure of it, or the
    /// call yields an object that nobody else has seen.
    fn is_held_like_a_cast(&mut self, fx: &Fx, e: ExprId) -> bool {
        let hir = self.hir(fx.file);
        let ExprKind::Call(call) = hir[e].kind else { return false };
        if self.c.is_result_of_call_annotated(fx.file, e) {
            return true;
        }
        hir.ids(hir[call].args).next().is_some_and(|first| self.is_assigned_onto(fx, first))
    }

    /// `Object.assign({ .. }, a, b)` is `{ .., ...a, ...b }` in other words. Whether `e` is such a literal: it is built as an ordinary
    /// object, and what the call yields is made one of its type. Likewise `Object.defineProperties({ .. }, descriptors)` and the like: what they install under
    /// the name of a member need not be of the type that the member has in the literal.
    pub(crate) fn is_assigned_onto(&mut self, fx: &Fx, e: ExprId) -> bool {
        self.c.is_literal_assigned_onto(fx.file, e)
    }

    /// Whether the value of the expression is only there for its properties to be copied out of it at once: the operand of a spread in an
    /// object literal, an argument of `Object.assign` after the first, or what yields one. Nobody else ever sees it, so a literal there is
    /// an ordinary object. The checker checks it against what the whole is checked against, which it need not be. Also what `Object.create` or `Object.setPrototypeOf` makes a prototype: who reads it holds the heir.
    pub(crate) fn is_only_copied_from(&mut self, fx: &Fx, e: ExprId) -> bool {
        self.c.is_only_copied_from(fx.file, e)
    }

    /// An operation that may throw, and that nothing vouches for the result of, is given the type as the type of what it yields: the
    /// engine makes sure of it there, unless it knows better. Whether that was done.
    fn yields_as(&mut self, fx: &mut Fx, value: V, ty: TyId) -> bool {
        if ty == self.out.tys.anything || self.out.tys.get(ty).is_never() {
            return true;
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
        let var = fx.b.new_var(self.or_anything(ty.id));
        let blank = self.blank_of(ty.id);
        if blank != Op::Undefined {
            let ty_of_blank = self.type_of_op(fx, &blank).id;
            fx.b.start_var_as(var, blank, ty_of_blank);
        }
        if ty.checked != TypeId::UNRESOLVED {
            fx.checked_vars.insert(var, ty.checked);
        }
        var
    }

    /// What a place of the type holds that nothing has been stored to: `undefined`. Where the type has no room for that, the checker has
    /// found every read of the place to come after a store, so nobody gets to see what it holds, and any value of the type does.
    fn blank_of(&mut self, ty: TyId) -> Op {
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

    pub(crate) fn emit_blank(&mut self, fx: &mut Fx, ty: TyId) -> V {
        let blank = self.blank_of(ty);
        self.emit(fx, blank)
    }

    /// An object of exactly the layout.
    pub(crate) fn ty_of_layout(&mut self, layout: LayoutId) -> TyId {
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
        let var = fx.b.new_var(self.ty_of_layout(layout));
        fx.b.write(var, env);
        fx.envs.push(super::EnvScope { layout, var });
    }

    /// `value`: what the call `e` has yielded. Where the checker knows what the program goes on with if that is not of the type of `e`, see
    /// `Checker::recovery_of_call`, it is tested here, once, and what comes out is of the type on both paths. The test is a claim that
    /// throws, under a handler of its own, which drops what is thrown. The function expression is evaluated anew there: that cannot be
    /// told from the first evaluation, and costs nothing where the test passes.
    fn or_recovered(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        let hir = self.hir(fx.file);
        let ExprKind::Call(call) = hir[e].kind else { return value };
        let Some(recovery) = self.c.recovery_of_call(fx.file, e) else { return value };
        let Some(argument) = hir.ids(hir[call].args).next() else { return value };
        let checked = self.c.type_of_expr(fx.file, e);
        let want = Ty { id: self.ty_of_expression(fx, e, checked), checked };
        let have = Ty { id: self.ty(fx, value), checked: self.checked(fx, value) };
        if want.id.is_none() || want.id == self.out.tys.anything || self.is_within(have, want) {
            return value;
        }
        self.note_untyped_inflow(want);
        let (miss, join) = (fx.b.new_block(), fx.b.new_block());
        let result = self.new_var(fx, want);
        fx.handlers.push(miss);
        let held = self.emit_throwing(fx, Op::Coerce { value, to: want.id, why: Why::Claim });
        fx.handlers.pop();
        fx.b.write(result, held);
        fx.b.jump(join);
        fx.b.seal(miss);
        fx.b.switch_to(miss);
        self.emit(fx, Op::Caught);
        let argument = self.expr(fx, argument);
        let recovered = match recovery {
            Recovery::Argument => argument,
            Recovery::CallArgument => {
                let this = self.emit(fx, Op::Undefined);
                self.emit_throwing(fx, Op::Call { callee: argument, this, args: Default::default() })
            }
        };
        self.write_as(fx, result, recovered, Why::Claim);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    /// A variable for the value of the expression `e`, which more than one path yields.
    pub(crate) fn new_result(&mut self, fx: &mut Fx, e: Option<ExprId>) -> Var {
        match e {
            Some(e) if fx.sink.is_some_and(|sink| sink.e == e) => {
                let want = fx.sink.map_or(Ty::NONE, |sink| sink.want);
                self.new_var(fx, want)
            }
            Some(e) if fx.is_typed && self.c.has_declared_type(fx.file, e) => {
                let checked = self.type_of_value(fx, e);
                let mut ty = Ty { id: self.ty_of_expression(fx, e, checked), checked };
                if self.c.is_optional_chain(fx.file, e) || self.c.may_yield_blank_variable(fx.file, e) {
                    ty.id = self.or_undefined_if_telling(ty.id);
                }
                self.new_var(fx, ty)
            }
            Some(e) if !fx.is_typed => {
                let shown = self.ty_shown_by_text(fx, e, Computes::Value);
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
        self.write_as(fx, var, value, Why::Store);
    }

    /// `why`: `Cast`, if the variable has its type from an annotation.
    pub(crate) fn write_as(&mut self, fx: &mut Fx, var: Var, value: V, why: Why) {
        let want = Ty { id: fx.b.ty_of_var(var), checked: fx.checked_vars.get(&var).copied().unwrap_or(TypeId::UNRESOLVED) };
        let value = self.fit(fx, value, want, why);
        fx.b.write(var, value);
    }

    /// The same for the left operand of `&&` on the falsy path. No object is falsy: `declaration && diagnosticOf(declaration)` hands on
    /// `undefined`, never a declaration, so no declaration is cast to a diagnostic.
    pub(crate) fn write_falsy_as(&mut self, fx: &mut Fx, var: Var, value: V, why: Why) {
        let want = Ty { id: fx.b.ty_of_var(var), checked: fx.checked_vars.get(&var).copied().unwrap_or(TypeId::UNRESOLVED) };
        let have = Ty { id: self.ty(fx, value), checked: self.checked(fx, value) };
        let described = self.out.tys.get(have.id);
        let falsy = Declared { prims: described.prims, ints: described.ints, ..Declared::never() };
        let is_narrowable = have.id != self.out.tys.anything && described.has_objects() && !falsy.is_never();
        if !is_narrowable || want.id.is_none() || self.is_within(have, want) {
            return self.write_as(fx, var, value, why);
        }
        let to = self.out.tys.intern(falsy);
        let value = self.emit_throwing(fx, Op::Coerce { value, to, why: Why::Flow });
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
        if let Some((want, why)) = self.held_on_return(fx) {
            if value.is_none() {
                value = self.emit(fx, Op::Undefined);
            }
            value = self.fit(fx, value, want, why);
        }
        fx.b.terminate(Term::Return(value));
    }

    /// What the function holds to what it returns, and why. What an async function or a generator is declared to yield is the promise
    /// or the generator, which the engine makes.
    pub(crate) fn held_on_return(&self, fx: &Fx) -> Option<(Ty, Why)> {
        let func = &self.out.funcs[fx.id.idx()];
        if func.result.is_none() || func.has(func_flags::ASYNC | func_flags::GENERATOR) {
            return None;
        }
        let signature = self.signatures.get(&fx.id);
        let want = Ty { id: func.result, checked: signature.and_then(|signature| signature.result).unwrap_or(TypeId::UNRESOLVED) };
        Some((want, if signature.is_some_and(|signature| signature.is_result_annotated) { Why::Cast } else { Why::Store }))
    }

    /// An object that is one of several types of the program, looked at as what those have in common: that is all that can be got at
    /// without knowing which it is. So whatever is accessed by name is looked at as one type.
    fn as_one_view(&mut self, fx: &mut Fx, obj: V, name: StrId) -> V {
        // A narrowed type that is not reliable is applied, and tested, only where the use needs it. A field of the declared type does not:
        // `cur = a; change(); cur.flags`, where `change` assigns the captured `cur` and `flags` is in every member of its union.
        let obj = if fx.narrowed.contains_key(&obj) && self.has_field_as_declared(fx, obj, name) { obj } else { self.as_narrowed(fx, obj) };
        let ty = self.out.tys.get(self.ty(fx, obj));
        let is_of_several = ty.parts.len() > 1 && ty.parts.iter().all(|part| matches!(part, Part::Class(_)));
        // A union of many types is described by what they have in common and nothing else (`MOST_LAYOUTS_IN_UNION`), which need not have the
        // field: `(type as ObjectFlagsType).objectFlags`.
        let is_described_in_common = matches!(ty.parts[..], [Part::Class(layout)] if self.out.layouts[layout.idx()].field(name).is_none());
        if !(is_of_several || is_described_in_common) || ty.prims & !prim::NULLISH != 0 || ty.ints.is_some() || ty.any_object || ty.any_function {
            return obj;
        }
        let checked = self.checked(fx, obj);
        if self.c.says_nothing(checked) {
            return obj;
        }
        let union = self.c.non_nullable(checked);
        if is_described_in_common && self.c.parts(union).len() < 2 {
            return obj;
        }
        let mut common = self.c.view_of_union(union);
        // `(node as NamedDeclaration).name`, where the object may be any node: not all of them have it. Then it is looked at as what has
        // the properties of all of them, and what the object lacks is found the general way.
        // So where one of the parts is a view of anything, `const get = () => x as P; get().s`: what the parts have in common says nothing
        // of what such an object has.
        let lacks_it = |b: &Self, layout: Option<LayoutId>| layout.is_none_or(|layout| b.out.layouts[layout.idx()].field(name).is_none());
        let in_common = self.record_layout(common);
        let may_be_anything = self.c.parts(union).iter().any(|&part| self.c.is_view_of_anything(part));
        if may_be_anything || lacks_it(self, in_common) {
            let either = self.c.view_of_either(union);
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
        let viewed = self.emit(fx, Op::Coerce { value: obj, to: want.id, why: Why::Upcast });
        fx.fitted.insert((fx.b.block, obj, want.id), viewed);
        fx.checked.insert(viewed, common);
        viewed
    }

    /// Whether every layout the value can have by its own type has the field.
    fn has_field_as_declared(&self, fx: &Fx, obj: V, name: StrId) -> bool {
        let ty = self.out.tys.get(self.ty(fx, obj));
        !ty.parts.is_empty()
            && !ty.any_object
            && !ty.any_function
            && ty.prims & !prim::NULLISH == 0
            && ty.ints.is_none()
            && ty.parts.iter().all(|part| matches!(part, Part::Class(layout) if self.out.layouts[layout.idx()].field(name).is_some()))
    }

    /// The operands that enter places, as what the places hold. What is stored to a variable of the source has been seen to by
    /// `write_sym`, which knows whether the type of the variable is written down.
    pub(crate) fn fit_operands(&mut self, fx: &mut Fx, op: Op) -> Op {
        let op = match op {
            Op::PropGet { obj, name } => Op::PropGet { obj: self.as_one_view(fx, obj, name), name },
            Op::PropSet { obj, name, value } => Op::PropSet { obj: self.as_one_view(fx, obj, name), name, value },
            Op::PropHas { obj, name } => Op::PropHas { obj: self.as_one_view(fx, obj, name), name },
            Op::PropDelete { obj, name } => Op::PropDelete { obj: self.as_narrowed(fx, obj), name },
            Op::CallMethod { obj, name, args } => Op::CallMethod { obj: self.as_one_view(fx, obj, name), name, args },
            Op::ElemGet { obj, key } => Op::ElemGet { obj: self.as_narrowed(fx, obj), key },
            Op::ElemSet { obj, key, value } => Op::ElemSet { obj: self.as_narrowed(fx, obj), key, value },
            Op::ElemHas { obj, key } => Op::ElemHas { obj: self.as_narrowed(fx, obj), key },
            Op::ElemDelete { obj, key } => Op::ElemDelete { obj: self.as_narrowed(fx, obj), key },
            op => op,
        };
        match op {
            Op::GlobalSet(global, value) => {
                let want = Ty { id: self.out.globals[global.idx()].declared, checked: self.checked_globals.get(&global).copied().unwrap_or(TypeId::UNRESOLVED) };
                Op::GlobalSet(global, self.fit(fx, value, want, Why::Store))
            }
            Op::FieldSet { obj, layout, field, value } => {
                let (want, why) = (self.type_of_field(layout, field), self.why_of_field(layout, field));
                Op::FieldSet { obj, layout, field, value: self.fit(fx, value, want, why) }
            }
            Op::PropSet { obj, name, value } => match self.field_stored_to(self.ty(fx, obj), name) {
                Some((want, why)) => Op::PropSet { obj, name, value: self.fit(fx, value, want, why) },
                None => op,
            },
            Op::CallDirect { func, mut args } => {
                let callee = &self.out.funcs[func.idx()];
                let (this, params) = (callee.this_declared, callee.params.clone());
                let whys: Vec<Why> = (0..params.len()).map(|i| callee.why_of_param(i)).collect();
                let mut at = callee.captures.len();
                let has_this = callee.has(func_flags::HAS_THIS);
                let signature = self.signatures.get(&func).cloned().unwrap_or_default();
                if has_this {
                    if at < args.len() {
                        let want = Ty { id: this, checked: signature.this.unwrap_or(TypeId::UNRESOLVED) };
                        args[at] = self.fit(fx, args[at], want, Why::Store);
                    }
                    at += 1;
                }
                for (i, &param) in params.iter().enumerate() {
                    if at + i >= args.len() {
                        break;
                    }
                    let want = Ty { id: param, checked: signature.params.get(i).copied().unwrap_or(TypeId::UNRESOLVED) };
                    args[at + i] = self.fit(fx, args[at + i], want, whys[i]);
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
        let entering = self.c.types_held_entering(have.checked, want.checked);
        if !entering.is_empty() {
            self.c.go_a_level_into_what_is_held();
            for (held, held_as) in entering {
                self.note_entry_of_type(held, held_as);
            }
            self.c.come_back_a_level();
        }
        if have.id == want.id || want.id == self.out.tys.anything {
            return true;
        }
        let (a, b) = (self.out.tys.get(have.id), self.out.tys.get(want.id));
        if a.prims & !b.prims != 0 {
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
        let found = match self.parts_within.get(&(have.id, want.id)) {
            Some(known) => known.clone(),
            None => {
                let not_known_before = self.c.times_not_known();
                let found = self.find_parts_within(have.id, want.id);
                if self.c.times_not_known() == not_known_before {
                    self.parts_within.insert((have.id, want.id), found.clone());
                }
                found
            }
        };
        let Some((upcasts, is_foreign)) = found else { return false };
        // An object that is not laid out, an array, a function, what a package makes, is of a type of the program if the checker's type
        // of it is assignable to that. The layout then stands for such objects too.
        if is_foreign {
            // What is of a type of the program and not laid out is a literal that has yet to be made one of that type.
            if self.is_type_laid_out(have.checked) {
                return false;
            }
            let views = self.types_of_layouts_in(want.id);
            if !self.c.admits_foreign(have.checked, &views) {
                return false;
            }
        }
        // Whoever asks leaves out a test. The checker sees to it that the members of the one layout are members of the other.
        for &(from, to) in upcasts.iter() {
            self.c.note_upcast(self.layout_types[&from], self.layout_types[&to]);
        }
        true
    }

    fn find_parts_within(&mut self, have: TyId, want: TyId) -> Option<(Rc<[(LayoutId, LayoutId)]>, bool)> {
        let (a, b) = (self.out.tys.get(have).clone(), self.out.tys.get(want).clone());
        let mut upcasts: Vec<(LayoutId, LayoutId)> = Vec::new();
        let mut is_foreign = a.any_object || a.any_function && !b.any_function;
        for part in &a.parts {
            match (part, b.parts.iter().find(|other| self.is_part_within(part, other))) {
                (&Part::Class(from), Some(&Part::Class(to))) if from != to => upcasts.push((from, to)),
                (_, Some(_)) => {}
                (Part::Class(_), None) => return None,
                (_, None) => is_foreign = true,
            }
        }
        Some((upcasts.into(), is_foreign))
    }

    pub(crate) fn is_type_laid_out(&mut self, checked: TypeId) -> bool {
        if checked == TypeId::UNRESOLVED || self.c.says_nothing(checked) {
            return false;
        }
        let described = self.ty_of(checked);
        self.out.tys.get(described).parts.iter().any(|part| matches!(part, Part::Class(_)))
    }

    fn is_part_within(&mut self, part: &Part, other: &Part) -> bool {
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
        self.c.is_seen_as(source, target)
    }

    // ───────────────────────────── what the checker is told ─────────────────────────────

    /// The value of the expression `value` is stored to the field `name` of an object of the layout, which may hold a function. `is_birth`:
    /// as a part of its allocation.
    pub(crate) fn note_callee_stored(&mut self, fx: &Fx, layout: LayoutId, name: Atom, value: ExprId, is_birth: bool) {
        let Some(&holder) = self.layout_types.get(&layout) else { return };
        let field = self.str(name);
        let Some(field) = self.out.layouts[layout.idx()].field(field) else { return };
        let declared = self.out.layouts[layout.idx()].fields[field as usize].declared;
        if declared.is_none() || self.out.tys.get(declared).any_function {
            self.c.note_callee_stored(holder, name, fx.file, value, is_birth);
        }
    }

    /// Objects of the layout are made.
    pub(crate) fn note_allocation(&mut self, layout: LayoutId) {
        match self.layout_types.get(&layout) {
            Some(&ty) => self.c.note_allocation(ty),
            // An environment: no type stands for it, and it is looked at as nothing else.
            None => self.out.layouts[layout.idx()].is_allocated = true,
        }
    }

    /// The checker's types of the layouts that an object of the type is looked at as.
    pub(crate) fn types_of_layouts_in(&self, ty: TyId) -> Vec<TypeId> {
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
    pub(crate) fn note_cast(&mut self, have: Ty, want: TyId, why: Why) {
        self.note_cast_within(have, want, why, 0);
    }

    fn note_cast_within(&mut self, have: Ty, want: TyId, why: Why, depth: u8) {
        let (may_copy, may_change) = (matches!(why, Why::Cast | Why::Coerce), matches!(why, Why::Cast | Why::Coerce | Why::Flow));
        let is_vouched = self.out.tys.get(have.id).any_object;
        let is_told = is_vouched && have.checked != TypeId::UNRESOLVED && !self.c.is_untyped(have.checked);
        let known = if is_told { self.ty_of(have.checked) } else { have.id };
        let sources = self.types_of_layouts_in(known);
        for target in self.types_of_layouts_in(want) {
            self.c.note_cast(&sources, target, may_copy && is_vouched, is_vouched, may_change, may_change && !may_copy);
        }
        // The elements of an array are cast with it, or where they are read.
        let elements_in = |this: &Self, ty: TyId| -> Vec<TyId> { (this.out.tys.get(ty).parts.iter()).filter_map(|part| if let Part::Array(elements) = part { Some(*elements) } else { None }).collect() };
        if depth == MOST_HELD_WITHIN_EACH_OTHER {
            return;
        }
        let held = elements_in(self, known);
        for held_as in elements_in(self, want) {
            if held.is_empty() && is_vouched {
                self.note_cast_within(Ty::of(have.id), held_as, why, depth + 1);
            }
            for &held in &held {
                self.note_cast_within(Ty::of(held), held_as, why, depth + 1);
            }
        }
    }

    /// The value of an expression whose type says nothing of it is held to the type. If that is the type of a function, what the
    /// function yields is as little known, and is held to what the type says it yields.
    pub(crate) fn note_untyped_inflow(&mut self, want: Ty) {
        for target in self.types_of_layouts_in(want.id) {
            self.c.note_untyped_inflow(target);
        }
        for result in self.c.results_of_calls(want.checked) {
            let result = self.ty_of(result);
            for target in self.types_of_layouts_in(result) {
                self.c.note_untyped_inflow(target);
            }
        }
    }

    /// `{}`, `b ? {} : { a: 1 }`: the checker's type of an empty literal says nothing, but the object is made here, as what it is checked against. Where it is
    /// made an ordinary object after all, the cast that lets it in says so (`note_cast`).
    fn is_object_literal(&self, fx: &Fx, e: ExprId) -> bool {
        match self.hir(fx.file)[e].kind {
            ExprKind::Object(_) => true,
            ExprKind::Cond { yes, no, .. } => self.is_object_literal(fx, yes) && self.is_object_literal(fx, no),
            _ => false,
        }
    }

    /// The expression `e` is cast to `want`, or goes to a place whose type is written down. It is the text that counts: `f as unknown as
    /// Maker` yields the value of `f`, of which more is known, and says that nothing is.
    pub(crate) fn note_source_of_cast(&mut self, fx: &Fx, e: ExprId, want: Ty) {
        if e.is_none() {
            return;
        }
        let source = self.c.type_of_expr(fx.file, e);
        if self.c.is_untyped(source) && !self.is_object_literal(fx, e) {
            self.note_untyped_inflow(want);
        }
        if self.c.may_yield_a_namespace(fx.file, e) {
            self.c.note_place(fx.file, self.hir(fx.file)[e].pos);
            for view in self.types_of_layouts_in(want.id) {
                self.c.note_foreign(view, source);
            }
        }
        if let Some(origin) = self.c.origin_of_data(fx.file, e) {
            self.c.note_place(fx.file, self.hir(fx.file)[e].pos);
            self.c.note_what_stays_untyped(want.checked, false, origin);
        }
    }

    /// The value of `e` goes where the checker has a type for it, and the translated program need not have a place of that type: an
    /// argument of `map.set`, an element of an array literal. What `fit` takes note of where a value enters a place is taken note of
    /// all the same. A function that is handed to code that is not compiled with the program is called with what the type there says,
    /// which enters its parameters.
    pub(crate) fn note_entry(&mut self, fx: &Fx, e: ExprId) {
        if let Some((source, target)) = self.c.types_entered_by_spread(fx.file, e) {
            self.note_entry_of_type(source, target);
        }
        // What the sources have enters what the target has by the same names.
        if let ExprKind::Call(call) = self.hir(fx.file)[e].kind
            && self.c.is_object_assign(fx.file, e)
        {
            let hir = self.hir(fx.file);
            let mut arguments = hir.ids(hir[call].args);
            if let Some(target) = arguments.next() {
                let target = self.c.type_of_expr(fx.file, target);
                for source in arguments {
                    let source = self.c.type_of_expr(fx.file, source);
                    for (held, held_as) in self.c.properties_assigned(source, target) {
                        self.note_entry_of_type(held, held_as);
                    }
                }
            }
        }
        let Some(target) = self.c.type_entered_by(fx.file, e) else { return };
        if fx.is_typed && self.c.is_predicted(fx.file, e) {
            let described = self.ty_of(target);
            let (predicted, supertypes) = (self.c.type_of_expr(fx.file, e), self.types_of_layouts_in(described));
            self.c.admits_foreign(predicted, &supertypes);
        }
        let source = self.type_of_value(fx, e);
        // A literal that is only copied from is no object.
        if source == TypeId::UNKNOWN {
            return;
        }
        self.note_entry_of_type(source, target);
        for (argument, parameter) in self.c.arguments_of_callback(source, target) {
            self.note_entry_of_type(argument, parameter);
        }
    }

    pub(crate) fn note_entry_of_type(&mut self, source: TypeId, target: TypeId) {
        let (have, want) = (Ty { id: self.ty_of(source), checked: source }, Ty { id: self.ty_of(target), checked: target });
        // What is not within it is tested where it is read, or on the way into the function.
        if !self.is_within(have, want) {
            self.note_cast(have, want.id, Why::Store);
        }
    }

    fn note_parts_seen_as_their_view(&mut self, ty: TyId) {
        let views: Vec<LayoutId> = self.out.tys.get(ty).parts.iter().filter_map(|part| if let &Part::Class(view) = part { Some(view) } else { None }).collect();
        for view in views {
            let (Some(parts), Some(&target)) = (self.parts_of_views.get(&view).cloned(), self.layout_types.get(&view)) else { continue };
            for part in parts {
                let Some(&source) = self.layout_types.get(&part) else { continue };
                if self.c.is_seen_as(source, target) {
                    self.c.note_upcast(source, target);
                }
            }
        }
    }

    /// Whoever calls the function without knowing it hands it anything, and the engine holds that to the types of the parameters on the
    /// way in: as `as` does, where they are written down.
    pub(crate) fn note_casts_of_arguments(&mut self, func: FuncId, only_tests: bool) {
        let anything = self.out.tys.anything;
        self.c.note_place(self.file, self.out.funcs[func.idx()].pos);
        // `method.call(other)`
        let this = self.out.funcs[func.idx()].this_declared;
        if this.is_some() {
            self.note_cast(Ty::of(anything), this, Why::Store);
            for view in self.types_of_layouts_in(this) {
                self.c.note_untyped_inflow(view);
            }
        }
        for k in 0..self.out.funcs[func.idx()].params.len() {
            let param = self.out.funcs[func.idx()].params[k];
            if param.is_some() {
                let why = self.out.funcs[func.idx()].why_of_param(k);
                let target = if why == Why::Cast { self.ty_of_cast_target(param) } else { param };
                let why = if only_tests { Why::Claim } else { why };
                self.note_cast(Ty::of(anything), target, why);
                self.note_parts_seen_as_their_view(param);
            }
        }
    }

    /// Whoever stores to a field of the layout without knowing the layout, by a key that is computed or from code that is not compiled
    /// with the program, hands it anything, and the engine holds that to the type of the field: as `as` does, where it is written
    /// down. The engine is told which fields those are. Yields whether there are any.
    pub(crate) fn note_casts_of_fields(&mut self, layout: LayoutId) -> bool {
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
            let target = self.ty_of_cast_target(declared);
            self.note_cast(Ty::of(anything), target, Why::Cast);
        }
        !held.is_empty()
    }

    /// The function as the checker has it.
    pub(crate) fn set_signature(&mut self, func: FuncId, signature: Signature) {
        self.signatures.insert(func, signature);
    }
}
