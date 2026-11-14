use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, BindingKind, CodeUnit, CommonJsVariable, FnOwner, Parent, ScopeId,
    SymbolId,
};
use bun_sema::check::aot::function_of_this;
use bun_sema::fold::FoldedValue;
use bun_sema::hir::{
    Call, Chain, ExprId, ExprKind, FnBody, FnId, MemberKey, NodeData, PatKind, PropKey, PropKind,
    StmtKind, is_proto_setter,
};
use bun_sema::program::Sym;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::Arguments;
use super::written_operands::find_locked_builtin;
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    ECMAMode, Field, FunctionFlags, FunctionKind, FunctionSyntax, Layout, LayoutFlags, LayoutKind,
    LimitId,
};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, LayoutKey, ValueId, VariableKey};
use crate::lower::layouts::can_be_field;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, function, object};

pub(in crate::lower) struct PrototypeMaker {
    prototype: ExprId,
    above: Option<SymbolId>,
    names: Vec<Atom>,
    is_always_initialized: bool,
}

#[derive(Default)]
pub(in crate::lower) struct PrototypeMakers {
    of_variables: FxHashMap<SymbolId, PrototypeMaker>,
    variables_of_prototypes: FxHashMap<ExprId, SymbolId>,
}

impl FileLowering<'_, '_, '_, '_> {
    fn prototype_makers(&self) -> &PrototypeMakers {
        self.lists
            .prototype_makers
            .get_or_init(|| self.find_prototype_makers())
    }

    pub(in crate::lower) fn variable_of_prototype_literal(
        &self,
        literal: ExprId,
    ) -> Option<SymbolId> {
        self.prototype_makers()
            .variables_of_prototypes
            .get(&literal)
            .copied()
    }

    pub(in crate::lower) fn holds_prototype_of_maker(&self, variable: SymbolId) -> bool {
        self.prototype_makers().of_variables.contains_key(&variable)
    }

    fn find_prototype_makers(&self) -> PrototypeMakers {
        let mut makers = PrototypeMakers::default();
        if self.part.is_some() || self.inputs.modules.has_instances(self.file) || self.is_checked()
        {
            return makers;
        }
        let mut members_above: Option<FxHashSet<Atom>> = None;
        let mut held_above: FxHashSet<SymbolId> = FxHashSet::default();
        for index in 0..self.hir.exprs.len() as u32 {
            let expression = ExprId(index);
            let (found, is_literal) = match self.hir[expression].kind {
                ExprKind::Call(number) => {
                    let site = self.hir[number];
                    let set = || {
                        self.find_literal_below_variable(site)
                            .map(|(_, variable)| variable)
                    };
                    (self.find_variable_below(site).or_else(set), false)
                }
                ExprKind::Object(_) => (self.find_variable_in_literal(expression), true),
                _ => (None, false),
            };
            let Some(variable) = found else {
                continue;
            };
            if let Some(member) = self.find_member_stored(expression)
                && members_above
                    .get_or_insert_with(|| self.find_members_above())
                    .contains(&member)
            {
                held_above.insert(variable);
            }
            if makers.of_variables.contains_key(&variable) {
                continue;
            }
            if let Some((prototype, above)) = self.find_prototype_held(variable, 0) {
                let is_always_initialized = self.is_always_initialized(variable);
                if is_literal && !is_always_initialized {
                    continue;
                }
                let names = Vec::new();
                let maker = PrototypeMaker {
                    prototype,
                    above,
                    names,
                    is_always_initialized,
                };
                makers.of_variables.insert(variable, maker);
                makers.variables_of_prototypes.insert(prototype, variable);
            }
        }
        for variable in held_above {
            if let Some(maker) = makers.of_variables.remove(&variable) {
                makers.variables_of_prototypes.remove(&maker.prototype);
            }
        }
        loop {
            let of_variables = &makers.of_variables;
            let is_missing = |maker: &PrototypeMaker| {
                maker
                    .above
                    .is_some_and(|above| !of_variables.contains_key(&above))
            };
            let missing = of_variables
                .iter()
                .find(|(_, maker)| is_missing(maker))
                .map(|(&variable, _)| variable);
            let Some(maker) = missing.and_then(|variable| makers.of_variables.remove(&variable))
            else {
                break;
            };
            makers.variables_of_prototypes.remove(&maker.prototype);
        }
        if !makers.of_variables.is_empty() {
            self.list_names_of_makers(&mut makers);
        }
        makers
    }

