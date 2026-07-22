def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, s.count(old), old[:70])
        s = s.replace(old, new)
    open(path, "w").write(s)
    print("patched", path)

edit("src/jsc/bindings/BunDebugger.cpp", [
(
"""    std::atomic<ConnectionStatus> status = ConnectionStatus::Pending;

    bool unrefOnDisconnect = false;""",
"""    std::atomic<ConnectionStatus> status = ConnectionStatus::Pending;

    // This connection's frontend speaks CDP through InspectorCDPAdapter, so it
    // is the only kind that understands the synthetic Bun.* events below.
    bool isNodeCDP = false;

    bool unrefOnDisconnect = false;"""
),
(
"""JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateConnection, (JSGlobalObject * globalObject, CallFrame* callFrame))""",
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
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateConnection, (JSGlobalObject * globalObject, CallFrame* callFrame))"""
),
(
"""    connection->jsBunDebuggerOnMessageFunction = { vm, onMessageFn };
    connection->connect();""",
"""    connection->jsBunDebuggerOnMessageFunction = { vm, onMessageFn };
    connection->isNodeCDP = callFrame->argument(3).toBoolean(globalObject);
    connection->connect();"""
)])

edit("src/jsc/Debugger.rs", [
(
"""    safe fn Bun__createJSDebugger(global: &JSGlobalObject) -> u32;""",
"""    safe fn Bun__createJSDebugger(global: &JSGlobalObject) -> u32;
    safe fn BunDebugger__notifyWaitingForDebugger();"""
),
(
"""            // Armed here, before the debugger thread can accept a frontend, so
            // a client that attaches immediately still sees the waiting state.
            IS_WAITING_FOR_DEBUGGER.store(true, Ordering::Relaxed);""",
"""            // Armed here, before the debugger thread can accept a frontend, so
            // a client that attaches immediately still sees the waiting state.
            IS_WAITING_FOR_DEBUGGER.store(true, Ordering::Relaxed);
            BunDebugger__notifyWaitingForDebugger();"""
),
(
"""        dbg.must_block_until_connected = true;
    }
    Debugger::wait_for_debugger_if_necessary(VirtualMachine::get_mut_ptr());""",
"""        dbg.must_block_until_connected = true;
    }
    // A frontend may already be attached with the NodeRuntime domain enabled
    // (inspector.open() then waitForDebugger()); Node announces the new wait to
    // it, so tell the debugger thread before blocking.
    IS_WAITING_FOR_DEBUGGER.store(true, Ordering::Relaxed);
    BunDebugger__notifyWaitingForDebugger();
    Debugger::wait_for_debugger_if_necessary(VirtualMachine::get_mut_ptr());"""
)])

edit("src/js/internal/debugger.ts", [
(
"""    this.#createBackend = (refEventLoop, receive) => {
      const backend = createBackend(executionContextId, refEventLoop, receive);""",
"""    this.#createBackend = (refEventLoop, receive, isCDP = false) => {
      const backend = createBackend(executionContextId, refEventLoop, receive, isCDP);"""
),
(
"""  #createBackend: (refEventLoop: boolean, receive: (...messages: string[]) => void) => Backend;""",
"""  #createBackend: (refEventLoop: boolean, receive: (...messages: string[]) => void, isCDP?: boolean) => Backend;"""
),
(
"""      let adapter: any;
      const backend = this.#createBackend(true, (...messages: string[]) => {
        for (const message of messages) {
          adapter.handleBackendMessage(message);
        }
      });""",
"""      let adapter: any;
      const backend = this.#createBackend(
        true,
        (...messages: string[]) => {
          for (const message of messages) {
            adapter.handleBackendMessage(message);
          }
        },
        true,
      );"""
),
(
"""  createSessionBackend(receive: (...messages: string[]) => void): Backend {
    return this.#createBackend(true, receive);
  }""",
"""  createSessionBackend(receive: (...messages: string[]) => void): Backend {
    return this.#createBackend(true, receive, true);
  }"""
)])

edit("src/js/internal/inspector/cdp.ts", [
(
"""      default:
        // JSC- and Bun-specific events have no CDP equivalent.
        return;""",
"""      case "Bun.waitingForDebugger":
        // Synthesized by the inspected thread when it starts waiting for a
        // frontend, mirroring Node's RuntimeAgent::setWaitingForDebugger:
        // announce it to a session that already enabled the domain.
        if (this.#nodeRuntimeEnabled) {
          this.#emitToClient("NodeRuntime.waitingForDebugger", {});
        }
        return;

      default:
        // JSC- and Bun-specific events have no CDP equivalent.
        return;"""
)])
