use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingKind, CodeUnit, FunctionFlags, has_mapped_arguments};
use bun_sema::fold::{Decision, NamedPath};
use bun_sema::hir::{ExprId, ExprKind, MemberKey};

use crate::ir::generated::RuntimeErrorKind;
use crate::ir::{BlockId, ValueId};
use crate::lower::expression::{DefineStop, ShortCircuit};
use crate::lower::member::PropertyName;
use crate::lower::scope::{ArgumentsObject, BindingForm};
use crate::lower::{FileLowering, FunctionLowering};

pub(super) fn lower_delete(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    operand: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let target = lowering.file.skip_type_syntax(operand);
    match lowering.file.decisions().decision(target) {
        Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {
            return lowering.builder.boolean(true);
        }
        Decision::GlobalPath(path) => return lowering.delete_global_path(path),
        Decision::NamedPath(named) => return lowering.delete_named_path(target, named),
        Decision::Unknown => {}
    }
    if matches!(hir[target].kind, ExprKind::Ident(_)) {
        return lowering.delete_identifier(target);
    }
    let Some((object, key)) = hir.member_key(target) else {
        lowering.lower_expression_for_effect(target);
        return lowering.builder.boolean(true);
    };
    if matches!(hir[object].kind, ExprKind::Super) {
        return lowering.delete_super_member(target, key);
    }
    if let Some(deleted) = lowering.try_lower_exports_deletion(target) {
        return deleted;
    }
    if lowering.file.is_chain_root(target) {
        return lowering.lower_in_chain(ShortCircuit::True, &mut |lowering, exit| {
            delete_member(lowering, target, Some(exit))
        });
    }
    delete_member(lowering, target, None)
}

impl FileLowering<'_, '_, '_, '_> {
    // JSC records a `delete` where its operand ends.
    fn delete_position(&self, access: ExprId) -> u32 {
        let closing = match self.is_shown_without_source_map() {
            true => None,
            false => self.find_closing_token_behind(access),
        };
        closing.unwrap_or_else(|| self.last_mapped_position(access))
    }

    // JSC keeps the parameters of sloppy code in a mapped arguments object where nothing captures one. `delete` of such a name answers true there.
    fn deletes_mapped_argument(&self, named: &NamedPath<'_>) -> bool {
        let (bound, plan) = (self.bound, &self.scopes);
        let [_] = named.names else {
            return false;
        };
        match named.head.binding {
            Binding::Symbol(symbol) => {
                let is_parameter = bound.binding_kind(symbol) == BindingKind::Parameter;
                let unit = bound.code_unit(bound.symbol_scope(symbol));
                matches!(plan.form(symbol), BindingForm::MappedArgument { .. })
                    || (is_parameter && self.may_have_mapped_arguments(unit))
            }
            Binding::CommonJs(_) => {
                plan.arguments_object(CodeUnit::File) == ArgumentsObject::Mapped
                    || self.may_have_mapped_arguments(CodeUnit::File)
            }
            Binding::Arguments(_) | Binding::Free => false,
        }
    }

    // JSC makes a mapped arguments object wherever the text that `bun run` keeps names `arguments`, also in code that the build has removed.
    fn may_have_mapped_arguments(&self, unit: CodeUnit) -> bool {
        let names_arguments = match unit {
            CodeUnit::File => self.bound.file_uses_arguments(),
            CodeUnit::Function(function) => {
                let flags = self.bound.function_flags(function);
                flags.contains(FunctionFlags::USES_ARGUMENTS)
            }
            CodeUnit::FieldInitializer(_) => false,
        };
        names_arguments && has_mapped_arguments(self.hir, unit)
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn delete_global_path(&mut self, path: &[Atom]) -> ValueId {
        let last = self.lower_global_path_holder(path);
        let Some(holder) = last.holder else {
            return self.emit_free_name_delete(last.name);
        };
        let key = self.file.atom_key(last.name);
        self.emit_delete(holder, PropertyName::Constant(key))
    }

    // `bun run` prints the name or the path of a define in place of `target`, so `delete` removes what that text names there.
    fn delete_named_path(&mut self, target: ExprId, named: &NamedPath<'_>) -> ValueId {
        let stop = self.find_define_stop_at_target(target, named, DefineStop::Deleted);
        if stop.is_some() || self.file.deletes_mapped_argument(named) {
            self.report_define_without_support(target, named, DefineStop::Deleted);
            return self.builder.boolean(true);
        }
        self.set_position(self.file.hir[target].pos);
        let last = self.lower_named_path_holder(named);
        let Some(holder) = last.holder else {
            return self.delete_define_head(&named.head);
        };
        let key = self.file.atom_key(last.name);
        self.emit_delete(holder, PropertyName::Constant(key))
    }

    fn delete_super_member(&mut self, access: ExprId, key: MemberKey) -> ValueId {
        self.get_this();
        match key {
            MemberKey::Computed(computed) => {
                self.lower_expression(computed);
            }
            MemberKey::Name(_) | MemberKey::PrivateName(_) => {}
        }
        self.set_position(self.file.delete_position(access));
        self.emit_throw_runtime_error(RuntimeErrorKind::DeleteSuperProperty, None);
        self.builder.boolean(true)
    }
}

fn delete_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    exit: Option<BlockId>,
) -> ValueId {
    let hir = lowering.file.hir;
    let Some((object, key)) = hir.member_key(access) else {
        debug_assert!(false, "delete_member takes a member access");
        return lowering.builder.boolean(true);
    };
    let base = lowering.lower_member_base(access, object, exit);
    let name = match key {
        MemberKey::Name(_) | MemberKey::Computed(_) => lowering.lower_member_key(key),
        MemberKey::PrivateName(_) => return lowering.builder.boolean(true),
    };
    lowering.set_position(lowering.file.delete_position(access));
    lowering.emit_delete(base, name)
}
