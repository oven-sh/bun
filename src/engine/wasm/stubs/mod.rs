//! Machine code for calls of one type between scripts and WebAssembly.

mod from_script;
mod helpers;
mod kind;
mod to_script;
mod writer;

use core::cell::RefCell;
use std::sync::{Arc, LazyLock, Weak};

use bun_engine_exec_memory::{CodeHandle, Priority, link, synchronize_instructions};
use bun_engine_vm::{FastHashMap, GcFree};
use bun_engine_wasm_compiler::abi::Signature;
use bun_engine_wasm_format::TypeIndex;
use bun_engine_wasm_runtime::Module;
use bun_threading::Guarded;

pub(crate) use self::kind::Direction;
use self::kind::Key;

struct Stub {
    key: Key,
    code: CodeHandle,
}

static SHARED: LazyLock<Guarded<FastHashMap<Key, Weak<Stub>>>> = LazyLock::new(Guarded::default);

impl Stub {
    /// `None` if there is no room for it.
    fn find_or_make(module: &Module, direction: Direction, ty: TypeIndex) -> Option<Arc<Stub>> {
        let key = Key::new(direction, module, ty);
        let mut shared = SHARED.lock();
        if let Some(stub) = shared.get(&key).and_then(Weak::upgrade) {
            synchronize_instructions();
            return Some(stub);
        }
        let (engine, ty) = (module.engine(), module.types().func_type(ty));
        let signature = Signature::new(ty);
        let (bytes, name) = match direction {
            Direction::FromScript => (from_script::generate(engine, &key, &signature), "from"),
            Direction::ToScript => (to_script::generate(engine, &key, &signature), "to"),
        };
        let code = link(&bytes, Priority::Optional, |_| unreachable!()).ok()?;
        code.describe(|| format!("wasm {name} script {ty}"));
        let stub = Arc::new(Stub {
            key: key.clone(),
            code,
        });
        shared.insert(key, Arc::downgrade(&stub));
        Some(stub)
    }
}

impl Drop for Stub {
    fn drop(&mut self) {
        let mut shared = SHARED.lock();
        if shared
            .get(&self.key)
            .is_some_and(|it| it.strong_count() == 0)
        {
            shared.remove(&self.key);
        }
    }
}

/// Those that an instance keeps.
#[derive(Default)]
pub(crate) struct Stubs(RefCell<FastHashMap<(Direction, TypeIndex), Option<Arc<Stub>>>>);

// SAFETY: code that refers to no cell.
unsafe impl GcFree for Stubs {}

impl Stubs {
    /// For a type of function all of whose values scripts have values for. `None` if there is no room for it.
    pub(crate) fn address(
        &self,
        module: &Module,
        direction: Direction,
        ty: TypeIndex,
    ) -> Option<usize> {
        let mut known = self.0.borrow_mut();
        let stub = (known.entry((direction, ty)))
            .or_insert_with(|| Stub::find_or_make(module, direction, ty));
        Some(stub.as_ref()?.code.start())
    }
}
