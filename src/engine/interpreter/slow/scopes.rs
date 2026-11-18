use bun_engine_vm::code::metadata::{GetGlobal, GetImport, GlobalAccess};
use bun_engine_vm::{Environment, JsCell, ModuleEnvironment, scope};

use super::execute;

execute! {
    CreateScope(op, cx, f) {
        let template = f.code_block.scope_template(cx, op.scope);
        // SAFETY: what the generator has arranged.
        f.set(op.dst, unsafe { Environment::create(cx, &cx.global(), f.cell(op.parent), template) });
    }
    CopyScope(op, cx, f) {
        f.set(op.scope, f.cell::<Environment>(op.scope).copy(cx));
    }
    CreateWithScope(op, cx, f) {
        let object = f.get(op.object).to_object(cx)?;
        let template = f.code_block.scope_template(cx, op.scope);
        // SAFETY: as above.
        f.set(op.dst, unsafe { Environment::create_with(cx, f.cell(op.parent), template, object) });
    }
    GetScoped(op, cx, f) {
        let value = f.cell::<Environment>(op.scope).get(op.slot).expect("initialized");
        f.set_profiled(op.dst, op.metadata, value);
    }
    GetOuter(op, cx, f) {
        let value = f.outer_scope(op.scope, op.depth).get(op.slot).expect("initialized");
        f.set_profiled(op.dst, op.metadata, value);
    }
    GetScopedChecked(op, cx, f) {
        let value = f.cell::<Environment>(op.scope).get_checked(cx, op.slot)?;
        f.set_profiled(op.dst, op.metadata, value);
    }
    GetOuterChecked(op, cx, f) {
        let value = f.outer_scope(op.scope, op.depth).get_checked(cx, op.slot)?;
        f.set_profiled(op.dst, op.metadata, value);
    }
    GetInternal(op, cx, f) {
        f.set_or_empty(op.dst, f.outer_scope(op.scope, op.depth).get(op.slot));
    }
    PutScoped(op, cx, f) {
        // SAFETY: as above.
        unsafe { f.cell::<Environment>(op.scope).set(op.slot, f.get_or_empty(op.value)) };
    }
    PutOuter(op, cx, f) {
        // SAFETY: as above.
        unsafe { f.outer_scope(op.scope, op.depth).set(op.slot, f.get_or_empty(op.value)) };
    }
    GetImport(op, cx, f) {
        let module = f.outer_scope(op.scope, op.depth).cast::<ModuleEnvironment>();
        let value = module.get_import(cx, op.slot)?;
        let entry = f.entry::<GetImport>(op.metadata);
        if !module.is_only_instance() {
            entry.note_variation(module.import_target(op.slot).map(|it| it.1));
        } else if let Some((environment, slot)) = module.import_target(op.slot) {
            // SAFETY: what the import is bound to.
            let address = core::ptr::from_ref(unsafe { environment.slot_unchecked(slot) });
            entry.slot.set(address.expose_provenance());
            entry.environment.set(environment.address());
            f.code_block.write_barrier_for_cell();
        }
        f.set_profiled(op.dst, op.metadata, value);
    }
    GetGlobal(op, cx, f) {
        let access = &f.entry::<GetGlobal>(op.metadata).access;
        let value = access.get_slow(cx, f.code_block, f.name(op.name), op.unresolved)?;
        f.set_profiled(op.dst, op.metadata, value);
    }
    PutGlobal(op, cx, f) {
        let access = f.entry::<GlobalAccess>(op.metadata);
        access.put_slow(cx, f.code_block, f.name(op.name), f.get(op.value), op.strict)?;
    }
    InitializeGlobal(op, cx, f) {
        cx.initialize_global(f.name(op.name), f.get(op.value));
    }
    DeleteGlobal(op, cx, f) {
        f.set(op.dst, cx.delete_global(f.name(op.name))?);
    }
    ResolveDynamic(op, cx, f) {
        let holder = cx.resolve_dynamic_with_cache(f.cell(op.scope), f.name(op.name), f.entry(op.metadata))?;
        f.code_block.write_barrier_for_cell();
        f.set(op.dst, holder);
    }
    GetDynamic(op, cx, f) {
        let (holder, name) = (f.cell(op.holder), f.name(op.name));
        let value = cx.get_dynamic(holder, name, op.unresolved, op.strict)?;
        f.entry::<GetGlobal>(op.metadata).access.remember_dynamic(cx, holder, name, false);
        f.code_block.write_barrier_for_cell();
        f.set_profiled(op.dst, op.metadata, value);
    }
    PutDynamic(op, cx, f) {
        let (holder, name) = (f.cell(op.holder), f.name(op.name));
        cx.put_dynamic(holder, name, f.get(op.value), op.strict)?;
        f.entry::<GlobalAccess>(op.metadata).remember_dynamic(cx, holder, name, true);
        f.code_block.write_barrier_for_cell();
    }
    DeleteDynamic(op, cx, f) {
        f.set(op.dst, cx.delete_dynamic(f.cell(op.holder), f.name(op.name))?);
    }
    GetDynamicThis(op, cx, f) {
        f.set(op.dst, scope::dynamic_this(f.cell::<JsCell>(op.holder)));
    }
    PutHoisted(op, cx, f) {
        cx.put_hoisted(f.cell(op.scope), f.name(op.name), f.reg(op.value))?;
    }
    DirectEval(op, cx, f) {
        let (source, scope) = (f.get(op.source), f.cell(op.scope));
        let result = bun_engine_vm::direct_eval(cx, f.code_block, source, scope, op.context)?;
        f.set_profiled(op.dst, op.metadata, result);
    }
    DynamicImport(op, cx, f) {
        let (specifier, options) = (f.get(op.specifier), f.get(op.options));
        let scope = f.cell(op.scope);
        f.set(op.dst, bun_engine_vm::dynamic_import(cx, f.code_block, specifier, options, scope, op.phase)?);
    }
}
