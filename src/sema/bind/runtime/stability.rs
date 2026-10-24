use super::bits::has_bit;
use super::declaration_kinds::pattern_root;
use super::queries::{find_entry, find_symbol};
use super::references::is_loop_head;
use super::{
    Binding, BindingInitializer, BindingKind, BindingStability, CodeUnit, FunctionFlags,
    RuntimeInput, has_mapped_arguments,
};
use crate::atom::Atom;
use crate::bind::{
    Bound, BoundBuilder, ClassOwner, Decl, FnOwner, ModuleInstanceState, Parent, PatParent,
    ScopeKind, SymbolId,
};
use crate::hir::*;
use smallvec::SmallVec;

#[derive(Copy, Clone)]
enum Initializers {
    None,
    One(Decl),
    Several,
}

struct StabilityPass<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a BoundBuilder,
    initializers: Vec<Initializers>,
}

pub(super) fn compute_stability(input: &mut RuntimeInput<'_, '_>) {
    let mut pass = StabilityPass {
        hir: input.hir,
        bound: &*input.bound,
        initializers: vec![Initializers::None; input.bound.symbols.len()],
    };
    pass.add_patterns();
    pass.add_functions();
    pass.add_classes();
    pass.add_containers();
    pass.add_expressions();
    let symbols = (0..pass.initializers.len() as u32).map(SymbolId);
    let stabilities = symbols.map(|symbol| pass.classify(symbol)).collect();
    let initializers = pass.initializers.iter().map(|recorded| match *recorded {
        Initializers::One(decl) => Some(decl),
        Initializers::None | Initializers::Several => None,
    });
    let initializers = initializers.collect();
    let stability = &mut input.bound.runtime.stability;
    stability.stabilities = stabilities;
    stability.initializers = initializers;
    let has_mapped_argument = stability
        .stabilities
        .contains(&BindingStability::MappedArgument);
    input.bound.runtime.depends_on_sloppy_mode |= has_mapped_argument;
}

