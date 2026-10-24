use bun_sema::bind::{Bound, ClassOwner, Decl, InitialState, Parent, PatParent};
use bun_sema::check::aot::{ClassRef, FunctionRef, GaveUp, PositionTypes, declares_type_alone};
use bun_sema::hir::{File, Flags, FnBody, MemberKind, PatId, StmtKind, VarDeclId};
use bun_sema::program::{FileId, Sym};

use super::SiteOrigin;
use crate::ir::generated::TypeSiteKind;
use crate::ir::{DeclaredType, FunctionKey, Type, TypeTable};
use crate::lower::{FileLowering, class};

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn compute_variable_position(&mut self, symbol: Sym) -> DeclaredType {
        if self.is_function_binding(symbol) {
            let ty = match self.find_bound_function(symbol) {
                Some(key) => {
                    let function = self.reference_function(key);
                    self.fragment.types.intern(Type::function(function))
                }
                None => TypeTable::FUNCTION,
            };
            return DeclaredType::from_compiler(ty);
        }
        let files = self.queries.files();
        let declarations = files.decls_of(symbol);
        let mut values = declarations
            .iter()
            .filter(|&&(_, it)| !declares_type_alone(it));
        let Some(&(declaring_file, declaration)) = values.next() else {
            return DeclaredType::untyped();
        };
        let (kind, pattern) = match declaration {
            Decl::Var(pattern) | Decl::Require(pattern) => (TypeSiteKind::Variable, pattern),
            Decl::Param(pattern) => (TypeSiteKind::Parameter, pattern),
            _ => return DeclaredType::untyped(),
        };
        let written = self.queries.written_variable_type(symbol);
        let (checked, origin) = match declaring_file == self.file {
            true => {
                let origin = SiteOrigin {
                    kind,
                    position: self.hir[pattern].pos,
                };
                (self.queries.binding_type(pattern), Some(origin))
            }
            false => (Err(GaveUp::Unresolved), None),
        };
        let types = PositionTypes { written, checked };
        let position = self.build_position_of_types(types, origin);
        match self.starts_undefined(symbol, declaring_file, pattern) {
            true => self.add_undefined(position),
            false => position,
        }
    }

    // `var v = 1`, `let v;` and the `v` of `(v?: number) => {}` hold `undefined` before anything is stored.
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
        let is_defined = self.is_lowered_file(function.file)
            && !compiled
                .analysis
                .decisions
                .is_dead_function(function.function);
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

    fn find_bound_function(&self, symbol: Sym) -> Option<FunctionKey> {
        let key = match self.queries.class_of_binding(symbol) {
            Some(class) => {
                let left_out = self.inputs.library_functions.left_out_declarations();
                match left_out.is_class_left_out(class.file, class.class) {
                    true => None,
                    false => find_class_constructor(self, class),
                }
            }
            None => self.find_defined_function(find_only_definition(self, symbol)?),
        };
        key.filter(|key| self.inputs.modules.load_failure(key.home_file()).is_none())
    }

    fn is_function_binding(&self, symbol: Sym) -> bool {
        if self.queries.class_of_binding(symbol).is_some() {
            return true;
        }
        let files = self.queries.files();
        let mut has_body = false;
        for &(declaring_file, declaration) in files.decls_of(symbol).iter() {
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
        // The variable that a function in a block also declares in sloppy code is `undefined` until the block runs.
        has_body && files.bound(symbol.file).initial_state(symbol.id) == InitialState::Initialized
    }
}

// `for (const v of list)` stores into `v` before anything reads it.
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
    let hir = file.queries.files().hir(class.file);
    let constructor = class::runtime_members(hir, class.class)
        .find(|&member| hir.runtime_member_kind(member) == MemberKind::Constructor);
    match constructor {
        Some(member) => {
            let function = FunctionRef {
                file: class.file,
                function: hir[member].func,
            };
            file.find_defined_function(function)
        }
        None => {
            let is_defined = file.is_lowered_file(class.file) && !file.is_dead_class(class);
            is_defined.then_some(FunctionKey::ImplicitConstructor(class))
        }
    }
}