    fn find_member_stored(&self, created: ExprId) -> Option<Atom> {
        let (hir, bound) = (self.hir, self.bound);
        let mut child = created;
        loop {
            return match bound.parent_of_expr(child) {
                Parent::Expr(parent) if hir.type_assertion_operand(parent) == Some(child) => {
                    child = parent;
                    continue;
                }
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Assign {
                        op: None,
                        target,
                        value,
                    } if value == child => match hir.member_key(self.skip_type_syntax(target)) {
                        Some((_, MemberKey::Name(name))) => Some(name),
                        _ => {
                            child = parent;
                            continue;
                        }
                    },
                    _ => None,
                },
                Parent::Prop(property) => match hir.runtime_property_key(property) {
                    PropKey::Name(name) => Some(name),
                    _ => None,
                },
                Parent::MemberInit(member) => match hir.runtime_member_key(member) {
                    PropKey::Name(name) => Some(name),
                    _ => None,
                },
                _ => None,
            };
        }
    }

    fn find_members_above(&self) -> FxHashSet<Atom> {
        let hir = self.hir;
        let mut members = FxHashSet::default();
        for expression in hir.exprs.iter() {
            let ExprKind::Call(number) = expression.kind else {
                continue;
            };
            let site = hir[number];
            let Some((_, MemberKey::Name(name))) =
                hir.member_key(self.skip_type_syntax(site.callee))
            else {
                continue;
            };
            if self.queries.atom_bytes(name) == b"create"
                && site.args.len() != 0
                && let Some((_, MemberKey::Name(member))) =
                    hir.member_key(self.skip_type_syntax(hir.id_at(site.args, 0)))
                && member != known::prototype
            {
                members.insert(member);
            }
        }
        members
    }

    fn find_variable_below(&self, site: Call) -> Option<SymbolId> {
        let Some((_, MemberKey::Name(name))) =
            self.hir.member_key(self.skip_type_syntax(site.callee))
        else {
            return None;
        };
        if self.queries.atom_bytes(name) != b"create"
            || site.args.len() != 1
            || site.chain != Chain::No
        {
            return None;
        }
        let variable = self.find_variable_named(self.hir.id_at(site.args, 0))?;
        (find_locked_builtin(self, site.callee) == Some(BuiltinId::ObjectCreate))
            .then_some(variable)
    }

    fn find_literal_below_variable(&self, site: Call) -> Option<(ExprId, SymbolId)> {
        let Some((_, MemberKey::Name(name))) =
            self.hir.member_key(self.skip_type_syntax(site.callee))
        else {
            return None;
        };
        if self.queries.atom_bytes(name) != b"setPrototypeOf"
            || site.args.len() != 2
            || site.chain != Chain::No
        {
            return None;
        }
        let literal = self.skip_type_syntax(self.hir.id_at(site.args, 0));
        let variable = self.find_variable_named(self.hir.id_at(site.args, 1))?;
        let is_plain = matches!(self.find_parent_in_plain_literal(literal), Some(None))
            && find_locked_builtin(self, site.callee) == Some(BuiltinId::ObjectSetPrototypeOf);
        is_plain.then_some((literal, variable))
    }

    fn find_variable_in_literal(&self, literal: ExprId) -> Option<SymbolId> {
        let ExprKind::Object(properties) = self.hir[literal].kind else {
            return None;
        };
        if !properties.iter().any(|id| is_proto_setter(&self.hir[id])) {
            return None;
        }
        match self.find_parent_in_plain_literal(literal) {
            Some(Some(parent)) => self.find_variable_named(parent),
            Some(None) | None => None,
        }
    }

    fn find_variable_named(&self, expression: ExprId) -> Option<SymbolId> {
        let name = self.skip_type_syntax(expression);
        match (self.hir[name].kind, self.bound.static_binding(name)) {
            (ExprKind::Ident(_), Some(Binding::Symbol(variable))) => Some(variable),
            _ => None,
        }
    }

    fn find_parent_in_plain_literal(&self, literal: ExprId) -> Option<Option<ExprId>> {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return None;
        };
        let mut parent = None;
        let mut names: FxHashSet<Atom> = FxHashSet::default();
        for id in properties.iter() {
            let property = hir[id];
            if is_proto_setter(&property) {
                if parent.replace(property.value).is_some() {
                    return None;
                }
                continue;
            }
            let PropKey::Name(name) = hir.runtime_property_key(id) else {
                return None;
            };
            if !matches!(property.kind, PropKind::Init | PropKind::Shorthand)
                || name == known::__proto__
                || !names.insert(name)
                || self
                    .queries
                    .atom_bytes(name)
                    .first()
                    .is_none_or(u8::is_ascii_digit)
            {
                return None;
            }
        }
        Some(parent)
    }

    fn is_evaluated_once(&self, scope: ScopeId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut unit = bound.code_unit(scope);
        loop {
            let function = match unit {
                CodeUnit::File => return true,
                CodeUnit::Function(function) => function,
                CodeUnit::FieldInitializer(_) => return false,
            };
            let FnOwner::Expr(written) = bound.fns[function.idx()].owner else {
                return false;
            };
            if !bound.is_called_only_where_written(hir, function) || self.is_in_loop(written) {
                return false;
            }
            let own_scope = bound.fns[function.idx()].scope;
            let around = own_scope
                .is_some()
                .then(|| bound.scopes[own_scope.idx()].parent);
            let Some(around) = around.filter(|around| around.is_some()) else {
                return false;
            };
            unit = bound.code_unit(around);
        }
    }

    fn is_in_loop(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let mut node = hir.node(expression);
        loop {
            node = hir.parent(node);
            match hir.data(node) {
                NodeData::None | NodeData::File => return false,
                NodeData::Expr(expression) if matches!(hir[expression].kind, ExprKind::Fn(_)) => {
                    return false;
                }
                NodeData::Stmt(statement) => match hir[statement].kind {
                    StmtKind::Fn(_) => return false,
                    StmtKind::For { .. }
                    | StmtKind::ForIn { .. }
                    | StmtKind::ForOf { .. }
                    | StmtKind::While { .. }
                    | StmtKind::DoWhile { .. } => return true,
                    _ => {}
                },
                _ => {}
            }
        }
    }

    fn is_always_initialized(&self, variable: SymbolId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        if bound.binding_kind(variable) != BindingKind::Var {
            return true;
        }
        let body = match bound.code_unit(bound.symbol_scope(variable)) {
            CodeUnit::File if self.imports_files() => return false,
            CodeUnit::File => hir.body,
            CodeUnit::Function(function) => match hir[function].body {
                FnBody::Block(statements) => statements,
                FnBody::Expr(_) | FnBody::None => return false,
            },
            CodeUnit::FieldInitializer(_) => return false,
        };
        for statement in hir.ids(body) {
            match hir[statement].kind {
                StmtKind::Empty
                | StmtKind::Fn(_)
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_) => {}
                StmtKind::Directive { .. } => {}
                StmtKind::Expr(directive) if matches!(hir[directive].kind, ExprKind::String(_)) => {
                }
                StmtKind::Var(declarations) => {
                    for declaration in declarations.iter() {
                        let declaration = hir[declaration];
                        if !matches!(hir[declaration.pat].kind, PatKind::Ident(_)) {
                            return false;
                        }
                        if declaration.init == ExprId::NONE {
                            continue;
                        }
                        if bound.initialized_binding(declaration.pat) == Binding::Symbol(variable) {
                            return self.stores_before_calls(variable, declaration.init);
                        }
                        if !self.calls_nothing_of_file(declaration.init, 0) {
                            return false;
                        }
                    }
                }
                _ => return false,
            }
        }
        false
    }

    fn imports_files(&self) -> bool {
        let hir = self.hir;
        hir.ids(hir.body)
            .any(|statement| match hir[statement].kind {
                StmtKind::Import(_) | StmtKind::ExportStar { .. } => true,
                StmtKind::ExportNamed(export) => hir[export].has_module_specifier,
                _ => false,
            })
    }

    fn stores_before_calls(&self, variable: SymbolId, initializer: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut value = hir.skip_type_assertions(initializer);
        while let ExprKind::Assign {
            op: None,
            target,
            value: stored,
        } = hir[value].kind
        {
            if !self.is_exports_path(target) {
                return false;
            }
            value = hir.skip_type_assertions(stored);
        }
        let ExprKind::Call(number) = hir[value].kind else {
            return self.evaluates_without_calls(value);
        };
        let site = hir[number];
        if self.find_variable_below(site).is_some() {
            return true;
        }
        self.find_assigned_literals(site).is_some_and(|above| {
            let BindingInitializer::Expression(literal) = bound.binding_initializer(hir, above)
            else {
                return false;
            };
            let mut sources = hir.ids(site.args).skip(1);
            bound.symbol_scope(above) == bound.symbol_scope(variable)
                && self.is_literal_without(literal, PropKind::Setter)
                && sources.all(|source| {
                    self.is_literal_without(source, PropKind::Getter)
                        && self.evaluates_without_calls(source)
                })
        })
    }

    fn is_exports_path(&self, target: ExprId) -> bool {
        let Some((owner, MemberKey::Name(_))) = self.hir.member_key(self.skip_type_syntax(target))
        else {
            return false;
        };
        let owner = self.skip_type_syntax(owner);
        match self.hir[owner].kind {
            ExprKind::Ident(_) => matches!(
                self.bound.binding(owner),
                Binding::CommonJs(CommonJsVariable::Module | CommonJsVariable::Exports)
            ),
            _ => self.is_exports_path(owner),
        }
    }

    fn is_literal_without(&self, expression: ExprId, kind: PropKind) -> bool {
        let hir = self.hir;
        match hir[hir.skip_type_assertions(expression)].kind {
            ExprKind::Object(properties) => properties.iter().all(|id| hir[id].kind != kind),
            _ => false,
        }
    }

    fn evaluates_without_calls(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let value = hir.skip_type_assertions(expression);
        let is_builtin = |named: ExprId| {
            matches!(
                self.builtins.of_pure_expr(self.skip_type_syntax(named)),
                Some(Resolved::Builtin(_))
            )
        };
        match hir[value].kind {
            ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::This
            | ExprKind::Regex { .. }
            | ExprKind::Fn(_) => true,
            ExprKind::Array(elements) => hir
                .ids(elements)
                .all(|element| self.evaluates_without_calls(element)),
            ExprKind::Object(properties) => properties.iter().all(|id| {
                let property = hir[id];
                let is_key_evaluated = match hir.runtime_property_key(id) {
                    PropKey::Name(_) => true,
                    PropKey::Computed(key) => is_builtin(key),
                    PropKey::None | PropKey::Private(_) => false,
                };
                is_key_evaluated
                    && property.kind != PropKind::Spread
                    && !is_proto_setter(&property)
                    && self.evaluates_without_calls(property.value)
            }),
            ExprKind::Dot { .. } if is_builtin(value) => true,
            ExprKind::New(number) => hir[number].args.len() == 0 && is_builtin(hir[number].callee),
            _ => {
                matches!(
                    self.decisions().constant(hir, value),
                    FoldedValue::Constant(_)
                ) || self.calls_nothing_of_file(value, 0)
            }
        }
    }

    fn calls_nothing_of_file(&self, expression: ExprId, depth: u32) -> bool {
        let hir = self.hir;
        match hir[hir.skip_type_assertions(expression)].kind {
            ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Fn(_)
            | ExprKind::String(_) => true,
            ExprKind::Number(_) => true,
            ExprKind::Object(properties) => {
                depth < 4
                    && properties.iter().all(|id| {
                        let property = hir[id];
                        matches!(hir.runtime_property_key(id), PropKey::Name(_))
                            && property.kind != PropKind::Spread
                            && !is_proto_setter(&property)
                            && self.calls_nothing_of_file(property.value, depth + 1)
                    })
            }
            ExprKind::Call(number) => {
                let site = hir[number];
                self.is_commonjs_module()
                    && matches!(hir[site.callee].kind, ExprKind::Ident(_))
                    && matches!(self.bound.binding(site.callee), Binding::CommonJs(_))
                    && site.args.len() == 1
                    && matches!(hir[hir.id_at(site.args, 0)].kind, ExprKind::String(_))
            }
            _ => false,
        }
    }

    fn find_prototype_held(
        &self,
        variable: SymbolId,
        depth: u32,
    ) -> Option<(ExprId, Option<SymbolId>)> {
        let (hir, bound) = (self.hir, self.bound);
        if !bound.is_stable_binding(variable)
            || bound.binding_kind(variable) == BindingKind::Import
            || !self.is_evaluated_once(bound.symbol_scope(variable))
            || self.is_exported_variable(VariableKey::Symbol(Sym {
                file: self.file,
                id: variable,
            }))
        {
            return None;
        }
        let BindingInitializer::Expression(value) = bound.binding_initializer(hir, variable) else {
            return None;
        };
        let mut literal = hir.skip_type_assertions(value);
        while let ExprKind::Assign {
            op: None, value, ..
        } = hir[literal].kind
        {
            literal = hir.skip_type_assertions(value);
        }
        if self.is_in_loop(literal) {
            return None;
        }
        let mut created = literal;
        if let ExprKind::Call(number) = hir[created].kind
            && self.find_assigned_literals(hir[number]).is_some()
        {
            created = self.skip_type_syntax(hir.id_at(hir[number].args, 0));
        }
        if let Some(above) = self.find_variable_of_created(created) {
            let is_held = depth < 8
                && above != variable
                && self.find_prototype_held(above, depth + 1).is_some();
            return is_held.then_some((created, Some(above)));
        }
        let ExprKind::Object(properties) = hir[literal].kind else {
            return None;
        };
        let mut has_function = false;
        for property in properties.iter() {
            let property = hir[property];
            if is_proto_setter(&property) || property.kind == PropKind::Spread {
                return None;
            }
            has_function |= matches!(
                property.kind,
                PropKind::Method | PropKind::Getter | PropKind::Setter
            ) || matches!(
                hir[hir.skip_type_assertions(property.value)].kind,
                ExprKind::Fn(_)
            );
        }
        has_function.then_some((literal, None))
    }

    fn find_variable_of_created(&self, value: ExprId) -> Option<SymbolId> {
        match self.hir[self.skip_type_syntax(value)].kind {
            ExprKind::Call(number) => self.find_variable_below(self.hir[number]),
            _ => None,
        }
    }

    fn find_assigned_literals(&self, site: Call) -> Option<SymbolId> {
        let variable = match site.args.len() {
            0 | 1 => None,
            _ => self.find_variable_of_created(self.hir.id_at(site.args, 0)),
        }?;
        (find_locked_builtin(self, site.callee) == Some(BuiltinId::ObjectAssign))
            .then_some(variable)
    }

    fn list_names_of_makers(&self, makers: &mut PrototypeMakers) {
        let (hir, bound) = (self.hir, self.bound);
        let mut methods: FxHashMap<FnId, SymbolId> = FxHashMap::default();
        for (&variable, maker) in &makers.of_variables {
            let ExprKind::Object(properties) = hir[maker.prototype].kind else {
                continue;
            };
            for property in properties.iter() {
                let value = hir.skip_type_assertions(hir[property].value);
                if let ExprKind::Fn(function) = hir[value].kind {
                    methods.insert(function, variable);
                }
            }
        }
        for expression in hir.exprs.iter() {
            if let ExprKind::Call(number) = expression.kind
                && self.find_assigned_literals(hir[number]).is_some()
            {
                let site = hir[number];
                let created = self.skip_type_syntax(hir.id_at(site.args, 0));
                let heir = makers.variables_of_prototypes.get(&created).copied();
                for source in hir.ids(site.args).skip(1) {
                    let ExprKind::Object(properties) = hir[hir.skip_type_assertions(source)].kind
                    else {
                        continue;
                    };
                    for property in properties.iter() {
                        let value = hir.skip_type_assertions(hir[property].value);
                        if let (Some(heir), ExprKind::Fn(function)) = (heir, hir[value].kind) {
                            methods.insert(function, heir);
                        }
                    }
                }
            }
            if let ExprKind::Assign {
                op: None,
                target,
                value,
            } = expression.kind
                && let ExprKind::Fn(function) = hir[hir.skip_type_assertions(value)].kind
                && let Some((object, MemberKey::Name(_))) =
                    hir.member_key(self.skip_type_syntax(target))
                && let Some(variable) = self.find_variable_named(object)
                && makers.of_variables.contains_key(&variable)
            {
                methods.insert(function, variable);
            }
        }
        let mut holders: FxHashMap<SymbolId, SymbolId> = FxHashMap::default();
        for declaration in hir.var_decls.iter() {
            if declaration.init == ExprId::NONE
                || !matches!(hir[declaration.pat].kind, PatKind::Ident(_))
            {
                continue;
            }
            let mut made = self.skip_type_syntax(declaration.init);
            if let ExprKind::Call(number) = hir[made].kind
                && self.find_assigned_literals(hir[number]).is_some()
            {
                made = hir.id_at(hir[number].args, 0);
            }
            if let Some(variable) = self.find_variable_of_created(made)
                && let Binding::Symbol(holder) = bound.initialized_binding(declaration.pat)
                && !makers.of_variables.contains_key(&holder)
            {
                holders.insert(holder, variable);
            }
        }
        let prototypes = makers.variables_of_prototypes.clone();
        let mut names: FxHashMap<SymbolId, FxHashSet<Atom>> = FxHashMap::default();
        let mut add = |variable: SymbolId, name: Atom| {
            if let Some(maker) = makers.of_variables.get_mut(&variable)
                && names.entry(variable).or_default().insert(name)
            {
                maker.names.push(name);
            }
        };
        for index in 0..hir.exprs.len() as u32 {
            match hir[ExprId(index)].kind {
                ExprKind::Object(properties) => {
                    let Some(variable) = self.find_variable_in_literal(ExprId(index)) else {
                        continue;
                    };
                    for id in properties.iter().filter(|&id| !is_proto_setter(&hir[id])) {
                        if let PropKey::Name(name) = hir.runtime_property_key(id) {
                            add(variable, name);
                        }
                    }
                }
                ExprKind::Call(number) => {
                    if let Some((literal, variable)) = self.find_literal_below_variable(hir[number])
                        && let ExprKind::Object(properties) = hir[literal].kind
                    {
                        for id in properties.iter() {
                            if let PropKey::Name(name) = hir.runtime_property_key(id) {
                                add(variable, name);
                            }
                        }
                        continue;
                    }
                    let Some(variable) = self.find_assigned_literals(hir[number]) else {
                        continue;
                    };
                    if prototypes
                        .contains_key(&self.skip_type_syntax(hir.id_at(hir[number].args, 0)))
                    {
                        continue;
                    }
                    for source in hir.ids(hir[number].args).skip(1) {
                        let ExprKind::Object(properties) =
                            hir[hir.skip_type_assertions(source)].kind
                        else {
                            continue;
                        };
                        for property in properties.iter() {
                            if let PropKey::Name(name) = hir[property].key {
                                add(variable, name);
                            }
                        }
                    }
                }
                ExprKind::Assign {
                    op: None, target, ..
                } => {
                    let Some((object, MemberKey::Name(name))) =
                        hir.member_key(self.skip_type_syntax(target))
                    else {
                        continue;
                    };
                    let object = self.skip_type_syntax(object);
                    let variable = match hir[object].kind {
                        ExprKind::This => {
                            let function = function_of_this(hir, object);
                            function.and_then(|function| methods.get(&function).copied())
                        }
                        ExprKind::Ident(_) => match bound.binding(object) {
                            Binding::Symbol(holder) => holders.get(&holder).copied(),
                            _ => None,
                        },
                        _ => None,
                    };
                    if let Some(variable) = variable {
                        add(variable, name);
                    }
                }
                _ => {}
            }
        }
    }

    pub(in crate::lower) fn declare_prototype_maker(&mut self, variable: SymbolId) -> FunctionId {
        let key = FunctionKey::PrototypeMaker(Sym {
            file: self.file,
            id: variable,
        });
        let maker = self.declare_function(key, |file| {
            let prototype = file.prototype_makers().of_variables[&variable].prototype;
            let position = file.hir[prototype].pos;
            let mut header = function::create_header(file, key, FunctionKind::Plain, position);
            header.flags |= FunctionFlags::IS_HIDDEN_IN_STACK_TRACES;
            header.syntax |= FunctionSyntax::IS_SHOWN_AS_NATIVE_CODE;
            header
        });
        self.define_layout_of_maker(variable, maker);
        maker
    }

    fn define_layout_of_maker(&mut self, variable: SymbolId, maker: FunctionId) {
        let key = LayoutKey::PrototypeMaker(Sym {
            file: self.file,
            id: variable,
        });
        let layout = self.fragment.declare_layout(key);
        if self.fragment.is_layout_defined(layout) {
            return;
        }
        let (position, above, mut names) = {
            let listed = &self.prototype_makers().of_variables[&variable];
            (
                self.hir[listed.prototype].pos,
                listed.above,
                listed.names.clone(),
            )
        };
        let mut base = None;
        if let Some(above) = above {
            self.declare_prototype_maker(above);
            let key = LayoutKey::PrototypeMaker(Sym {
                file: self.file,
                id: above,
            });
            base = Some(self.fragment.declare_layout(key));
            let mut next = Some(above);
            while let Some(variable) = next {
                let listed = &self.prototype_makers().of_variables[&variable];
                names.retain(|name| !listed.names.contains(name));
                next = listed.above;
            }
        }
        let limit = self.inputs.limits.get(LimitId::FieldsInKeyOrder);
        let mut fields = Vec::new();
        for name in names {
            let key = self.name_key(name);
            if (fields.len() as u64) < limit && can_be_field(self, key) {
                fields.push(Field {
                    key: Some(key),
                    declared: DeclaredType::untyped(),
                    ..Field::default()
                });
            }
        }
        let definition = Layout {
            kind: LayoutKind::Instance,
            module: Some(self.module_id()),
            position,
            constructor: Some(maker),
            base,
            fields,
            flags: LayoutFlags::IS_CONSTRUCTOR_FUNCTION,
            ..Layout::default()
        };
        self.fragment.define_layout(layout, definition);
    }

    pub(in crate::lower) fn lower_prototype_maker(&mut self, function: FunctionId) {
        let mut lowering = FunctionLowering::begin(self, function);
        let nothing = lowering.builder.undefined();
        lowering.emit_return(nothing, None);
        lowering.finish();
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_prototype_maker(&mut self, variable: SymbolId) -> ValueId {
        let key = VariableKey::PrototypeMaker(Sym {
            file: self.file.file,
            id: variable,
        });
        let held = self.file.ensure_variable(key);
        self.builder.get_module_variable(held)
    }

    pub(in crate::lower) fn emit_prototype_of_maker(
        &mut self,
        variable: SymbolId,
        literal: ValueId,
    ) -> ValueId {
        let maker = self.emit_prototype_maker(variable);
        let prototype = PropertyName::Constant(self.file.name_key(known::prototype));
        self.emit_set_in_mode(maker, prototype, literal, ECMAMode::Strict);
        self.emit_get(maker, prototype)
    }

    fn emit_maker_of_initialized(
        &mut self,
        variable: SymbolId,
        prototype: ValueId,
        builtin: BuiltinId,
    ) -> ValueId {
        if !self.file.prototype_makers().of_variables[&variable].is_always_initialized {
            let (missing, is_held) = (self.create_block(), self.create_block());
            self.branch_if_undefined(prototype, missing);
            self.jump(is_held);

            self.continue_in(missing);
            let mut arguments: SmallVec<[ValueId; 2]> = SmallVec::new();
            if builtin == BuiltinId::ObjectSetPrototypeOf {
                let layout = self.file.untyped_layout(&[]);
                let literal = self.begin_object(layout);
                arguments.push(object::finish_object(self, literal));
            }
            arguments.push(self.builder.undefined());
            let thrown = self.emit_builtin_call(builtin, &arguments);
            self.builder.throw(thrown);

            self.continue_in(is_held);
        }
        self.emit_prototype_maker(variable)
    }

    pub(super) fn lower_object_made_by_maker(
        &mut self,
        call: ExprId,
        site: Call,
    ) -> Option<ValueId> {
        let variable = self.file.find_variable_below(site)?;
        if !self.file.holds_prototype_of_maker(variable) {
            return None;
        }
        self.lower_expression(site.callee);
        let parent = self.file.hir.id_at(site.args, 0);
        let parent = self.lower_expression(parent);
        self.set_position(self.file.call_position(site));
        self.quote_if_next_fails(call);
        let maker = self.emit_maker_of_initialized(variable, parent, BuiltinId::ObjectCreate);
        let made = match self.file.variable_of_prototype_literal(call) {
            Some(held) => {
                let prototype = PropertyName::Constant(self.file.name_key(known::prototype));
                let above = self.emit_get(maker, prototype);
                let made = self.emit_builtin_call(BuiltinId::ObjectCreate, &[above]);
                self.emit_prototype_of_maker(held, made)
            }
            None => self.emit_construct(maker, Arguments::Values(Default::default()), None),
        };
        self.set_position(self.file.hir[call].pos);
        Some(self.claim_call_result(call, made))
    }

    pub(super) fn lower_literal_below_prototype(
        &mut self,
        call: ExprId,
        site: Call,
    ) -> Option<ValueId> {
        let (literal, variable) = self.file.find_literal_below_variable(site)?;
        if !self.file.holds_prototype_of_maker(variable) {
            return None;
        }
        self.lower_expression(site.callee);
        let (values, _) = self.lower_values_below_prototype(literal);
        let parent = self.file.hir.id_at(site.args, 1);
        let parent = self.lower_expression(parent);
        self.set_position(self.file.call_position(site));
        self.quote_if_next_fails(call);
        let maker =
            self.emit_maker_of_initialized(variable, parent, BuiltinId::ObjectSetPrototypeOf);
        let made = self.emit_object_of_maker(maker, &values);
        self.set_position(self.file.hir[call].pos);
        Some(self.claim_call_result(call, made))
    }

    pub(in crate::lower) fn try_lower_literal_with_prototype(
        &mut self,
        literal: ExprId,
    ) -> Option<ValueId> {
        let variable = self.file.find_variable_in_literal(literal)?;
        if !self
            .file
            .prototype_makers()
            .of_variables
            .get(&variable)?
            .is_always_initialized
        {
            return None;
        }
        let (values, _) = self.lower_values_below_prototype(literal);
        self.set_position(self.file.hir[literal].pos);
        let maker = self.emit_prototype_maker(variable);
        Some(self.emit_object_of_maker(maker, &values))
    }

    fn lower_values_below_prototype(
        &mut self,
        literal: ExprId,
    ) -> (Vec<(PropertyName, ValueId)>, Option<ValueId>) {
        let hir = self.file.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            unreachable!("the literal was looked at");
        };
        let mut values = Vec::new();
        let mut parent = None;
        for id in properties.iter() {
            let property = hir[id];
            self.set_position(property.pos);
            if is_proto_setter(&property) {
                parent = Some(self.lower_expression(property.value));
                continue;
            }
            let key = hir.runtime_property_key(id);
            let name = self.lower_property_name(key);
            let given = self.name_under_property(&property, key, name);
            let value = self.lower_named_evaluation(property.value, given);
            values.push((name, value));
        }
        (values, parent)
    }

    fn emit_object_of_maker(
        &mut self,
        maker: ValueId,
        values: &[(PropertyName, ValueId)],
    ) -> ValueId {
        let made = self.emit_construct(maker, Arguments::Values(Default::default()), None);
        for &(name, value) in values {
            self.emit_define(made, name, value);
        }
        made
    }
}
