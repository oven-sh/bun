#!/usr/bin/env python3
"""array-storage-changes-during-walks.py <row 0..17>: A complete table: every way to change an array's storage kind,
done by code that runs in the middle of an iteration over it: a callback, an argument conversion, toString, toJSON or
a getter.
"""
import sys
row = int(sys.argv[1]) if len(sys.argv) > 1 else 0
creators = { "ints": "[1, 2, 3, 4]", "doubles": "[1.5, 2.5, 3.5, 4.5]", "strings": '["a", "b", "c", "d"]', "objects": "[{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]", "mixed": '[1, "b", { n: 3 }, 4.5]',
  "keys": "Object.keys({ k: 1, l: 2, m: 3, n: 4 })", "mapped": "[3, 1, 2, 5].map(x => x * 2)", "split": '"a,b,c,d".split(",")', "pushed": "(() => { const p = []; for (let i = 0; i < 4; i++) p.push({ n: i }); return p; })()" }
mutations = { "far": 'a[5000] = "far";', "lengthUp": "a.length = 120000;", "lengthDown": "a.length = 2;", "lengthZero": "a.length = 0;", "getter": 'Object.defineProperty(a, 2, { get() { return "got"; }, configurable: true });',
  "freeze": "Object.freeze(a);", "hole": "delete a[2];", "double": "a[2] = 0.5;", "string": 'a[2] = "s";', "object": "a[2] = { n: 9 };", "unshift": 'a.unshift("u");', "shift": "a.shift();", "splice": "a.splice(1, 2);",
  "long": "for (let i = 0; i < 120000; i++) a.push(i); a.shift();", "proto": 'delete a[2]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 2: "up" });', "push": "a.push(7, 8);", "pop": "a.pop(); a.pop();", "reverse": "a.reverse();", "fill": "a.fill(0.25);" }
