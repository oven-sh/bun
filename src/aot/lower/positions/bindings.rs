use bun_sema::atom::known;
use bun_sema::bind::{Bound, ClassOwner, Decl, InitialState, Parent, PatParent, SymbolId};
use bun_sema::check::aot::{ClassRef, FunctionRef, GaveUp, PositionTypes, declares_type_alone};
use bun_sema::hir::{ClassId, ExprKind, File, Flags, FnBody, PatId, StmtKind, VarDeclId, VarKind};
use bun_sema::program::{FileId, Sym};

use crate::ir::{
    DeclaredType, FunctionKey, LayoutKey, Mapped, PositionFlags, Primitives, TypeTable,
};
use crate::lower::FileLowering;
use crate::lower::function_types::find_explicit_constructor;

fn is_const_written_as_zero(hir: &File<'_>, bound: &Bound<'_>, pattern: PatId) -> bool {
    let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
        return false;
    };
    let written = &hir[declaration];
    written.kind == VarKind::Const
        && written.ty.is_none()
        && written.init.is_some()
        && matches!(hir[written.init].kind, ExprKind::Number(index)
            if hir.numbers[index as usize].to_bits() == 0)
        && !hir.is_ambient(hir.node(declaration))
}

fn is_read_off_a_value(hir: &File<'_>, bound: &Bound<'_>, pattern: PatId) -> bool {
    match bound.pat_parent[pattern.idx()] {
        PatParent::Var(declaration) => {
            let value = hir[declaration].init;
            value.is_some()
                && match hir[value].kind {
                    ExprKind::Dot { name, .. } => name != known::length,
                    ExprKind::Index { .. } => true,
                    _ => false,
                }
        }
        PatParent::Prop(..) | PatParent::Elem(..) => true,
        PatParent::None | PatParent::Param(_) => false,
    }
}

fn is_element_of_a_value(hir: &File<'_>, bound: &Bound<'_>, pattern: PatId) -> bool {
    match bound.pat_parent[pattern.idx()] {
        PatParent::Var(declaration) => {
            matches!(hir[hir[declaration].init].kind, ExprKind::Index { .. })
        }
        PatParent::Elem(..) => true,
        PatParent::None | PatParent::Param(_) | PatParent::Prop(..) => false,
    }
}

fn comes_from_elsewhere(hir: &File<'_>, bound: &Bound<'_>, pattern: PatId) -> bool {
    let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
        return false;
    };
    let mut value = hir[declaration].init;
    if value.is_none() {
        return false;
    }
    loop {
        value = match hir[value].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } => expr,
            ExprKind::AsConst(expr) | ExprKind::NonNull(expr) | ExprKind::Await(expr) => expr,
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) => return true,
            _ => return false,
        };
    }
}

fn may_hold_string_literals(hir: &File<'_>, bound: &Bound<'_>, pattern: PatId) -> bool {
    let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
        return false;
    };
    let declaration = &hir[declaration];
    declaration.kind == VarKind::Const
        && declaration.init.is_some()
        && matches!(
            hir[hir.skip_type_assertions(declaration.init)].kind,
            ExprKind::Index { .. } | ExprKind::Cond { .. }
        )
}

fn is_list_written_out(hir: &File<'_>, bound: &Bound<'_>, pattern: PatId) -> bool {
    match bound.pat_parent[pattern.idx()] {
        PatParent::Var(declaration) => {
            let value = hir[declaration].init;
            value.is_some() && matches!(hir[value].kind, ExprKind::Array(_))
        }
        _ => false,
    }
}

