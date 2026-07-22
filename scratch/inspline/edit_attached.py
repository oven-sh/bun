#!/usr/bin/env python3
"""Print Node's "Debugger attached." line when a CDP frontend connects.

Gated to node-CDP / node:inspector WebSocket sessions in #open; Bun's own
JSC-protocol connections are untouched.
"""
p = "/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/js/internal/debugger.ts"
old = """    if (this.#nodeInspector || data.isCDP) {
      // node:inspector clients speak CDP; the adapter sits between the"""
new = """    if (this.#nodeInspector || data.isCDP) {
      // Node prints this on every remote session attach; tools gate on it.
      Bun.write(Bun.stderr, "Debugger attached.\\n");
      // node:inspector clients speak CDP; the adapter sits between the"""
s = open(p).read()
assert s.count(old) == 1, s.count(old)
open(p, "w").write(s.replace(old, new))
print("ok")
