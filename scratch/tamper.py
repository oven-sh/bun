import subprocess, os, tempfile, sys
ROOT = "/Users/ciro/code/bun/.claude/worktrees/wave-insp"
SRC = "/Users/ciro/code/node-v26.3.0/test/parallel"
TAMPERS = {
 "test-inspector-ip-detection.js": ("assert.strictEqual(ip, match[1]);", "assert.strictEqual(ip + 'x', match[1]);"),
 "test-inspector-reported-host.js": ("assert.ok(", "assert.ok(!"),
 "test-inspector-not-blocked-on-idle.js": ("'method': 'Debugger.pause'", "'method': 'Debugger.bogusMethodXYZ'"),
 "test-inspector-stress-http.js": ("assert(!result.some((a) => !a), 'Some attempts failed');", "assert(result.some((a) => !a), 'Some attempts failed');"),
}
def run(path):
    t = tempfile.mkdtemp()
    env = dict(os.environ, TMPDIR=t, TEST_TMPDIR=t, FORCE_COLOR="0", NO_COLOR="1",
               BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING="1", BUN_GARBAGE_COLLECTOR_LEVEL="1",
               BUN_DEBUG_QUIET_LOGS="1")
    p = subprocess.run([f"{ROOT}/build/release/bun", "run", f"--config={ROOT}/bunfig.node-test.toml", path],
                       env=env, capture_output=True, timeout=90)
    return p.returncode
for name, (old, new) in TAMPERS.items():
    src = open(f"{SRC}/{name}").read()
    dst = f"{ROOT}/test/js/node/test/parallel/{name}"
    open(dst, "w").write(src)
    codes = [run(dst) for _ in range(3)]
    assert src.count(old) == 1, (name, "tamper anchor", src.count(old))
    open(dst, "w").write(src.replace(old, new))
    tampered = run(dst)
    os.remove(dst)
    print(f"{name}: clean={codes} tampered={tampered} -> {'OK' if all(c==0 for c in codes) and tampered!=0 else 'SUSPECT'}")
