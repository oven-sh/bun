#!/usr/bin/env python3
"""Match Node v26.3.0's --inspect announce lines on the CDP-on-CLI path.

Edits src/js/internal/debugger.ts only:
1. Help URL -> https://nodejs.org/learn/getting-started/debugging (v26 wording).
2. Advertise 127.0.0.1 (not "localhost") in the Debugger-listening line for the
   default bind, via a #cdpHost field set where the loopback listener is bound.
Each replacement must occur exactly once; abort loudly otherwise.
"""

import sys

PATH = "/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/js/internal/debugger.ts"

edits = [
    (
        "`Debugger listening on ${cdpUrl}\\nFor help, see: https://nodejs.org/en/docs/inspector\\n`,",
        "`Debugger listening on ${cdpUrl}\\nFor help, see: https://nodejs.org/learn/getting-started/debugging\\n`,",
    ),
    (
        "  #cdpPathname?: string;",
        "  #cdpPathname?: string;\n"
        "  // Host advertised in the \"Debugger listening on\" line; Node prints 127.0.0.1\n"
        "  // for the default bind, not \"localhost\".\n"
        "  #cdpHost?: string;",
    ),
    (
        "    return `ws://${this.#url.host}${this.#cdpPathname}`;",
        "    return `ws://${this.#cdpHost ?? this.#url.host}${this.#cdpPathname}`;",
    ),
    (
        "            } catch {\n"
        "              // Already bound by the primary listener, or unavailable.\n"
        "            }\n"
        "          }",
        "            } catch {\n"
        "              // Already bound by the primary listener, or unavailable.\n"
        "            }\n"
        "          }\n"
        "          // Between the primary and loopback listeners 127.0.0.1 is always\n"
        "          // bound here, so advertise it the way Node's default bind does.\n"
        "          this.#cdpHost = `127.0.0.1:${server.port}`;",
    ),
]

src = open(PATH).read()
for old, new in edits:
    n = src.count(old)
    if n != 1:
        print(f"FATAL: expected 1 occurrence, found {n}:\n{old[:120]}", file=sys.stderr)
        sys.exit(1)
    src = src.replace(old, new)
open(PATH, "w").write(src)
print("ok: 4 edits applied")
