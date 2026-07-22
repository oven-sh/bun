#!/usr/bin/env python3
"""Answer invalid CDP client messages the way V8's dispatcher does.

Unparseable JSON, non-object payloads, and missing methods get
{"id":<id|0>,"error":{"code":-32601,"message":"'' wasn't found"}} instead of
being silently dropped (node test-inspector-invalid-protocol gates on this).
"""
p = "/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/js/internal/inspector/cdp.ts"
old = """  handleClientMessage(message: string): void {
    let parsed: AnyObject;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const { id, method, params } = parsed;
    if (typeof method !== "string") return;
"""
new = """  handleClientMessage(message: string): void {
    let parsed: AnyObject;
    try {
      parsed = JSON.parse(message);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object") {
      // V8's dispatcher answers unparseable input with method-not-found on
      // id 0 rather than dropping it.
      this.#replyErrorToClient(0, -32601, "'' wasn't found");
      return;
    }
    const { id, method, params } = parsed;
    if (typeof method !== "string") {
      this.#replyErrorToClient(id ?? 0, -32601, "'' wasn't found");
      return;
    }
"""
s = open(p).read()
assert s.count(old) == 1, s.count(old)
open(p, "w").write(s.replace(old, new))
print("ok")
