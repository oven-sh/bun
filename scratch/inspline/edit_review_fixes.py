#!/usr/bin/env python3
"""Apply code-review fixes.

1. debugger.ts: only advertise 127.0.0.1 when we can prove it is bound: either
   the loopback listener bound (either family: if it got ::1 the primary must
   hold 127.0.0.1, else the ::1 bind would have failed). If both loopback binds
   failed, leave #cdpHost unset and fall back to the primary host as before.
2. cdp.ts: collapse the two malformed-message guards into one (same reply).
"""
import sys

p1 = "/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/js/internal/debugger.ts"
old1 = """          // Between the primary and loopback listeners 127.0.0.1 is always
          // bound here, so advertise it the way Node's default bind does.
          this.#cdpHost = `127.0.0.1:${server.port}`;"""
new1 = """          // Advertise 127.0.0.1 as Node's default bind does, but only when
          // provably bound: a loopback listener on ::1 implies the primary
          // holds 127.0.0.1, else that ::1 bind would have failed too.
          if (this.#loopbackServer) this.#cdpHost = `127.0.0.1:${server.port}`;"""

p2 = "/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/js/internal/inspector/cdp.ts"
old2 = """    } catch {
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
    }"""
new2 = """    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.method !== "string") {
      // V8's dispatcher answers any malformed message (unparseable, non-object,
      // or method-less) with method-not-found on the given id, 0 otherwise.
      this.#replyErrorToClient(parsed?.id ?? 0, -32601, "'' wasn't found");
      return;
    }
    const { id, method, params } = parsed;"""

for p, old, new in [(p1, old1, new1), (p2, old2, new2)]:
    s = open(p).read()
    if s.count(old) != 1:
        print(f"FATAL {p}: {s.count(old)}", file=sys.stderr); sys.exit(1)
    open(p, "w").write(s.replace(old, new))
print("ok: 2 fixes applied")
