use super::{
    LinkedBinding, LoadedValue, NamespaceReferent, ReferentCertainty, ReferentContext,
    ResolvedReferent, StaticInitializer, StaticReferent, UnknownReferent,
};
use crate::atom::{Atom, known};
use crate::bind::decorator_metadata::has_decorators;
use crate::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, CommonJsVariable, Decl,
    InitialState, Parent, PatParent, SymbolId,
};
use crate::check::aot::{ClassRef, FunctionRef};
use crate::hir::*;
use crate::import_sites::is_free_common_js;
use crate::program::{FileId, Sym};
use smallvec::SmallVec;
use std::marker::PhantomData;

#[derive(Copy, Clone)]
enum DeclaredValue {
    Function(FnId),
    Class(ClassId),
}

#[derive(Copy, Clone)]
struct ExportStore {
    node: ExprId,
    target: ExprId,
    value: Option<ExprId>,
}

enum Step<B, M> {
    Expression(FileId, ExprId),
    Symbol(Sym),
    Linked(LinkedBinding<B, M>),
    Found(StaticReferent<B, M>),
}

type StepOf<'s, C> = Step<<C as ReferentContext<'s>>::Builtin, <C as ReferentContext<'s>>::Module>;

fn unknown<B, M>(reason: UnknownReferent) -> Step<B, M> {
    Step::Found(StaticReferent::Unknown(reason))
}

fn find_only_returned_value(hir: &File<'_>, bound: &Bound<'_>, function: FnId) -> Option<ExprId> {
    if hir[function]
        .flags
        .intersects(Flags::ASYNC | Flags::GENERATOR)
    {
        return None;
    }
    let mut returns = bound.ids(bound.fns[function.idx()].returns);
    let (Some(statement), None) = (returns.next(), returns.next()) else {
        return None;
    };
    match hir[statement].kind {
        StmtKind::Return(value)
            if value.is_some() && bound.parent_of_stmt(statement) == Parent::FnBody(function) =>
        {
            Some(value)
        }
        _ => None,
    }
}

fn find_argument_of_only_call(hir: &File<'_>, bound: &Bound<'_>, id: SymbolId) -> Option<ExprId> {
    let &[Decl::Param(pattern)] = bound.symbol(id).decls else {
        return None;
    };
    let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    let written = &hir[parameter];
    let is_plain_name = matches!(hir[pattern].kind, PatKind::Ident(_))
        && written.default.is_none()
        && !written.flags.contains(Flags::REST);
    let function = bound.param_fn[parameter.idx()];
    if !is_plain_name || function == FnId::NONE {
        return None;
    }
    let call = bound.get_immediately_invoked_function_expression(hir, function)?;
    if bound.finds_itself(hir, function) {
        return None;
    }
    let index = hir[function].params.iter().position(|it| it == parameter)?;
    let mut arguments = hir.ids(hir[call].args).take(index + 1);
    if arguments
        .clone()
        .any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
    {
        return None;
    }
    arguments.nth(index)
}

fn reads_module_exports(hir: &File<'_>, bound: &Bound<'_>, expr: ExprId) -> bool {
    match hir.member_key(expr) {
        Some((object, MemberKey::Name(name))) => {
            name == known::exports
                && is_free_common_js(hir, bound, object, CommonJsVariable::Module)
        }
        Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) | None => false,
    }
}

fn reads_exports_object(hir: &File<'_>, bound: &Bound<'_>, expr: ExprId) -> bool {
    is_free_common_js(hir, bound, expr, CommonJsVariable::Exports)
        || reads_module_exports(hir, bound, expr)
}

fn find_assignment(hir: &File<'_>, node: ExprId) -> Option<ExportStore> {
    let ExprKind::Assign {
        op: None,
        target,
        value,
    } = hir[node].kind
    else {
        return None;
    };
    Some(ExportStore {
        node,
        target,
        value: Some(value),
    })
}

type FindExportStore = fn(&File<'_>, &Bound<'_>, Decl) -> Option<ExportStore>;

