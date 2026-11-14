use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Decl, InitialState, Parent, SymbolId};
use bun_sema::fold::{Constant, Decision};
use bun_sema::hir::{BinOp, EnumId, EnumMemberId, ExprId, ExprKind, Flags, StmtId, StmtKind, UnOp};
use bun_sema::program::Sym;
use bun_sema::types::EnumValue;
use smallvec::SmallVec;

use crate::builtins::SourceDialect;
use crate::lower::FileLowering;
use crate::modules::{ImportBinding, KnownObjects, Validity};

#[derive(Copy, Clone, PartialEq, Debug)]
pub(super) enum EnumMemberValue {
    Number(f64),
    String(Atom),
    Computed(ExprId),
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
    Other,
}

impl KnownPrimitive {
    fn of_constant(constant: Constant) -> KnownPrimitive {
        match constant {
            Constant::String(_) => KnownPrimitive::String,
            Constant::Null => KnownPrimitive::Null,
            Constant::Undefined => KnownPrimitive::Undefined,
            Constant::Boolean(_) | Constant::Number(_) | Constant::BigInt(_) => {
                KnownPrimitive::Other
            }
        }
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

    pub(in crate::lower) fn find_read_of_enum_member_of_this_file(
        &mut self,
        access: ExprId,
    ) -> Option<Constant> {
        let members = KnownObjects::new(
            self.queries.files(),
            self.inputs.modules,
            &self.modules.known_member_values,
        );
        if members.find_read(self.file, access)?.object.file != self.file {
            return None;
        }
        self.find_enum_member_read(access)
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

    /// A `const enum` of a runtime module that is named by its known members alone. In a program, the object is left out
    /// where it is not reached.
    pub(super) fn is_const_enum_without_object(&self, declaration: EnumId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let flags = hir[declaration].flags;
        if self.source.dialect() != SourceDialect::Runtime
            || !flags.contains(Flags::CONST)
            || flags.contains(Flags::EXPORT)
        {
            return false;
        }
        let symbol = bound.declared_symbol(Decl::Enum(declaration));
        let is_named_by_export = |statement: StmtId| match hir[statement].kind {
            StmtKind::ExportNamed(export) => {
                let export = &hir[export];
                !export.type_only && !export.has_module_specifier
            }
            StmtKind::ImportEquals(_) => true,
            _ => false,
        };
        if bound.symbol(symbol).decls.len() != 1
            || bound.is_visible_to_eval(symbol)
            || hir.ids(hir.body).any(is_named_by_export)
        {
            return false;
        }
        let is_read_of_known_member = |reference: ExprId| match bound.parent_of_expr(reference) {
            Parent::Expr(access) => {
                hir.member_key(access).is_some_and(|it| it.0 == reference)
                    && self.find_known_member_read(access).is_some()
            }
            _ => false,
        };
        (0..hir.exprs.len() as u32).map(ExprId).all(|reference| {
            self.symbol_named_by(reference) != Some(symbol) || is_read_of_known_member(reference)
        })
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
            | None => match self.find_known_primitive(initializer) {
                KnownPrimitive::String => EnumMemberValue::ComputedString(initializer),
                KnownPrimitive::Null | KnownPrimitive::Undefined | KnownPrimitive::Other => {
                    EnumMemberValue::Computed(initializer)
                }
            },
        }
    }

    fn find_known_primitive(&mut self, expression: ExprId) -> KnownPrimitive {
        if self.queries.is_stack_low() {
            return KnownPrimitive::Other;
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
            ExprKind::Unary { op, .. } => match op {
                UnOp::Typeof => KnownPrimitive::String,
                UnOp::Void => KnownPrimitive::Undefined,
                _ => KnownPrimitive::Other,
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
                    Some(TranspilerConstant::NumberLeftToRunTime) | None => KnownPrimitive::Other,
                }
            }
            _ => KnownPrimitive::Other,
        }
    }

    fn find_binary_primitive(&mut self, op: BinOp, left: ExprId, right: ExprId) -> KnownPrimitive {
        match op {
            BinOp::Add => {
                let sides = [left, right].map(|side| self.find_known_primitive(side));
                match sides.contains(&KnownPrimitive::String) {
                    true => KnownPrimitive::String,
                    false => KnownPrimitive::Other,
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
                    KnownPrimitive::String | KnownPrimitive::Other => left,
                }
            }
            _ => KnownPrimitive::Other,
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
                match first == self.find_known_primitive(second) {
                    true => first,
                    false => KnownPrimitive::Other,
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
