use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Decl, InitialState, SymbolId};
use bun_sema::check::aot::ShapeKind;
use bun_sema::fold::{Constant, Decision};
use bun_sema::hir::{BinOp, EnumId, EnumMemberId, ExprId, ExprKind, UnOp};
use bun_sema::program::Sym;
use bun_sema::types::EnumValue;
use smallvec::SmallVec;

use crate::lower::{CheckerTypeId, FileLowering};
use crate::modules::{ImportBinding, KnownObjects, Validity};

const MAX_DEPTH_OF_UNION_MEMBERS: u32 = 8;

#[derive(Copy, Clone, PartialEq, Debug)]
pub(super) enum EnumMemberValue {
    Number(f64),
    String(Atom),
    /// A run-time value that is known not to be a string.
    Computed(ExprId),
    /// A run-time value of a type the build does not know.
    ComputedUnknown(ExprId),
    ComputedNumber(ExprId),
    ComputedString(ExprId),
    PreviousPlusOne,
    Missing,
}

pub(super) type EnumMembers = SmallVec<[(EnumMemberId, EnumMemberValue); 8]>;

#[derive(Copy, Clone, PartialEq, Eq)]
enum KnownPrimitive {
    String,
    Null,
    Undefined,
    /// A number, boolean or bigint.
    NotString,
    Unknown,
}

impl KnownPrimitive {
    fn of_constant(constant: Constant) -> KnownPrimitive {
        match constant {
            Constant::String(_) => KnownPrimitive::String,
            Constant::Null => KnownPrimitive::Null,
            Constant::Undefined => KnownPrimitive::Undefined,
            Constant::Boolean(_) | Constant::Number(_) | Constant::BigInt(_) => {
                KnownPrimitive::NotString
            }
        }
    }

