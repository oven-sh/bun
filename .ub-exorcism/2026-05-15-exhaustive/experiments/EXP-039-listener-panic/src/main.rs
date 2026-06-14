// EXP-039: Listener.rs `ptr::read` → `mem::forget` panic window (4 sites).
//
// Mirrors `src/runtime/socket/Listener.rs:235, 317, 1069, 1289`:
//
//   let handlers_moved: Handlers = unsafe { core::ptr::read(&socket_config.handlers) };
//   let protos_taken = socket_config.ssl.as_mut().and_then(|s| s.take_protos()); // may panic
//   let default_data = socket_config.default_data;
//   let ssl_cfg_taken = socket_config.ssl.take();
//   core::mem::forget(socket_config);
//
// A panic between line 1 (`ptr::read`) and line 5 (`mem::forget`) leaves `socket_config`
// un-forgotten. The compiler-inserted unwind runs `Drop for SocketConfig`, which runs
// `Drop for Handlers` on bytes the `ptr::read` already moved into `handlers_moved`
// → double-free / double-drop on the inner `Box<u32>`.
//
// Miri witnesses this as `attempting to use unsupported foreign item / dereferencing
// uninitialised data` or double-free on the second drop of `Handlers::buf`.

struct Handlers {
    buf: Box<u32>,
}

struct SocketConfig {
    handlers: Handlers,
    ssl: Option<Box<u8>>,
}

impl Drop for SocketConfig {
    fn drop(&mut self) {
        eprintln!("Drop SocketConfig (recursive drop of Handlers begins)");
    }
}

impl Drop for Handlers {
    fn drop(&mut self) {
        // Read the buf to force Miri to deref both copies; on the second drop the
        // backing allocation has already been freed.
        let v = *self.buf;
        eprintln!(
            "Drop Handlers — about to free Box<u32> @ {:p} = {}",
            &*self.buf, v
        );
    }
}

#[inline(never)]
fn take_protos(_s: &mut Box<u8>) {
    // Mirror Vec::with_capacity(n) inside ssl.take_protos() panicking on OOM.
    panic!("simulated OOM inside take_protos()");
}

fn main() {
    let config = SocketConfig {
        handlers: Handlers { buf: Box::new(42) },
        ssl: Some(Box::new(1)),
    };

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // Move config inside the closure so its Drop is owned by this scope.
        let mut config = config;

        // Line 1 of the Listener.rs pattern: bit-copy Handlers out via `ptr::read`.
        // The original storage at `config.handlers` is now logically uninitialised
        // (still in `config`, drop flag still set).
        let _handlers_moved: Handlers = unsafe { core::ptr::read(&config.handlers) };

        // Lines 2-4 of the Listener.rs pattern: allocate / take. PANIC HERE.
        take_protos(config.ssl.as_mut().unwrap());

        // Line 5 (never reached): suppress Drop.
        core::mem::forget(config);
    }));

    // On unwind, `Drop for SocketConfig` ran → `Drop for Handlers` ran on the
    // original `config.handlers` whose `buf` was already moved into
    // `_handlers_moved`. The latter ALSO drops at unwind, producing a double-free.
    assert!(result.is_err());
    eprintln!("caught panic; if both Handlers Drops ran, that is the double-free bug.");
}
