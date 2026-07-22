def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, s.count(old), old[:70])
        s = s.replace(old, new)
    open(path, "w").write(s)
    print("patched", path)

edit("src/jsc/Debugger.rs", [
(
"""/// True while the inspected thread is blocked waiting for a frontend
/// (`--inspect-brk`, `--inspect-wait`, `inspector.waitForDebugger()`). Read
/// from the debugger thread to answer `NodeRuntime.enable`, so it is atomic.
static IS_WAITING_FOR_DEBUGGER: AtomicBool = AtomicBool::new(false);""",
"""/// Script execution context of the thread currently blocked waiting for a
/// frontend (`--inspect-brk`, `--inspect-wait`, `inspector.waitForDebugger()`),
/// or 0 when none is. Contexts are what inspector connections are keyed by, so
/// a waiting worker must not answer for the main thread. Read from the debugger
/// thread to answer `NodeRuntime.enable`, hence atomic.
static WAITING_FOR_DEBUGGER_CONTEXT: AtomicU32 = AtomicU32::new(0);"""
),
(
"""    safe fn BunDebugger__notifyWaitingForDebugger();""",
"""    safe fn BunDebugger__notifyWaitingForDebugger(ctx_id: u32);"""
),
(
"""            // Armed here, before the debugger thread can accept a frontend, so
            // a client that attaches immediately still sees the waiting state.
            IS_WAITING_FOR_DEBUGGER.store(true, Ordering::Relaxed);
            BunDebugger__notifyWaitingForDebugger();""",
"""            // Armed here, before the debugger thread can accept a frontend, so
            // a client that attaches immediately still sees the waiting state.
            // No broadcast: no connection can exist yet.
            WAITING_FOR_DEBUGGER_CONTEXT.store(dbg.script_execution_context_id, Ordering::Relaxed);"""
),
(
"""        let _reset = scopeguard::guard((), |()| {
            IS_WAITING_FOR_DEBUGGER.store(false, Ordering::Relaxed);""",
"""        let _reset = scopeguard::guard((), |()| {
            let _ = WAITING_FOR_DEBUGGER_CONTEXT.compare_exchange(
                ctx_id,
                0,
                Ordering::Relaxed,
                Ordering::Relaxed,
            );"""
),
(
"""    // A frontend may already be attached with the NodeRuntime domain enabled
    // (inspector.open() then waitForDebugger()); Node announces the new wait to
    // it, so tell the debugger thread before blocking.
    IS_WAITING_FOR_DEBUGGER.store(true, Ordering::Relaxed);
    BunDebugger__notifyWaitingForDebugger();""",
"""    // A frontend may already be attached with the NodeRuntime domain enabled
    // (inspector.open() then waitForDebugger()); Node announces the new wait to
    // it, so tell the debugger thread before blocking.
    let ctx_id = match this.debugger.as_deref() {
        Some(d) => d.script_execution_context_id,
        None => 0,
    };
    WAITING_FOR_DEBUGGER_CONTEXT.store(ctx_id, Ordering::Relaxed);
    BunDebugger__notifyWaitingForDebugger(ctx_id);"""
),
(
"""        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
    }
    IS_WAITING_FOR_DEBUGGER.store(false, Ordering::Relaxed);
}

/// Answers `NodeRuntime.enable`""",
"""        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
    }
    let _ = WAITING_FOR_DEBUGGER_CONTEXT.compare_exchange(
        dbg.script_execution_context_id,
        0,
        Ordering::Relaxed,
        Ordering::Relaxed,
    );
}

/// Answers `NodeRuntime.enable`"""
),
(
"""    // Matches Node's runIfWaitingForDebugger -> unsetWaitingForDebugger: the
    // wait is resolved, so NodeRuntime.enable must stop announcing it.
    IS_WAITING_FOR_DEBUGGER.store(false, Ordering::Relaxed);""",
"""    // Matches Node's runIfWaitingForDebugger -> unsetWaitingForDebugger: the
    // wait is resolved, so NodeRuntime.enable must stop announcing it.
    let _ = WAITING_FOR_DEBUGGER_CONTEXT.compare_exchange(
        dbg.script_execution_context_id,
        0,
        Ordering::Relaxed,
        Ordering::Relaxed,
    );"""
),
(
"""// HOST_EXPORT(Debugger__isWaitingForDebugger, c)
pub fn is_waiting_for_debugger() -> bool {
    IS_WAITING_FOR_DEBUGGER.load(Ordering::Relaxed)
}""",
"""// HOST_EXPORT(Debugger__isWaitingForDebugger, c)
pub fn is_waiting_for_debugger(ctx_id: u32) -> bool {
    ctx_id != 0 && WAITING_FOR_DEBUGGER_CONTEXT.load(Ordering::Relaxed) == ctx_id
}"""
)])