fn is_made_by_the_text_of_its_file(hir: &File<'_>, bound: &Bound<'_>, pattern: PatId) -> bool {
    let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
        return false;
    };
    let value = hir[declaration].init;
    if value.is_none() {
        return false;
    }
    match hir[value].kind {
        ExprKind::Object(_) | ExprKind::Array(_) => true,
        ExprKind::Call(site) | ExprKind::New(site) => {
            let callee = hir[site].callee;
            let named = bound.symbol_of_expr(callee);
            matches!(hir[callee].kind, ExprKind::Ident(_))
                && !named.is_none()
                && matches!(bound.symbol(named).decls, [Decl::Fn(_)] | [Decl::Class(_)])
        }
        _ => false,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn compute_inferred_position(&mut self, symbol: Sym) -> DeclaredType {
        let files = self.queries.files();
        let declarations = files.decls_of(symbol);
        let mut values = declarations
            .iter()
            .filter(|&&(_, it)| !declares_type_alone(it));
        let Some(&(declaring_file, Decl::Var(pattern))) = values.next() else {
            return DeclaredType::untyped();
        };
        if declaring_file != self.file {
            return DeclaredType::untyped();
        }
        let is_made_by_the_text = is_made_by_the_text_of_its_file(self.hir, self.bound, pattern);
        let comes_from_elsewhere =
            self.is_checked() && comes_from_elsewhere(self.hir, self.bound, pattern);
        if !is_made_by_the_text && !comes_from_elsewhere {
            return DeclaredType::untyped();
        }
        if is_list_written_out(self.hir, self.bound, pattern) {
            let list = Mapped::expected(TypeTable::ARRAY);
            return DeclaredType::new(list, None, PositionFlags::default());
        }
        let written = self.queries.written_variable_type(symbol);
        let checked = self.queries.binding_type(pattern);
        self.create_expected_position(PositionTypes { written, checked }, is_made_by_the_text)
    }

    pub(in crate::lower) fn compute_literal_position(&mut self, symbol: Sym) -> DeclaredType {
        let files = self.queries.files();
        let &[(declaring_file, Decl::Var(pattern))] = &files.decls_of(symbol)[..] else {
            return DeclaredType::untyped();
        };
        if declaring_file != self.file
            || !self.is_checked()
            || !may_hold_string_literals(self.hir, self.bound, pattern)
        {
            return DeclaredType::untyped();
        }
        let written = self.queries.written_variable_type(symbol);
        let checked = self.queries.binding_type(pattern);
        let position = self.create_expected_position(PositionTypes { written, checked }, false);
        let ty = self.fragment.types.get(position.ty);
        let nullish = Primitives::UNDEFINED | Primitives::NULL;
        let holds_literals_alone = !ty.strings.is_empty()
            && nullish.contains(ty.primitives)
            && ty.layouts.is_empty()
            && ty.functions.is_empty();
        match holds_literals_alone {
            true => position,
            false => DeclaredType::untyped(),
        }
    }

    pub(super) fn compute_variable_position(&mut self, symbol: Sym) -> DeclaredType {
        let class = self.queries.class_of_binding(symbol);
        let files = self.queries.files();
        let declarations = files.decls_of(symbol);
        if class.is_some() || self.is_function_binding(symbol, &declarations) {
            let ty = match self.find_bound_function(symbol, class) {
                Some(key) => {
                    let function = self.reference_function(key);
                    self.fragment.types.intern_function(function)
                }
                None => TypeTable::FUNCTION,
            };
            let position = DeclaredType::from_compiler(ty);
            let starts_empty = symbol.file == self.file
                && self.scopes.function_made_at_first_read(symbol.id).is_some();
            return match starts_empty {
                true => self.add_undefined(position),
                false => position,
            };
        }
        let mut values = declarations
            .iter()
            .filter(|&&(_, it)| !declares_type_alone(it));
        let Some(&(declaring_file, declaration)) = values.next() else {
            return DeclaredType::untyped();
        };
        let pattern = match declaration {
            Decl::Var(pattern) | Decl::Require(pattern) | Decl::Param(pattern) => pattern,
            Decl::Enum(_) | Decl::Module(_) => {
                let bound = files.bound(symbol.file);
                let binding = bound.declared_symbol(declaration);
                let locals = bound.scopes[bound.symbol_scope(binding).idx()].locals;
                let local = bound.lookup(locals, bound.symbol(binding).name);
                let exported = bound.export_symbol_of_value_symbol_if_exported(binding);
                let outer = bound.symbol(exported).parent;
                let left_out = self.inputs.library_functions.left_out_declarations();
                let hir = files.hir(declaring_file);
                let is_left_out = match declaration {
                    Decl::Enum(it) => left_out.is_statement_left_out(declaring_file, hir[it].stmt),
                    Decl::Module(it) => {
                        left_out.is_statement_left_out(declaring_file, hir[it].stmt)
                    }
                    _ => false,
                };
                let holds_its_container_alone = declaring_file == symbol.file
                    && !is_left_out
                    && (outer.is_none() || outer == bound.file_symbol)
                    && declarations.len() == 1
                    && bound.makes_container_object(files.hir(declaring_file), declaration)
                    && [local.unwrap_or(binding), binding, exported]
                        .into_iter()
                        .all(|name| {
                            bound.symbol(name).decls.len() == 1
                                && bound.stores_to(name).is_empty()
                                && !bound.is_visible_to_eval(name)
                        });
                return match holds_its_container_alone {
                    true => self.container_position(symbol.file, exported),
                    false => DeclaredType::untyped(),
                };
            }
            _ => return DeclaredType::untyped(),
        };
        if is_const_written_as_zero(
            files.hir(declaring_file),
            files.bound(declaring_file),
            pattern,
        ) {
            self.types.positions.constant_zeros.insert(symbol);
        }
        let is_parameter = matches!(
            files.bound(declaring_file).pat_parent[pattern.idx()],
            PatParent::Param(_)
        );
        let is_stored_again = !files.bound(symbol.file).is_stable_binding(symbol.id);
        let written = self.queries.written_variable_type(symbol);
        let is_read = !is_stored_again
            && !is_parameter
            && !self.is_checked()
            && declaring_file == self.file
            && is_read_off_a_value(
                files.hir(declaring_file),
                files.bound(declaring_file),
                pattern,
            );
        let is_element = is_read
            && is_element_of_a_value(
                files.hir(declaring_file),
                files.bound(declaring_file),
                pattern,
            );
        let is_given_by_a_call = !is_stored_again
            && !is_parameter
            && !self.is_checked()
            && declaring_file == self.file
            && comes_from_elsewhere(
                files.hir(declaring_file),
                files.bound(declaring_file),
                pattern,
            );
        let is_expected_by_its_uses = (is_read
            && self.queries.uses_say_what_read_is(pattern, is_element))
            || (is_given_by_a_call && self.queries.uses_say_list_of_lists(pattern));
        let is_declared = is_parameter
            || is_stored_again
            || is_expected_by_its_uses
            || written.written().is_some();
        let checked = match is_declared && declaring_file == self.file {
            true => self.queries.binding_type(pattern),
            false => Err(GaveUp::Unresolved),
        };
        let types = PositionTypes { written, checked };
        let position = self.create_position(types);
        match self.starts_undefined(symbol, declaring_file, pattern) {
            true => self.add_undefined(position),
            false => position,
        }
    }

    fn container_position(&mut self, file: FileId, merged: SymbolId) -> DeclaredType {
        let container = self.queries.canonical_symbol(file, merged);
        let layout = self
            .fragment
            .declare_layout(LayoutKey::Container(container));
        let ty = self.fragment.types.intern_layout(layout);
        let expected = DeclaredType::new(Mapped::expected(ty), None, PositionFlags::default());
        self.add_undefined(expected)
    }

    fn starts_undefined(&self, symbol: Sym, declaring_file: FileId, pattern: PatId) -> bool {
        let files = self.queries.files();
        if files.bound(symbol.file).initial_state(symbol.id) == InitialState::Undefined {
            return true;
        }
        let (hir, bound) = (files.hir(declaring_file), files.bound(declaring_file));
        match bound.pat_parent[pattern.idx()] {
            PatParent::Var(declaration) => {
                hir[declaration].init.is_none() && !is_loop_head(hir, bound, declaration)
            }
            PatParent::Param(parameter) => hir[parameter].flags.contains(Flags::OPTIONAL),
            PatParent::None | PatParent::Prop(..) | PatParent::Elem(..) => false,
        }
    }

    fn is_lowered_file(&self, other: FileId) -> bool {
        self.inputs.files[other.idx()].is_some()
    }

    fn find_defined_function(&self, function: FunctionRef) -> Option<FunctionKey> {
        let compiled = self.queries.files().compiled(function.file)?;
        let decisions = &compiled.analysis.decisions;
        let is_defined =
            self.is_lowered_file(function.file) && !decisions.is_dead_function(function.function);
        is_defined.then_some(FunctionKey::Source(function))
    }

    fn is_dead_class(&self, class: ClassRef) -> bool {
        let files = self.queries.files();
        let Some(compiled) = files.compiled(class.file) else {
            return false;
        };
        let decisions = &compiled.analysis.decisions;
        match files.bound(class.file).class_owner[class.class.idx()] {
            ClassOwner::Expr(expression) => decisions.is_dead_expr(expression),
            ClassOwner::Stmt(statement) => decisions.is_dead_stmt(statement),
        }
    }

    pub(in crate::lower) fn class_object_position(&mut self, class: ClassId) -> DeclaredType {
        let ty = match self.find_lowered_constructor(self.own_class(class)) {
            Some(key) => {
                let function = self.reference_function(key);
                self.fragment.types.intern_function(function)
            }
            None => TypeTable::FUNCTION,
        };
        DeclaredType::from_compiler(ty)
    }

    fn find_lowered_constructor(&self, class: ClassRef) -> Option<FunctionKey> {
        let left_out = self.inputs.library_functions.left_out_declarations();
        match left_out.is_class_left_out(class.file, class.class) {
            true => None,
            false => find_class_constructor(self, class).filter(|key| self.is_in_program(key)),
        }
    }

    fn is_in_program(&self, key: &FunctionKey) -> bool {
        let modules = self.inputs.modules;
        let home = key.home_file();
        modules.load_failure(home).is_none() && !modules.is_placeholder(home)
    }

    fn find_bound_function(&self, symbol: Sym, class: Option<ClassRef>) -> Option<FunctionKey> {
        let Some(class) = class else {
            let defined = self.find_defined_function(find_only_definition(self, symbol)?);
            return defined.filter(|key| self.is_in_program(key));
        };
        self.find_lowered_constructor(class)
    }

    fn is_function_binding(&self, symbol: Sym, declarations: &[(FileId, Decl)]) -> bool {
        let files = self.queries.files();
        let mut has_body = false;
        for &(declaring_file, declaration) in declarations {
            let function = match declaration {
                Decl::Fn(function) => function,
                _ if declares_type_alone(declaration) => continue,
                _ => return false,
            };
            let bound = files.bound(declaring_file);
            if !bound.is_stable_binding(bound.declared_symbol(declaration)) {
                return false;
            }
            has_body |= match files.hir(declaring_file)[function].body {
                FnBody::None => false,
                FnBody::Block(_) | FnBody::Expr(_) => true,
            };
        }
        has_body && files.bound(symbol.file).initial_state(symbol.id) == InitialState::Initialized
    }
}

