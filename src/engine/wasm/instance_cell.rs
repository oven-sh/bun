//! The cell of a `WebAssembly.Instance`, most of which belongs to the run time.

use core::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_vm::{Field, GcFree, GlobalObject, JsDestructibleObject, Visitor};
use bun_engine_wasm_runtime::{Engine, HostCell, Instance, Module, Store};

use crate::module::WasmModule;
use crate::owned::{host_cell, visit_with};
use crate::prelude::*;
use crate::stubs::Stubs;

/// Destroys what the run time keeps in the rest of the cell.
struct Remainder {
    engine: &'static Engine,
    cell: Cell<Option<HostCell>>,
}

// SAFETY: it refers to the cell that has it.
unsafe impl GcFree for Remainder {}

impl Drop for Remainder {
    fn drop(&mut self) {
        if let Some(cell) = self.cell.get() {
            // SAFETY: the cell that `create` made, which nothing uses any more.
            unsafe { Instance::destroy(self.engine, cell) };
        }
    }
}

#[cell(
    name = "WebAssembly.Instance",
    cell_type = WasmInstance,
    visit_children
)]
pub(crate) struct WasmInstance {
    base: JsDestructibleObject,
    remainder: Remainder,
    realm_of_constructor: Gc<GlobalObject>,
    module: Gc<WasmModule>,
    pub(crate) exports: Field<Option<Gc<JsObject>>>,
    stubs: Stubs,
}

impl WasmInstance {
    pub(crate) const OFFSET_OF_EXPORTS: usize = core::mem::offset_of!(WasmInstance, exports);
    /// The bytes of the cell that are the heap's, before those of the run time.
    pub(crate) const HEADER_SIZE: usize = size_of::<WasmInstance>().next_multiple_of(16);

    /// `module` is the `WebAssembly.Module` that has `compiled`. The imports are still to be linked.
    pub(crate) fn create(
        cx: &Cx,
        shape: Gc<Shape>,
        module: Gc<WasmModule>,
        store: &Rc<Store>,
        compiled: Arc<Module>,
    ) -> JsResult<Gc<WasmInstance>> {
        let size = Instance::cell_size(&compiled);
        let init = WasmInstanceInit {
            base: JsObjectInit::new(cx, shape),
            remainder: Remainder {
                engine: store.engine(),
                cell: Cell::new(None),
            },
            realm_of_constructor: cx.global(),
            module,
            exports: None,
            stubs: Stubs::default(),
        };
        let heap = &cx.heap;
        // SAFETY: initialized below, before the next allocation.
        let address = unsafe { (heap.destructible_objects).try_allocate_zeroed(heap, size) };
        if address == 0 {
            return Err(cx.throw_out_of_memory());
        }
        // SAFETY: a new cell of that size, which `visit_children` traces and `Remainder` destroys.
        let (object, created) = unsafe {
            WasmInstance::initialize(core::ptr::with_exposed_provenance_mut(address), init);
            let object = Gc::<WasmInstance>::from_address(address);
            let cell = host_cell(object.cell());
            object.remainder.cell.set(Some(cell));
            (object, Instance::create(cell, store, compiled))
        };
        match created {
            Ok(_) => Ok(object),
            Err(_) => Err(cx.throw_out_of_memory()),
        }
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        if visitor.puts_off_current_cell() {
            return;
        }
        if let Some(instance) = self.created_instance() {
            instance.trace(visit_with(visitor));
        }
    }

    fn created_instance(&self) -> Option<&Instance> {
        let cell = host_cell(self.as_cell().into());
        // SAFETY: what `create` made. The result points into the cell.
        unsafe { Instance::of_cell(self.remainder.engine, cell) }
    }

    /// It is in the cell.
    #[cfg_attr(rootcheck, rootcheck::stays("an address in the cell keeps it alive"))]
    pub(crate) fn instance<'a>(&self) -> &'a Instance {
        let instance = self.created_instance().expect("no other is handed out");
        // SAFETY: the reference keeps the cell alive, wherever the rules allow a reference to a cell to be.
        unsafe { &*core::ptr::from_ref(instance) }
    }

    pub(crate) fn of(instance: &Instance) -> Gc<WasmInstance> {
        // SAFETY: `create` makes every instance.
        unsafe { Gc::from_address(instance.cell().address()) }
    }

    pub(crate) fn stubs(&self) -> &Stubs {
        &self.stubs
    }

    /// Where its functions and what they throw belong.
    pub(crate) fn realm(&self) -> Gc<GlobalObject> {
        self.shape().global().expect("an object of a realm")
    }

    /// Where its memories, tables, globals and tags belong.
    pub(crate) fn realm_of_constructor(&self) -> Gc<GlobalObject> {
        self.realm_of_constructor
    }

    pub(crate) fn module(&self) -> Gc<WasmModule> {
        self.module
    }
}
