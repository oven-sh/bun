use bun_sema::atom::Atom;
use bun_sema::bind::{
    Binding, BindingKind, CodeUnit, Decl, FunctionFlags, Parent, PatParent, SymbolId,
};
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::hir::{BinOp, Chain, ExprId, ExprKind, Flags, FnBody, FnKind, PatKind, StmtKind};
use bun_sema::program::Sym;
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

use crate::ir::ValueId;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering};

struct Member {
    name: Atom,
    value: ExprId,
    /// `E[E["A"] = 0] = "A"`: the second "A".
    name_under_value: Option<ExprId>,
}

/// What `tsc` prints for `enum E { A, B = 5, C = "c" }`:
/// `var E; (function (E) { E[E["A"] = 0] = "A"; E[E["B"] = 5] = "B"; E["C"] = "c"; })(E || (E = {}));`
pub(in crate::lower) struct EmittedEnum {
    /// The `{}`.
    literal: ExprId,
    /// `E = {}`
    store: ExprId,
    members: Vec<Member>,
}

const LARGEST_INDEX: f64 = i32::MAX as f64;

impl FileLowering<'_, '_, '_, '_> {
    fn symbol_named_by(&self, expression: ExprId) -> Option<SymbolId> {
        match (self.hir[expression].kind, self.bound.binding(expression)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(symbol),
            _ => None,
        }
    }

    // `E[key]`
    fn key_stored_under(&self, target: ExprId, object: SymbolId) -> Option<ExprId> {
        let ExprKind::Index {
            obj,
            index,
            chain: Chain::No,
        } = self.hir[target].kind
        else {
            return None;
        };
        (self.symbol_named_by(obj) == Some(object)).then_some(index)
    }

