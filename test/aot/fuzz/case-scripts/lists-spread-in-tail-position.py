#!/usr/bin/env python3
"""lists-spread-in-tail-position.py <folder>: Writes one file per case. A list that may lie in the caller's frame (a rest parameter, a literal, `arguments`) is spread in a call in tail position: the frame is given up while the callee's words are written.
How the list is made x how it is handed on x who takes it x how long it is. Each prints texts of primitives."""
import os, sys
out = sys.argv[1]
H = '''let said = "";
const G = globalThis;
function name(e) { return "threw " + e.constructor.name; }
function digest(list) { let h = 7; for (let i = 0; i < list.length; i++) h = (h * 31 + (typeof list[i] === "number" ? list[i] : String(list[i]).length)) % 1000003; return list.length + ":" + h + ":" + String(list[0]) + ":" + String(list[list.length - 1]); }
'''
TAKES = {
 "a-rest-parameter": "function takes(...all) { return digest(all); }",
 "arguments": "function takes() { return digest(arguments); }",
 "twelve-parameters": "function takes(a, b, c, d, e, f, g, h, i, j, k, l) { return digest([a, b, c, d, e, f, g, h, i, j, k, l]); }",
 "two-and-a-rest": "function takes(a, b, ...more) { return String(a) + '/' + String(b) + '/' + digest(more); }",
 "hands-on-again": "function last(...all) { return digest(all); }\nfunction takes(...all) { return last(...all); }",
 "works-deep-first": "function deep(d, x) { const a = x + d, b = [a, d]; return d > 0 ? deep(d - 1, a) + b[1] - d : 0; }\nfunction takes(...all) { deep(40, 1); return digest(all); }",
 "collects-first": "function takes(...all) { Bun.gc(true); return digest(all); }",
}
GIVES = {
 "a-rest-spread": "function gives(...rest) { return WAY(...rest); }",
 "a-rest-spread-behind-a-value": "function gives(...rest) { return WAY(-1, ...rest); }",
 "a-rest-spread-twice": "function gives(...rest) { return WAY(...rest, ...rest); }",
 "a-rest-by-apply": "function gives(...rest) { return WAY.apply(null, rest); }",
 "a-rest-by-reflect-apply": "function gives(...rest) { return Reflect.apply(WAY, null, rest); }",
 "arguments-spread": "function gives() { return WAY(...arguments); }",
 "arguments-by-apply": "function gives() { return WAY.apply(null, arguments); }",
 "a-literal-of-the-rest": "function gives(...rest) { return WAY(...[0, ...rest, 0]); }",
 "a-slice-of-the-rest": "function gives(...rest) { return WAY(...rest.slice(1)); }",
 "a-map-of-the-rest": "function gives(...rest) { return WAY(...rest.map(x => x)); }",
 "a-local-list-filled-in-a-loop": "function gives(...rest) { const list = []; for (let i = 0; i < rest.length; i++) list.push(rest[i]); return WAY(...list); }",
 "the-rest-changed-first": "function gives(...rest) { rest.push('end'); rest[0] = 'first'; return WAY(...rest); }",
 "first-and-a-rest": "function gives(first, ...rest) { return WAY(...rest, first); }",
 "not-in-tail-position-control": "function gives(...rest) { const r = WAY(...rest); return r; }",
 "in-a-ring": "function gives(n, ...rest) { return n > 0 ? back(n - 1, ...rest) : WAY(...rest); }\nfunction back(n, ...rest) { return gives(n, ...rest); }",
}
P = {}
for g, gives in GIVES.items():
    for t, takes in TAKES.items():
        for w, (pre, way) in {"direct": ("", "takes"), "by-value": ("const ways = [takes, digest];\n", "ways[G.nothing ? 1 : 0]")}.items():
            ring = g == "in-a-ring"
            call = "gives(%s...list)" % ("100001, " if ring else "")
            P["%s--%s--%s.mjs" % (g, t, w)] = H + takes + "\n" + pre + gives.replace("WAY", way) + "\nfor (const size of [0, 1, 2, 5, 8, 9, 13, 16, 33, 100, 1000%s]) {\n  const list = []; for (let i = 0; i < size; i++) list.push(i %% 3 === 2 ? 't' + i : i %% 3 === 1 ? i + 0.5 : i);\n  let r; try { r = %s; } catch (e) { r = name(e); }\n  said += size + '=' + r + '\\n';\n}\nconsole.log(said);\n" % ("" if ring else ", 20000", call)
for n, t in P.items(): open(os.path.join(out, n), "w").write(t)
open(os.path.join(out, "LIST.txt"), "w").write("\n".join(sorted(P)) + "\n")
print(len(P), "programs")
