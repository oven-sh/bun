p = "src/jsc/Debugger.rs"
s = open(p).read()

old = """    safe fn Bun__startJSDebuggerThread(
        global: &JSGlobalObject,
        ctx_id: u32,
        url: &mut BunString,
        from_env: c_int,
        is_connect: bool,
        is_node_inspector: bool,
    );"""
new = """    safe fn Bun__startJSDebuggerThread(
        global: &JSGlobalObject,
        ctx_id: u32,
        url: &mut BunString,
        from_env: c_int,
        is_connect: bool,
        is_node_inspector: bool,
        enable_node_cdp: bool,
    );"""
assert s.count(old) == 1
s = s.replace(old, new)

old = """            Bun__startJSDebuggerThread(global, ctx_id, &mut url, 1, is_connect, false);"""
new = """            Bun__startJSDebuggerThread(global, ctx_id, &mut url, 1, is_connect, false, false);"""
assert s.count(old) == 1
s = s.replace(old, new)

old = """        if let Some(path_or_port) = path_or_port {
            let mut url = BunString::clone_utf8(path_or_port);
            let _scope = this.enter_event_loop_scope();
            Bun__startJSDebuggerThread(global, ctx_id, &mut url, 0, is_connect, is_node_inspector);
        }"""
new = """        if let Some(path_or_port) = path_or_port {
            let mut url = BunString::clone_utf8(path_or_port);
            let _scope = this.enter_event_loop_scope();
            // A `--inspect*` server keeps speaking the JSC protocol on its own
            // pathname (debug.bun.sh, the VSCode extension), and additionally
            // serves Node's `/json` discovery endpoints plus a second pathname
            // that speaks the V8 CDP, so `node --inspect`-shaped clients can
            // attach. `inspector.open()` servers are CDP-only and already
            // covered by `is_node_inspector`.
            let enable_node_cdp = !is_node_inspector && !is_connect;
            Bun__startJSDebuggerThread(
                global,
                ctx_id,
                &mut url,
                0,
                is_connect,
                is_node_inspector,
                enable_node_cdp,
            );
        }"""
assert s.count(old) == 1
s = s.replace(old, new)
open(p, "w").write(s)
print("patched", p)

p = "src/jsc/bindings/BunDebugger.cpp"
s = open(p).read()
old = "extern \"C\" void Bun__startJSDebuggerThread(Zig::GlobalObject* debuggerGlobalObject, ScriptExecutionContextIdentifier scriptId, BunString* portOrPathString, int isAutomatic, bool isUrlServer, bool isNodeInspector)"
new = "extern \"C\" void Bun__startJSDebuggerThread(Zig::GlobalObject* debuggerGlobalObject, ScriptExecutionContextIdentifier scriptId, BunString* portOrPathString, int isAutomatic, bool isUrlServer, bool isNodeInspector, bool enableNodeCDP)"
assert s.count(old) == 1
s = s.replace(old, new)
old = """    arguments.append(jsBoolean(isNodeInspector));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 3, String("reportNodeInspectorServerStarted"_s), jsFunctionReportNodeInspectorServerStarted, ImplementationVisibility::Public));"""
new = """    arguments.append(jsBoolean(isNodeInspector));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 3, String("reportNodeInspectorServerStarted"_s), jsFunctionReportNodeInspectorServerStarted, ImplementationVisibility::Public));
    arguments.append(jsBoolean(enableNodeCDP));"""
assert s.count(old) == 1
s = s.replace(old, new)
open(p, "w").write(s)
print("patched", p)