fn find_store_of_whole(
    hir: &File<'_>,
    bound: &Bound<'_>,
    declaration: Decl,
) -> Option<ExportStore> {
    let Decl::ModuleExports(node) = declaration else {
        return None;
    };
    find_assignment(hir, node).filter(|store| reads_module_exports(hir, bound, store.target))
}

fn find_store_of_property(
    hir: &File<'_>,
    bound: &Bound<'_>,
    declaration: Decl,
) -> Option<ExportStore> {
    let Decl::ExportsProperty(node) = declaration else {
        return None;
    };
    if let ExprKind::Call(call) = hir[node].kind {
        let object = hir.ids(hir[call].args).next()?;
        let definition = ExportStore {
            node,
            target: node,
            value: None,
        };
        return reads_exports_object(hir, bound, object).then_some(definition);
    }
    let store = find_assignment(hir, node)?;
    let (object, _) = hir.member_key(store.target)?;
    reads_exports_object(hir, bound, object).then_some(store)
}

fn find_statement_around(bound: &Bound<'_>, parent: Parent) -> Option<StmtId> {
    match parent {
        Parent::Stmt(statement) => statement.some(),
        Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()].some(),
        Parent::Case(case) => bound.case_stmt[case.idx()].some(),
        _ => None,
    }
}

fn is_evaluated_by_file_body(hir: &File<'_>, bound: &Bound<'_>, mut expr: ExprId) -> bool {
    let mut parent = bound.parent_of_expr(expr);
    while let Parent::Expr(outer) = parent {
        let is_assigned_value = matches!(
            hir.exprs.get(outer.idx()).map(|node| node.kind),
            Some(ExprKind::Assign { op: None, value, .. }) if value == expr
        );
        if !is_assigned_value {
            return false;
        }
        expr = outer;
        parent = bound.parent_of_expr(expr);
    }
    find_statement_around(bound, parent).is_some_and(|statement| {
        matches!(hir[statement].kind, StmtKind::Expr(_) | StmtKind::Var(_))
            && bound.parent_of_stmt(statement) == Parent::File
    })
}

fn is_in_catch_clause(hir: &File<'_>, bound: &Bound<'_>, expr: ExprId) -> bool {
    let mut parent = bound.parent_of_expr(expr);
    while let Parent::Expr(outer) = parent {
        parent = bound.parent_of_expr(outer);
    }
    let mut statement = find_statement_around(bound, parent);
    while let Some(inner) = statement {
        statement = find_statement_around(bound, bound.parent_of_stmt(inner));
        let is_handler = statement.is_some_and(
            |outer| matches!(hir[outer].kind, StmtKind::Try { handler, .. } if handler == inner),
        );
        if is_handler {
            return true;
        }
    }
    false
}

fn find_deciding_store(
    hir: &File<'_>,
    bound: &Bound<'_>,
    stores: &[ExportStore],
) -> Result<ExportStore, UnknownReferent> {
    let Some(&last) = stores.iter().max_by_key(|store| hir[store.node].pos) else {
        return Err(UnknownReferent::MissingMember);
    };
    if is_evaluated_by_file_body(hir, bound, last.node) {
        return Ok(last);
    }
    let mut usual_stores = stores
        .iter()
        .filter(|store| !is_in_catch_clause(hir, bound, store.node));
    match (usual_stores.next(), usual_stores.next()) {
        (Some(&only), None) => Ok(only),
        (None, _) if stores.len() == 1 => Ok(last),
        (Some(_), Some(_)) | (None, _) => {
            let unstable = BindingStability::NotInitializedOnce;
            Err(UnknownReferent::UnstableBinding(unstable))
        }
    }
}

pub(super) struct ReferentWalk<'c, 's, C: ReferentContext<'s>> {
    context: &'c C,
    visited: SmallVec<[Sym; 8]>,
    pending_members: SmallVec<[Atom; 4]>,
    certainty: ReferentCertainty,
    follows_stored_members: bool,
    session: PhantomData<&'s ()>,
}