    fn is_known_not_string(self) -> bool {
        matches!(
            self,
            KnownPrimitive::Null | KnownPrimitive::Undefined | KnownPrimitive::NotString
        )
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn find_enum_member_read(&mut self, access: ExprId) -> Option<Constant> {
        if let Some(&read) = self.enum_member_reads.get(&access) {
            return Some(read);
        }
        let (read, validity) = self.find_known_member_read(access)?;
        self.enum_member_reads.insert(access, read);
        if validity == Validity::Always && self.is_value_written_by_bundling(access) {
            self.values_written_in_place.get_mut().push((access, read));
        }
        Some(read)
    }

    pub(in crate::lower) fn find_member_of_loaded_module(&self, access: ExprId) -> Option<ExprId> {
        let (member, root) = self.find_member_and_root(access)?;
        let is_imported = self.symbol_named_by(root).is_some_and(|name| {
            let binding = self.inputs.modules.import_binding(self.file, name);
            matches!(binding, ImportBinding::Namespace { .. })
        });
        (!is_imported).then_some(member)
    }

    fn is_value_written_by_bundling(&self, access: ExprId) -> bool {
        let Some((_, root)) = self.find_member_and_root(access) else {
            return true;
        };
        self.symbol_named_by(root)
            .is_some_and(|name| self.bound.initial_state(name) != InitialState::Undefined)
    }

    fn find_member_and_root(&self, access: ExprId) -> Option<(ExprId, ExprId)> {
        let (hir, modules) = (self.hir, self.inputs.modules);
        let member = self.skip_type_syntax(hir.member_key(access)?.0);
        let mut root = self.skip_type_syntax(hir.member_key(member)?.0);
        if modules.member_binding(self.file, member).is_none()
            && modules.member(self.file, member).is_none()
        {
            return None;
        }
        while let Some((object, _)) = hir.member_key(root) {
            root = self.skip_type_syntax(object);
        }
        Some((member, root))
    }

    fn find_known_member_read(&self, access: ExprId) -> Option<(Constant, Validity)> {
        let members = KnownObjects::new(
            self.queries.files(),
            self.inputs.modules,
            &self.modules.known_member_values,
        );
        let read = members.find_read(self.file, access)?;
        let is_valid = match read.validity {
            Validity::Always => true,
            Validity::WhileObjectIsNotHandedOn => {
                let left_out = self.inputs.library_functions.left_out_declarations();
                left_out.is_object_never_handed_on(read.object.file, read.object.id)
            }
        };
        is_valid.then_some((read.value, read.validity))
    }

    pub(in crate::lower) fn find_signed_enum_member(&self, expression: ExprId) -> Option<Constant> {
        let members = KnownObjects::new(
            self.queries.files(),
            self.inputs.modules,
            &self.modules.known_member_values,
        );
        let number = members.find_signed_member_in_place(self.file, expression)?;
        let number = Constant::Number(number);
        let mut written = self.values_written_in_place.borrow_mut();
        written.push((self.hir.skip_type_assertions(expression), number));
        Some(number)
    }

    pub(in crate::lower) fn find_data_variable_read(&self, symbol: SymbolId) -> Option<Constant> {
        let members = KnownObjects::new(
            self.queries.files(),
            self.inputs.modules,
            &self.modules.known_member_values,
        );
        let named = Sym {
            file: self.file,
            id: symbol,
        };
        members.find_data_variable(named).map(|found| found.1)
    }

    pub(in crate::lower) fn find_data_member_read(&mut self, access: ExprId) -> Option<Constant> {
        let members = KnownObjects::new(
            self.queries.files(),
            self.inputs.modules,
            &self.modules.known_member_values,
        );
        let read = members.find_data_read(self.file, access)?;
        let left_out = self.inputs.library_functions.left_out_declarations();
        left_out
            .is_object_never_handed_on(read.object.file, read.object.id)
            .then_some(read.value)
    }

    pub(super) fn compute_enum_member_values(&mut self, declaration: EnumId) -> EnumMembers {
        let hir = self.hir;
        let mut members = EnumMembers::new();
        for member in hir[declaration].members.iter() {
            let data = hir[member];
            if data.computed_name.is_some() {
                continue;
            }
            let value = match data.init.some() {
                Some(initializer) => self.classify_enum_initializer(member, initializer),
                None => match members.last().map(|previous| previous.1) {
                    None => EnumMemberValue::Number(0.0),
                    Some(EnumMemberValue::Number(number)) => EnumMemberValue::Number(number + 1.0),
                    Some(EnumMemberValue::ComputedNumber(_) | EnumMemberValue::PreviousPlusOne) => {
                        EnumMemberValue::PreviousPlusOne
                    }
                    Some(
                        EnumMemberValue::String(_)
                        | EnumMemberValue::Computed(_)
                        | EnumMemberValue::ComputedUnknown(_)
                        | EnumMemberValue::ComputedString(_)
                        | EnumMemberValue::Missing,
                    ) => EnumMemberValue::Missing,
                },
            };
            members.push((member, value));
        }
        members
    }

    fn find_transpiler_constant(&mut self, member: EnumMemberId) -> Option<TranspilerConstant> {
        let members = KnownObjects::new(
            self.queries.files(),
            self.inputs.modules,
            &self.modules.known_member_values,
        );
        if let Some(value) = members.find_value_in_place(self.file, member) {
            return Some(TranspilerConstant::Known(value));
        }
        let constant = self.queries.enum_member_value(member).ok().flatten()?;
        let is_left_to_run_time =
            constant.rests_on_inexact_power && !constant.reads_other_file_or_variable;
        match constant.value {
            EnumValue::Number(_) if is_left_to_run_time => {
                Some(TranspilerConstant::NumberLeftToRunTime)
            }
            EnumValue::String(_) if is_left_to_run_time => {
                Some(TranspilerConstant::StringLeftToRunTime)
            }
            EnumValue::Number(_) | EnumValue::String(_) => None,
        }
    }

    fn classify_enum_initializer(
        &mut self,
        member: EnumMemberId,
        initializer: ExprId,
    ) -> EnumMemberValue {
        match self.find_transpiler_constant(member) {
            Some(TranspilerConstant::Known(Constant::Number(number))) => {
                EnumMemberValue::Number(number)
            }
            Some(TranspilerConstant::Known(Constant::String(text))) => {
                EnumMemberValue::String(text)
            }
            Some(TranspilerConstant::NumberLeftToRunTime) => {
                EnumMemberValue::ComputedNumber(initializer)
            }
            Some(TranspilerConstant::StringLeftToRunTime) => {
                EnumMemberValue::ComputedString(initializer)
            }
            Some(TranspilerConstant::Known(
                Constant::Undefined | Constant::Null | Constant::Boolean(_) | Constant::BigInt(_),
            ))
            | None => {
                let mut known = self.find_known_primitive(initializer);
                if known == KnownPrimitive::Unknown {
                    known = self.find_typed_primitive(initializer);
                }
                match known {
                    KnownPrimitive::String => EnumMemberValue::ComputedString(initializer),
                    KnownPrimitive::Null
                    | KnownPrimitive::Undefined
                    | KnownPrimitive::NotString => EnumMemberValue::Computed(initializer),
                    KnownPrimitive::Unknown => EnumMemberValue::ComputedUnknown(initializer),
                }
            }
        }
    }

    /// The primitive of the initializer's checked type, as tsc decides it.
    fn find_typed_primitive(&mut self, initializer: ExprId) -> KnownPrimitive {
        match self.queries.expression_type(initializer) {
            Ok(ty) => self.find_primitive_of_type(ty, 0),
            Err(_) => KnownPrimitive::Unknown,
        }
    }

    fn find_primitive_of_type(&mut self, ty: CheckerTypeId, depth: u32) -> KnownPrimitive {
        if depth > MAX_DEPTH_OF_UNION_MEMBERS {
            return KnownPrimitive::Unknown;
        }
        let Ok(shape) = self.queries.type_shape(ty) else {
            return KnownPrimitive::Unknown;
        };
        if !shape.trust.is_trusted() {
            return KnownPrimitive::Unknown;
        }
        match shape.kind {
            ShapeKind::String | ShapeKind::StringLiteral(_) | ShapeKind::TemplateLiteral { .. } => {
                KnownPrimitive::String
            }
            ShapeKind::Undefined => KnownPrimitive::Undefined,
            ShapeKind::Null => KnownPrimitive::Null,
            ShapeKind::Boolean
            | ShapeKind::BooleanLiteral(_)
            | ShapeKind::Number
            | ShapeKind::NumberLiteral(_)
            | ShapeKind::NumericEnumMember(_)
            | ShapeKind::BigInt
            | ShapeKind::BigIntLiteral { .. } => KnownPrimitive::NotString,
            ShapeKind::Int32 { base } => self.find_primitive_of_type(base, depth + 1),
            ShapeKind::Union(members) => {
                let mut found = None;
                for &member in members {
                    let primitive = self.find_primitive_of_type(member, depth + 1);
                    found = Some(match found {
                        None => primitive,
                        Some(KnownPrimitive::Unknown) => return KnownPrimitive::Unknown,
                        Some(earlier) if earlier == primitive => earlier,
                        Some(earlier)
                            if earlier.is_known_not_string() && primitive.is_known_not_string() =>
                        {
                            KnownPrimitive::NotString
                        }
                        Some(_) => return KnownPrimitive::Unknown,
                    });
                }
                found.unwrap_or(KnownPrimitive::Unknown)
            }
            _ => KnownPrimitive::Unknown,
        }
    }

    fn find_known_primitive(&mut self, expression: ExprId) -> KnownPrimitive {
        if self.queries.is_stack_low() {
            return KnownPrimitive::Unknown;
        }
        match self.decisions().decision(expression) {
            Decision::Constant(constant) => return KnownPrimitive::of_constant(constant),
            Decision::Unknown
            | Decision::GlobalPath(_)
            | Decision::Data(_)
            | Decision::DeferredData => {}
        }
        match self.hir[expression].kind {
            ExprKind::String(_) | ExprKind::Template { .. } => KnownPrimitive::String,
            ExprKind::Null => KnownPrimitive::Null,
            ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::BigInt(_) => {
                KnownPrimitive::NotString
            }
            ExprKind::Unary { op, .. } => match op {
                UnOp::Typeof => KnownPrimitive::String,
                UnOp::Void => KnownPrimitive::Undefined,
                UnOp::Plus
                | UnOp::Minus
                | UnOp::BitNot
                | UnOp::Not
                | UnOp::Delete
                | UnOp::PreInc
                | UnOp::PreDec
                | UnOp::PostInc
                | UnOp::PostDec => KnownPrimitive::NotString,
            },
            ExprKind::Binary { op, left, right } => self.find_binary_primitive(op, left, right),
            ExprKind::Assign {
                op: None, value, ..
            } => self.find_known_primitive(value),
            ExprKind::Cond { branches, .. } => {
                let branches = self.hir.branches(branches);
                self.find_either_primitive(branches.yes, branches.no)
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => self.find_known_primitive(expr),
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                match self.find_inlined_enum_member(expression) {
                    Some(TranspilerConstant::Known(constant)) => {
                        KnownPrimitive::of_constant(constant)
                    }
                    Some(TranspilerConstant::StringLeftToRunTime) => KnownPrimitive::String,
                    Some(TranspilerConstant::NumberLeftToRunTime) => KnownPrimitive::NotString,
                    None => KnownPrimitive::Unknown,
                }
            }
            _ => KnownPrimitive::Unknown,
        }
    }

    fn find_binary_primitive(&mut self, op: BinOp, left: ExprId, right: ExprId) -> KnownPrimitive {
        match op {
            BinOp::Add => {
                let sides = [left, right].map(|side| self.find_known_primitive(side));
                if sides.contains(&KnownPrimitive::String) {
                    KnownPrimitive::String
                } else if sides.iter().all(|side| side.is_known_not_string()) {
                    KnownPrimitive::NotString
                } else {
                    KnownPrimitive::Unknown
                }
            }
            BinOp::Comma => self.find_known_primitive(right),
            BinOp::And | BinOp::Or => self.find_either_primitive(left, right),
            BinOp::Nullish if self.decisions().is_dead_expr(right) => {
                self.find_known_primitive(left)
            }
            BinOp::Nullish => {
                let [left, right] = [left, right].map(|side| self.find_known_primitive(side));
                match left {
                    KnownPrimitive::Null | KnownPrimitive::Undefined => right,
                    KnownPrimitive::String | KnownPrimitive::NotString => left,
                    KnownPrimitive::Unknown => KnownPrimitive::Unknown,
                }
            }
            BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Rem
            | BinOp::Pow
            | BinOp::Shl
            | BinOp::Shr
            | BinOp::UShr
            | BinOp::BitAnd
            | BinOp::BitOr
            | BinOp::BitXor
            | BinOp::Lt
            | BinOp::Le
            | BinOp::Gt
            | BinOp::Ge
            | BinOp::EqEq
            | BinOp::NotEq
            | BinOp::EqEqEq
            | BinOp::NotEqEq
            | BinOp::In
            | BinOp::Instanceof => KnownPrimitive::NotString,
        }
    }

    fn find_either_primitive(&mut self, first: ExprId, second: ExprId) -> KnownPrimitive {
        let decisions = self.decisions();
        match (
            decisions.is_dead_expr(first),
            decisions.is_dead_expr(second),
        ) {
            (true, _) => self.find_known_primitive(second),
            (false, true) => self.find_known_primitive(first),
            (false, false) => {
                let first = self.find_known_primitive(first);
                let second = self.find_known_primitive(second);
                if first == second {
                    first
                } else if first.is_known_not_string() && second.is_known_not_string() {
                    KnownPrimitive::NotString
                } else {
                    KnownPrimitive::Unknown
                }
            }
        }
    }

    fn find_inlined_enum_member(&mut self, reference: ExprId) -> Option<TranspilerConstant> {
        if !matches!(self.hir[reference].kind, ExprKind::Ident(_)) {
            let member = self.queries.accessed_enum_member(reference);
            return self.find_transpiler_constant(member.ok().flatten()?);
        }
        let bound = self.bound;
        let symbol = match bound.binding(reference) {
            Binding::Symbol(symbol) => symbol,
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => return None,
        };
        match *bound.symbol(symbol).decls {
            [Decl::EnumMember(member)] => self.find_transpiler_constant(member),
            _ => None,
        }
    }
}

#[derive(Copy, Clone)]
enum TranspilerConstant {
    Known(Constant),
    NumberLeftToRunTime,
    StringLeftToRunTime,
}