edit("src/jsc/bindings/BunDebugger.cpp", [
(
"""extern "C" bool Debugger__isWaitingForDebugger();

// Reads the inspected thread's wait-for-frontend state from the debugger
// thread, for NodeRuntime.enable in internal/inspector/cdp.ts.
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWaitingForDebugger, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsBoolean(Debugger__isWaitingForDebugger()));
}""",
"""extern "C" bool Debugger__isWaitingForDebugger(uint32_t scriptId);

// Reads an inspected context's wait-for-frontend state from the debugger
// thread, for NodeRuntime.enable in internal/inspector/cdp.ts.
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWaitingForDebugger, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsBoolean(Debugger__isWaitingForDebugger(callFrame->argument(0).toUInt32(globalObject))));
}"""
),
(
"""// The inspected thread started waiting for a frontend (inspector.waitForDebugger()).
// Node's RuntimeAgent::setWaitingForDebugger notifies sessions that already
// enabled the NodeRuntime domain; the adapter decides, since `enabled` is per
// session.
extern "C" void BunDebugger__notifyWaitingForDebugger()
{
    if (debuggerScriptExecutionContext == nullptr) {
        return;
    }

    debuggerScriptExecutionContext->postTaskConcurrently([](ScriptExecutionContext& context) {
        Locker<Lock> locker(inspectorConnectionsLock);
        for (auto& connections : *inspectorConnections) {
            for (auto* connection : connections.value) {
                if (connection->isNodeCDP) {
                    connection->sendMessageToFrontend("{\\"method\\":\\"Bun.waitingForDebugger\\"}"_s);
                }
            }
        }
    });
}""",
"""// A context started waiting for a frontend (inspector.waitForDebugger()).
// Mirrors Node's RuntimeAgent::setWaitingForDebugger; the adapter decides
// whether to forward it, since NodeRuntime `enabled` is per session.
extern "C" void BunDebugger__notifyWaitingForDebugger(uint32_t scriptId)
{
    if (debuggerScriptExecutionContext == nullptr) {
        return;
    }

    debuggerScriptExecutionContext->postTaskConcurrently([scriptId](ScriptExecutionContext& context) {
        Locker<Lock> locker(inspectorConnectionsLock);
        // Only this context's frontends: another context may be running fine.
        for (auto* connection : inspectorConnections->get(static_cast<ScriptExecutionContextIdentifier>(scriptId))) {
            if (connection->isNodeCDP) {
                connection->sendMessageToFrontend("{\\"method\\":\\"Bun.waitingForDebugger\\"}"_s);
            }
        }
    });
}"""
),
(
"""    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 0, String("isWaitingForDebugger"_s), jsFunctionIsWaitingForDebugger, ImplementationVisibility::Public));""",
"""    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 1, String("isWaitingForDebugger"_s), jsFunctionIsWaitingForDebugger, ImplementationVisibility::Public));"""
)])

edit("src/js/internal/debugger.ts", [
(
"""  enableNodeCDP: boolean,
  isWaitingForDebugger: () => boolean,
): void {""",
"""  enableNodeCDP: boolean,
  isWaitingForDebuggerFor: (executionContextId: number) => boolean,
): void {
  // Per context: a waiting worker must not answer for the main thread.
  const isWaitingForDebugger = () => isWaitingForDebuggerFor(executionContextId);"""
),
(
"""  // Reads the inspected thread's wait-for-frontend state; see cdp.ts.
  #isWaitingForDebugger: () => boolean = () => false;""",
"""  // Reads the inspected context's wait-for-frontend state; see cdp.ts.
  #isWaitingForDebugger: () => boolean;"""
)])