fn is_loop_head(hir: &File<'_>, bound: &Bound<'_>, declaration: VarDeclId) -> bool {
    let statement = bound.var_stmt[declaration.idx()];
    let Parent::Stmt(parent) = bound.parent_of_stmt(statement) else {
        return false;
    };
    matches!(
        hir[parent].kind,
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == statement
    )
}

fn find_only_definition(file: &FileLowering<'_, '_, '_, '_>, symbol: Sym) -> Option<FunctionRef> {
    let files = file.queries.files();
    let declarations = files.decls_of(symbol);
    let mut definitions = declarations
        .iter()
        .filter_map(|&(declaring_file, declaration)| {
            let Decl::Fn(function) = declaration else {
                return None;
            };
            match files.hir(declaring_file)[function].body {
                FnBody::None => None,
                FnBody::Block(_) | FnBody::Expr(_) => Some(FunctionRef {
                    file: declaring_file,
                    function,
                }),
            }
        });
    let definition = definitions.next()?;
    definitions.next().is_none().then_some(definition)
}

fn find_class_constructor(
    file: &FileLowering<'_, '_, '_, '_>,
    class: ClassRef,
) -> Option<FunctionKey> {
    match find_explicit_constructor(file, class) {
        Some(constructor) => file.find_defined_function(constructor),
        None => {
            let is_defined = file.is_lowered_file(class.file) && !file.is_dead_class(class);
            is_defined.then_some(FunctionKey::ImplicitConstructor(class))
        }
    }
}
