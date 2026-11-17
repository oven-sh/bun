//! What stands for a client on a thread.

use core::cell::RefCell;
use core::ffi::c_void;
use core::mem::ManuallyDrop;

use bun_collections::HashMap;
use bun_jsc::{JSGlobalObject, JSValue, Weak};

use crate::exec;
use crate::net::embedder::ClientId;

#[derive(Default)]
struct OfThread {
    hosts: HashMap<u32, Weak<()>>,
    is_in_use: bool,
}

thread_local! {
    static OF_THREAD: ManuallyDrop<RefCell<OfThread>> = ManuallyDrop::default();
}

fn of_thread<R>(steps: impl FnOnce(&mut OfThread) -> R) -> R {
    OF_THREAD.with(|it| steps(&mut it.borrow_mut()))
}

pub fn host_of(id: ClientId) -> Option<JSValue> {
    of_thread(|it| it.hosts.get(&id.0)?.get())
}

/// It does not keep `host` alive.
pub fn register(global: &JSGlobalObject, id: ClientId, host: JSValue) {
    extern "C" fn forget_everything(_: *mut c_void) {
        drop(of_thread(|it| core::mem::take(&mut it.hosts)));
    }
    of_thread(|it| {
        if !core::mem::replace(&mut it.is_in_use, true) {
            exec::at_exit(forget_everything);
        }
        if it.hosts.len().is_power_of_two() {
            it.hosts.retain(|_, host| host.get().is_some());
        }
        it.hosts.insert(id.0, Weak::create_passive(host, global));
    });
}