# `hit()` runs the mutation once, at the second step of the walk
walks = {
 "forEach": "a.forEach((x: any) => { hit(); note(x); })", "map": "note(a.map((x: any) => { hit(); return x; }).slice(0, 6))", "filter": "note(a.filter((x: any) => { hit(); return true; }).slice(0, 6))",
 "reduce": "note(a.reduce((s: any, x: any) => { hit(); return s + show(x); }, ''))", "reduceRight": "note(a.reduceRight((s: any, x: any) => { hit(); return s + show(x); }, ''))",
 "some": "note(a.some((x: any) => { hit(); note(x); return false; }))", "every": "note(a.every((x: any) => { hit(); note(x); return true; }))", "find": "note(a.find((x: any) => { hit(); note(x); return false; }))",
 "findLast": "note(a.findLast((x: any) => { hit(); note(x); return false; }))", "findIndex": "note(a.findIndex((x: any) => { hit(); note(x); return false; }))", "flatMap": "note(a.flatMap((x: any) => { hit(); return [x]; }).slice(0, 6))",
 "forOf": "for (const x of a) { hit(); note(x); if (steps > 8) break; }", "forI": "for (let i = 0; i < a.length && i < 8; i++) { hit(); note(a[i]); }", "forICached": "for (let i = 0, n = a.length; i < n && i < 8; i++) { hit(); note(a[i]); }",
 "entries": "for (const [i, x] of a.entries()) { hit(); note(i); note(x); if (steps > 8) break; }", "from": "note(Array.from(a, (x: any) => { hit(); return x; }).slice(0, 6))", "sort": "note(a.sort((p: any, q: any) => { hit(); return 0; }).slice(0, 6))",
 "toSorted": "note(a.toSorted((p: any, q: any) => { hit(); return 0; }).slice(0, 6))", "pattern": "{ const [p, q = (hit(), hit(), 'd'), r, s] = a; note([p, q, r, s]); }",
 "join": "a[1] = { toString() { hit(); hit(); return 'T'; } }; note(a.join().slice(0, 30))", "string": "a[1] = { toString() { hit(); hit(); return 'T'; } }; note(String(a).slice(0, 30))",
 "json": "a[1] = { toJSON() { hit(); hit(); return 'J'; } }; note(JSON.stringify(a).slice(0, 60))", "jsonGetter": "a[1] = { get g() { hit(); hit(); return 'G'; } }; note(JSON.stringify(a).slice(0, 60))",
 "jsonReplacer": "note(JSON.stringify(a, (k, v) => { hit(); return v; }).slice(0, 60))", "includes": "note(a.includes({ valueOf() { hit(); hit(); return 1; } }))", "indexOfFrom": "note(a.indexOf(4, { valueOf() { hit(); hit(); return 0; } } as any))",
 "sliceFrom": "note(a.slice({ valueOf() { hit(); hit(); return 0; } } as any, 4))", "atIndex": "note(a.at({ valueOf() { hit(); hit(); return 2; } } as any))", "fillValue": "note(a.fill(1, { valueOf() { hit(); hit(); return 0; } } as any, 3).slice(0, 5))",
 "spliceCount": "note(a.splice(0, { valueOf() { hit(); hit(); return 1; } } as any))", "withIndex": "note(a.with({ valueOf() { hit(); hit(); return 1; } } as any, 'w').slice(0, 5))", "concatSpreadable": "note([0].concat(a, { get [Symbol.isConcatSpreadable]() { hit(); hit(); return false; } } as any, a).length)",
 "copyWithin": "note(a.copyWithin(0, { valueOf() { hit(); hit(); return 1; } } as any).slice(0, 5))", "lastIndexOfFrom": "note(a.lastIndexOf(1, { valueOf() { hit(); hit(); return 3; } } as any))", "storeValue": "a[2] = (hit(), hit(), 'v'); note(a.slice(0, 5))",
 "storeKey": "a[(hit(), hit(), 1)] = 'k'; note(a.slice(0, 5))", "readKey": "note(a[(hit(), hit(), 2)])", "pushValue": "note(a.push((hit(), hit(), 'p'))); note(a.slice(0, 7))", "spreadCall": "note(rest(...a, (hit(), hit(), 1), ...a).length)",
}
head = '''const show = (v: any, d = 0): string => { if (v === null) return "null"; if (v === undefined) return "u"; const t = typeof v; if (t === "number") return Object.is(v, -0) ? "-0" : String(v); if (t === "string") return JSON.stringify(v); if (t === "function") return "fn"; if (t !== "object") return String(v); if (d > 2) return ".."; if (Array.isArray(v)) { const p = []; for (let i = 0; i < Math.min(v.length, 12); i++) p.push(i in v ? show(v[i], d + 1) : "_"); return "[" + p.join() + "]" + v.length; } return "{" + Object.keys(v).map(k => k + ":" + show(v[k], d + 1)).join() + "}"; };
function rest(...r: any[]) { return r; }
const attempt = (f: () => unknown): string => { try { return show(f()); } catch (e) { return "THROWS " + (e as Error).name; } };
'''
names = list(creators)
cn = names[row % len(names)]; c = creators[cn]
half = row // len(names) % 2
lines = [head]; table = []; n = 0
for index, (mn, m) in enumerate(mutations.items()):
    if index % 2 != half:
        continue
    for wn, w in walks.items():
        n += 1
        lines.append(f"function g{n}() {{ const a: any = {c}; let steps = 0, said = ''; const note = (v: any) => {{ said += show(v) + ','; }}; const hit = () => {{ if (++steps === 2) {{ {m} }} }}; {w}; return said + show(a.slice(0, 6)) + a.length; }}")
        table.append(f'["{mn} {wn}", g{n}]')
lines.append("const ALL: [string, () => unknown][] = [" + ", ".join(table) + "];")
lines.append('for (let turn = 0; turn < 2; turn++) for (const [name, f] of ALL) { const r = attempt(f); console.log(turn + " " + name + ": " + r); }')
print("\n".join(lines))
