use bun_sema::bind::{Bound, ClassOwner, Decl, InitialState, Parent, PatParent};
use bun_sema::check::aot::{ClassRef, FunctionRef, GaveUp, PositionTypes, declares_type_alone};
use bun_sema::hir::{File, Flags, FnBody, MemberKind, PatId, StmtKind, VarDeclId};
use bun_sema::program::{FileId, Sym};

use super::SiteOrigin;
use crate::ir::generated::TypeSiteKind;
use crate::ir::{DeclaredType, FunctionKey, Type, TypeTable};
use crate::lower::{FileLowering, class};

pub(super) fn compute_variable_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    symbol: Sym,
) -> DeclaredType {
    if is_function_binding(file, symbol) {
        let ty = match find_bound_function(file, symbol) {
            Some(key) => {
                let function = file.reference_function(key);
                file.fragment.types.intern(Type::function(function))
            }
            None => TypeTable::FUNCTION,
        };
        return DeclaredType::from_compiler(ty);
    }
    let files = file.queries.files();
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
        Decl::Fn(_)
        | Decl::Class(_)
        | Decl::Interface(_)
        | Decl::Alias(_)
        | Decl::Enum(_)
        | Decl::EnumMember(_)
        | Decl::Module(_)
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
        | Decl::ModuleExports(_)
        | Decl::ExportsProperty(_)
        | Decl::Expando(_)
        | Decl::ObjectLiteral(_)
        | Decl::CommonJsVariable
        | Decl::Member(_)
        | Decl::ParameterProperty(_)
        | Decl::ThisProperty(_)
        | Decl::Property(_)
        | Decl::TypeLiteral(_) => return DeclaredType::untyped(),
    };
    let written = file.queries.written_variable_type(symbol);
    let (checked, origin) = match declaring_file == file.file {
        true => {
            let origin = SiteOrigin {
                kind,
                position: file.hir[pattern].pos,
            };
            (file.queries.binding_type(pattern), Some(origin))
        }
        false => (Err(GaveUp::Unresolved), None),
    };
    let types = PositionTypes { written, checked };
    let position = super::build_position_of_types(file, types, origin);
    match starts_undefined(file, symbol, declaring_file, pattern) {
        true => super::add_undefined(file, position),
        false => position,
    }
}

// `var v = 1`, `let v;` and the `v` of `(v?: number) => {}` hold `undefined` before anything is stored.
fn starts_undefined(
    file: &FileLowering<'_, '_, '_, '_>,
    symbol: Sym,
    declaring_file: FileId,
    pattern: PatId,
) -> bool {
    let files = file.queries.files();
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

fn is_lowered_file(file: &FileLowering<'_, '_, '_, '_>, other: FileId) -> bool {
    file.inputs.files[other.idx()].is_some()
}

fn find_defined_function(
    file: &FileLowering<'_, '_, '_, '_>,
    function: FunctionRef,
) -> Option<FunctionKey> {
    let compiled = file.queries.files().compiled(function.file)?;
    let is_defined = is_lowered_file(file, function.file)
        && !compiled
            .analysis
            .decisions
            .is_dead_function(function.function);
    is_defined.then_some(FunctionKey::Source(function))
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

fn is_dead_class(file: &FileLowering<'_, '_, '_, '_>, class: ClassRef) -> bool {
    let files = file.queries.files();
    let Some(compiled) = files.compiled(class.file) else {
        return false;
    };
    let decisions = &compiled.analysis.decisions;
    match files.bound(class.file).class_owner[class.class.idx()] {
        ClassOwner::Expr(expression) => decisions.is_dead_expr(expression),
        ClassOwner::Stmt(statement) => decisions.is_dead_stmt(statement),
    }
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
            find_defined_function(file, function)
        }
        None => {
            let is_defined = is_lowered_file(file, class.file) && !is_dead_class(file, class);
            is_defined.then_some(FunctionKey::ImplicitConstructor(class))
        }
    }
}

fn find_bound_function(file: &FileLowering<'_, '_, '_, '_>, symbol: Sym) -> Option<FunctionKey> {
    let key = match file.queries.class_of_binding(symbol) {
        Some(class) => {
            let left_out = file.inputs.library_functions.left_out_declarations();
            match left_out.is_class_left_out(class.file, class.class) {
                true => None,
                false => find_class_constructor(file, class),
            }
        }
        None => find_defined_function(file, find_only_definition(file, symbol)?),
    };
    key.filter(|key| file.inputs.modules.load_failure(key.home_file()).is_none())
}

fn is_function_binding(file: &FileLowering<'_, '_, '_, '_>, symbol: Sym) -> bool {
    if file.queries.class_of_binding(symbol).is_some() {
        return true;
    }
    let files = file.queries.files();
    let mut has_body = false;
    for &(declaring_file, declaration) in files.decls_of(symbol).iter() {
        let function = match declaration {
            Decl::Fn(function) => function,
            _ if declares_type_alone(declaration) => continue,
            Decl::Var(_)
            | Decl::Param(_)
            | Decl::Class(_)
            | Decl::Interface(_)
            | Decl::Alias(_)
            | Decl::Enum(_)
            | Decl::EnumMember(_)
            | Decl::Module(_)
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
            | Decl::TypeLiteral(_) => return false,
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
