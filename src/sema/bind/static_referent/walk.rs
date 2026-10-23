use super::{
    LinkedBinding, LoadedValue, NamespaceReferent, ReferentCertainty, ReferentContext,
    ResolvedReferent, StaticReferent, UnknownReferent,
};
use crate::atom::{Atom, known};
use crate::bind::decorator_metadata::has_decorators;
use crate::bind::{
    Binding, BindingInitializer, BindingStability, Bound, CommonJsVariable, Decl, InitialState,
    Parent,
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

// A store of a CommonJS module into `module.exports` or into a property of its exports object.
#[derive(Copy, Clone)]
struct ExportStore {
    node: ExprId,
    target: ExprId,
    // `None`: a call defines the property.
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

// The binder declares an export wherever the text reads `module.exports` or `exports`.
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

// `None`: an expression, a function, a class, a pattern or an object literal lies between.
fn find_statement_around(bound: &Bound<'_>, parent: Parent) -> Option<StmtId> {
    match parent {
        Parent::Stmt(statement) => statement.some(),
        Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()].some(),
        Parent::Case(case) => bound.case_stmt[case.idx()].some(),
        Parent::None
        | Parent::File
        | Parent::Expr(_)
        | Parent::ParamDefault(_)
        | Parent::PatPropDefault(_)
        | Parent::PatElemDefault(_)
        | Parent::Prop(_)
        | Parent::PropKey(_)
        | Parent::PatKey(_)
        | Parent::MemberKey(_)
        | Parent::MethodKey(_)
        | Parent::MemberInit(_)
        | Parent::FnBody(_)
        | Parent::EnumInit(_)
        | Parent::ClassExtends(_)
        | Parent::ClassDecorator(_)
        | Parent::MemberDecorator(_)
        | Parent::ParamDecorator(_)
        | Parent::Module(_) => None,
    }
}

// The expression is a statement of the body of the file, the initializer of a variable declared there, or the value that such an expression assigns.
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

// The store that is expected to give the value that another module finds.
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
    // It reads the whole text of each file on the way.
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

    // `false`: the walk has been there.
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
            ExprKind::Call(_) => match context.loaded_value(file, expr) {
                Some(loaded) => self.step_loaded_value(loaded),
                None => unknown(UnknownReferent::NotAReference),
            },
            ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Missing
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::Template { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Array(_)
            | ExprKind::New(_)
            | ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Jsx(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_)
            | ExprKind::JsxText(_) => unknown(UnknownReferent::NotAReference),
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
        // The object may have changed since the literal created it.
        self.certainty = ReferentCertainty::Expected;
        match value {
            Some(value) => Step::Expression(file, value),
            None => unknown(UnknownReferent::MissingMember),
        }
    }

    fn step_loaded_value(&mut self, loaded: LoadedValue<C::Module>) -> StepOf<'s, C> {
        // Only the namespace object of an ES module is out of the reach of stores.
        self.certainty = ReferentCertainty::Expected;
        match loaded {
            LoadedValue::Namespace(module) => Step::Linked(LinkedBinding::Namespace(module)),
            LoadedValue::DefaultExport(file) => self.step_default_export(file),
            LoadedValue::ModuleExports(file) => self.step_module_exports(file),
        }
    }

    // A module that lists its exports and has no default one is loaded as an object with those names.
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

    // A store into a property of the exports object counts also where another store replaces the object.
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

    // `f.name = value` and `Object.assign(f, { name: value })` in the body of a file, where `f` is one of the bindings that led to the function or the class.
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
        // The walk goes on with another value, which may be the same one: `f.f = f`.
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
                Decl::Var(_)
                | Decl::Param(_)
                | Decl::EnumMember(_)
                | Decl::TypeParam(_)
                | Decl::ImportDefault(_)
                | Decl::ImportNamespace(_)
                | Decl::ImportSpec(_)
                | Decl::ImportEquals(_)
                | Decl::ExportSpec(_)
                | Decl::ExportStarAs(_)
                | Decl::ExportExpr(_)
                | Decl::UmdGlobal(_)
                | Decl::File
                | Decl::Require(_)
                | Decl::ModuleExports(_)
                | Decl::ExportsProperty(_)
                | Decl::Expando(_)
                | Decl::ObjectLiteral(_)
                | Decl::CommonJsVariable
                | Decl::Member(_)
                | Decl::ParameterProperty(_)
                | Decl::ThisProperty(_)
                | Decl::Property(_)
                | Decl::TypeLiteral(_) => {
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
