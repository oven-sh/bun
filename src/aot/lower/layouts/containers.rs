#[cfg(test)]
mod tests;

use core::cmp::Reverse;

use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Bound, CodeUnit, CommonJsVariable, Decl, Parent, SymbolId};
use bun_sema::check::aot::ObjectOrigin;
use bun_sema::fold::{Constant, Decisions, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Call, ExprId, ExprKind, Flags, FnId, FnKind, MemberKey, PatKind, StmtId, StmtKind,
    TextRange, is_moved_to_file_start,
};
use bun_sema::import_sites::JsxImport;
use bun_sema::program::{FileId, Files, Sym};
use bun_sema::util::SharedSort;
use rustc_hash::FxHashSet;

use super::OwnFields;
use super::object_types::can_be_field;
use crate::builtins::ResolvedBuiltins;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{Field, FieldForm, Layout, LayoutKind, LimitId, PositionFlags};
use crate::ir::{DeclaredType, InParallel, LayoutId, LayoutKey, for_each_mut};
use crate::lower::scope::{BindingRef, ScopeSlot};
use crate::lower::{CheckerTypeId, FileInputs, FileLowering, module};
use crate::modules::{DescribedPart, ModuleGraph, ModuleKind, ModuleRef, Shape, WrittenDescriptor};

#[derive(Copy, Clone)]
struct CreatedName {
    name: Atom,
    form: FieldForm,
}

pub struct NamesCreatedOnExports {
    modules: Vec<(FileId, u32)>,
    names: Vec<CreatedName>,
}

