p = "src/jsc/Debugger.rs"
s = open(p).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, (s.count(old), old[:70])
    s = s.replace(old, new)

# state
rep("""static FUTEX_ATOMIC: AtomicU32 = AtomicU32::new(0);
pub(crate) static HAS_CREATED_DEBUGGER: AtomicBool = AtomicBool::new(false);""",
"""static FUTEX_ATOMIC: AtomicU32 = AtomicU32::new(0);
pub(crate) static HAS_CREATED_DEBUGGER: AtomicBool = AtomicBool::new(false);
/// True while the inspected thread is blocked waiting for a frontend
/// (`--inspect-brk`, `--inspect-wait`, `inspector.waitForDebugger()`). Read
/// from the debugger thread to answer `NodeRuntime.enable`, so it is atomic.
static IS_WAITING_FOR_DEBUGGER: AtomicBool = AtomicBool::new(false);""")

# arm in create()
rep("""        let dbg = this_ref.debugger_mut().unwrap();
        if dbg.wait_for_connection != Wait::Off {
            dbg.poll_ref.ref_(get_vm_ctx(AllocatorType::Js));
            dbg.must_block_until_connected = true;
        }""",
"""        let dbg = this_ref.debugger_mut().unwrap();
        if dbg.wait_for_connection != Wait::Off {
            dbg.poll_ref.ref_(get_vm_ctx(AllocatorType::Js));
            dbg.must_block_until_connected = true;
            // Armed here, before the debugger thread can accept a frontend, so
            // a client that attaches immediately still sees the waiting state.
            IS_WAITING_FOR_DEBUGGER.store(true, Ordering::Relaxed);
        }""")

# clear on every exit of the wait
rep("""        // Reset `must_block_until_connected` on every exit path.
        let _reset = scopeguard::guard((), |()| {
            if let Some(d) = this.debugger_mut() {
                d.must_block_until_connected = false;
            }
        });""",
"""        // Reset `must_block_until_connected` on every exit path. The wait is
        // over once this returns, including the `Wait::Shortly` timeout, so
        // clear the flag `NodeRuntime.enable` reads here too.
        let _reset = scopeguard::guard((), |()| {
            IS_WAITING_FOR_DEBUGGER.store(false, Ordering::Relaxed);
            if let Some(d) = this.debugger_mut() {
                d.must_block_until_connected = false;
            }
        });""")

# clear in did_connect and abandon
rep("""    if dbg.wait_for_connection != Wait::Off {
        dbg.wait_for_connection = Wait::Off;
        dbg.must_block_until_connected = false;
        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
    }
}""",
"""    if dbg.wait_for_connection != Wait::Off {
        dbg.wait_for_connection = Wait::Off;
        dbg.must_block_until_connected = false;
        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
    }
    IS_WAITING_FOR_DEBUGGER.store(false, Ordering::Relaxed);
}""")

rep("""    if dbg.wait_for_connection != Wait::Off {
        dbg.wait_for_connection = Wait::Off;
        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
        this.event_loop_mut().wakeup();
    }
}""",
"""    if dbg.wait_for_connection != Wait::Off {
        dbg.wait_for_connection = Wait::Off;
        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
        this.event_loop_mut().wakeup();
    }
    // Matches Node's runIfWaitingForDebugger -> unsetWaitingForDebugger: the
    // wait is resolved, so NodeRuntime.enable must stop announcing it.
    IS_WAITING_FOR_DEBUGGER.store(false, Ordering::Relaxed);
}""")

# exported reader
rep("""// HOST_EXPORT(Debugger__didConnect, c)
pub fn did_connect() {""",
"""/// Answers `NodeRuntime.enable` on the debugger thread: Node emits
/// `NodeRuntime.waitingForDebugger` from that command exactly while the
/// inspected thread is blocked waiting for a frontend.
// HOST_EXPORT(Debugger__isWaitingForDebugger, c)
pub fn is_waiting_for_debugger() -> bool {
    IS_WAITING_FOR_DEBUGGER.load(Ordering::Relaxed)
}

// HOST_EXPORT(Debugger__didConnect, c)
pub fn did_connect() {""")
open(p, "w").write(s)
print("ok")