fn is_repeated(hir: &File<'_>, bound: &BoundBuilder, statement: StmtId) -> bool {
    let mut child = statement;
    loop {
        let parent = match bound.parent_of_stmt(child) {
            Parent::Stmt(parent) if parent.is_some() => parent,
            Parent::FnBody(_) | Parent::File | Parent::Module(_) => return false,
            _ => return true,
        };
        match hir[parent].kind {
            StmtKind::For { init, .. } if init != child => return true,
            StmtKind::For { .. }
            | StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Expr(_)
            | StmtKind::Var(_)
            | StmtKind::Fn(_)
            | StmtKind::Class(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::Return(_)
            | StmtKind::If { .. }
            | StmtKind::Block(_)
            | StmtKind::Switch { .. }
            | StmtKind::Try { .. }
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Labeled { .. }
            | StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::With { .. }
            | StmtKind::Directive { .. } => {}
            _ => return true,
        }
        child = parent;
    }
}

impl StabilityPass<'_, '_> {
    fn add(&mut self, symbol: SymbolId, decl: Decl) {
        if let Some(recorded) = self.initializers.get_mut(symbol.idx()) {
            *recorded = match *recorded {
                Initializers::None => Initializers::One(decl),
                Initializers::One(_) | Initializers::Several => Initializers::Several,
            };
        }
    }

    fn add_repeated(&mut self, symbol: SymbolId) {
        if let Some(recorded) = self.initializers.get_mut(symbol.idx()) {
            *recorded = Initializers::Several;
        }
    }

    fn add_container(&mut self, symbol: SymbolId, decl: Decl) {
        let bound = self.bound;
        if let Some(recorded) = self.initializers.get_mut(symbol.idx()) {
            *recorded = match *recorded {
                Initializers::None => Initializers::One(decl),
                Initializers::One(merged)
                    if bound.symbols[symbol.idx()].decls.contains(&merged) =>
                {
                    Initializers::One(merged)
                }
                Initializers::One(_) | Initializers::Several => Initializers::Several,
            };
        }
    }

    fn add_declared(&mut self, decl: Decl) {
        if let Some(symbol) = self.bound.declared_binding_symbol(decl) {
            self.add(symbol, decl);
        }
    }

    fn add_patterns(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for (index, pattern) in hir.pats.iter().enumerate() {
            if !matches!(pattern.kind, PatKind::Ident(_)) {
                continue;
            }
            let name = PatId(index as u32);
            match pattern_root(bound, name) {
                PatParent::Param(_) => self.add_declared(Decl::Param(name)),
                PatParent::Var(declaration) => self.add_variable(name, declaration),
                PatParent::None | PatParent::Prop(..) | PatParent::Elem(..) => {}
            }
        }
    }

    fn add_variable(&mut self, name: PatId, declaration: VarDeclId) {
        let (hir, bound) = (self.hir, self.bound);
        let Some(statement) = bound.var_stmt[declaration.idx()].some() else {
            return;
        };
        let is_var = bound.variable_kind(hir, declaration) == VarKind::Var;
        let is_head = is_loop_head(hir, bound.parent_of_stmt(statement), statement);
        if is_var && hir[declaration].init.is_none() && !is_head {
            return;
        }
        let Binding::Symbol(symbol) = bound.initialized_pattern_binding(name) else {
            return;
        };
        let decl = match bound.required_by(hir, name) {
            Some(_) => Decl::Require(name),
            None => Decl::Var(name),
        };
        self.add(symbol, decl);
        if is_var && (is_head || is_repeated(hir, bound, statement)) {
            self.add_repeated(symbol);
        }
    }

    fn add_functions(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for (index, function) in hir.fns.iter().enumerate() {
            let creates_binding = matches!(function.kind, FnKind::Decl | FnKind::Expr)
                && has_body(function)
                && !function.flags.contains(Flags::AMBIENT)
                && bound.fns[index].owner != FnOwner::None;
            if creates_binding {
                self.add_declared(Decl::Fn(FnId(index as u32)));
            }
        }
        for hoisted in bound.runtime.declarations.annex_b_functions.iter() {
            self.add(hoisted.var_symbol, Decl::Fn(hoisted.function));
            let is_evaluated_once = match bound.fns[hoisted.function.idx()].owner {
                FnOwner::Stmt(statement) => !is_repeated(hir, bound, statement),
                FnOwner::None | FnOwner::Expr(_) | FnOwner::Member(_) | FnOwner::Type(_) => false,
            };
            if !is_evaluated_once {
                self.add_repeated(hoisted.var_symbol);
            }
        }
        for copy in bound.runtime.declarations.parameter_var_copies.iter() {
            if let Some(&decl) = bound.symbols[copy.variable.idx()].decls.first() {
                self.add(copy.variable, decl);
            }
        }
    }

    fn add_classes(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for (index, class) in hir.classes.iter().enumerate() {
            if bound.class_scope[index].is_none() || class.flags.contains(Flags::AMBIENT) {
                continue;
            }
            let id = ClassId(index as u32);
            match bound.class_owner[index] {
                ClassOwner::Stmt(_) => self.add_declared(Decl::Class(id)),
                ClassOwner::Expr(_) => {}
            }
            let inner_symbols = &bound.runtime.declarations.inner_class_symbols;
            if let Some(inner) = find_symbol(inner_symbols, id) {
                self.add(inner, Decl::Class(id));
            }
        }
    }

    fn add_containers(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for (index, declaration) in hir.enums.iter().enumerate() {
            let decl = Decl::Enum(EnumId(index as u32));
            if !declaration.flags.contains(Flags::AMBIENT)
                && let Some(symbol) = bound.declared_binding_symbol(decl)
            {
                self.add_container(symbol, decl);
            }
        }
        for (index, declaration) in hir.modules.iter().enumerate() {
            let decl = Decl::Module(ModuleId(index as u32));
            let is_instantiated =
                bound.module_instance_state[index] != ModuleInstanceState::NonInstantiated;
            if is_instantiated
                && !declaration.flags.contains(Flags::AMBIENT)
                && let Some(symbol) = bound.declared_binding_symbol(decl)
            {
                self.add_container(symbol, decl);
            }
        }
    }

    fn add_expressions(&mut self) {
        let declarations = &self.bound.runtime.declarations;
        for &(decl, symbol) in declarations.declared_symbols.iter() {
            if matches!(decl, Decl::ExportExpr(_)) {
                self.add(symbol, decl);
            }
        }
        for (index, &symbol) in declarations.import_equals_symbols.iter().enumerate() {
            self.add(symbol, Decl::ImportEquals(ImportEqualsId(index as u32)));
        }
    }

    fn is_mapped_argument(&self, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let scope = bound.scopes.get(bound.symbol_scope(symbol).idx());
        let Some(ScopeKind::Fn(function)) = scope.map(|scope| scope.kind) else {
            return false;
        };
        let flags = bound.function_flags(function);
        flags.contains(FunctionFlags::USES_ARGUMENTS)
            && has_mapped_arguments(hir, CodeUnit::Function(function))
    }

    fn is_mapped_wrapper_parameter(&self, symbol: SymbolId) -> bool {
        let runtime = &self.bound.runtime;
        runtime.file_uses_arguments
            && has_mapped_arguments(self.hir, CodeUnit::File)
            && find_entry(&runtime.references.redeclared_commonjs_variables, symbol).is_some()
    }

    fn classify(&self, symbol: SymbolId) -> BindingStability {
        let bound = self.bound;
        let kind = bound.binding_kind(symbol);
        match kind {
            BindingKind::NoBinding => return BindingStability::NoBinding,
            BindingKind::Import => return BindingStability::Linked,
            BindingKind::TypeScriptContainer
            | BindingKind::Var
            | BindingKind::Let
            | BindingKind::Const
            | BindingKind::SimpleCatchParameter
            | BindingKind::Class
            | BindingKind::ClassInnerName
            | BindingKind::Function
            | BindingKind::FunctionName
            | BindingKind::Parameter => {}
        }
        let container = bound.symbols[symbol.idx()].parent;
        if container.is_some() && container != bound.file_symbol {
            return BindingStability::ContainerMember;
        }
        let eval_visible_symbols = &bound.runtime.references.eval_visible_symbols;
        if !kind.is_immutable() && has_bit(eval_visible_symbols, symbol.idx()) {
            return BindingStability::VisibleToEval;
        }
        if kind == BindingKind::Parameter && self.is_mapped_argument(symbol) {
            return BindingStability::MappedArgument;
        }
        if kind == BindingKind::Var && self.is_mapped_wrapper_parameter(symbol) {
            return BindingStability::MappedArgument;
        }
        let is_hoisted = matches!(kind, BindingKind::Var | BindingKind::TypeScriptContainer);
        match self.initializers[symbol.idx()] {
            Initializers::One(_) => BindingStability::Stable,
            Initializers::None if is_hoisted => BindingStability::Stable,
            Initializers::None | Initializers::Several => BindingStability::NotInitializedOnce,
        }
    }
}

fn find_pattern_initializer(hir: &File<'_>, bound: &Bound<'_>, name: PatId) -> BindingInitializer {
    let mut path: SmallVec<[Atom; 2]> = SmallVec::new();
    let mut pattern = name;
    let declaration = loop {
        match bound.pat_parent[pattern.idx()] {
            PatParent::Var(declaration) => break declaration,
            PatParent::Prop(parent, property) => {
                let PropKey::Name(key) = hir.runtime_binding_key(property) else {
                    return BindingInitializer::Opaque;
                };
                let property = &hir[property];
                if property.is_rest || property.default.is_some() {
                    return BindingInitializer::Opaque;
                }
                path.push(key);
                pattern = parent;
            }
            PatParent::Elem(..) | PatParent::Param(_) | PatParent::None => {
                return BindingInitializer::Opaque;
            }
        }
    };
    let Some(source) = hir[declaration].init.some() else {
        return BindingInitializer::Opaque;
    };
    if path.is_empty() {
        return BindingInitializer::Expression(source);
    }
    path.reverse();
    BindingInitializer::PatternProperty { source, path }
}

pub(super) fn find_binding_initializer(
    hir: &File<'_>,
    bound: &Bound<'_>,
    symbol: SymbolId,
) -> BindingInitializer {
    if bound.binding_kind(symbol) == BindingKind::Import {
        return BindingInitializer::Import;
    }
    let recorded = bound.runtime.stability.initializers.get(symbol.idx());
    let Some(decl) = recorded.copied().flatten() else {
        return BindingInitializer::Opaque;
    };
    match decl {
        Decl::Class(class) => BindingInitializer::Class(class),
        Decl::Fn(function) => BindingInitializer::Function(function),
        Decl::Module(module) => BindingInitializer::Namespace(module),
        Decl::Enum(id) => BindingInitializer::Enum(id),
        Decl::Var(name) | Decl::Require(name) => find_pattern_initializer(hir, bound, name),
        Decl::ExportExpr(statement) => {
            let (StmtKind::ExportDefault(value) | StmtKind::ExportAssign(value)) =
                hir[statement].kind
            else {
                return BindingInitializer::Opaque;
            };
            BindingInitializer::Expression(value)
        }
        Decl::ImportEquals(import) => match hir[import].target {
            ImportEqualsTarget::Entity(_) => BindingInitializer::EntityName(import),
            ImportEqualsTarget::Require(_) => BindingInitializer::Import,
        },
        _ => BindingInitializer::Opaque,
    }
}