impl NamesCreatedOnExports {
    pub fn collect(
        files: &Files<'_>,
        modules: &ModuleGraph,
        inputs: &[Option<FileInputs<'_>>],
        in_parallel: InParallel<'_>,
    ) -> NamesCreatedOnExports {
        let file_ids = (0..inputs.len() as u32).map(FileId);
        let candidates = file_ids.filter(|&file| may_have_exports_layout(files, modules, file));
        let mut found: Vec<(FileId, Vec<CreatedName>)> =
            candidates.map(|file| (file, Vec::new())).collect();
        for_each_mut(&mut found, in_parallel, &|(module, names)| {
            if let Some(text) = ModuleText::of_module(files, inputs, *module) {
                *names = list_created_names(&text);
            }
        });
        found.retain(|(_, names)| !names.is_empty());
        let name_count: usize = found.iter().map(|(_, names)| names.len()).sum();
        let mut created = NamesCreatedOnExports {
            modules: Vec::with_capacity(found.len()),
            names: Vec::with_capacity(name_count),
        };
        for (module, names) in found {
            created.modules.push((module, created.names.len() as u32));
            created.names.extend(names);
        }
        created
    }

    fn of(&self, module: FileId) -> &[CreatedName] {
        let Ok(at) = self.modules.binary_search_by_key(&module, |entry| entry.0) else {
            return &[];
        };
        let start = self.modules[at].1 as usize;
        let following = self.modules.get(at + 1);
        let end = following.map_or(self.names.len(), |entry| entry.1 as usize);
        &self.names[start..end]
    }
}

fn may_have_exports_layout(files: &Files<'_>, modules: &ModuleGraph, module: FileId) -> bool {
    if !modules.has_record(module)
        || modules.kind(module) != ModuleKind::CommonJs
        || modules.is_library(module)
    {
        return false;
    }
    match modules.shape(ModuleRef::File(module)) {
        Shape::Value | Shape::AsToday => !files.bound(module).file_uses_arguments(),
        Shape::EsModule | Shape::Names => false,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_container_position(&self, symbol: Sym) -> u32 {
        let hir = self.hir;
        let declarations = self.queries.files().decls_of(symbol);
        let mut own_declarations = declarations.iter().filter(|entry| entry.0 == self.file);
        let position = own_declarations.find_map(|entry| match entry.1 {
            Decl::Enum(declaration) => Some(hir[declaration].name_pos),
            Decl::Module(declaration) => Some(hir[declaration].name_pos),
            Decl::Fn(function) => Some(hir[function].name_pos),
            Decl::Class(class) => Some(hir[class].name_pos),
            _ => None,
        });
        position.unwrap_or(0)
    }

    pub(in crate::lower) fn container_layout(&mut self, container: SymbolId) -> LayoutId {
        let symbol = self.queries.canonical_symbol(self.file, container);
        self.fragment.declare_layout(LayoutKey::Container(symbol))
    }

    fn is_file_symbol(&self, symbol: Sym) -> bool {
        self.queries.files().bound(symbol.file).file_symbol == symbol.id
    }

    pub(crate) fn module_exports_layout(&mut self, module: FileId) -> Option<LayoutId> {
        let files = self.queries.files();
        if !may_have_exports_layout(files, self.inputs.modules, module) {
            return None;
        }
        let file_symbol = files.bound(module).file_symbol.some()?;
        let symbol = self.queries.canonical_symbol(module, file_symbol);
        if symbol.file != module || symbol.id != file_symbol {
            return None;
        }
        let layout = self.fragment.declare_layout(LayoutKey::Container(symbol));
        let has_fields = !super::own_fields(self, layout).as_slice().is_empty();
        has_fields.then_some(layout)
    }

    fn find_module_of_type(&mut self, ty: CheckerTypeId) -> Option<FileId> {
        let ObjectOrigin::Symbol(symbol) = self.queries.object_origin(ty) else {
            return None;
        };
        self.is_file_symbol(symbol).then_some(symbol.file)
    }

    pub(in crate::lower) fn is_type_of_module(&mut self, ty: CheckerTypeId) -> bool {
        self.find_module_of_type(ty).is_some()
    }

    pub(crate) fn module_type_layout(&mut self, ty: CheckerTypeId) -> Option<LayoutId> {
        let module = self.find_module_of_type(ty)?;
        self.module_exports_layout(module)
    }

    fn reads_this_of_body(&self) -> bool {
        let this = BindingRef::Slot(module::file_scope(self), ScopeSlot::This);
        let analysis = &self.compiled.analysis;
        self.scopes.placement(this).is_some()
            && (!analysis.has_esm_syntax || analysis.jsx_imports.contains(JsxImport::JsxDev))
    }

    fn names_exports_without_expression(&self) -> bool {
        let analysis = &self.compiled.analysis;
        let mut bindings = analysis.bindings_read_without_expression(self.hir, self.bound);
        bindings.any(|binding| {
            matches!(
                binding,
                Binding::CommonJs(CommonJsVariable::Exports | CommonJsVariable::Module)
            )
        })
    }

    pub(in crate::lower) fn begins_with_exports_object(&self) -> bool {
        let own_module = ModuleRef::File(self.file);
        let modules = self.inputs.modules;
        if modules.half(own_module)
            || modules.keeps_module_object(own_module)
            || self.reads_this_of_body()
            || self.names_exports_without_expression()
        {
            return true;
        }
        !replaces_exports_first(&ModuleText {
            hir: self.hir,
            bound: self.bound,
            decisions: self.decisions(),
            builtins: self.builtins,
            is_this_exports: !self.compiled.analysis.has_esm_syntax,
        })
    }

    fn compute_exports_fields(&mut self, module: FileId) -> OwnFields {
        let created = self.inputs.names_created_on_exports;
        let limit = self.inputs.limits.get(LimitId::FieldsInKeyOrder);
        let mut fields = OwnFields::default();
        for &CreatedName { name, form } in created.of(module) {
            let key = self.atom_key(name);
            if !can_be_field(self, key) {
                continue;
            }
            if fields.as_slice().len() as u64 >= limit {
                break;
            }
            fields.add(Field {
                key: Some(key),
                declared: DeclaredType::untyped(),
                form,
                ..Field::default()
            });
        }
        fields.finish()
    }

    pub(super) fn compute_container_fields(&mut self, symbol: Sym) -> OwnFields {
        if self.is_file_symbol(symbol) {
            return self.compute_exports_fields(symbol.file);
        }
        if symbol.file != self.file {
            return OwnFields::default();
        }
        let bound = self.bound;
        let limit = self.inputs.limits.get(LimitId::FieldsInKeyOrder);
        let mut fields = OwnFields::default();
        for &(name, export) in bound.table(bound.symbol(symbol.id).exports) {
            if !bound.has_runtime_value(export) {
                continue;
            }
            let key = self.name_key(name);
            if !can_be_field(self, key) {
                continue;
            }
            if fields.as_slice().len() as u64 >= limit {
                break;
            }
            let mut declarations = bound.symbol(export).decls.iter();
            let is_enum_member = declarations.any(|decl| matches!(decl, Decl::EnumMember(_)));
            let mut declared = match is_enum_member {
                true => DeclaredType::untyped(),
                false => self.binding_position(export),
            };
            if declared.flags.contains(PositionFlags::IS_FROM_COMPILER) {
                declared.flags |= PositionFlags::IS_EXPECTED;
            }
            fields.add(Field {
                key: Some(key),
                declared,
                ..Field::default()
            });
        }
        fields.finish()
    }

    pub(super) fn define_container_layout(&mut self, layout: LayoutId, symbol: Sym) {
        debug_assert!(
            symbol.file == self.file,
            "a container is defined by its file"
        );
        let name = self.bound.symbol(symbol.id).name;
        let is_module_exports = self.is_file_symbol(symbol);
        let kind = match is_module_exports {
            true => LayoutKind::Record,
            false => LayoutKind::Container,
        };
        let definition = Layout {
            kind,
            name: (name.is_some() && !is_module_exports)
                .then(|| self.intern_binding_name(Binding::Symbol(symbol.id), name)),
            module: Some(self.module_id()),
            position: self.find_container_position(symbol),
            fields: super::own_fields(self, layout).as_slice().to_vec(),
            ..Layout::default()
        };
        self.fragment.note_allocation(layout);
        for key in definition.fields.iter().filter_map(|field| field.key) {
            self.fragment.note_write(key);
        }
        self.fragment.define_layout(layout, definition);
    }
}

struct ModuleText<'x, 's> {
    hir: &'x hir::File<'s>,
    bound: &'x Bound<'s>,
    decisions: &'x Decisions<'s>,
    builtins: &'x ResolvedBuiltins,
    is_this_exports: bool,
}

impl<'x, 's> ModuleText<'x, 's> {
    fn of_module(
        files: &'x Files<'s>,
        inputs: &[Option<FileInputs<'x>>],
        module: FileId,
    ) -> Option<ModuleText<'x, 's>> {
        let (compiled, inputs) = (files.compiled(module)?, inputs[module.idx()]?);
        Some(ModuleText {
            hir: files.hir(module),
            bound: files.bound(module),
            decisions: &compiled.analysis.decisions,
            builtins: inputs.builtins,
            is_this_exports: !compiled.analysis.has_esm_syntax,
        })
    }
}

#[derive(Copy, Clone)]
struct Assignment {
    node: ExprId,
    is_plain: bool,
    value: ExprId,
}

#[derive(Copy, Clone)]
struct Creation {
    name: Atom,
    form: Option<FieldForm>,
    is_deferred: bool,
    end: u32,
    start: u32,
}

fn find_code_unit(text: &ModuleText<'_, '_>, expression: ExprId) -> Option<CodeUnit> {
    let bound = text.bound;
    let mut child = expression;
    loop {
        let statement = match bound.parent_of_expr(child) {
            Parent::Expr(parent) => {
                child = parent;
                continue;
            }
            Parent::Prop(property) | Parent::PropKey(property) | Parent::MethodKey(property) => {
                child = bound.prop_owner[property.idx()];
                continue;
            }
            Parent::Stmt(statement) => statement,
            Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()],
            Parent::File => return Some(CodeUnit::File),
            Parent::FnBody(function) => return Some(CodeUnit::Function(function)),
            Parent::ParamDefault(parameter) => {
                return Some(CodeUnit::Function(bound.param_fn[parameter.idx()]));
            }
            Parent::MemberInit(member) => return Some(CodeUnit::FieldInitializer(member)),
            _ => return None,
        };
        let scope = bound.scope_of_stmt(statement);
        return scope.is_some().then(|| bound.code_unit(scope));
    }
}

fn find_enclosing_unit(text: &ModuleText<'_, '_>, function: FnId) -> CodeUnit {
    let bound = text.bound;
    let mut next = bound.fns[function.idx()].scope.some();
    while let Some(scope) = next {
        let unit = bound.code_unit(scope);
        if unit != CodeUnit::Function(function) {
            return unit;
        }
        next = bound.runtime_parent_scope(text.hir, scope).some();
    }
    CodeUnit::File
}

fn is_in_body_through(
    text: &ModuleText<'_, '_>,
    expression: ExprId,
    mut passes: impl FnMut(FnId) -> bool,
) -> bool {
    let Some(mut unit) = find_code_unit(text, expression) else {
        return false;
    };
    while let CodeUnit::Function(function) = unit {
        if !passes(function) {
            return false;
        }
        unit = find_enclosing_unit(text, function);
    }
    unit == CodeUnit::File
}

fn reads_this_of_file(text: &ModuleText<'_, '_>, this: ExprId) -> bool {
    is_in_body_through(text, this, |it| text.hir[it].kind == FnKind::Arrow)
}

fn is_called_where_written(text: &ModuleText<'_, '_>, function: FnId) -> bool {
    let hir = text.hir;
    !hir[function]
        .flags
        .intersects(Flags::ASYNC | Flags::GENERATOR)
        && text
            .bound
            .get_immediately_invoked_function_expression(hir, function)
            .is_some()
}

fn names_exports_object(text: &ModuleText<'_, '_>, expression: ExprId) -> bool {
    text.builtins.builtin_of_expression(expression) == Some(BuiltinId::ModuleObjectExports)
}

fn is_exports_object(text: &ModuleText<'_, '_>, expression: ExprId) -> bool {
    let expression = text.hir.skip_type_assertions(expression);
    if matches!(text.hir[expression].kind, ExprKind::This) {
        return text.is_this_exports && reads_this_of_file(text, expression);
    }
    names_exports_object(text, expression)
}

fn find_assignment(text: &ModuleText<'_, '_>, target: ExprId) -> Option<Assignment> {
    let target = text.bound.outermost_type_assertion(text.hir, target);
    let Parent::Expr(parent) = text.bound.parent_of_expr(target) else {
        return None;
    };
    let ExprKind::Assign {
        op,
        target: assigned,
        value,
    } = text.hir.exprs.get(parent.idx())?.kind
    else {
        return None;
    };
    (assigned == target).then_some(Assignment {
        node: parent,
        is_plain: op.is_none(),
        value,
    })
}

fn find_constant(text: &ModuleText<'_, '_>, expression: ExprId) -> Option<Constant> {
    let expression = text.hir.skip_type_assertions(expression);
    match text.decisions.constant(text.hir, expression) {
        FoldedValue::Constant(constant) => Some(constant),
        FoldedValue::ConstantOutsideDeadZone(_) | FoldedValue::Unknown => None,
    }
}

fn find_constant_name(text: &ModuleText<'_, '_>, key: ExprId) -> Option<Atom> {
    match find_constant(text, key)? {
        Constant::String(name) => Some(name),
        _ => None,
    }
}

fn find_defined_form(text: &ModuleText<'_, '_>, descriptor: ExprId) -> Option<FieldForm> {
    let written = WrittenDescriptor::read(text.hir, text.decisions, descriptor)?;
    let mut form = match written.part {
        DescribedPart::Accessor { .. } => FieldForm::IS_ACCESSOR,
        DescribedPart::Data {
            is_writable: Some(true),
            ..
        } => FieldForm::default(),
        DescribedPart::Data { .. } => FieldForm::IS_READ_ONLY,
    };
    if written.is_enumerable != Some(true) {
        form |= FieldForm::IS_NOT_ENUMERABLE;
    }
    if written.is_configurable != Some(true) {
        form |= FieldForm::IS_NOT_CONFIGURABLE;
    }
    Some(form)
}

fn create_creation(
    text: &ModuleText<'_, '_>,
    name: Atom,
    form: Option<FieldForm>,
    node: ExprId,
) -> Creation {
    Creation {
        name,
        form,
        is_deferred: !is_in_body_through(text, node, |it| is_called_where_written(text, it)),
        end: text.hir[node].end,
        start: text.hir[node].pos,
    }
}

fn find_definition(text: &ModuleText<'_, '_>, expression: ExprId, call: &Call) -> Option<Creation> {
    let hir = text.hir;
    if call.args.len() != 3 {
        return None;
    }
    let callee = hir.skip_type_assertions(call.callee);
    let callee = text.builtins.builtin_of_expression(callee)?;
    let defines_property = matches!(
        callee,
        BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty
    );
    if !defines_property || !is_exports_object(text, hir.id_at(call.args, 0)) {
        return None;
    }
    let name = find_constant_name(text, hir.id_at(call.args, 1))?;
    let form = find_defined_form(text, hir.id_at(call.args, 2));
    Some(create_creation(text, name, form, expression))
}

fn has_export_assignment(bound: &Bound<'_>) -> bool {
    let exports = bound.symbol(bound.file_symbol).exports;
    let Some(assigned) = bound.lookup(exports, known::export_equals) else {
        return false;
    };
    let mut declarations = bound.symbol(assigned).decls.iter();
    declarations.any(|declaration| matches!(declaration, Decl::ExportExpr(_)))
}

fn stores_object_variable(text: &ModuleText<'_, '_>) -> bool {
    let mut stores = text.bound.runtime.unbound_name_stores().iter();
    stores.any(|&(target, _)| match text.bound.binding(target) {
        Binding::CommonJs(CommonJsVariable::Exports | CommonJsVariable::Module) => {
            !text.decisions.is_dead_expr(target)
        }
        Binding::CommonJs(
            CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname,
        )
        | Binding::Symbol(_)
        | Binding::Arguments(_)
        | Binding::Free => false,
    })
}

fn collect_creations(text: &ModuleText<'_, '_>) -> Option<Vec<Creation>> {
    let (hir, bound) = (text.hir, text.bound);
    if has_export_assignment(bound) || stores_object_variable(text) {
        return None;
    }
    let mut creations = Vec::new();
    for expression in (0..hir.exprs.len() as u32).map(ExprId) {
        if let ExprKind::Call(call) = hir[expression].kind {
            creations.extend(find_definition(text, expression, &hir[call]));
            continue;
        }
        let Some((object, key)) = hir.member_key(expression) else {
            continue;
        };
        if !bound.is_stored_to(hir, expression) || text.decisions.is_dead_expr(expression) {
            continue;
        }
        let assignment = find_assignment(text, expression);
        if names_exports_object(text, expression) {
            let keeps_object =
                assignment.is_some_and(|it| it.is_plain && is_exports_object(text, it.value));
            if !keeps_object {
                return None;
            }
            continue;
        }
        if !is_exports_object(text, object) {
            continue;
        }
        let name = match key {
            MemberKey::Name(name) => Some(name),
            MemberKey::Computed(computed) => find_constant_name(text, computed),
            MemberKey::PrivateName(_) => None,
        };
        let Some(name) = name else {
            continue;
        };
        let node = assignment.map_or(expression, |it| it.node);
        let form = Some(FieldForm::default());
        creations.push(create_creation(text, name, form, node));
    }
    Some(creations)
}

fn list_created_names(text: &ModuleText<'_, '_>) -> Vec<CreatedName> {
    let mut creations = collect_creations(text).unwrap_or_default();
    creations.shared_sort_by_key(|it| (it.is_deferred, it.end, Reverse(it.start)));
    let mut created_names = FxHashSet::default();
    creations.retain(|it| created_names.insert(it.name));
    let of_known_form = creations.iter().filter_map(|it| {
        let form = it.form?;
        Some(CreatedName {
            name: it.name,
            form,
        })
    });
    of_known_form.collect()
}

struct Replacement {
    module_name: ExprId,
    exports_name: Option<ExprId>,
    value: ExprId,
    start: u32,
    end: u32,
}

fn find_plain_store(text: &ModuleText<'_, '_>, expression: ExprId) -> Option<(ExprId, ExprId)> {
    let hir = text.hir;
    match hir[hir.skip_type_assertions(expression)].kind {
        ExprKind::Assign {
            op: None,
            target,
            value,
        } => Some((hir.skip_type_assertions(target), value)),
        _ => None,
    }
}

fn find_module_name(text: &ModuleText<'_, '_>, access: ExprId) -> Option<ExprId> {
    let (object, _) = text.hir.member_key(access)?;
    names_exports_object(text, access).then(|| text.hir.skip_type_assertions(object))
}

fn find_replacement(text: &ModuleText<'_, '_>, statement: StmtId) -> Option<Replacement> {
    let hir = text.hir;
    let mut expression = match hir[statement].kind {
        StmtKind::Expr(expression) => expression,
        StmtKind::Var(declarations) => {
            let first = &hir[declarations.iter().next()?];
            matches!(hir[first.pat].kind, PatKind::Ident(_)).then_some(first.init.some()?)?
        }
        _ => return None,
    };
    if text.decisions.is_dead_stmt(statement) {
        return None;
    }
    while let ExprKind::Binary {
        op: BinOp::Comma,
        left,
        ..
    } = hir[hir.skip_type_assertions(expression)].kind
    {
        expression = left;
    }
    let (target, value) = find_plain_store(text, expression)?;
    let (module_name, exports_name, value) = match find_module_name(text, target) {
        Some(module_name) => (module_name, None, value),
        None if matches!(hir[target].kind, ExprKind::Ident(_))
            && text.bound.binding(target) == Binding::CommonJs(CommonJsVariable::Exports) =>
        {
            let (inner_target, value) = find_plain_store(text, value)?;
            (find_module_name(text, inner_target)?, Some(target), value)
        }
        None => return None,
    };
    Some(Replacement {
        module_name,
        exports_name,
        value,
        start: hir[expression].pos,
        end: hir[expression].end,
    })
}

fn is_evaluated_behind(
    text: &ModuleText<'_, '_>,
    replacement: &Replacement,
    evaluated_ahead: &[TextRange],
    mention: ExprId,
) -> bool {
    let hir = text.hir;
    let position = hir[mention].pos;
    if position >= replacement.end {
        let next = evaluated_ahead.partition_point(|moved| moved.end <= position);
        if evaluated_ahead
            .get(next)
            .is_some_and(|moved| moved.pos <= position)
        {
            return false;
        }
        let mut outermost = None;
        let is_in_body = is_in_body_through(text, mention, |function| {
            outermost = Some(function);
            true
        });
        return is_in_body && outermost.is_none_or(|function| hir[function].kind != FnKind::Decl);
    }
    let value = hir.skip_type_assertions(replacement.value);
    position >= replacement.start && matches!(hir[value].kind, ExprKind::Fn(_))
}

fn replaces_exports_first(text: &ModuleText<'_, '_>) -> bool {
    let (hir, bound) = (text.hir, text.bound);
    let mut statements = hir.ids(hir.body).enumerate();
    let found =
        statements.find_map(|(index, statement)| Some((index, find_replacement(text, statement)?)));
    let Some((statements_in_front, replacement)) = found else {
        return false;
    };
    let can_return_first = (0..hir.stmts.len() as u32).map(StmtId).any(|statement| {
        let scope = bound.scope_of_stmt(statement);
        matches!(hir[statement].kind, StmtKind::Return(_))
            && hir[statement].loc.pos < replacement.start
            && !text.decisions.is_dead_stmt(statement)
            && (scope.is_none() || bound.code_unit(scope) == CodeUnit::File)
    });
    if can_return_first {
        return false;
    }
    let evaluated_ahead = hir
        .ids(hir.body)
        .enumerate()
        .filter(|&(index, it)| index < statements_in_front || is_moved_to_file_start(hir, it));
    let evaluated_ahead = evaluated_ahead.map(|(_, it)| hir[it].loc);
    let mut evaluated_ahead: Vec<TextRange> = evaluated_ahead
        .filter(|written| written.pos >= replacement.end)
        .collect();
    evaluated_ahead.shared_sort_unstable_by_key(|written| written.pos);
    bound.ident_bindings().iter().all(|&(mention, binding)| {
        let Binding::CommonJs(variable) = binding else {
            return true;
        };
        let names_replaced_value = match variable {
            CommonJsVariable::Exports => replacement.exports_name.is_some(),
            CommonJsVariable::Module => match bound.parent_of_expr(mention) {
                Parent::Expr(access) => hir
                    .member_key(access)
                    .is_some_and(|(object, _)| object == mention),
                _ => false,
            },
            CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname => {
                return true;
            }
        };
        text.decisions.is_dead_expr(mention)
            || mention == replacement.module_name
            || Some(mention) == replacement.exports_name
            || (names_replaced_value
                && is_evaluated_behind(text, &replacement, &evaluated_ahead, mention))
    })
}