impl<'c, 's, C: ReferentContext<'s>> ReferentWalk<'c, 's, C> {
    pub(super) fn new(context: &'c C) -> Self {
        ReferentWalk {
            context,
            visited: SmallVec::new(),
            pending_members: SmallVec::new(),
            certainty: ReferentCertainty::Proven,
            follows_stored_members: false,
            session: PhantomData,
        }
    }

    pub(super) fn resolve_export(
        mut self,
        file: FileId,
        name: Atom,
        member: Option<Atom>,
    ) -> ResolvedReferent<C::Builtin, C::Module> {
        self.follows_stored_members = true;
        self.pending_members.extend(member);
        let step = self.step_export(file, name);
        self.run(step)
    }

    pub(super) fn resolve_expression(
        self,
        file: FileId,
        expr: ExprId,
    ) -> ResolvedReferent<C::Builtin, C::Module> {
        self.run(Step::Expression(file, expr))
    }

    // The expression whose value the name has for as long as the program runs: the initializer of a binding that nothing stores to, through imports and other such names.
    pub(super) fn resolve_initializer(
        mut self,
        mut file: FileId,
        mut expr: ExprId,
    ) -> Option<StaticInitializer> {
        let mut holder = None;
        loop {
            let hir = self.context.hir(file);
            expr = hir.skip_type_assertions(expr);
            if !matches!(hir[expr].kind, ExprKind::Ident(_)) {
                return Some(StaticInitializer { file, expr, holder });
            }
            let mut step = self.step_identifier(file, expr);
            (file, expr) = loop {
                step = match step {
                    Step::Symbol(symbol) => {
                        holder = Some(symbol);
                        self.step_symbol(symbol)
                    }
                    Step::Linked(LinkedBinding::Binding(symbol)) => Step::Symbol(symbol),
                    Step::Expression(file, expr) => break (file, expr),
                    Step::Linked(_) | Step::Found(_) => return None,
                };
            };
            if !self.pending_members.is_empty() || self.certainty != ReferentCertainty::Proven {
                return None;
            }
        }
    }

    pub(super) fn resolve_symbol(self, symbol: Sym) -> ResolvedReferent<C::Builtin, C::Module> {
        self.run(Step::Symbol(symbol))
    }

    fn run(mut self, mut step: StepOf<'s, C>) -> ResolvedReferent<C::Builtin, C::Module> {
        loop {
            step = match step {
                Step::Expression(file, expr) => self.step_expression(file, expr),
                Step::Symbol(symbol) => self.step_symbol(symbol),
                Step::Linked(LinkedBinding::Binding(symbol)) => Step::Symbol(symbol),
                Step::Linked(LinkedBinding::Namespace(module)) => {
                    Step::Found(StaticReferent::Namespace(NamespaceReferent::Module(module)))
                }
                Step::Linked(LinkedBinding::Builtin(builtin)) => {
                    Step::Found(StaticReferent::Builtin(builtin))
                }
                Step::Linked(LinkedBinding::Unknown) => unknown(UnknownReferent::UnlinkedImport),
                Step::Found(referent) => match self.pending_members.pop() {
                    Some(name) => self.step_member(referent, name),
                    None => {
                        return ResolvedReferent {
                            referent,
                            certainty: self.certainty,
                        };
                    }
                },
            };
        }
    }

    fn visit(&mut self, symbol: Sym) -> bool {
        let is_first_visit = !self.visited.contains(&symbol);
        if is_first_visit {
            self.visited.push(symbol);
        }
        is_first_visit
    }

    fn step_expression(&mut self, file: FileId, expr: ExprId) -> StepOf<'s, C> {
        let context = self.context;
        let hir = context.hir(file);
        let expr = hir.skip_type_assertions(expr);
        if let Some(builtin) = context.builtin_of_expression(file, expr) {
            return Step::Found(StaticReferent::Builtin(builtin));
        }
        match hir[expr].kind {
            ExprKind::Ident(_) => self.step_identifier(file, expr),
            ExprKind::Class(class) => self.class_step(file, class),
            ExprKind::Fn(function) => {
                Step::Found(StaticReferent::Function(FunctionRef { file, function }))
            }
            ExprKind::Dot {
                chain: Chain::No, ..
            }
            | ExprKind::Index {
                chain: Chain::No, ..
            } => match hir.member_key(expr) {
                Some((object, MemberKey::Name(name))) => {
                    self.pending_members.push(name);
                    Step::Expression(file, object)
                }
                Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) | None => {
                    unknown(UnknownReferent::NotAReference)
                }
            },
            ExprKind::Assign {
                op: None, value, ..
            } => Step::Expression(file, value),
            ExprKind::Object(properties) => self.step_object_literal(file, properties),
            ExprKind::Call(site) => match context.loaded_value(file, expr) {
                Some(loaded) => self.step_loaded_value(loaded),
                None => match hir[hir.skip_type_assertions(hir[site].callee)].kind {
                    ExprKind::Fn(function) => {
                        match find_only_returned_value(hir, context.bound(file), function) {
                            Some(value) => Step::Expression(file, value),
                            None => unknown(UnknownReferent::NotAReference),
                        }
                    }
                    _ => unknown(UnknownReferent::NotAReference),
                },
            },
            _ => unknown(UnknownReferent::NotAReference),
        }
    }

    fn step_identifier(&self, file: FileId, ident: ExprId) -> StepOf<'s, C> {
        let bound = self.context.bound(file);
        if !bound.runtime.is_computed() {
            return unknown(UnknownReferent::NotCompiled);
        }
        if bound.dynamic_lookup_scope(NodeData::Expr(ident)).is_some() {
            return unknown(UnknownReferent::DynamicScope);
        }
        self.binding_step(file, bound.binding(ident))
    }

    fn binding_step(&self, file: FileId, binding: Binding) -> StepOf<'s, C> {
        match binding {
            Binding::Symbol(id) => Step::Symbol(Sym { file, id }),
            Binding::Arguments(_) | Binding::CommonJs(_) => unknown(UnknownReferent::NotAReference),
            Binding::Free => unknown(UnknownReferent::FreeName),
        }
    }

    fn class_step(&self, file: FileId, class: ClassId) -> StepOf<'s, C> {
        let hir = self.context.hir(file);
        if has_decorators(hir, hir[class].modifiers) {
            return unknown(UnknownReferent::DecoratedClass);
        }
        Step::Found(StaticReferent::Class(ClassRef { file, class }))
    }

    fn step_object_literal(&mut self, file: FileId, properties: Span<PropId>) -> StepOf<'s, C> {
        let Some(name) = self.pending_members.pop() else {
            return unknown(UnknownReferent::NotAReference);
        };
        if name == known::__proto__ {
            return unknown(UnknownReferent::MemberOfValue);
        }
        let context = self.context;
        let hir = context.hir(file);
        let mut value = None;
        for property in properties.iter() {
            let holds_value = match hir[property].kind {
                PropKind::Init | PropKind::Shorthand | PropKind::Method => true,
                PropKind::Getter | PropKind::Setter | PropKind::Spread => false,
            };
            match hir.runtime_property_key(property) {
                PropKey::Name(key) if key != name => {}
                PropKey::Private(_) => {}
                PropKey::Name(_) if holds_value => value = Some(hir[property].value),
                PropKey::Name(_) | PropKey::None | PropKey::Computed(_) => value = None,
            }
        }
        self.certainty = ReferentCertainty::Expected;
        match value {
            Some(value) => Step::Expression(file, value),
            None => unknown(UnknownReferent::MissingMember),
        }
    }

    fn step_loaded_value(&mut self, loaded: LoadedValue<C::Module>) -> StepOf<'s, C> {
        self.certainty = ReferentCertainty::Expected;
        match loaded {
            LoadedValue::Namespace(module) => Step::Linked(LinkedBinding::Namespace(module)),
            LoadedValue::DefaultExport(file) => self.step_default_export(file),
            LoadedValue::ModuleExports(file) => self.step_module_exports(file),
        }
    }

    fn step_default_export(&mut self, file: FileId) -> StepOf<'s, C> {
        let bound = self.context.bound(file);
        let exports = bound.symbol(bound.file_symbol).exports;
        if !bound.runtime.is_computed() || bound.lookup(exports, known::default).is_some() {
            return self.step_export(file, known::default);
        }
        let listed = self
            .pending_members
            .last()
            .and_then(|&name| bound.lookup(exports, name));
        match listed.map(|member| bound.symbol(member).decls) {
            Some(&[Decl::ExportSpec(specifier)]) => {
                self.pending_members.pop();
                self.binding_step(file, bound.exported_binding(specifier))
            }
            Some(_) | None => unknown(UnknownReferent::MissingMember),
        }
    }

    fn step_export(&self, file: FileId, name: Atom) -> StepOf<'s, C> {
        let bound = self.context.bound(file);
        if !bound.runtime.is_computed() {
            return unknown(UnknownReferent::NotCompiled);
        }
        match bound.lookup(bound.symbol(bound.file_symbol).exports, name) {
            Some(id) => Step::Symbol(Sym { file, id }),
            None => unknown(UnknownReferent::MissingMember),
        }
    }

    fn live_export_stores(
        &self,
        exported: Sym,
        find_store: FindExportStore,
    ) -> SmallVec<[ExportStore; 4]> {
        let Sym { file, id } = exported;
        let context = self.context;
        let (hir, bound) = (context.hir(file), context.bound(file));
        let declarations = bound.symbol(id).decls.iter();
        declarations
            .filter_map(|&declaration| find_store(hir, bound, declaration))
            .filter(|store| !context.is_dead_store(file, store.target))
            .collect()
    }

    fn step_module_exports(&mut self, file: FileId) -> StepOf<'s, C> {
        let context = self.context;
        let bound = context.bound(file);
        if !bound.runtime.is_computed() {
            return unknown(UnknownReferent::NotCompiled);
        }
        let exports = bound.symbol(bound.file_symbol).exports;
        let next_member = self.pending_members.last().copied();
        if let Some(id) = next_member.and_then(|name| bound.lookup(exports, name)) {
            let property = Sym { file, id };
            let stores = self.live_export_stores(property, find_store_of_property);
            if !stores.is_empty() {
                self.pending_members.pop();
                return self.step_export_stores(property, &stores);
            }
        }
        match bound.lookup(exports, known::export_equals) {
            Some(id) => {
                let whole = Sym { file, id };
                let stores = self.live_export_stores(whole, find_store_of_whole);
                self.step_export_stores(whole, &stores)
            }
            None if next_member.is_none() => unknown(UnknownReferent::NotAReference),
            None => unknown(UnknownReferent::MissingMember),
        }
    }

    fn step_export_stores(&mut self, exported: Sym, stores: &[ExportStore]) -> StepOf<'s, C> {
        if !self.visit(exported) {
            return unknown(UnknownReferent::Cycle);
        }
        let file = exported.file;
        let context = self.context;
        let (hir, bound) = (context.hir(file), context.bound(file));
        match find_deciding_store(hir, bound, stores).map(|store| store.value) {
            Ok(Some(value)) => Step::Expression(file, value),
            Ok(None) => unknown(UnknownReferent::OpaqueInitializer),
            Err(reason) => unknown(reason),
        }
    }

    fn step_symbol(&mut self, symbol: Sym) -> StepOf<'s, C> {
        if !self.visit(symbol) {
            return unknown(UnknownReferent::Cycle);
        }
        let Sym { file, id } = symbol;
        let context = self.context;
        let (hir, bound) = (context.hir(file), context.bound(file));
        if !bound.runtime.is_computed() {
            return unknown(UnknownReferent::NotCompiled);
        }
        let is_dead_store = |target: ExprId| context.is_dead_store(file, target);
        match bound.binding_stability_ignoring(id, &is_dead_store) {
            BindingStability::Stable => {}
            BindingStability::Linked => return Step::Linked(context.linked_binding(file, id)),
            unstable @ (BindingStability::NoBinding
            | BindingStability::Stored
            | BindingStability::NotInitializedOnce
            | BindingStability::VisibleToEval
            | BindingStability::MappedArgument
            | BindingStability::ContainerMember) => {
                return unknown(UnknownReferent::UnstableBinding(unstable));
            }
        }
        if bound.initial_state(id) == InitialState::Undefined {
            self.certainty = ReferentCertainty::Expected;
        }
        match bound.binding_initializer(hir, id) {
            BindingInitializer::Class(class) => self.class_step(file, class),
            BindingInitializer::Function(function) => {
                Step::Found(StaticReferent::Function(FunctionRef { file, function }))
            }
            BindingInitializer::Namespace(_) | BindingInitializer::Enum(_) => {
                let id = bound.export_symbol_of_value_symbol_if_exported(id);
                let container = NamespaceReferent::Declared(Sym { file, id });
                Step::Found(StaticReferent::Namespace(container))
            }
            BindingInitializer::Expression(value) => Step::Expression(file, value),
            BindingInitializer::PatternProperty { source, path } => {
                self.pending_members.extend(path.iter().rev().copied());
                Step::Expression(file, source)
            }
            BindingInitializer::EntityName(import) => self.step_entity_name(file, import),
            BindingInitializer::Import => Step::Linked(context.linked_binding(file, id)),
            BindingInitializer::Opaque if bound.binding_kind(id) == BindingKind::Parameter => {
                match find_argument_of_only_call(hir, bound, id) {
                    Some(argument) => Step::Expression(file, argument),
                    None => unknown(UnknownReferent::OpaqueInitializer),
                }
            }
            BindingInitializer::Opaque => unknown(UnknownReferent::OpaqueInitializer),
        }
    }

    fn step_entity_name(&mut self, file: FileId, import: ImportEqualsId) -> StepOf<'s, C> {
        let context = self.context;
        let (hir, bound) = (context.hir(file), context.bound(file));
        let ImportEqualsTarget::Entity(names) = hir[import].target else {
            return unknown(UnknownReferent::OpaqueInitializer);
        };
        self.pending_members.extend(hir.texts(names).skip(1).rev());
        self.binding_step(file, bound.entity_root_binding(import))
    }

    fn step_member(
        &mut self,
        referent: StaticReferent<C::Builtin, C::Module>,
        name: Atom,
    ) -> StepOf<'s, C> {
        match referent {
            StaticReferent::Namespace(NamespaceReferent::Module(module)) => {
                Step::Linked(self.context.module_export(module, name))
            }
            StaticReferent::Namespace(NamespaceReferent::Declared(container)) => {
                self.step_declared_member(container, name)
            }
            StaticReferent::Builtin(holder) => match self.context.builtin_member(holder, name) {
                Some(member) => {
                    self.certainty = ReferentCertainty::Expected;
                    Step::Found(StaticReferent::Builtin(member))
                }
                None => unknown(UnknownReferent::MemberOfValue),
            },
            StaticReferent::Class(_) | StaticReferent::Function(_) => {
                match self.follows_stored_members {
                    true => self.step_stored_member(name),
                    false => unknown(UnknownReferent::MemberOfValue),
                }
            }
            StaticReferent::Unknown(reason) => unknown(reason),
        }
    }

    fn step_stored_member(&mut self, name: Atom) -> StepOf<'s, C> {
        let mut stored = None;
        for &holder in &self.visited {
            for value in self.values_stored_in_member(holder, name) {
                if stored.replace((holder.file, value)).is_some() {
                    let unstable = BindingStability::NotInitializedOnce;
                    return unknown(UnknownReferent::UnstableBinding(unstable));
                }
            }
        }
        self.certainty = ReferentCertainty::Expected;
        self.visited.clear();
        match stored {
            Some((file, value)) => Step::Expression(file, value),
            None => unknown(UnknownReferent::MissingMember),
        }
    }

    fn values_stored_in_member(&self, holder: Sym, name: Atom) -> SmallVec<[ExprId; 2]> {
        let context = self.context;
        let file = holder.file;
        let (hir, bound) = (context.hir(file), context.bound(file));
        let names_holder = |expr: ExprId| {
            let expr = hir.skip_type_assertions(expr);
            matches!(hir[expr].kind, ExprKind::Ident(_))
                && bound.binding(expr) == Binding::Symbol(holder.id)
        };
        let mut values = SmallVec::new();
        for node in (0..hir.exprs.len() as u32).map(ExprId) {
            let value = match hir[node].kind {
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } => match hir.member_key(target) {
                    Some((object, MemberKey::Name(key))) if key == name && names_holder(object) => {
                        (!context.is_dead_store(file, target)).then_some(value)
                    }
                    _ => None,
                },
                ExprKind::Call(call) => self.find_copied_property(file, call, name, &names_holder),
                _ => None,
            };
            if let Some(value) = value
                && is_evaluated_by_file_body(hir, bound, node)
            {
                values.push(value);
            }
        }
        values
    }

    fn find_copied_property(
        &self,
        file: FileId,
        call: CallId,
        name: Atom,
        names_holder: &dyn Fn(ExprId) -> bool,
    ) -> Option<ExprId> {
        let context = self.context;
        let hir = context.hir(file);
        let callee = hir.skip_type_assertions(hir[call].callee);
        let builtin = context.builtin_of_expression(file, callee)?;
        let target = context.find_target_of_copied_properties(builtin)? as usize;
        let mut arguments = hir.ids(hir[call].args).skip(target);
        if !names_holder(arguments.next()?) {
            return None;
        }
        let mut value = None;
        for source in arguments {
            let ExprKind::Object(properties) = hir[hir.skip_type_assertions(source)].kind else {
                continue;
            };
            for property in properties.iter() {
                let holds_value = matches!(
                    hir[property].kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                );
                if holds_value && hir.runtime_property_key(property) == PropKey::Name(name) {
                    value = Some(hir[property].value);
                }
            }
        }
        value
    }

    fn step_declared_member(&mut self, container: Sym, name: Atom) -> StepOf<'s, C> {
        let file = container.file;
        let context = self.context;
        let (hir, bound) = (context.hir(file), context.bound(file));
        let Some(member) = bound.lookup(bound.symbol(container.id).exports, name) else {
            return unknown(UnknownReferent::MissingMember);
        };
        self.certainty = ReferentCertainty::Expected;
        let mut value = None;
        let mut has_container = false;
        for &decl in bound.symbol(member).decls {
            if bound.modifier_flags(hir, decl).contains(Flags::AMBIENT) {
                continue;
            }
            match decl {
                Decl::Fn(function) if has_body(&hir[function]) => {
                    value = value.or(Some(DeclaredValue::Function(function)));
                }
                Decl::Class(class) => value = value.or(Some(DeclaredValue::Class(class))),
                Decl::Module(_) | Decl::Enum(_) => has_container = true,
                Decl::Fn(_) | Decl::Interface(_) | Decl::Alias(_) => {}
                _ => {
                    let unstable = BindingStability::ContainerMember;
                    return unknown(UnknownReferent::UnstableBinding(unstable));
                }
            }
        }
        match value {
            Some(DeclaredValue::Function(function)) => {
                Step::Found(StaticReferent::Function(FunctionRef { file, function }))
            }
            Some(DeclaredValue::Class(class)) => self.class_step(file, class),
            None if has_container => {
                let container = NamespaceReferent::Declared(Sym { file, id: member });
                Step::Found(StaticReferent::Namespace(container))
            }
            None => unknown(UnknownReferent::MissingMember),
        }
    }
}
