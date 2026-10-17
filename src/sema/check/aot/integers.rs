use super::{ByFile, Primitive};
use super::kinds::kind;
use crate::atom::{Atom, known};
use crate::bind::{Decl, Flow, FlowId, FlowTarget, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId, UNREACHABLE};
use crate::check::Checker;
use crate::check::errors::Container;
use crate::hir::{
    BinOp, CallId, Chain, ExprId, ExprKind, ExprTag, File, FileKind, Flags, FnBody, FnId, FnKind, IdList, MemberId, MemberKind, PatId, PropKey, StmtId, StmtKind,
    TypeNodeId, TypeNodeKind, UnOp, VarKind,
};
use crate::program::{FileId, Sym};
use crate::types::{EnumValue, Prop, PropFlags, PropSource, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use super::OnceLock;

const MAX_EXACT: i64 = 1 << 53;
pub(super) const INT32: (i64, i64) = (i32::MIN as i64, i32::MAX as i64);
const MAX_UINT32: i64 = u32::MAX as i64;
const MAX_STEP: i64 = 1024;
const MAX_COMPUTED: i64 = 1 << 52;
const MAX_STRING_LENGTH: i64 = i32::MAX as i64;
const MAX_ARRAY_LENGTH: i64 = u32::MAX as i64;
const MAX_STEPS: u32 = 100_000;
const MAX_NODES_IN_LOOP: usize = 100_000;

const INTEGER_ARRAYS: [(&[u8], i64, i64); 7] = [
    (b"Int8Array", i8::MIN as i64, i8::MAX as i64),
    (b"Uint8Array", 0, u8::MAX as i64),
    (b"Uint8ClampedArray", 0, u8::MAX as i64),
    (b"Int16Array", i16::MIN as i64, i16::MAX as i64),
    (b"Uint16Array", 0, u16::MAX as i64),
    (b"Int32Array", INT32.0, INT32.1),
    (b"Uint32Array", 0, MAX_UINT32),
];


#[derive(Copy, Clone, PartialEq, Eq)]
struct Numbers {
    minimum: i64,
    maximum: i64,
    nil: bool,
    ignores_nullish: bool,
}

type Found = Option<Numbers>;

impl Place {
    pub(super) fn is_declared_int32(&self) -> bool {
        self.declared_range.is_some()
    }
}

impl Numbers {
    const NOTHING: Numbers = Numbers { minimum: 1, maximum: 0, nil: false, ignores_nullish: false };
    const NULLISH: Numbers = Numbers { minimum: 1, maximum: 0, nil: true, ignores_nullish: false };

    fn integers(minimum: i64, maximum: i64) -> Numbers {
        if minimum > maximum { Numbers::NOTHING } else { Numbers { minimum, maximum, nil: false, ignores_nullish: false } }
    }

    fn has_no_number(self) -> bool {
        self.minimum > self.maximum
    }

    fn range(self) -> Option<(i64, i64)> {
        (!self.has_no_number()).then_some((self.minimum, self.maximum))
    }

    fn numbers(self) -> Option<(i64, i64)> {
        if self.nil { None } else { self.range() }
    }

    fn or(self, other: Numbers) -> Numbers {
        let (nil, ignores_nullish) = (self.nil || other.nil, self.ignores_nullish || other.ignores_nullish);
        if self.has_no_number() {
            return Numbers { nil, ignores_nullish, ..other };
        }
        if other.has_no_number() {
            return Numbers { nil, ignores_nullish, ..self };
        }
        Numbers { minimum: self.minimum.min(other.minimum), maximum: self.maximum.max(other.maximum), nil, ignores_nullish }
    }

    fn and(self, other: Numbers) -> Numbers {
        let ignores_nullish = self.ignores_nullish || other.ignores_nullish;
        Numbers { nil: self.nil && other.nil || ignores_nullish, ignores_nullish, ..self.within(other.minimum, other.maximum) }
    }

    fn within(self, minimum: i64, maximum: i64) -> Numbers {
        Numbers { nil: self.nil, ignores_nullish: self.ignores_nullish, ..Numbers::integers(self.minimum.max(minimum), self.maximum.min(maximum)) }
    }

    fn without(self, excluded: Option<i64>) -> Numbers {
        match excluded {
            Some(value) if self.minimum == value => self.within(value + 1, i64::MAX),
            Some(value) if self.maximum == value => self.within(i64::MIN, value - 1),
            _ => self,
        }
    }

    fn truthy(self) -> Numbers {
        Numbers::integers(if self.minimum == 0 { 1 } else { self.minimum }, if self.maximum == 0 { -1 } else { self.maximum })
    }

    fn stored_as_a_number(self) -> Numbers {
        Numbers { ignores_nullish: self.ignores_nullish || self.nil, ..self }
    }

    fn with_nullish_as_zero(self) -> Numbers {
        if self.nil { Numbers { nil: false, ignores_nullish: false, ..self.or(Numbers::integers(0, 0)) } } else { self }
    }

    fn rounded(self) -> Numbers {
        if self.has_no_number() {
            return self;
        }
        let minimum = if self.minimum >= 0 {
            0
        } else if self.minimum >= INT32.0 {
            INT32.0
        } else {
            -MAX_EXACT
        };
        let maximum = if self.maximum <= INT32.1 {
            INT32.1
        } else if self.maximum <= MAX_UINT32 {
            MAX_UINT32
        } else {
            MAX_EXACT
        };
        Numbers { minimum, maximum, nil: self.nil, ignores_nullish: self.ignores_nullish }
    }
}

fn either(a: Found, b: Found) -> Found {
    Some(a?.or(b?))
}

fn is_operator_on_numbers(op: BinOp) -> bool {
    matches!(op, BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow | BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor)
}

fn both(a: Found, b: Found) -> Found {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.and(b)),
        (a, b) => a.or(b),
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum View {
    Kept,
    Here,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Basis {
    Rough,
    Exact,
}

#[derive(Copy, Clone)]
pub(super) enum Store {
    Value(ExprId),
    Computed(ExprId),
    Nil,
}

#[derive(Default)]
pub(super) struct Place {
    pub(super) is_followed: bool,
    pub(super) stores: Vec<Store>,
    pub(super) starts_undefined: bool,
    is_parameter: bool,
    defaulted: std::ops::Range<usize>,
    is_assigned: bool,
    container: Option<Container>,
    is_stored_elsewhere: bool,
    by_type: Found,
    declared_range: Found,
    enters_as_declared: bool,
    holds_numbers_only: bool,
}

#[derive(Default)]
struct Uses {
    stored_through_assertions: FxHashSet<SymbolId>,
    calls: FxHashMap<SymbolId, Option<Vec<CallId>>>,
    private_stores: FxHashMap<SymbolId, Vec<ExprId>>,
    has_direct_eval: bool,
}

struct Test {
    at: FlowId,
    minimum: i64,
    maximum: i64,
    excluded: Option<i64>,
}

type Tests = SmallVec<[Test; 4]>;

struct Walk {
    at: Sym,
    basis: Basis,
    tests: Tests,
    by_type: Found,
    declared_range: Found,
    is_parameter: bool,
    joins: FxHashMap<FlowId, Found>,
    steps: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Child {
    Expr(ExprId),
    Stmt(StmtId),
    Other,
}

#[derive(Default)]
pub(super) struct Shared {
    free_names: OnceLock<FxHashSet<Atom>>,
    uses: ByFile<Uses>,
    has_seen_int32_annotation: AtomicBool,
}

pub(super) enum Int32Proof {
    Proven,
    Unproven { range: Option<(i64, i64)>, may_be_nullish: bool },
}

#[derive(Default)]
pub(super) struct State {
    places: FxHashMap<Sym, Rc<Place>>,
    rough: FxHashMap<Sym, Found>,
    exact: FxHashMap<Sym, Found>,
    assumed: FxHashMap<Sym, Found>,
    settling: Vec<Sym>,
    is_converging: bool,
    round: u32,
    values: FxHashMap<(FileId, ExprId, View, Basis), (Found, u32)>,
    loops: FxHashMap<(Sym, FlowId), bool>,
    leaving: FxHashMap<(FileId, u32), Rc<[(u32, ExprId, bool)]>>,
}

fn integer(value: f64) -> Found {
    let is_integer = value.fract() == 0.0 && value.abs() <= MAX_COMPUTED as f64 && !(value == 0.0 && value.is_sign_negative());
    is_integer.then(|| Numbers::integers(value as i64, value as i64))
}

fn to_int32(it: Numbers) -> Option<(i64, i64)> {
    let (minimum, maximum) = it.with_nullish_as_zero().range()?;
    (minimum >= INT32.0 && maximum <= INT32.1).then_some((minimum, maximum))
}

fn to_uint32(it: Numbers) -> Option<(i64, i64)> {
    let (minimum, maximum) = it.with_nullish_as_zero().range()?;
    (minimum >= 0 && maximum <= MAX_UINT32).then_some((minimum, maximum))
}

fn ones(value: i64) -> i64 {
    (1i64 << (64 - value.leading_zeros())) - 1
}

fn sum(a: (i64, i64), b: (i64, i64)) -> Option<(i64, i64)> {
    let (minimum, maximum) = (a.0 + b.0, a.1 + b.1);
    let matches_step = |it: (i64, i64)| it.0 >= -MAX_STEP && it.1 <= MAX_STEP;
    if matches_step(a) || matches_step(b) {
        return Some((minimum.clamp(-MAX_EXACT, MAX_EXACT), maximum.clamp(-MAX_EXACT, MAX_EXACT)));
    }
    let is_count = |it: (i64, i64)| it.0 == -MAX_EXACT || it.1 == MAX_EXACT;
    let limit = if is_count(a) || is_count(b) { MAX_EXACT } else { MAX_COMPUTED };
    (minimum >= -limit && maximum <= limit).then_some((minimum, maximum))
}

fn bitwise(op: BinOp, a: Found, b: Found) -> (i64, i64) {
    let (x, y) = (a.and_then(to_int32), b.and_then(to_int32));
    let count = y.filter(|y| y.0 == y.1).map(|y| y.0 & 31);
    match op {
        BinOp::BitAnd => match [x, y].into_iter().flatten().filter(|it| it.0 >= 0).map(|it| it.1).min() {
            Some(maximum) => (0, maximum),
            None => INT32,
        },
        BinOp::BitOr => match (x, y) {
            (Some(x), Some((0, 0))) => x,
            (Some((0, 0)), Some(y)) => y,
            (Some(x), Some(y)) if x.0 >= 0 && y.0 >= 0 => (x.0.max(y.0), ones(x.1.max(y.1))),
            _ => INT32,
        },
        BinOp::BitXor => match (x, y) {
            (Some(x), Some(y)) if x.0 >= 0 && y.0 >= 0 => (0, ones(x.1.max(y.1))),
            _ => INT32,
        },
        BinOp::Shl => match (x, count) {
            (Some(x), Some(count)) if x.0 >= 0 && x.1 << count <= INT32.1 => (x.0 << count, x.1 << count),
            _ => INT32,
        },
        BinOp::Shr => match (x, count) {
            (Some(x), Some(count)) => (x.0 >> count, x.1 >> count),
            (Some(x), None) => (x.0.min(0), x.1.max(-1)),
            _ => INT32,
        },
        _ => match (a.and_then(to_uint32), count) {
            (Some(x), Some(count)) => (x.0 >> count, x.1 >> count),
            (Some(x), None) => (0, x.1),
            (None, Some(count)) => (0, MAX_UINT32 >> count),
            (None, None) => (0, MAX_UINT32),
        },
    }
}

fn combined(op: BinOp, a: Found, b: Found) -> Found {
    if a == Some(Numbers::NOTHING) || b == Some(Numbers::NOTHING) {
        return Some(Numbers::NOTHING);
    }
    let (minimum, maximum) = match op {
        BinOp::UShr => bitwise(op, a, b),
        BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr => {
            if a.is_none() && b.is_none() {
                return None;
            }
            bitwise(op, a, b)
        }
        _ => {
            let (a, b) = (a?.numbers()?, b?.numbers()?);
            match op {
                BinOp::Add => sum(a, b)?,
                BinOp::Sub => sum(a, (-b.1, -b.0))?,
                BinOp::Mul => {
                    let has_zero = |it: (i64, i64)| it.0 <= 0 && it.1 >= 0;
                    if has_zero(a) && b.0 < 0 || has_zero(b) && a.0 < 0 {
                        return None;
                    }
                    let products = [a.0 as i128 * b.0 as i128, a.0 as i128 * b.1 as i128, a.1 as i128 * b.0 as i128, a.1 as i128 * b.1 as i128];
                    let minimum = products.into_iter().fold(i128::MAX, i128::min);
                    let maximum = products.into_iter().fold(i128::MIN, i128::max);
                    if minimum < -(MAX_COMPUTED as i128) || maximum > MAX_COMPUTED as i128 {
                        return None;
                    }
                    (minimum as i64, maximum as i64)
                }
                BinOp::Rem => {
                    if a.0 < 0 || b.0 <= 0 && b.1 >= 0 {
                        return None;
                    }
                    (0, a.1.min(b.0.abs().max(b.1.abs()) - 1))
                }
                _ => return None,
            }
        }
    };
    Some(Numbers::integers(minimum, maximum))
}

fn negated(a: Found) -> Found {
    let a = a?;
    if a == Numbers::NOTHING {
        return Some(a);
    }
    let (minimum, maximum) = a.numbers()?;
    (minimum > 0 || maximum < 0).then(|| Numbers::integers(-maximum, -minimum))
}

fn chosen(op: BinOp, a: Found, b: Found, view: View) -> Found {
    let a = a?;
    let stays = match op {
        BinOp::And if view == View::Here => a.within(0, 0),
        BinOp::And => a,
        BinOp::Or if view == View::Here => a.truthy(),
        _ => Numbers { nil: false, ignores_nullish: false, ..a },
    };
    if op == BinOp::Nullish && !a.nil {
        return Some(stays);
    }
    Some(stays.or(b?))
}

fn never_completes(hir: &File, stmt: StmtId) -> bool {
    match hir[stmt].kind {
        StmtKind::Return(_) | StmtKind::Throw(_) | StmtKind::Break(_) | StmtKind::Continue(_) => true,
        StmtKind::Block(list) => hir.ids(list).next_back().is_some_and(|last| never_completes(hir, last)),
        StmtKind::If { yes, no, .. } => no.is_some() && never_completes(hir, yes) && never_completes(hir, no),
        _ => false,
    }
}

impl<'p, 's> Checker<'p, 's> {

    pub fn expr_integer_range(&mut self, file: FileId, e: ExprId) -> Option<(i64, i64)> {
        self.numbers_of_expr(file, e, View::Kept, Basis::Exact)?.range()
    }

    pub fn symbol_integer_range(&mut self, sym: Sym) -> Option<(i64, i64)> {
        let written = self.annotated_symbol_integer_range(sym);
        if !self.integer_slot(sym).is_followed {
            return written;
        }
        let found = self.slot_numbers(sym, Basis::Exact).and_then(|found| found.range());
        match (found, written) {
            (Some(found), Some(written)) if found.0.max(written.0) <= found.1.min(written.1) => Some((found.0.max(written.0), found.1.min(written.1))),
            (found, written) => written.or(found),
        }
    }

    pub fn has_seen_int32_annotation(&self) -> bool {
        self.p.aot.integers.has_seen_int32_annotation.load(Ordering::Relaxed)
    }

    pub(super) fn int32_proof(&mut self, file: FileId, store: Store) -> Int32Proof {
        match self.store_numbers(file, store, View::Kept, Basis::Exact) {
            Some(found) if !found.nil && found.range().is_none_or(|(minimum, maximum)| minimum >= INT32.0 && maximum <= INT32.1) => Int32Proof::Proven,
            Some(found) => Int32Proof::Unproven { range: found.range(), may_be_nullish: found.nil },
            None => Int32Proof::Unproven { range: None, may_be_nullish: false },
        }
    }

    pub fn is_cast_to_int32(&mut self, file: FileId, e: ExprId) -> bool {
        matches!(self.hir(file)[e].kind, ExprKind::As { ty, .. } if self.is_int32_annotation(file, ty, 0))
    }

    pub(super) fn is_int32_annotation(&mut self, file: FileId, node: TypeNodeId, depth: u8) -> bool {
        if node.is_none() || depth == 8 || depth == 0 && (self.is_untyped_file(file) || self.is_in_untyped_clone_span(file, self.hir(file)[node].pos)) {
            return false;
        }
        let found = match self.hir(file)[node].kind {
            TypeNodeKind::Ref { name, args } if args.is_empty() => {
                let scope = self.bound(file).type_scope[node.idx()];
                self.resolve_type_reference_name(file, scope, name, true)
            }
            TypeNodeKind::Import { args, is_typeof: false, .. } if args.is_empty() => {
                let found = self.resolve_import_type(file, node, false);
                found.and_then(|found| self.resolve_symbol(found).symbol())
            }
            _ => None,
        };
        let Some(sym) = found else { return false };
        if self.bun_intrinsic(sym).is_some_and(|name| self.atoms().bytes(name) == b"int32") {
            self.p.aot.integers.has_seen_int32_annotation.store(true, Ordering::Relaxed);
            return true;
        }
        let declared = self.files().decls_of(sym).iter().copied().find_map(|(file, decl)| match decl {
            Decl::Alias(alias) => Some((file, alias)),
            _ => None,
        });
        let Some((file, alias)) = declared else { return false };
        let alias = self.hir(file)[alias];
        if !alias.type_params.is_empty() {
            return false;
        }
        self.is_int32_annotation(file, alias.ty, depth + 1)
    }

    fn annotated_symbol_integer_range(&mut self, sym: Sym) -> Option<(i64, i64)> {
        let (file, decl) = self.files().value_declaration(sym)?;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let node = match decl {
            Decl::Var(pat) | Decl::Param(pat) => match bound.pat_parent[pat.idx()] {
                PatParent::Var(d) => hir[d].ty,
                PatParent::Param(p) => hir[p].ty,
                _ => return None,
            },
            Decl::Member(m) if hir[m].kind == MemberKind::Getter => hir[hir[m].func].ret,
            Decl::Member(m) => hir[m].ty,
            Decl::ParameterProperty(p) => hir[p].ty,
            _ => return None,
        };
        self.is_int32_annotation(file, node, 0).then_some((i32::MIN as i64, i32::MAX as i64))
    }

    pub fn annotated_prop_integer_range(&mut self, prop: &Prop) -> Option<(i64, i64)> {
        match &prop.source {
            PropSource::Symbol(sym) => self.annotated_symbol_integer_range(*sym),
            PropSource::Intersected(_, parts) => parts.iter().try_fold(None, |_, part| self.annotated_prop_integer_range(part).map(Some)).flatten(),
            _ => None,
        }
    }

    pub fn annotated_result_integer_range(&mut self, file: FileId, func: FnId) -> Option<(i64, i64)> {
        let node = self.hir(file)[func].ret;
        self.is_int32_annotation(file, node, 0).then_some((i32::MIN as i64, i32::MAX as i64))
    }

    pub fn type_integer_range(&mut self, ty: TypeId) -> Option<(i64, i64)> {
        self.numbers_by_type(ty)?.range()
    }

    pub fn union_part_integer_range(&mut self, part: TypeId, is_next_to_enum: bool) -> Option<(i64, i64)> {
        self.numbers_by_part(part, is_next_to_enum)?.range()
    }

    pub fn integer_range_before_update(&mut self, file: FileId, e: ExprId) -> Option<(i64, i64)> {
        let ExprKind::Unary { operand, .. } = self.hir(file)[e].kind else { return None };
        self.numbers_of_expr(file, operand, View::Here, Basis::Exact)?.numbers()
    }

    pub fn stored_integer_range(&mut self, file: FileId, e: ExprId) -> Option<(i64, i64)> {
        self.numbers_of_compound_assignment(file, e, Basis::Exact)?.range()
    }

    fn numbers_by_type(&mut self, ty: TypeId) -> Found {
        if ty.is_never() {
            return None;
        }
        let is_next_to_enum = self.has_numeric_enum_member(ty);
        let mut all = Numbers::NOTHING;
        for &part in self.parts(ty) {
            all = all.or(self.numbers_by_part(part, is_next_to_enum)?);
        }
        Some(Numbers { nil: all.nil || self.accepts_nullish(ty), ..all })
    }

    pub fn has_numeric_enum_member(&self, ty: TypeId) -> bool {
        self.parts(ty).iter().any(|&part| matches!(self.data(part), TypeData::EnumLit { value: EnumValue::Number(_), .. }))
    }

    fn numbers_by_part(&self, part: TypeId, is_next_to_enum: bool) -> Found {
        match self.data(part) {
            TypeData::NumberLit { bits, .. } => integer(f64::from_bits(*bits)).filter(|it| it.minimum != 0 || is_next_to_enum),
            TypeData::EnumLit { value: EnumValue::Number(bits), .. } => {
                integer(f64::from_bits(*bits)).filter(|it| it.minimum >= INT32.0 && it.maximum <= INT32.1)?;
                Some(Numbers::integers(INT32.0, INT32.1))
            }
            _ if part.is_undefined() || part.is_null() => Some(Numbers::NULLISH),
            _ => None,
        }
    }

    fn is_number_type(&self, ty: TypeId) -> bool {
        !ty.is_never() && self.every_type(ty, |c, part| c.is_number_like(part))
    }

    fn has_trusted_type(&mut self, file: FileId, e: ExprId) -> bool {
        !self.is_untyped_file(file) && self.has_declared_type(file, e)
    }

    fn trusted_type_of(&mut self, file: FileId, e: ExprId) -> (TypeId, bool) {
        let (held, may_be_undefined) = self.checked_type_of(file, e);
        let produced = self.result_type_of(file, e);
        (if produced != self.type_of_expr(file, e) { produced } else { held }, may_be_undefined)
    }

    pub(super) fn is_global_instance(&self, ty: TypeId, names: &[&[u8]]) -> bool {
        if let TypeData::Intersection(parts) = self.data(ty) {
            return parts.iter().any(|&part| self.is_global_instance(part, names));
        }
        let TypeData::Ref { target, .. } = self.data(ty) else { return false };
        let name = self.files().symbol(*target).name;
        if name.is_none() {
            return false;
        }
        let text = self.atoms().bytes(name);
        names.contains(&text) && self.global_type_symbol(name) == Some(*target)
    }

    fn max_length_of(&mut self, ty: TypeId) -> Option<i64> {
        let mut maximum = None;
        for &part in self.parts(ty) {
            if part.is_undefined() || part.is_null() {
                continue;
            }
            let of_part = if self.is_string_like(part) {
                MAX_STRING_LENGTH
            } else if !self.is_uninformative(part) && self.is_array_like(part) {
                MAX_ARRAY_LENGTH
            } else {
                return None;
            };
            maximum = Some(maximum.map_or(of_part, |maximum: i64| maximum.max(of_part)));
        }
        maximum
    }

    fn element_numbers(&mut self, file: FileId, obj: ExprId, index: ExprId) -> Found {
        let key = self.trusted_type_of(file, index).0;
        let ty = self.trusted_type_of(file, obj).0;
        if !self.is_number_type(key) || ty.is_never() {
            return None;
        }
        let mut all = Numbers::NOTHING;
        for &part in self.parts(ty) {
            let &(_, minimum, maximum) = INTEGER_ARRAYS.iter().find(|it| self.is_global_instance(part, &[it.0]))?;
            all = all.or(Numbers::integers(minimum, maximum));
        }
        Some(all)
    }

    pub fn element_read_without_integer_range(&mut self, file: FileId, e: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        let ExprKind::NonNull(read) = hir[e].kind else { return None };
        let (obj, index) = self.element_read(file, read)?;
        if self.is_untyped_file(file) {
            return None;
        }
        let ty = self.trusted_type_of(file, read).0;
        (self.numbers_by_type(ty).is_none() && (index.is_none() || self.element_numbers(file, obj, index).is_none())).then_some(read)
    }

    fn element_read(&mut self, file: FileId, read: ExprId) -> Option<(ExprId, ExprId)> {
        let hir = self.hir(file);
        match hir[read].kind {
            ExprKind::Index { obj, index, chain: Chain::No } if !matches!(hir[obj].kind, ExprKind::Super) => Some((obj, index)),
            ExprKind::Dot { obj, name, chain: Chain::No, .. } if !matches!(hir[obj].kind, ExprKind::Super) && self.resolves_via_index_signature(file, obj, name) => Some((obj, ExprId::NONE)),
            _ => None,
        }
    }

    fn is_only_tested(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.expr_parent[e.idx()] {
            Parent::Expr(around) if around.is_some() => match hir[around].kind {
                ExprKind::Unary { op: UnOp::Not, .. } => true,
                ExprKind::Cond { test, .. } => test == e,
                ExprKind::Binary { op: BinOp::And | BinOp::Or, .. } => self.is_only_tested(file, around),
                _ => false,
            },
            Parent::Stmt(stmt) if stmt.is_some() => match hir[stmt].kind {
                StmtKind::If { test, .. } | StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } | StmtKind::For { test, .. } => test == e,
                _ => false,
            },
            _ => false,
        }
    }

    fn proves_defined(&self, file: FileId, test: ExprId, sense: bool, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let references_it = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == symbol;
        let is_undefined = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(name) if name == known::undefined);
        let is_nullish = |e: ExprId| is_undefined(e) || matches!(hir[e].kind, ExprKind::Null);
        match hir[test].kind {
            ExprKind::Ident(_) => sense && references_it(test),
            ExprKind::Unary { op: UnOp::Not, operand } => self.proves_defined(file, operand, !sense, symbol),
            ExprKind::Binary { op: op @ (BinOp::EqEqEq | BinOp::NotEqEq), left, right } => sense == (op == BinOp::NotEqEq) && (references_it(left) && is_undefined(right) || references_it(right) && is_undefined(left)),
            ExprKind::Binary { op: op @ (BinOp::EqEq | BinOp::NotEq), left, right } => sense == (op == BinOp::NotEq) && (references_it(left) && is_nullish(right) || references_it(right) && is_nullish(left)),
            _ => false,
        }
    }

    fn is_guarded_by_defined_check(&self, file: FileId, mut flow: FlowId, symbol: SymbolId, known: &mut FxHashMap<FlowId, bool>) -> bool {
        let bound = self.bound(file);
        let mut passed: SmallVec<[FlowId; 16]> = SmallVec::new();
        let answer = loop {
            if flow.is_none() || known.len() + passed.len() > 4096 || self.is_half_of_stack_in_use() {
                break false;
            }
            if let Some(&answer) = known.get(&flow) {
                break answer;
            }
            passed.push(flow);
            flow = match bound.flow[flow.idx()] {
                Flow::Unreachable => break true,
                Flow::Cond { expr, sense, .. } if self.proves_defined(file, expr, sense, symbol) => break true,
                Flow::Cond { before, .. } | Flow::Assign { before, .. } | Flow::Switch { before, .. } | Flow::Call { before, .. } | Flow::ArrayMutation { before, .. } => before,
                Flow::Label { start, len } => break len > 0 && bound.edges(start, len).iter().all(|&edge| self.is_guarded_by_defined_check(file, edge, symbol, known)),
                Flow::Loop { start, len } => match bound.edges(start, len).first() {
                    Some(&entry) => entry,
                    None => break false,
                },
                _ => break false,
            };
        };
        for flow in passed {
            known.insert(flow, answer);
        }
        answer
    }

    pub(super) fn is_reference_guarded_by_defined_check(&self, file: FileId, e: ExprId, known: &mut FxHashMap<FlowId, bool>) -> bool {
        let bound = self.bound(file);
        self.is_guarded_by_defined_check(file, bound.expr_flow[e.idx()], bound.expr_symbol[e.idx()], known)
    }

    pub(super) fn is_undefined_safe_use(&mut self, file: FileId, e: ExprId) -> bool {
        if self.is_only_tested(file, e) {
            return true;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let around = match bound.expr_parent[e.idx()] {
            Parent::Expr(around) if around.is_some() => around,
            Parent::Stmt(stmt) if stmt.is_some() => return matches!(hir[stmt].kind, StmtKind::Switch { expr, .. } if expr == e),
            _ => return false,
        };
        let is_arithmetic = match hir[around].kind {
            ExprKind::Binary { op: BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq, .. } | ExprKind::Unary { op: UnOp::Typeof, .. } => false,
            ExprKind::Binary { op: BinOp::Or, left, .. } if left == e => false,
            ExprKind::Binary { op, .. } if is_operator_on_numbers(op) => true,
            ExprKind::Assign { op: Some(op), value, .. } if value == e && is_operator_on_numbers(op) => true,
            ExprKind::Unary { op: UnOp::Minus | UnOp::Plus | UnOp::BitNot, .. } => true,
            _ => return false,
        };
        !is_arithmetic || {
            let (operand, whole) = (self.type_of_expr(file, e), self.type_of_expr(file, around));
            self.is_number_type(operand) && self.is_number_type(whole)
        }
    }

    pub fn unasserted_element_read_in(&mut self, file: FileId, e: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::NonNull(read) = hir[e].kind else { return None };
        let Parent::Expr(around) = bound.expr_parent[e.idx()] else { return None };
        let is_arithmetic = match hir[around].kind {
            ExprKind::Binary { op: BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge, .. } => false,
            ExprKind::Binary { op, .. } if is_operator_on_numbers(op) => true,
            ExprKind::Assign { op: Some(op), value, .. } if value == e && is_operator_on_numbers(op) => true,
            ExprKind::Unary { op: UnOp::Minus | UnOp::Plus | UnOp::BitNot, .. } => true,
            _ => return None,
        };
        if self.is_untyped_file(file) {
            return None;
        }
        let (obj, index) = self.element_read(file, read)?;
        if is_arithmetic {
            let (operand, whole) = (self.type_of_expr(file, e), self.type_of_expr(file, around));
            if !self.is_number_type(operand) || !self.is_number_type(whole) {
                return None;
            }
        }
        let ty = self.trusted_type_of(file, read).0;
        (self.numbers_by_type(ty).is_none() && (index.is_none() || self.element_numbers(file, obj, index).is_none())).then_some(read)
    }

    fn numbers_of_expr(&mut self, file: FileId, e: ExprId, view: View, basis: Basis) -> Found {
        if e.is_none() {
            return None;
        }
        let key = (file, e, view, basis);
        let state = &self.aot.integers;
        if let Some(&(found, round)) = state.values.get(&key)
            && (round == 0 || state.is_converging && round == state.round)
        {
            return found;
        }
        if self.is_half_of_stack_in_use() {
            return None;
        }
        let mut found = self.numbers_by_syntax(file, e, view, basis);
        let kind = self.hir(file)[e].kind;
        let has_own_type = matches!(
            kind,
            ExprKind::Ident(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Call(_)
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Await(_)
                | ExprKind::Yield { .. }
                | ExprKind::As { .. }
                | ExprKind::NonNull(_)
        );
        if has_own_type && self.has_trusted_type(file, e) {
            let (ty, mut may_be_undefined) = self.trusted_type_of(file, e);
            if may_be_undefined && found.is_some() && self.is_every_store_seen(file, e) {
                may_be_undefined = self.checked_type_and_whether_left_undefined(file, e).1;
            }
            let by_type = self.numbers_by_type(ty);
            if let ExprKind::Index { obj, index, .. } = kind {
                let ignores_nullish = self.is_number_type(ty);
                found = both(by_type, self.element_numbers(file, obj, index)).map(|it| Numbers { nil: true, ignores_nullish, ..it });
            } else {
                let is_from_type_only = found.is_none() && by_type.is_some() && !matches!(kind, ExprKind::NonNull(_));
                let is_left_out = may_be_undefined || is_from_type_only && !matches!(self.constant_value_of(file, e), Some(Primitive::Number(_)));
                found = both(found, by_type);
                if let Some(found) = &mut found {
                    if self.is_number_type(ty) {
                        found.ignores_nullish |= is_left_out;
                        found.nil = found.ignores_nullish;
                    } else {
                        found.nil |= may_be_undefined;
                    }
                }
            }
        }
        let state = &mut self.aot.integers;
        let round = if state.is_converging { state.round } else { 0 };
        state.values.insert(key, (found, round));
        found
    }

    fn is_every_store_seen(&mut self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Ident(_) => {
                let (bound, local) = (self.bound(file), self.bound(file).expr_symbol[e.idx()]);
                let Some(symbol) = bound.symbols.get(local.idx()) else { return false };
                let at = if symbol.flags.contains(SymFlags::ALIAS) { self.files().resolve_alias(self.files().sym(file, local)) } else { Some(Sym { file, id: local }) };
                at.is_some_and(|at| {
                    let place = self.integer_slot(at);
                    (place.is_followed || place.declared_range.is_some()) && !(place.is_parameter && place.starts_undefined)
                })
            }
            ExprKind::Dot { name: known::length, chain: Chain::No, .. } => true,
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => self.annotated_property_numbers(file, e, obj, name).is_some_and(|declared| !declared.nil),
            ExprKind::Call(_) => self.annotated_result_numbers(file, e).is_some(),
            ExprKind::As { .. } => self.is_cast_to_int32(file, e),
            _ => false,
        }
    }

    fn numbers_by_syntax(&mut self, file: FileId, e: ExprId, view: View, basis: Basis) -> Found {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Number(index) => integer(hir.numbers[index as usize]),
            ExprKind::Null => Some(Numbers::NULLISH),
            ExprKind::Ident(name) => self.identifier_numbers(file, e, name, view, basis),
            ExprKind::Unary { op, operand } => match op {
                UnOp::Void => Some(Numbers::NULLISH),
                UnOp::Minus => negated(self.numbers_of_expr(file, operand, View::Here, basis)),
                UnOp::Plus | UnOp::PostInc | UnOp::PostDec => {
                    let operand = self.numbers_of_expr(file, operand, View::Here, basis)?;
                    if operand == Numbers::NOTHING {
                        return Some(operand);
                    }
                    operand.numbers().map(|(minimum, maximum)| Numbers::integers(minimum, maximum))
                }
                UnOp::BitNot => match self.numbers_truncated(file, operand, basis) {
                    Some(Numbers::NOTHING) => Some(Numbers::NOTHING),
                    Some(operand) => Some(match to_int32(operand) {
                        Some((minimum, maximum)) => Numbers::integers(-maximum - 1, -minimum - 1),
                        None => Numbers::integers(INT32.0, INT32.1),
                    }),
                    None => self.is_number_by_type(file, e).then(|| Numbers::integers(INT32.0, INT32.1)),
                },
                UnOp::PreInc | UnOp::PreDec => self.numbers_of_compound_assignment(file, e, basis),
                UnOp::Not | UnOp::Typeof | UnOp::Delete => None,
            },
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Comma => self.numbers_of_expr(file, right, view, basis),
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    let (a, b) = (self.numbers_of_expr(file, left, view, basis), self.numbers_of_expr(file, right, view, basis));
                    chosen(op, a, b, view)
                }
                _ => self.binary_numbers(file, e, op, left, right, basis),
            },
            ExprKind::Assign { op, target, value } => match op {
                None => self.numbers_of_expr(file, value, view, basis),
                Some(op @ (BinOp::And | BinOp::Or | BinOp::Nullish)) => {
                    let (a, b) = (self.numbers_of_expr(file, target, view, basis), self.numbers_of_expr(file, value, view, basis));
                    chosen(op, a, b, view)
                }
                Some(_) => self.numbers_of_compound_assignment(file, e, basis),
            },
            ExprKind::Cond { yes, no, .. } => either(self.numbers_of_expr(file, yes, view, basis), self.numbers_of_expr(file, no, view, basis)),
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::Instantiation { expr, .. } => self.numbers_of_expr(file, expr, view, basis),
            ExprKind::As { expr, .. } | ExprKind::NonNull(expr) if self.is_untyped_file(file) => self.numbers_of_expr(file, expr, view, basis),
            ExprKind::As { expr, .. } if self.is_cast_to_int32(file, e) => {
                let converted = Numbers::integers(INT32.0, INT32.1);
                Some(self.numbers_of_expr(file, expr, view, basis).filter(|operand| !operand.nil && operand.range().is_some_and(|(minimum, maximum)| minimum >= INT32.0 && maximum <= INT32.1)).unwrap_or(converted))
            }
            ExprKind::As { expr, .. } => {
                let operand = self.numbers_of_expr(file, expr, view, basis)?;
                let target = self.type_of_expr(file, e);
                let is_unchanged = operand == Numbers::NOTHING || self.is_uninformative(target) || !operand.nil && self.some_type(target, |c, part| c.is_number_like(part));
                is_unchanged.then_some(operand)
            }
            ExprKind::NonNull(expr) if self.files().module(file).builtin.is_none() => self.numbers_of_expr(file, expr, view, basis).map(|it| Numbers { ignores_nullish: it.ignores_nullish || it.nil, ..it }),
            ExprKind::NonNull(expr) => self.numbers_of_expr(file, expr, view, basis).map(|it| Numbers { nil: false, ignores_nullish: false, ..it }),
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => self.property_numbers(file, e, obj, name, basis),
            ExprKind::Call(call) => self.call_numbers(file, e, call, basis),
            _ => None,
        }
    }

    fn is_number_by_type(&mut self, file: FileId, e: ExprId) -> bool {
        if self.is_untyped_file(file) {
            return self.result_kinds_of(file, e) == kind::NUMBER;
        }
        if !self.has_trusted_type(file, e) {
            return false;
        }
        let ty = self.type_of_expr(file, e);
        self.is_number_type(ty)
    }

    fn binary_numbers(&mut self, file: FileId, e: ExprId, op: BinOp, left: ExprId, right: ExprId, basis: Basis) -> Found {
        let is_bitwise = matches!(op, BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr);
        if !is_bitwise {
            if matches!(op, BinOp::Div | BinOp::Pow) {
                return match self.constant_value_of(file, e) {
                    Some(Primitive::Number(value)) => integer(value),
                    _ => None,
                };
            }
            if !matches!(op, BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Rem) {
                return None;
            }
            let (a, b) = (self.numbers_of_expr(file, left, View::Here, basis), self.numbers_of_expr(file, right, View::Here, basis));
            return combined(op, a, b);
        }
        let (a, b) = (self.numbers_truncated(file, left, basis), self.numbers_truncated(file, right, basis));
        match combined(op, a, b) {
            None => self.is_number_by_type(file, e).then(|| Numbers::integers(INT32.0, INT32.1)),
            found => found,
        }
    }

    fn numbers_truncated(&mut self, file: FileId, e: ExprId, basis: Basis) -> Found {
        match self.hir(file)[e].kind {
            ExprKind::Binary { op: BinOp::Div, left, right } => self.quotient_numbers(file, left, right, basis),
            _ => self.numbers_of_expr(file, e, View::Here, basis),
        }
    }

    fn quotient_numbers(&mut self, file: FileId, left: ExprId, right: ExprId, basis: Basis) -> Found {
        let (a, b) = (self.numbers_of_expr(file, left, View::Here, basis)?, self.numbers_of_expr(file, right, View::Here, basis)?);
        if a == Numbers::NOTHING || b == Numbers::NOTHING {
            return Some(Numbers::NOTHING);
        }
        let (a, b) = (a.numbers()?, b.numbers()?);
        (a.0 >= 0 && b.0 > 0).then(|| Numbers::integers(a.0 / b.1, a.1 / b.0))
    }

    fn numbers_of_compound_assignment(&mut self, file: FileId, e: ExprId, basis: Basis) -> Found {
        let (op, operand) = match self.hir(file)[e].kind {
            ExprKind::Unary { op: UnOp::PreInc | UnOp::PostInc, operand } => (BinOp::Add, operand),
            ExprKind::Unary { op: UnOp::PreDec | UnOp::PostDec, operand } => (BinOp::Sub, operand),
            ExprKind::Assign { op: Some(op), target, value } => return self.binary_numbers(file, e, op, target, value, basis),
            _ => return None,
        };
        combined(op, self.numbers_of_expr(file, operand, View::Here, basis), Some(Numbers::integers(1, 1)))
    }

    fn identifier_numbers(&mut self, file: FileId, e: ExprId, name: Atom, view: View, basis: Basis) -> Found {
        let bound = self.bound(file);
        let local = bound.expr_symbol[e.idx()];
        if local.is_none() {
            return (name == known::undefined).then_some(Numbers::NULLISH);
        }
        let mut at = Sym { file, id: local };
        if bound.symbols[local.idx()].flags.contains(SymFlags::ALIAS) {
            at = self.files().resolve_alias(self.files().sym(file, local))?;
            if self.is_untyped_file(at.file) && !self.is_untyped_file(file) {
                return None;
            }
        }
        let place = self.integer_slot(at);
        if !place.is_followed {
            return place.declared_range;
        }
        let held = self.slot_numbers(at, basis);
        if view == View::Kept || at.file != file {
            return held;
        }
        let is_read_elsewhere = place.container != Some(self.flow_container(file, bound.expr_parent[e.idx()]));
        let is_constant = !place.is_assigned && !place.starts_undefined;
        let learned_nothing = if is_constant { held.is_none() } else { place.is_stored_elsewhere || is_read_elsewhere };
        if learned_nothing {
            return held;
        }
        let Some(tests) = self.dominating_tests(file, e, at, basis) else { return held };
        if is_constant {
            return held.map(|held| tests.iter().fold(held, |held, test| held.within(test.minimum, test.maximum).without(test.excluded)));
        }
        let flow = bound.expr_flow[e.idx()];
        if flow.is_none() || flow == UNREACHABLE {
            return held;
        }
        let mut walk = Walk { at, basis, tests, by_type: place.by_type, declared_range: place.declared_range, is_parameter: place.is_parameter, joins: FxHashMap::default(), steps: 0 };
        self.numbers_at(&mut walk, flow)
    }

    pub(super) fn private_field_for_access(&self, file: FileId, e: ExprId, name: Atom) -> SymbolId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(&class) = bound.private_class.get(&e) else { return SymbolId::NONE };
        let member = hir[class].members.iter().find(|&member| hir[member].key == PropKey::Private(name));
        member.map_or(SymbolId::NONE, |member| bound.member_symbol[member.idx()])
    }

    fn property_numbers(&mut self, file: FileId, e: ExprId, obj: ExprId, name: Atom, basis: Basis) -> Found {
        let field = self.private_field_for_access(file, e, name);
        if field.is_some() {
            let at = Sym { file, id: field };
            return if self.integer_slot(at).is_followed { self.slot_numbers(at, basis) } else { None };
        }
        if name != known::length {
            return self.annotated_property_numbers(file, e, obj, name);
        }
        if self.is_untyped_file(file) {
            return match self.result_kinds_of(file, obj) {
                kind::STRING => Some(Numbers::integers(0, MAX_STRING_LENGTH)),
                kind::ARRAY => Some(Numbers::integers(0, MAX_ARRAY_LENGTH)),
                of if of == kind::ARRAY | kind::STRING => Some(Numbers::integers(0, MAX_ARRAY_LENGTH.max(MAX_STRING_LENGTH))),
                _ => None,
            };
        }
        if !self.has_trusted_type(file, e) {
            return None;
        }
        let ty = self.trusted_type_of(file, obj).0;
        let maximum = self.max_length_of(ty)?;
        Some(Numbers::integers(0, maximum))
    }

    fn annotated_property_numbers(&mut self, file: FileId, e: ExprId, obj: ExprId, name: Atom) -> Found {
        if self.is_untyped_file(file) {
            return None;
        }
        let holder = self.type_of_expr(file, obj);
        let (prop, _) = self.get_property_of_type(holder, name)?;
        let (minimum, maximum) = self.annotated_prop_integer_range(prop)?;
        let is_fact = self.has_trusted_type(file, e) && !self.is_in_untyped_clone_span(file, self.hir(file)[e].pos);
        is_fact.then(|| Numbers { nil: prop.flags.contains(PropFlags::OPTIONAL), ..Numbers::integers(minimum, maximum) })
    }

    fn annotated_result_numbers(&mut self, file: FileId, e: ExprId) -> Found {
        if self.is_untyped_file(file) {
            return None;
        }
        let (declared_in, signature, _) = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig))?;
        let (of, func) = self.implementation_for(declared_in, signature)?;
        if !self.is_compiled(of) || self.hir(of)[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR | Flags::AMBIENT) {
            return None;
        }
        let (minimum, maximum) = self.annotated_result_integer_range(of, func)?;
        let is_fact = self.has_trusted_type(file, e) && !self.is_in_untyped_clone_span(file, self.hir(file)[e].pos);
        is_fact.then(|| Numbers::integers(minimum, maximum))
    }

    pub(super) fn refers_to_global_object(&mut self, file: FileId, e: ExprId, name: &[u8]) -> bool {
        let ExprKind::Ident(written) = self.hir(file)[e].kind else { return false };
        self.bound(file).expr_symbol[e.idx()].is_none()
            && self.atoms().bytes(written) == name
            && !self.module_graph_may_replace_in(file, written)
            && self.symbol_of_identifier(file, e, written).is_some_and(|found| self.hir(found.file).kind == FileKind::Declaration)
    }

    pub fn well_known_symbol_for_expr(&mut self, file: FileId, e: ExprId) -> Option<Atom> {
        match self.hir(file)[e].kind {
            ExprKind::Dot { obj, name, .. } if self.refers_to_global_object(file, obj, b"Symbol") => Some(name),
            _ => None,
        }
    }

    fn call_numbers(&mut self, file: FileId, e: ExprId, call: CallId, basis: Basis) -> Found {
        if let Some(annotated) = self.annotated_result_numbers(file, e) {
            return Some(annotated);
        }
        let hir = self.hir(file);
        let call = &hir[call];
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[call.callee].kind else { return None };
        if call.chain != Chain::No || hir.ids(call.args).any(|arg| matches!(hir[arg].kind, ExprKind::Spread(_) | ExprKind::Missing)) {
            return None;
        }
        let name = self.atoms().bytes(name);
        if self.refers_to_global_object(file, obj, b"Math") {
            return self.math_call_numbers(file, name, call.args, basis);
        }
        let is_untyped = self.is_untyped_file(file);
        if !matches!(name, b"indexOf" | b"lastIndexOf" | b"search" | b"codePointAt") || !is_untyped && !self.has_trusted_type(file, e) {
            return None;
        }
        let is_string = |c: &mut Self, e: ExprId| {
            if is_untyped {
                return c.result_kinds_of(file, e) == kind::STRING;
            }
            let ty = c.trusted_type_of(file, e).0;
            !ty.is_never() && c.every_type(ty, |c, part| c.is_string_like(part))
        };
        if !is_string(self, obj) {
            return None;
        }
        match name {
            b"codePointAt" => Some(Numbers { minimum: 0, maximum: 0x10FFFF, nil: true, ignores_nullish: false }),
            b"search" if !hir.ids(call.args).next().is_some_and(|pattern| is_string(self, pattern)) => None,
            _ => Some(Numbers::integers(-1, MAX_STRING_LENGTH)),
        }
    }

    fn math_call_numbers(&mut self, file: FileId, name: &[u8], args: IdList<ExprId>, basis: Basis) -> Found {
        let hir = self.hir(file);
        match name {
            b"imul" => return Some(Numbers::integers(INT32.0, INT32.1)),
            b"clz32" => return Some(Numbers::integers(0, 32)),
            b"floor" | b"trunc" => {
                if let Some(arg) = hir.ids(args).next()
                    && let ExprKind::Binary { op: BinOp::Div, left, right } = hir[arg].kind
                {
                    return self.quotient_numbers(file, left, right, basis);
                }
            }
            b"ceil" | b"round" | b"abs" | b"sign" | b"min" | b"max" => {}
            _ => return None,
        }
        let mut given: SmallVec<[(i64, i64); 4]> = SmallVec::new();
        for arg in hir.ids(args) {
            let arg = self.numbers_of_expr(file, arg, View::Here, basis)?;
            if arg == Numbers::NOTHING {
                return Some(arg);
            }
            given.push(arg.numbers()?);
        }
        let &(minimum, maximum) = given.first()?;
        Some(match name {
            b"min" => Numbers::integers(given.iter().fold(minimum, |minimum, it| minimum.min(it.0)), given.iter().fold(maximum, |maximum, it| maximum.min(it.1))),
            b"max" => Numbers::integers(given.iter().fold(minimum, |minimum, it| minimum.max(it.0)), given.iter().fold(maximum, |maximum, it| maximum.max(it.1))),
            b"abs" if minimum >= 0 => Numbers::integers(minimum, maximum),
            b"abs" if maximum <= 0 => Numbers::integers(-maximum, -minimum),
            b"abs" => Numbers::integers(0, maximum.max(-minimum)),
            b"sign" => Numbers::integers(minimum.signum(), maximum.signum()),
            _ => Numbers::integers(minimum, maximum),
        })
    }

    pub(super) fn flow_container(&self, file: FileId, mut parent: Parent) -> Container {
        let bound = self.bound(file);
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => self.expr_parent_link(file, e),
                Parent::Stmt(s) if s.is_some() => self.stmt_parent_link(file, s),
                Parent::FnBody(func) => return Container::Fn(func),
                Parent::ParamDefault(p) => return Container::Fn(bound.param_fn[p.idx()]),
                Parent::MemberInit(member) => return Container::Member(member),
                Parent::Module(module) => return Container::Module(module),
                Parent::File => return Container::File,
                Parent::None => return Container::Other,
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    fn is_labeled_statement(&self, file: FileId, stmt: StmtId) -> bool {
        matches!(self.bound(file).stmt_parent[stmt.idx()], Parent::Stmt(label) if label.is_some() && matches!(self.hir(file)[label].kind, StmtKind::Labeled { .. }))
    }

    pub(super) fn is_in_default_of_assignment_pattern(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut child = e;
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            match parent {
                Parent::Expr(outer) if outer.is_some() => {
                    if matches!(hir[outer].kind, ExprKind::Assign { op: None, value, .. } if value == child) && (bound.is_shorthand_property_assignment(hir, outer) || bound.get_assignment_target(hir, outer).is_some()) {
                        return true;
                    }
                    child = outer;
                }
                Parent::Prop(_) | Parent::PropKey(..) | Parent::ClassExtends(_) | Parent::Stmt(_) | Parent::VarInit(_) | Parent::Case(_) => {}
                Parent::MethodKey(prop) => {
                    parent = Parent::Expr(bound.prop_owner[prop.idx()]);
                    continue;
                }
                Parent::MemberKey(member) => parent = Parent::MemberInit(member),
                Parent::MemberInit(member) if hir[member].flags.contains(Flags::STATIC) => {}
                Parent::FnBody(func) if hir[func].kind == FnKind::StaticBlock => {}
                _ => return false,
            }
            parent = self.parent_of_node(file, parent);
        }
    }

    pub(super) fn is_outside_flow_graph(&self, file: FileId, e: ExprId) -> bool {
        if self.is_in_default_of_assignment_pattern(file, e) {
            return true;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut child = Child::Expr(e);
        let mut parent = bound.expr_parent[e.idx()];
        let mut is_in_try_statement = false;
        loop {
            match parent {
                Parent::Case(_) => return true,
                Parent::Stmt(outer) if outer.is_some() => match hir[outer].kind {
                    StmtKind::For { update, .. } if child == Child::Expr(update) && self.is_labeled_statement(file, outer) => return true,
                    StmtKind::Try { finalizer, .. } if child == Child::Stmt(finalizer) || is_in_try_statement => return true,
                    StmtKind::Try { .. } => is_in_try_statement = true,
                    _ => {}
                },
                Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::MemberInit(_) | Parent::Module(_) | Parent::File | Parent::None => return false,
                _ => {}
            }
            child = match parent {
                Parent::Expr(outer) => Child::Expr(outer),
                Parent::Stmt(outer) => Child::Stmt(outer),
                _ => Child::Other,
            };
            parent = self.parent_of_node(file, parent);
        }
    }

    fn slot_for_expr(&self, file: FileId, mut e: ExprId) -> SymbolId {
        let hir = self.hir(file);
        loop {
            match hir[e].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => e = expr,
                ExprKind::Ident(_) => return self.bound(file).expr_symbol[e.idx()],
                ExprKind::Dot { name, .. } => return self.private_field_for_access(file, e, name),
                _ => return SymbolId::NONE,
            }
        }
    }

    fn integer_uses_in(&self, file: FileId) -> &'p Uses {
        let program = self.p;
        program.aot.integers.uses.get_or_init(program.files.modules.len(), file, || self.find_integer_uses_in(file))
    }

    pub(super) fn is_stored_through_assertions(&self, file: FileId, symbol: SymbolId) -> bool {
        self.integer_uses_in(file).stored_through_assertions.contains(&symbol)
    }

    pub(super) fn has_direct_eval(&self, file: FileId) -> bool {
        self.integer_uses_in(file).has_direct_eval
    }

    fn find_integer_uses_in(&self, file: FileId) -> Uses {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let by_kind = self.file_exprs_by_kind(file);
        let mut uses = Uses::default();
        let is_eval = |call: &ExprId| matches!(hir[*call].kind, ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(name) if self.atoms().bytes(name) == b"eval"));
        uses.has_direct_eval = by_kind.of(ExprTag::Call).iter().any(is_eval);
        uses.stored_through_assertions.extend(self.reified_namespace_variables(file));
        uses.stored_through_assertions.extend((0..hir.pats.len()).filter_map(|pat| self.redeclared_catch_parameter(file, crate::hir::PatId(pat as u32)).map(|caught| [caught, bound.pat_symbol[pat]])).flatten());
        for tag in [ExprTag::As, ExprTag::Satisfies] {
            for &e in by_kind.of(tag) {
                if bound.get_assignment_target(hir, e).is_some() {
                    uses.stored_through_assertions.insert(self.slot_for_expr(file, e));
                }
            }
        }
        for &e in by_kind.of(ExprTag::Ident) {
            let symbol = bound.expr_symbol[e.idx()];
            if symbol.is_none() || !bound.symbols[symbol.idx()].flags.contains(SymFlags::FUNCTION) || bound.is_unchecked(e.idx()) || bound.is_in_type_query(e) {
                continue;
            }
            let call = match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Call(call) if hir[call].callee == e && hir[call].chain == Chain::No => Some(call),
                    _ => None,
                },
                _ => None,
            };
            let calls = uses.calls.entry(symbol).or_insert_with(|| Some(Vec::new()));
            match call {
                Some(call) => calls.iter_mut().for_each(|calls| calls.push(call)),
                None => *calls = None,
            }
        }
        if self.files().jsx_runtime(file).is_none() {
            for &e in by_kind.of(ExprTag::Jsx) {
                for is_fragment_tag in [false, true] {
                    if let (_, Some(named)) = self.classic_jsx_factory(file, e, is_fragment_tag)
                        && named.file == file
                    {
                        uses.calls.insert(named.id, None);
                    }
                }
            }
        }
        for named in self.decorator_referenced_values(file) {
            if named.file == file {
                uses.calls.insert(named.id, None);
            }
        }
        if !bound.private_class.is_empty() {
            for &e in by_kind.of(ExprTag::Dot) {
                let field = self.slot_for_expr(file, e);
                if field.is_some() && bound.get_assignment_target(hir, e).is_some() {
                    uses.private_stores.entry(field).or_default().push(e);
                }
            }
        }
        uses
    }

    fn is_file_private(&mut self, file: FileId, name: Atom) -> bool {
        if self.files().module(file).is_module() {
            return true;
        }
        !self.free_names().contains(&name)
    }

    pub(super) fn free_names(&self) -> &'p FxHashSet<Atom> {
        self.p.aot.integers.free_names.get_or_init(|| {
            let mut names = FxHashSet::default();
            for module in self.files().modules.iter().filter(|module| !module.is_opaque()) {
                for &(e, _) in module.bound.free_idents.iter() {
                    if let ExprKind::Ident(name) = module.hir[e].kind {
                        names.insert(name);
                    }
                }
            }
            names
        })
    }

    pub(super) fn integer_slot(&mut self, at: Sym) -> Rc<Place> {
        if let Some(known) = self.aot.integers.places.get(&at) {
            return Rc::clone(known);
        }
        let mut place = self.slot_stores(at).unwrap_or_default();
        place.declared_range = self.declared_int32_range(at);
        let place = Rc::new(place);
        self.aot.integers.places.insert(at, Rc::clone(&place));
        place
    }

    fn declared_int32_range(&mut self, at: Sym) -> Found {
        let (minimum, maximum) = self.annotated_symbol_integer_range(at)?;
        Some(Numbers::integers(minimum, maximum))
    }

    fn slot_stores(&mut self, at: Sym) -> Option<Place> {
        let file = at.file;
        let bound = self.bound(file);
        let symbol = bound.symbols.get(at.id.idx())?;
        let uses = self.integer_uses_in(file);
        if symbol.flags.contains(SymFlags::MERGED) || uses.stored_through_assertions.contains(&at.id) || uses.has_direct_eval {
            return None;
        }
        if self.redeclared_commonjs_variable(file, symbol.name) == Some(at) {
            return None;
        }
        let mut place = Place { is_followed: true, ..Place::default() };
        for &decl in symbol.decls.iter() {
            let declared_in = match decl {
                Decl::Var(pat) => self.add_variable_initializer(file, pat, symbol.name, &mut place)?,
                Decl::Param(pat) => match self.add_int32_parameter(file, pat, &mut place) {
                    Some(declared_in) => declared_in,
                    None => self.add_parameter_arguments(file, pat, uses, &mut place)?,
                },
                Decl::Member(member) => self.add_private_field_initializer(file, member, &mut place)?,
                _ => return None,
            };
            if *place.container.get_or_insert(declared_in) != declared_in && !matches!(declared_in, Container::Other) {
                return None;
            }
        }
        let names = bound.assignments_to(at.id).iter().map(|&(_, target)| target);
        let targets: Vec<ExprId> = names.chain(uses.private_stores.get(&at.id).into_iter().flatten().copied()).collect();
        for target in targets {
            place.stores.push(self.target_store(file, target)?);
            place.is_assigned = true;
            place.is_stored_elsewhere |= place.container != Some(self.flow_container(file, bound.expr_parent[target.idx()])) || self.is_outside_flow_graph(file, target);
        }
        if !self.is_untyped_file(file) {
            let ty = self.stored_type(self.files().sym(file, at.id));
            place.by_type = self.numbers_by_type(ty);
            place.holds_numbers_only = self.is_number_type(ty);
        }
        Some(place)
    }

    pub(super) fn stored_expressions(&mut self, at: Sym) -> Option<(Vec<ExprId>, Vec<ExprId>)> {
        let place = self.integer_slot(at);
        if !place.is_followed {
            return None;
        }
        let (mut values, mut computed) = (Vec::new(), Vec::new());
        for store in &place.stores {
            match *store {
                Store::Value(value) => values.push(value),
                Store::Computed(by) => computed.push(by),
                Store::Nil => return None,
            }
        }
        Some((values, computed))
    }

    pub(super) fn target_store(&self, file: FileId, target: ExprId) -> Option<Store> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(parent) = bound.expr_parent[target.idx()] else { return None };
        match hir[parent.some()?].kind {
            ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => Some(Store::Computed(parent)),
            ExprKind::Assign { op, target: to, value } if to == target && !bound.is_shorthand_property_assignment(hir, parent) && bound.get_assignment_target(hir, parent).is_none() => {
                Some(match op {
                    None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => Store::Value(value),
                    Some(_) => Store::Computed(parent),
                })
            }
            _ => None,
        }
    }

    fn add_variable_initializer(&mut self, file: FileId, pat: PatId, name: Atom, place: &mut Place) -> Option<Container> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return None };
        let (declaration, stmt) = (&hir[d], bound.var_stmt[d.idx()].some()?);
        if declaration.flags.contains(Flags::AMBIENT) || !matches!(hir[stmt].kind, StmtKind::Var(_)) {
            return None;
        }
        let around = bound.stmt_parent[stmt.idx()];
        if matches!(around, Parent::Stmt(head) if head.is_some() && matches!(hir[head].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt)) {
            return None;
        }
        let declared_in = self.flow_container(file, around);
        match declared_in {
            Container::File if (matches!(around, Parent::File) || declaration.kind == VarKind::Var) && !self.is_file_private(file, name) => return None,
            Container::Module(_) if declaration.flags.contains(Flags::EXPORT) => return None,
            Container::Other => return None,
            _ => {}
        }
        match declaration.init.some() {
            Some(init) => {
                place.stores.push(Store::Value(init));
                place.is_stored_elsewhere |= self.is_outside_flow_graph(file, init);
            }
            None => place.starts_undefined = true,
        }
        place.starts_undefined |= self.starts_undefined(self.files().sym(file, bound.pat_symbol[pat.idx()]));
        Some(declared_in)
    }

    fn add_private_field_initializer(&mut self, file: FileId, member: MemberId, place: &mut Place) -> Option<Container> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let m = &hir[member];
        let is_field = m.kind == MemberKind::Property && matches!(m.key, PropKey::Private(_)) && matches!(bound.member_owner[member.idx()], MemberOwner::Class(_));
        if !is_field || m.flags.intersects(Flags::ACCESSOR | Flags::AMBIENT) {
            return None;
        }
        match m.init.some() {
            Some(init) => place.stores.push(Store::Value(init)),
            None => place.starts_undefined = true,
        }
        Some(Container::Other)
    }

    pub(super) fn mentions_arguments_object(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        bound.arguments_objects.iter().any(|&e| {
            let mut around = self.enclosing_fn_of_expr(file, e);
            while let Some(arrow) = around.filter(|&it| hir[it].kind == FnKind::Arrow) {
                around = bound.fns[arrow.idx()].enclosing.some();
            }
            around == Some(func)
        })
    }

    fn add_parameter_arguments(&mut self, file: FileId, pat: PatId, uses: &Uses, place: &mut Place) -> Option<Container> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Param(p) = bound.pat_parent[pat.idx()] else { return None };
        let func = bound.param_fn[p.idx()];
        let (f, param) = (&hir[func], &hir[p]);
        if f.kind != FnKind::Decl
            || matches!(f.body, FnBody::None)
            || f.flags.intersects(Flags::EXPORT | Flags::DEFAULT | Flags::AMBIENT)
            || param.flags.intersects(Flags::REST | Flags::PARAMETER_PROPERTY)
        {
            return None;
        }
        let id = bound.fn_symbol[func.idx()];
        let symbol = bound.symbols.get(id.idx())?;
        let is_more = SymFlags::VALUE.difference(SymFlags::FUNCTION) | SymFlags::MERGED | SymFlags::ASSIGNED | SymFlags::ALIAS;
        let bodies = symbol.decls.iter().filter(|decl| matches!(**decl, Decl::Fn(it) if !matches!(hir[it].body, FnBody::None))).count();
        if symbol.flags.intersects(is_more) || bodies != 1 || !symbol.decls.iter().all(|decl| matches!(decl, Decl::Fn(_))) {
            return None;
        }
        if hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == f.name)) {
            return None;
        }
        let FnOwner::Stmt(stmt) = bound.fns[func.idx()].owner else { return None };
        if matches!(bound.stmt_parent[stmt.idx()], Parent::File) && !self.is_file_private(file, f.name) {
            return None;
        }
        if hir.is_js && !matches!(bound.stmt_parent[stmt.idx()], Parent::File | Parent::FnBody(_)) {
            return None;
        }
        if self.mentions_arguments_object(file, func) {
            return None;
        }
        let name = bound.symbols.get(bound.pat_symbol[pat.idx()].idx())?.name;
        if matches!(f.body, FnBody::Block(body) if hir.ids(body).any(|stmt| matches!(hir[stmt].kind, StmtKind::Fn(inner) if hir[inner].name == name))) {
            return None;
        }
        let index = f.params.iter().position(|it| it == p)?;
        place.is_parameter = true;
        place.stores.extend(param.default.some().map(Store::Value));
        let first_argument = place.stores.len();
        for &call in uses.calls.get(&id).map_or(Some(&[][..]), |calls| calls.as_deref())? {
            let args = hir[call].args;
            if hir.ids(args).any(|arg| matches!(hir[arg].kind, ExprKind::Spread(_) | ExprKind::Missing)) {
                return None;
            }
            place.stores.push(hir.ids(args).nth(index).map_or(Store::Nil, Store::Value));
        }
        if param.default.is_some() {
            place.defaulted = first_argument..place.stores.len();
        }
        Some(Container::Fn(func))
    }

    fn add_int32_parameter(&mut self, file: FileId, pat: PatId, place: &mut Place) -> Option<Container> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Param(p) = bound.pat_parent[pat.idx()] else { return None };
        let (func, param) = (bound.param_fn[p.idx()], &hir[p]);
        if matches!(hir[func].body, FnBody::None) || param.flags.contains(Flags::REST) || !self.is_int32_annotation(file, param.ty, 0) || self.mentions_arguments_object(file, func) {
            return None;
        }
        let name = bound.symbols.get(bound.pat_symbol[pat.idx()].idx())?.name;
        if matches!(hir[func].body, FnBody::Block(body) if hir.ids(body).any(|stmt| matches!(hir[stmt].kind, StmtKind::Fn(inner) if hir[inner].name == name))) {
            return None;
        }
        place.stores.extend(param.default.some().map(Store::Value));
        place.is_parameter = true;
        place.enters_as_declared = true;
        place.starts_undefined = param.flags.contains(Flags::OPTIONAL);
        Some(Container::Fn(func))
    }

    fn slot_numbers(&mut self, at: Sym, basis: Basis) -> Found {
        match basis {
            Basis::Rough => self.slot_numbers_first_pass(at),
            Basis::Exact => {
                if let Some(&known) = self.aot.integers.exact.get(&at) {
                    return known;
                }
                let found = self.stored_numbers(at);
                self.aot.integers.exact.insert(at, found);
                found
            }
        }
    }

    fn slot_numbers_first_pass(&mut self, at: Sym) -> Found {
        let state = &mut self.aot.integers;
        if let Some(&settled) = state.rough.get(&at) {
            return settled;
        }
        if let Some(&assumed) = state.assumed.get(&at) {
            return assumed;
        }
        state.assumed.insert(at, Some(Numbers::NOTHING));
        state.settling.push(at);
        if state.is_converging {
            return Some(Numbers::NOTHING);
        }
        state.is_converging = true;
        state.round += 1;
        loop {
            let mut has_changed = false;
            let mut next = 0;
            while let Some(&place) = self.aot.integers.settling.get(next) {
                next += 1;
                let Some(&Some(so_far)) = self.aot.integers.assumed.get(&place) else { continue };
                let found = self.stored_numbers(place).map(|found| so_far.or(found.rounded()));
                if found != Some(so_far) {
                    let state = &mut self.aot.integers;
                    state.assumed.insert(place, found);
                    state.round += 1;
                    has_changed = true;
                }
            }
            if !has_changed {
                break;
            }
        }
        let state = &mut self.aot.integers;
        state.is_converging = false;
        state.settling.clear();
        let settled = std::mem::take(&mut state.assumed);
        let found = settled.get(&at).copied().flatten();
        state.rough.extend(settled);
        found
    }

    fn stored_numbers(&mut self, at: Sym) -> Found {
        let place = self.integer_slot(at);
        if !place.is_followed {
            return None;
        }
        let by_type = place.by_type.filter(|by_type| !by_type.has_no_number());
        let mut all = if place.starts_undefined { Numbers::NULLISH } else { Numbers::NOTHING };
        if place.enters_as_declared {
            all = all.or(place.declared_range?);
        }
        for (index, &store) in place.stores.iter().enumerate() {
            let stored = match (self.store_numbers(at.file, store, View::Kept, Basis::Rough), by_type, place.declared_range) {
                (Some(stored), _, Some(declared)) => stored.within(declared.minimum, declared.maximum),
                (None, _, Some(declared)) => declared,
                (Some(stored), _, None) => stored,
                (None, Some(_), None) => Numbers { nil: true, ignores_nullish: true, ..Numbers::NOTHING },
                (None, None, None) => return None,
            };
            let stored = if place.holds_numbers_only { stored.stored_as_a_number() } else { stored };
            all = all.or(if place.defaulted.contains(&index) { Numbers { ignores_nullish: false, ..stored } } else { stored });
        }
        Some(match by_type {
            Some(by_type) => Numbers { nil: by_type.nil || place.starts_undefined || all.ignores_nullish, ignores_nullish: all.ignores_nullish, ..by_type },
            None => all,
        })
    }

    fn store_numbers(&mut self, file: FileId, store: Store, view: View, basis: Basis) -> Found {
        match store {
            Store::Value(e) => self.numbers_of_expr(file, e, view, basis),
            Store::Computed(e) => self.numbers_of_compound_assignment(file, e, basis),
            Store::Nil => Some(Numbers::NULLISH),
        }
    }

    fn numbers_at(&mut self, walk: &mut Walk, start: FlowId) -> Found {
        let bound = self.bound(walk.at.file);
        let (mut minimum, mut maximum) = (i64::MIN, i64::MAX);
        let mut excluded: SmallVec<[i64; 2]> = SmallVec::new();
        let mut flow = start;
        let found = loop {
            walk.steps += 1;
            if walk.steps > MAX_STEPS || self.is_half_of_stack_in_use() {
                break self.slot_numbers(walk.at, walk.basis);
            }
            for test in walk.tests.iter().filter(|test| test.at == flow) {
                (minimum, maximum) = (minimum.max(test.minimum), maximum.min(test.maximum));
                excluded.extend(test.excluded);
            }
            match bound.flow[flow.idx()] {
                Flow::Unreachable => break Some(Numbers::NOTHING),
                Flow::Start { .. } | Flow::StartInvoked { .. } => {
                    break if walk.is_parameter { self.slot_numbers(walk.at, walk.basis) } else { Some(Numbers::NULLISH) };
                }
                Flow::Assign { before, target } => match (self.numbers_at_assignment(walk, target), walk.declared_range) {
                    (Some(None), Some(declared)) => break Some(declared),
                    (Some(Some(stored)), Some(declared)) => break Some(stored.within(declared.minimum, declared.maximum)),
                    (Some(None), None) if walk.by_type.is_some() => break walk.by_type.map(|by_type| Numbers { nil: true, ignores_nullish: true, ..by_type }),
                    (Some(stored), None) => break both(stored, walk.by_type),
                    (None, _) => flow = before,
                },
                Flow::Cond { before, .. } | Flow::Switch { before, .. } | Flow::Call { before, .. } | Flow::Reduce { before, .. } | Flow::ArrayMutation { before, .. } => {
                    flow = before;
                }
                Flow::Label { start, len } => {
                    if let Some(&known) = walk.joins.get(&flow) {
                        break known;
                    }
                    let mut all = Some(Numbers::NOTHING);
                    for &edge in bound.edges(start, len) {
                        all = either(all, self.numbers_at(walk, edge));
                        if all.is_none() {
                            break;
                        }
                    }
                    walk.joins.insert(flow, all);
                    break all;
                }
                Flow::Loop { start, len } => match *bound.edges(start, len) {
                    [] => break Some(Numbers::NOTHING),
                    [entry] => flow = entry,
                    [entry, ..] => {
                        if self.is_assigned_in_loop(walk.at, flow) {
                            break self.slot_numbers(walk.at, walk.basis);
                        }
                        flow = entry;
                    }
                },
            }
        };
        found.map(|found| excluded.iter().fold(found.within(minimum, maximum), |found, &value| found.without(Some(value))))
    }

    pub(super) fn is_store_to_slot(&self, at: Sym, target: FlowTarget) -> bool {
        let (hir, bound) = (self.hir(at.file), self.bound(at.file));
        match target {
            FlowTarget::Var(d) => bound.pat_symbol[hir[d].pat.idx()] == at.id,
            FlowTarget::Pat(pat) => bound.pat_symbol[pat.idx()] == at.id,
            FlowTarget::Expr(e) => matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == at.id,
        }
    }

    fn numbers_at_assignment(&mut self, walk: &Walk, target: FlowTarget) -> Option<Found> {
        if !self.is_store_to_slot(walk.at, target) {
            return None;
        }
        let file = walk.at.file;
        let stored = match target {
            FlowTarget::Var(d) => self.numbers_of_expr(file, self.hir(file)[d].init, View::Here, walk.basis),
            FlowTarget::Pat(_) => None,
            FlowTarget::Expr(e) => match self.target_store(file, e) {
                Some(store) => self.store_numbers(file, store, View::Here, walk.basis),
                None => None,
            },
        };
        Some(if self.integer_slot(walk.at).holds_numbers_only { stored.map(Numbers::stored_as_a_number) } else { stored })
    }

    pub(super) fn is_assigned_in_loop(&mut self, at: Sym, head: FlowId) -> bool {
        if let Some(&known) = self.aot.integers.loops.get(&(at, head)) {
            return known;
        }
        let bound = self.bound(at.file);
        let mut seen = FxHashSet::default();
        seen.insert(head);
        let mut work: Vec<FlowId> = match bound.flow[head.idx()] {
            Flow::Loop { start, len } => bound.edges(start, len).iter().skip(1).copied().collect(),
            _ => Vec::new(),
        };
        let mut is_stored_to = false;
        while let Some(flow) = work.pop() {
            if !seen.insert(flow) {
                continue;
            }
            if seen.len() > MAX_NODES_IN_LOOP {
                is_stored_to = true;
                break;
            }
            match bound.flow[flow.idx()] {
                Flow::Unreachable | Flow::Start { .. } | Flow::StartInvoked { .. } => {}
                Flow::Label { start, len } | Flow::Loop { start, len } => work.extend_from_slice(bound.edges(start, len)),
                Flow::Assign { before, target } => {
                    if self.is_store_to_slot(at, target) {
                        is_stored_to = true;
                        break;
                    }
                    work.push(before);
                }
                Flow::Cond { before, .. } | Flow::Switch { before, .. } | Flow::Call { before, .. } | Flow::Reduce { before, .. } | Flow::ArrayMutation { before, .. } => {
                    work.push(before);
                }
            }
        }
        self.aot.integers.loops.insert((at, head), is_stored_to);
        is_stored_to
    }

    fn dominating_tests(&mut self, file: FileId, e: ExprId, at: Sym, basis: Basis) -> Option<Tests> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut passed: SmallVec<[(ExprId, bool); 8]> = SmallVec::new();
        let mut child = Child::Expr(e);
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            let mut siblings: IdList<StmtId> = IdList::EMPTY;
            let mut is_outermost = false;
            match parent {
                Parent::Expr(outer) if outer.is_some() => match hir[outer].kind {
                    ExprKind::Cond { test, yes, .. } if child == Child::Expr(yes) => passed.push((test, true)),
                    ExprKind::Cond { test, no, .. } if child == Child::Expr(no) => passed.push((test, false)),
                    ExprKind::Binary { op: BinOp::And, left, right } if child == Child::Expr(right) => passed.push((left, true)),
                    ExprKind::Binary { op: BinOp::Or, left, right } if child == Child::Expr(right) => passed.push((left, false)),
                    _ => {}
                },
                Parent::Stmt(outer) if outer.is_some() => match hir[outer].kind {
                    StmtKind::If { test, yes, .. } if child == Child::Stmt(yes) => passed.push((test, true)),
                    StmtKind::If { test, no, .. } if child == Child::Stmt(no) => passed.push((test, false)),
                    StmtKind::While { test, body } if child == Child::Stmt(body) => passed.push((test, true)),
                    StmtKind::For { test, update, body, .. } if child == Child::Stmt(body) || child == Child::Expr(update) => {
                        if child == Child::Expr(update) && self.is_labeled_statement(file, outer) {
                            return None;
                        }
                        if test.is_some() {
                            passed.push((test, true));
                        }
                    }
                    StmtKind::Block(list) => siblings = list,
                    StmtKind::Switch { cases, .. } => {
                        let bodies = cases.iter().map(|case| hir[case].body);
                        siblings = bodies.into_iter().find(|&body| hir.ids(body).any(|it| child == Child::Stmt(it))).unwrap_or(IdList::EMPTY);
                    }
                    _ => {}
                },
                Parent::FnBody(func) => {
                    if let FnBody::Block(list) = hir[func].body {
                        siblings = list;
                    }
                    is_outermost = true;
                }
                Parent::File => {
                    siblings = hir.body;
                    is_outermost = true;
                }
                Parent::Module(module) => {
                    siblings = hir[module].body;
                    is_outermost = true;
                }
                Parent::None | Parent::ParamDefault(_) | Parent::MemberInit(_) => is_outermost = true,
                _ => {}
            }
            if let Child::Stmt(child) = child
                && !siblings.is_empty()
            {
                let leaving = Rc::clone(self.aot.integers.leaving.entry((file, siblings.start)).or_insert_with(|| {
                    let mut leaving = Vec::new();
                    for (place, before) in hir.ids(siblings).enumerate() {
                        let StmtKind::If { test, yes, no } = hir[before].kind else { continue };
                        if never_completes(hir, yes) {
                            leaving.push((place as u32, test, false));
                        }
                        if no.is_some() && never_completes(hir, no) {
                            leaving.push((place as u32, test, true));
                        }
                    }
                    leaving.into()
                }));
                if !leaving.is_empty() {
                    let ids = &hir.ids[siblings.range()];
                    let place = ids.binary_search(&child.0).ok().or_else(|| ids.iter().position(|&it| it == child.0)).unwrap_or(ids.len());
                    passed.extend(leaving.iter().take_while(|it| (it.0 as usize) < place).map(|it| (it.1, it.2)));
                }
            }
            if is_outermost {
                break;
            }
            child = match parent {
                Parent::Expr(outer) => Child::Expr(outer),
                Parent::Stmt(outer) => Child::Stmt(outer),
                _ => Child::Other,
            };
            parent = self.parent_of_node(file, parent);
        }
        let mut tests = Tests::new();
        for (test, holds) in passed {
            self.add_variable_tests(file, test, holds, at, basis, &mut tests);
        }
        Some(tests)
    }

    fn add_variable_tests(&mut self, file: FileId, test: ExprId, holds: bool, at: Sym, basis: Basis, tests: &mut Tests) {
        if self.is_half_of_stack_in_use() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (op, left, right) = match hir[test].kind {
            ExprKind::Unary { op: UnOp::Not, operand } => return self.add_variable_tests(file, operand, !holds, at, basis, tests),
            ExprKind::Binary { op: BinOp::And | BinOp::Or, left, right } => {
                if matches!(hir[test].kind, ExprKind::Binary { op: BinOp::And, .. }) == holds {
                    self.add_variable_tests(file, left, holds, at, basis, tests);
                    self.add_variable_tests(file, right, holds, at, basis, tests);
                }
                return;
            }
            ExprKind::Binary { op, left, right } => (op, left, right),
            _ => return,
        };
        let references_it = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == at.id;
        let other_term = |e: ExprId| match hir[e].kind {
            ExprKind::Binary { op: BinOp::Add, left, right } if references_it(left) && !references_it(right) => Some((left, right)),
            ExprKind::Binary { op: BinOp::Add, left, right } if references_it(right) && !references_it(left) => Some((right, left)),
            _ => None,
        };
        let mirrored = match op {
            BinOp::Lt => BinOp::Gt,
            BinOp::Le => BinOp::Ge,
            BinOp::Gt => BinOp::Lt,
            BinOp::Ge => BinOp::Le,
            op => op,
        };
        let (name, other, op, addend) = if references_it(left) {
            (left, right, op, None)
        } else if references_it(right) {
            (right, left, mirrored, None)
        } else if let Some((name, addend)) = other_term(left) {
            (name, right, op, Some(addend))
        } else if let Some((name, addend)) = other_term(right) {
            (name, left, mirrored, Some(addend))
        } else {
            return;
        };
        if addend.is_some() && !(holds && matches!(op, BinOp::Lt | BinOp::Le)) {
            return;
        }
        if !matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::EqEqEq | BinOp::EqEq | BinOp::NotEqEq | BinOp::NotEq) {
            return;
        }
        let Some(other) = self.numbers_of_expr(file, other, View::Here, basis) else { return };
        let flow = bound.expr_flow[name.idx()];
        if other == Numbers::NOTHING {
            return tests.push(Test { at: flow, minimum: 1, maximum: 0, excluded: None });
        }
        let Some((low, mut high)) = other.numbers() else { return };
        if let Some(addend) = addend {
            let Some(addend) = self.numbers_of_expr(file, addend, View::Here, basis) else { return };
            if addend == Numbers::NOTHING {
                return tests.push(Test { at: flow, minimum: 1, maximum: 0, excluded: None });
            }
            let Some((least_added, _)) = addend.numbers() else { return };
            high = high.saturating_sub(least_added);
        }
        let (minimum, maximum) = match (op, holds) {
            (BinOp::Lt, true) | (BinOp::Ge, false) => (i64::MIN, high - 1),
            (BinOp::Le, true) | (BinOp::Gt, false) => (i64::MIN, high),
            (BinOp::Gt, true) | (BinOp::Le, false) => (low + 1, i64::MAX),
            (BinOp::Ge, true) | (BinOp::Lt, false) => (low, i64::MAX),
            (BinOp::EqEqEq | BinOp::EqEq, true) | (BinOp::NotEqEq | BinOp::NotEq, false) => (low, high),
            _ if low == high => return tests.push(Test { at: flow, minimum: i64::MIN, maximum: i64::MAX, excluded: Some(low) }),
            _ => return,
        };
        tests.push(Test { at: flow, minimum, maximum, excluded: None });
    }
}
