# BunProcess: chdir invalidates the cwd cache (Node clears cachedCwd on
# chdir and repopulates lazily via uv_cwd, so a deleted cwd throws).
import pathlib
root = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp")

f = root / "src/jsc/bindings/BunProcess.h"
s = f.read_text()
old = '''    void setCachedCwd(JSC::VM& vm, JSString* cwd) { m_cachedCwd.set(vm, this, cwd); }'''
new = '''    void setCachedCwd(JSC::VM& vm, JSString* cwd) { m_cachedCwd.set(vm, this, cwd); }
    void clearCachedCwd() { m_cachedCwd.clear(); }'''
assert s.count(old) == 1, "BunProcess.h"
s = s.replace(old, new)
f.write_text(s)

f = root / "src/jsc/bindings/BunProcess.cpp"
s = f.read_text()
old = '''    auto* processObject = defaultGlobalObject(globalObject)->processObject();
    processObject->setCachedCwd(vm, result.toStringOrNull(globalObject));
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));'''
new = '''    auto* processObject = defaultGlobalObject(globalObject)->processObject();
    // Node clears its cwd cache on chdir (does_own_process_state.js) and lets
    // the next process.cwd() re-query the OS - do not re-populate it here.
    processObject->clearCachedCwd();
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));'''
assert s.count(old) == 1, "BunProcess.cpp chdir"
s = s.replace(old, new)
f.write_text(s)
print("edit7 OK")
