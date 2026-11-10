use bun_sema::atom::Atom;
use bun_sema::bind::{
    Binding, BindingKind, CodeUnit, CommonJsVariable, Decl, FunctionFlags, Parent, PatParent,
    SymbolId,
};
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::fold::Constant;
use bun_sema::hir::{
    BinOp, Chain, ExprId, ExprKind, Flags, FnBody, FnKind, PatKind, StmtKind, UnOp, VarDeclId,
};
use bun_sema::program::Sym;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use crate::builtins::resolve::reads_what_wrapper_hands_in;
use crate::ir::ValueId;
use crate::lower::{FileLowering, FunctionLowering};
use crate::modules::ExportBinding;

struct Member {
    name: Atom,
    value: Constant,
    is_named_under_value: bool,
}

pub(in crate::lower) struct EmittedEnum {
    literal: ExprId,
    stores: Option<ExprId>,
    members: Vec<Member>,
    variable: Option<SymbolId>,
    own_names: SmallVec<[ExprId; 2]>,
    is_laid_on_exports: bool,
}

pub(in crate::lower) type EnumsThatStayAsBorn = FxHashMap<SymbolId, FxHashMap<Atom, Constant>>;

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn symbol_named_by(&self, expression: ExprId) -> Option<SymbolId> {
        match (self.hir[expression].kind, self.bound.binding(expression)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(symbol),
            _ => None,
        }
    }

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

    fn number_written_as(&self, expression: ExprId) -> Option<f64> {
        let hir = self.hir;
        let number = match hir[expression].kind {
            ExprKind::Number(index) => hir.numbers[index as usize],
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => match hir[operand].kind {
                ExprKind::Number(index) => -hir.numbers[index as usize],
                _ => return None,
            },
            _ => return None,
        };
        (number.is_finite() && number.to_bits() != (-0.0f64).to_bits()).then_some(number)
    }

    fn find_member_of_emitted_enum(&self, statement: ExprId, object: SymbolId) -> Option<Member> {
        let hir = self.hir;
        let (target, value) = self.plain_assignment(statement)?;
        if let Some(name) = self.name_stored_under(target, object) {
            let value = match hir[value].kind {
                ExprKind::String(text) => Constant::String(text),
                _ => Constant::Number(self.number_written_as(value)?),
            };
            return Some(Member {
                name,
                value,
                is_named_under_value: false,
            });
        }
        let key = self.key_stored_under(target, object)?;
        let (inner_target, number) = self.plain_assignment(key)?;
        let name = self.name_stored_under(inner_target, object)?;
        let ExprKind::String(again) = hir[value].kind else {
            return None;
        };
        let number = self.number_written_as(number)?;
        (name == again).then_some(Member {
            name,
            value: Constant::Number(number),
            is_named_under_value: true,
        })
    }

    fn is_member_of_exports(&self, target: ExprId) -> bool {
        let ExprKind::Dot {
            obj,
            chain: Chain::No,
            ..
        } = self.hir[target].kind
        else {
            return false;
        };
        matches!(self.hir[obj].kind, ExprKind::Ident(_))
            && self.bound.binding(obj) == Binding::CommonJs(CommonJsVariable::Exports)
    }

    fn is_undefined_until(&self, variable: SymbolId, store: Option<ExprId>, call: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let (statement, initialized) = match (bound.parent_of_expr(call), store) {
            (Parent::Stmt(statement), Some(_)) if matches!(hir[statement].kind, StmtKind::Expr(written) if written == call) => {
                (statement, None)
            }
            (Parent::VarInit(declaration), None) => {
                (bound.var_stmt[declaration.idx()], Some(declaration))
            }
            _ => return false,
        };
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
        let stands_in_head_of_loop = |declaration: VarDeclId| {
            let written = bound.var_stmt[declaration.idx()];
            matches!(bound.parent_of_stmt(written), Parent::Stmt(owner)
                if matches!(hir[owner].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == written))
        };
        let has_no_other_value = declarations.iter().all(|entry| match entry.1 {
            Decl::Var(pattern) if entry.0 == self.file => matches!(
                bound.pat_parent[pattern.idx()],
                PatParent::Var(declaration)
                    if Some(declaration) == initialized
                        || (hir[declaration].init.is_none() && !stands_in_head_of_loop(declaration))
            ),
            _ => false,
        });
        let runtime = &bound.runtime;
        let is_filled_at_entry = (runtime.redeclared_commonjs_variables().iter())
            .any(|it| it.0 == variable && reads_what_wrapper_hands_in(hir, bound, variable))
            || (runtime.annex_b_functions().iter()).any(|function| function.var_symbol == variable)
            || (runtime.parameter_var_copies().iter()).any(|copy| copy.variable == variable);
        let stores = bound.stores_to(variable);
        has_no_other_value
            && !is_filled_at_entry
            && bound.binding_kind(variable) == BindingKind::Var
            && bound.code_unit(bound.symbol_scope(variable)) == unit
            && !bound.is_visible_to_eval(variable)
            && match store {
                Some(store) => matches!(stores, [only] if only.target == store),
                None => stores.is_empty(),
            }
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
        let (FnKind::Expr | FnKind::Arrow, FnBody::Block(body), Chain::No) =
            (written.kind, written.body, site.chain)
        else {
            return None;
        };
        let mut arguments = hir.ids(site.args);
        let (Some(argument), None) = (arguments.next(), arguments.next()) else {
            return None;
        };
        let (mut literal, mut store, mut stores) = (argument, None, None);
        let (mut named, mut own_names, mut is_laid_on_exports) = (None, SmallVec::new(), false);
        if let ExprKind::Binary {
            op: BinOp::Or,
            left,
            right,
        } = hir[argument].kind
        {
            let variable = self.symbol_named_by(left)?;
            named = Some(variable);
            own_names.push(left);
            literal = right;
            while let Some((target, value)) = self.plain_assignment(literal) {
                if self.symbol_named_by(target) == Some(variable) && store.is_none() {
                    store = Some(target);
                    own_names.push(target);
                } else if !self.is_member_of_exports(target) {
                    return None;
                } else {
                    is_laid_on_exports = true;
                }
                literal = value;
            }
            if (store.is_none() && literal != right)
                || !self.is_undefined_until(variable, store, call)
            {
                return None;
            }
            stores = store.map(|_| right);
        }
        if !matches!(hir[literal].kind, ExprKind::Object(properties) if properties.len() == 0) {
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
        let mut returns_object = false;
        for statement in hir.ids(body) {
            match hir[statement].kind {
                _ if returns_object => return None,
                StmtKind::Expr(expression) => {
                    members.push(self.find_member_of_emitted_enum(expression, object)?);
                }
                StmtKind::Return(returned) if self.symbol_named_by(returned) == Some(object) => {
                    returns_object = true;
                }
                _ => return None,
            }
        }
        if returns_object != store.is_none() {
            return None;
        }
        let names: FxHashSet<Atom> = members.iter().map(|member| member.name).collect();
        let are_fields = (names.iter())
            .all(|&name| self.is_field_name(name) && !self.is_name_on_object_prototype(name));
        (names.len() == members.len() && !members.is_empty() && are_fields).then_some(EmittedEnum {
            literal,
            stores,
            members,
            variable: named,
            own_names,
            is_laid_on_exports,
        })
    }

    fn is_object_of_lookup(&self, name: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Parent::Expr(access) = bound.parent_of_expr(name) else {
            return false;
        };
        let is_object = matches!(
            hir[access].kind,
            ExprKind::Dot { obj, chain: Chain::No, .. } | ExprKind::Index { obj, chain: Chain::No, .. }
                if obj == name
        );
        let used = bound.outermost_type_assertion(hir, access);
        if !is_object || bound.get_assignment_target(hir, used).is_some() {
            return false;
        }
        match bound.parent_of_expr(used) {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Unary {
                    op: UnOp::Delete, ..
                } => false,
                ExprKind::Call(call) => hir[call].callee != used,
                ExprKind::TaggedTemplate(template) => hir[template].callee != used,
                _ => true,
            },
            _ => true,
        }
    }

    fn list_enums_that_stay_as_born(&mut self) -> EnumsThatStayAsBorn {
        let hir = self.hir;
        let every_expression = || (0..hir.exprs.len() as u32).map(ExprId);
        let mut own_names: FxHashSet<ExprId> = FxHashSet::default();
        let mut listed = EnumsThatStayAsBorn::default();
        for call in every_expression() {
            let is_call_of_written_function = matches!(hir[call].kind, ExprKind::Call(site)
                if matches!(hir[hir[site].callee].kind, ExprKind::Fn(_)));
            if !is_call_of_written_function {
                continue;
            }
            let Some(found) = self.find_emitted_enum(call) else {
                continue;
            };
            let Some(variable) = found.variable else {
                continue;
            };
            if found.is_laid_on_exports {
                continue;
            }
            own_names.extend(found.own_names.iter().copied());
            let members = found
                .members
                .iter()
                .map(|member| (member.name, member.value));
            listed.insert(variable, members.collect());
        }
        for export in self.inputs.modules.exports(self.file) {
            if let ExportBinding::Variable(exported) = export.binding
                && exported.file == self.file
            {
                listed.remove(&exported.id);
            }
        }
        if listed.is_empty() {
            return listed;
        }
        for name in every_expression() {
            if let Some(variable) = self.symbol_named_by(name)
                && listed.contains_key(&variable)
                && !own_names.contains(&name)
                && !self.is_object_of_lookup(name)
            {
                listed.remove(&variable);
            }
        }
        listed
    }

    pub(in crate::lower) fn find_member_of_enum_that_stays_as_born(
        &mut self,
        access: ExprId,
    ) -> Option<(SymbolId, Constant)> {
        let hir = self.hir;
        let (object, name) = match hir[access].kind {
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => (obj, name),
            ExprKind::Index {
                obj,
                index,
                chain: Chain::No,
            } => match hir[index].kind {
                ExprKind::String(name) => (obj, name),
                _ => return None,
            },
            _ => return None,
        };
        let variable = self.symbol_named_by(object)?;
        if self.bound.binding_kind(variable) != BindingKind::Var
            || self.bound.stores_to(variable).len() > 1
        {
            return None;
        }
        if self.enums_that_stay_as_born.is_none() {
            let listed = self.list_enums_that_stay_as_born();
            self.enums_that_stay_as_born = Some(listed);
        }
        let listed = self.enums_that_stay_as_born.as_ref()?;
        let value = *listed.get(&variable)?.get(&name)?;
        Some((variable, value))
    }

    pub(in crate::lower) fn find_emitted_enum_born_at(
        &mut self,
        literal: ExprId,
    ) -> Option<EmittedEnum> {
        let (hir, bound) = (self.hir, self.bound);
        let mut call = literal;
        while !matches!(hir[call].kind, ExprKind::Call(_)) {
            let is_on_the_way = call == literal
                || matches!(
                    hir[call].kind,
                    ExprKind::Assign { .. } | ExprKind::Binary { op: BinOp::Or, .. }
                );
            let Parent::Expr(parent) = bound.parent_of_expr(call) else {
                return None;
            };
            if !is_on_the_way {
                return None;
            }
            call = parent;
        }
        let found = self.find_emitted_enum(call)?;
        (found.literal == literal).then_some(found)
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_call_of_emitted_enum(&mut self, found: &EmittedEnum) -> ValueId {
        match found.stores {
            Some(stores) => {
                self.lower_expression_for_effect(stores);
                self.builder.undefined()
            }
            None => self.lower_expression(found.literal),
        }
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
        let mut entries: Vec<(Constant, Constant)> = Vec::with_capacity(2 * found.members.len());
        for member in &found.members {
            entries.push((Constant::String(member.name), member.value));
            if member.is_named_under_value {
                entries.push((member.value, Constant::String(member.name)));
            }
        }
        self.set_position(hir[found.literal].pos);
        self.lower_data_of_object(found.literal, layout, &entries)
    }
}
