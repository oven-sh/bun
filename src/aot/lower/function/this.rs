use bun_sema::bind::{FnOwner, ScopeId, ScopeKind};
use bun_sema::hir::{FnId, FnKind};

use super::is_derived_constructor;
use crate::ir::generated::{BlockFrequency, HomeObjectKind, ModuleKind, RuntimeErrorKind};
use crate::ir::{DeclaredType, TypeTable, ValueId};
use crate::lower::scope::{BindingRef, ScopeSlot};
use crate::lower::{FunctionLowering, class, condition, exception, scope};

#[derive(Copy, Clone)]
enum LexicalOwner {
    Generated,
    File(ScopeId),
    Function(ScopeId, FnId),
    FieldInitializer(ScopeId),
}

fn find_lexical_owner(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> LexicalOwner {
    let innermost = scope::innermost_scope(lowering);
    if innermost.is_none() {
        return LexicalOwner::Generated;
    }
    let owner = lowering.file.scopes.lexical_owner(innermost);
    match lowering.file.bound.scopes[owner.idx()].kind {
        ScopeKind::File => LexicalOwner::File(owner),
        ScopeKind::Fn(function) => LexicalOwner::Function(owner, function),
        ScopeKind::FieldInitializer(_) => LexicalOwner::FieldInitializer(owner),
        ScopeKind::Module(_)
        | ScopeKind::Block
        | ScopeKind::Class(_)
        | ScopeKind::Interface(_)
        | ScopeKind::TypeAlias(_)
        | ScopeKind::TypeParams
        | ScopeKind::Enum(_)
        | ScopeKind::TypeParamList(_)
        | ScopeKind::Param(_)
        | ScopeKind::ReturnType(_)
        | ScopeKind::Extends
        | ScopeKind::InferConstraint
        | ScopeKind::StaticMember
        | ScopeKind::ComputedName
        | ScopeKind::BaseExpression
        | ScopeKind::FunctionName(_)
        | ScopeKind::PropertyDeclaration(..)
        | ScopeKind::PropertyType(..)
        | ScopeKind::With(_)
        | ScopeKind::ClassDecorators(_)
        | ScopeKind::ImplicitBlock(_) => {
            debug_assert!(
                false,
                "a lexical owner is a file, function or field initializer"
            );
            LexicalOwner::Generated
        }
    }
}

pub(super) fn get_entry_this(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId {
    let bound_this = lowering.scopes.entry_this();
    match bound_this.or_else(|| lowering.builder.this_value()) {
        Some(this) => this,
        None => lowering.builder.undefined(),
    }
}

// `bun run` replaces the `this` of a file that has ES module syntax with `undefined`, in a CommonJS file with `import.meta` too.
pub(super) fn lower_this_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> ValueId {
    match find_lexical_owner(lowering) {
        LexicalOwner::File(_) if lowering.file.compiled.analysis.has_esm_syntax => {
            lowering.builder.undefined()
        }
        LexicalOwner::Generated
        | LexicalOwner::File(_)
        | LexicalOwner::Function(..)
        | LexicalOwner::FieldInitializer(_) => get_this(lowering),
    }
}

pub(super) fn get_this(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId {
    match find_lexical_owner(lowering) {
        LexicalOwner::Generated => get_entry_this(lowering),
        LexicalOwner::File(scope) => match lowering.file.inputs.modules.kind(lowering.file.file) {
            ModuleKind::CommonJs => scope::get_slot(lowering, scope, ScopeSlot::This),
            ModuleKind::SourceText
            | ModuleKind::Data
            | ModuleKind::RuntimeSource
            | ModuleKind::Runtime
            | ModuleKind::External => lowering.builder.undefined(),
        },
        LexicalOwner::Function(scope, function) => {
            if is_derived_constructor(lowering.file, function) {
                get_derived_constructor_this(lowering, scope)
            } else {
                scope::get_slot(lowering, scope, ScopeSlot::This)
            }
        }
        LexicalOwner::FieldInitializer(scope) => scope::get_slot(lowering, scope, ScopeSlot::This),
    }
}

// The exports object of a CommonJS module, `undefined` in an ES module: what the loader passes, whatever the checker says.
pub(super) fn is_this_of_module(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> bool {
    matches!(find_lexical_owner(lowering), LexicalOwner::File(_))
}

// An arrow function reads the `this` of the function around it.
pub(super) fn find_this_position(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> Option<DeclaredType> {
    match find_lexical_owner(lowering) {
        LexicalOwner::Generated => None,
        LexicalOwner::File(scope)
        | LexicalOwner::Function(scope, _)
        | LexicalOwner::FieldInitializer(scope) => {
            let binding = BindingRef::Slot(scope, ScopeSlot::This);
            Some(scope::stored_position(lowering.file, binding))
        }
    }
}

fn get_derived_constructor_this(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    owner: ScopeId,
) -> ValueId {
    let value = scope::get_slot(lowering, owner, ScopeSlot::This);
    let split = condition::split_on_type(lowering, value, TypeTable::ABSENT);
    lowering
        .builder
        .set_frequency(split.taken, BlockFrequency::Unlikely);
    lowering.builder.switch_to(split.taken);
    exception::emit_throw_runtime_error(lowering, RuntimeErrorKind::UninitializedThis, None);
    lowering.builder.switch_to(split.not_taken);
    rebind_this(lowering, owner, split.not_taken_value);
    split.not_taken_value
}

fn rebind_this(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    owner: ScopeId,
    value: ValueId,
) {
    let binding = BindingRef::Slot(owner, ScopeSlot::This);
    if let Some(local) = lowering.scopes.find_local(binding) {
        lowering.builder.write_variable(local.variable, value);
    }
}

pub(super) fn bind_this(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, value: ValueId) {
    let owner = match find_lexical_owner(lowering) {
        LexicalOwner::File(scope)
        | LexicalOwner::Function(scope, _)
        | LexicalOwner::FieldInitializer(scope) => scope,
        LexicalOwner::Generated => {
            lowering.scopes.set_entry_this(value);
            return;
        }
    };
    let old = scope::get_slot(lowering, owner, ScopeSlot::This);
    let split = condition::split_on_type(lowering, old, TypeTable::ABSENT);
    lowering
        .builder
        .set_frequency(split.not_taken, BlockFrequency::Unlikely);
    lowering.builder.switch_to(split.not_taken);
    exception::emit_throw_runtime_error(lowering, RuntimeErrorKind::ThisAlreadyBound, None);
    lowering.builder.switch_to(split.taken);
    scope::set_slot(lowering, owner, ScopeSlot::This, value);
}

pub(super) fn get_new_target(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId {
    match find_lexical_owner(lowering) {
        LexicalOwner::Function(scope, function) => {
            match lowering.file.hir.runtime_function_kind(function) {
                FnKind::Decl | FnKind::Expr | FnKind::Constructor => {
                    scope::get_slot(lowering, scope, ScopeSlot::NewTarget)
                }
                FnKind::Arrow
                | FnKind::Method
                | FnKind::Getter
                | FnKind::Setter
                | FnKind::StaticBlock
                | FnKind::CallSignature
                | FnKind::ConstructSignature
                | FnKind::FunctionType
                | FnKind::ConstructorType
                | FnKind::IndexSignature => lowering.builder.undefined(),
            }
        }
        LexicalOwner::Generated | LexicalOwner::File(_) | LexicalOwner::FieldInitializer(_) => {
            lowering.builder.undefined()
        }
    }
}

pub(super) fn get_home_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> (HomeObjectKind, ValueId) {
    match find_lexical_owner(lowering) {
        LexicalOwner::Function(scope, function) => {
            match lowering.file.bound.fns[function.idx()].owner {
                FnOwner::Expr(_) => {
                    let home = get_object_literal_home(lowering, scope, function);
                    (HomeObjectKind::Object, home)
                }
                FnOwner::Member(_) => class::get_class_home(lowering),
                FnOwner::None | FnOwner::Stmt(_) | FnOwner::Type(_) => {
                    (HomeObjectKind::Object, lowering.builder.undefined())
                }
            }
        }
        LexicalOwner::FieldInitializer(_) => class::get_class_home(lowering),
        LexicalOwner::Generated | LexicalOwner::File(_) => {
            (HomeObjectKind::Object, lowering.builder.undefined())
        }
    }
}

fn get_object_literal_home(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    owner: ScopeId,
    function: FnId,
) -> ValueId {
    match lowering.file.hir[function].kind {
        FnKind::Method | FnKind::Getter | FnKind::Setter => {
            scope::get_slot(lowering, owner, ScopeSlot::HomeObject)
        }
        FnKind::Decl
        | FnKind::Expr
        | FnKind::Arrow
        | FnKind::Constructor
        | FnKind::StaticBlock
        | FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType
        | FnKind::IndexSignature => lowering.builder.undefined(),
    }
}