    // `E["A"]`, which the parser may hold as `E.A`
    fn name_stored_under(&self, target: ExprId, object: SymbolId) -> Option<Atom> {
        if let ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } = self.hir[target].kind
        {
            return (self.symbol_named_by(obj) == Some(object)).then_some(name);
        }
        match self.hir[self.key_stored_under(target, object)?].kind {
            ExprKind::String(name) => Some(name),
            _ => None,
        }
    }

    fn plain_assignment(&self, expression: ExprId) -> Option<(ExprId, ExprId)> {
        match self.hir[expression].kind {
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => Some((target, value)),
            _ => None,
        }
    }

    fn find_member_of_emitted_enum(&self, statement: ExprId, object: SymbolId) -> Option<Member> {
        let hir = self.hir;
        let (target, value) = self.plain_assignment(statement)?;
        if let Some(name) = self.name_stored_under(target, object) {
            let is_constant = matches!(hir[value].kind, ExprKind::String(_) | ExprKind::Number(_));
            return is_constant.then_some(Member {
                name,
                value,
                name_under_value: None,
            });
        }
        let key = self.key_stored_under(target, object)?;
        let (inner_target, number) = self.plain_assignment(key)?;
        let name = self.name_stored_under(inner_target, object)?;
        let (ExprKind::String(again), ExprKind::Number(index)) =
            (hir[value].kind, hir[number].kind)
        else {
            return None;
        };
        // An index stands in front of every name whenever it is stored. Any other number is a name among the names.
        let written = hir.numbers[index as usize];
        let is_index = written.trunc() == written
            && (0.0..=LARGEST_INDEX).contains(&written)
            && written.to_bits() != (-0.0f64).to_bits();
        (name == again && is_index).then_some(Member {
            name,
            value: number,
            name_under_value: Some(value),
        })
    }

    // Nothing has been stored in the variable when the statement runs: it is a `var` without a value, the statement stands in the body that declares it, and the store in the statement is the only one.
    fn is_undefined_until(&self, variable: SymbolId, store: ExprId, call: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Parent::Stmt(statement) = bound.parent_of_expr(call) else {
            return false;
        };
        if !matches!(hir[statement].kind, StmtKind::Expr(written) if written == call) {
            return false;
        }
        let unit = match bound.parent_of_stmt(statement) {
            Parent::File => CodeUnit::File,
            Parent::FnBody(function) => CodeUnit::Function(function),
            _ => return false,
        };
        let symbol = Sym {
            file: self.file,
            id: variable,
        };
        let declarations = self.queries.files().decls_of(symbol);
        let has_no_value = declarations.iter().all(|entry| match entry.1 {
            Decl::Var(pattern) if entry.0 == self.file => matches!(
                bound.pat_parent[pattern.idx()],
                PatParent::Var(declaration) if hir[declaration].init.is_none()
            ),
            _ => false,
        });
        has_no_value
            && bound.binding_kind(variable) == BindingKind::Var
            && bound.code_unit(bound.symbol_scope(variable)) == unit
            && !bound.is_visible_to_eval(variable)
            && matches!(bound.stores_to(variable), [only] if only.target == store)
    }

    pub(in crate::lower) fn find_emitted_enum(&mut self, call: ExprId) -> Option<EmittedEnum> {
        let (hir, bound) = (self.hir, self.bound);
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let site = hir[site];
        let ExprKind::Fn(function) = hir[site.callee].kind else {
            return None;
        };
        let written = &hir[function];
        let (FnKind::Expr, FnBody::Block(body), Chain::No) =
            (written.kind, written.body, site.chain)
        else {
            return None;
        };
        let mut arguments = hir.ids(site.args);
        let (Some(argument), None) = (arguments.next(), arguments.next()) else {
            return None;
        };
        let ExprKind::Binary {
            op: BinOp::Or,
            left,
            right,
        } = hir[argument].kind
        else {
            return None;
        };
        let (store, literal) = self.plain_assignment(right)?;
        if !matches!(hir[literal].kind, ExprKind::Object(properties) if properties.len() == 0) {
            return None;
        }
        let variable = self.symbol_named_by(left)?;
        if self.symbol_named_by(store) != Some(variable)
            || !self.is_undefined_until(variable, store, call)
        {
            return None;
        }

        let unusual = FunctionFlags::USES_ARGUMENTS
            | FunctionFlags::HAS_DIRECT_EVAL
            | FunctionFlags::HAS_PARAMETER_EXPRESSIONS
            | FunctionFlags::HAS_REST_PATTERN_OR_DEFAULT;
        if written.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            || written.params.len() != 1
            || bound.function_flags(function).intersects(unusual)
        {
            return None;
        }
        let parameter = hir[written.params.at(0)].pat;
        let (PatKind::Ident(_), Binding::Symbol(object)) =
            (hir[parameter].kind, bound.initialized_binding(parameter))
        else {
            return None;
        };
        let mut members = Vec::new();
        for statement in hir.ids(body) {
            let StmtKind::Expr(expression) = hir[statement].kind else {
                return None;
            };
            members.push(self.find_member_of_emitted_enum(expression, object)?);
        }
        let names: FxHashSet<Atom> = members.iter().map(|member| member.name).collect();
        let are_fields = names.iter().all(|&name| self.is_field_name(name));
        (names.len() == members.len() && !members.is_empty() && are_fields).then_some(EmittedEnum {
            literal,
            store: right,
            members,
        })
    }

    /// For the `{}` that the statement stores in the variable.
    pub(in crate::lower) fn find_emitted_enum_born_at(
        &mut self,
        literal: ExprId,
    ) -> Option<EmittedEnum> {
        let bound = self.bound;
        let mut call = literal;
        for _ in 0..3 {
            let Parent::Expr(parent) = bound.parent_of_expr(call) else {
                return None;
            };
            call = parent;
        }
        let found = self.find_emitted_enum(call)?;
        (found.literal == literal).then_some(found)
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    /// The function only fills the object, which nobody has seen, so the object is born full and the function is not called.
    pub(in crate::lower) fn lower_call_of_emitted_enum(&mut self, found: &EmittedEnum) -> ValueId {
        self.lower_expression_for_effect(found.store);
        self.builder.undefined()
    }

    pub(in crate::lower) fn lower_object_of_emitted_enum(
        &mut self,
        found: &EmittedEnum,
    ) -> ValueId {
        let hir = self.file.hir;
        let keys: SmallVec<[_; 16]> = (found.members.iter())
            .map(|member| (self.file.name_key(member.name), ObjectMemberKind::Field))
            .collect();
        let layout = self.file.layout_of_names(found.literal, &keys);
        let mut object = self.begin_object(layout);
        let mut values: SmallVec<[ValueId; 16]> = SmallVec::new();
        for (member, &(key, _)) in found.members.iter().zip(&keys) {
            let value = self.lower_expression(member.value);
            let name = PropertyName::Constant(key);
            self.add_property(&mut object, name, value, Some(member.value));
            values.push(value);
        }
        for (member, &value) in found.members.iter().zip(&values) {
            if let Some(name) = member.name_under_value {
                let name_value = self.lower_expression(name);
                let key = PropertyName::Computed(value);
                self.add_property(&mut object, key, name_value, Some(name));
            }
        }
        self.set_position(hir[found.literal].pos);
        super::finish_object(self, object)
    }
}
