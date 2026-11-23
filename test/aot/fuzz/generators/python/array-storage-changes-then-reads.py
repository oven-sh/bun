#!/usr/bin/env python3
"""array-storage-changes-then-reads.py <row 0..599>: A complete table: every way to create an array x every way to
change its storage kind x every way to read it.
"""
import sys
row = int(sys.argv[1]) if len(sys.argv) > 1 else 0
creators = {
 "ints": "[1, 2, 3]", "doubles": "[1.5, 2.5, 3.5]", "strings": '["a", "b", "c"]', "mixed": '[1, "b", 2.5, null]', "objects": "[{ n: 1 }, { n: 2 }]",
 "empty": "[]", "pushed": "(() => { const p = []; p.push(1); p.push(2); return p; })()", "holes": "[1, , 3]", "sized": "new Array(3)", "filled": "new Array(3).fill(7)",
 "from": "Array.from([1, 2])", "of": 'Array.of("x", "y")', "spread": "[...[8, 9]]", "mapped": "[3, 1, 2].map(x => x * 2)", "filtered": "[3, 1, 2].filter(x => x > 1)",
 "sliced": '["p", "q", "r"].slice(1)', "concat": "[1].concat([2, 3])", "keys": "Object.keys({ k: 1, l: 2 })", "values": "Object.values({ k: 1, l: 2 })", "entries": "Object.entries({ k: 1 })",
 "split": '"a,b,c".split(",")', "rest": "rest(1, 2)", "parsed": 'JSON.parse("[1,2,3]")', "match": '"ab".match(/(a)(b)/)', "names": "Object.getOwnPropertyNames({ k: 1, l: 2 })",
}
mutations = {
 "none": "", "far": 'a[5000] = "far";', "farNumber": "a[5000] = 9;", "lengthUp": "a.length = 120000;", "lengthSmallUp": "a.length = 10;", "lengthDown": "a.length = 1;", "lengthZero": "a.length = 0;",
 "getter": 'Object.defineProperty(a, 0, { get() { return "got"; }, configurable: true });', "readOnly": 'Object.defineProperty(a, 1, { value: "fixed", writable: false });',
 "freeze": "Object.freeze(a);", "seal": "Object.seal(a);", "prevent": "Object.preventExtensions(a);", "hole": "delete a[0];", "double": "a[0] = 0.5;", "string": 'a[0] = "s";', "nan": "a[1] = NaN;",
 "undef": "a[0] = undefined;", "object": "a[1] = { o: 1 };", "unshift": 'a.unshift("u");', "splice": "a.splice(0, 1);", "long": "for (let i = 0; i < 120000; i++) a.push(i); a.shift();",
 "longUnshift": 'for (let i = 0; i < 120000; i++) a.push(i); a.unshift("u", "v");', "proto": 'Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: "up", 7: "up7" });', "heir": "Object.create(a);",
 "name": 'a.tag = "t"; a["-1"] = "m"; a["1.5"] = "f";', "append": "a[a.length] = 4;", "gap": "a[a.length + 2] = 4;", "reverse": "a.reverse();", "pop": "a.pop(); a.pop(); a.pop(); a.pop();",
 "hidden": 'hidden(a, x => { x[5000] = "far"; });', "hiddenLength": "hidden(a, x => { x.length = 120000; });",
}
readers = {
 "i0": "a[0]", "i1": "a[1]", "i7": "a[7]", "last": "a[a.length - 1]", "i5000": "a[5000]", "at0": "a.at(0)", "atLast": "a.at(-1)", "at1": "a.at(1)", "length": "a.length",
 "includes": "a.includes(2)", "includesU": "a.includes(undefined)", "includesS": 'a.includes("far")', "indexOf": "a.indexOf(2)", "indexOfS": 'a.indexOf("far")', "lastIndexOf": 'a.lastIndexOf("far")',
 "join": "a.join().length", "joinHead": 'a.join("-").slice(0, 40)', "slice": "a.slice(0, 4)", "sliceEnd": "a.slice(-2)", "sliceAll": "a.slice().length", "concat": "a.concat([1]).length",
 "forOf": "(() => { let n = 0, s = ''; for (const x of a) { if (n++ < 9) s += show(x); } return s + n; })()", "forI": "(() => { let s = ''; for (let i = 0; i < a.length && i < 9; i++) s += show(a[i]); return s; })()",
 "forEach": "(() => { let n = 0, s = ''; a.forEach((x: any) => { if (n++ < 9) s += show(x); }); return s + n; })()", "map": "a.map((x: any) => x).slice(0, 5)", "filter": "a.filter((x: any) => x !== 2).slice(0, 5)",
 "reduce": "a.reduce((s: any, x: any) => s + 1, 0)", "some": 'a.some((x: any) => x === "far")', "every": "a.every((x: any) => x !== undefined)", "find": 'a.find((x: any) => x === "far")',
 "findIndex": "a.findIndex((x: any) => x === undefined)", "findLast": "a.findLast(() => true)", "findLastIndex": "a.findLastIndex((x: any) => x !== undefined)",
 "spread": "[...a].length", "spreadHead": "[...a].slice(0, 4)", "pattern": "(() => { const [p, q, r] = a; return [p, q, r]; })()", "patternRest": "(() => { const [p, ...r] = a; return [p, r.length]; })()",
 "from": "Array.from(a).length", "keys": "[...a.keys()].length", "entries": "[...a.entries()].slice(0, 2)", "objectKeys": "Object.keys(a).slice(0, 6)", "in0": "0 in a", "in5000": "5000 in a",
 "json": "JSON.stringify(a).slice(0, 40)", "string": "String(a).slice(0, 30)", "flat": "a.flat().length", "toSorted": "a.toSorted().slice(0, 3)", "toReversed": "a.toReversed().slice(0, 3)", "withAt": "a.with(0, 'w').slice(0, 2)",
 "pop": "a.pop()", "shift": "a.shift()", "push": "a.push(5)", "store0": "(a[0] = 'st', a[0])", "store1": "(a[1] = 1, a.slice(0, 3))", "sort": "a.sort().slice(0, 3)", "fill": "a.fill(0, 0, 2).slice(0, 3)", "apply": "Math.max.apply(null, a.slice(0, 3))",
 "spreadCall": "rest(...a).length", "isArray": "Array.isArray(a)", "hasOwn": "Object.hasOwn(a, 1)", "copyWithin": "a.copyWithin(0, 1, 2).slice(0, 3)", "indexLoopSum": "(() => { let t = 0; for (let i = 0; i < a.length; i++) if (typeof a[i] === 'number') t += a[i]; return t; })()",
}
head = '''const show = (v: any, d = 0): string => { if (v === null) return "null"; if (v === undefined) return "u"; const t = typeof v; if (t === "number") return Object.is(v, -0) ? "-0" : String(v); if (t === "string") return JSON.stringify(v); if (t === "function") return "fn"; if (t !== "object") return String(v); if (d > 2) return ".."; if (Array.isArray(v)) { const p = []; for (let i = 0; i < Math.min(v.length, 12); i++) p.push(i in v ? show(v[i], d + 1) : "_"); return "[" + p.join() + "]" + v.length; } return "{" + Object.keys(v).map(k => k + ":" + show(v[k], d + 1)).join() + "}"; };
function rest(...r: any[]) { return r; }
function hidden(a: any, f: (a: any) => void) { f(a); }
const attempt = (f: () => unknown): string => { try { return show(f()); } catch (e) { return "THROWS " + (e as Error).name; } };
'''
forms = ["local", "callee", "mutator", "field", "variable", "loop"]
names = list(creators)
cn = names[row % len(names)]; c = creators[cn]
form = forms[row // len(names) % len(forms)]
quarter = row // (len(names) * len(forms)) % 4
lines = [head]; table = []; n = 0
for index, (mn, m) in enumerate(mutations.items()):
    if index % 4 != quarter:
        continue
    for rn, r in readers.items():
        n += 1
        if form == "local":
            lines.append(f"function g{n}() {{ const a: any = {c}; {m} return {r}; }}")
        elif form == "callee":
            lines.append(f"function r{n}(a: any) {{ return {r}; }} function g{n}() {{ const a: any = {c}; {m} return r{n}(a); }}")
        elif form == "mutator":
            lines.append(f"function m{n}(a: any) {{ {m} }} function g{n}() {{ const a: any = {c}; m{n}(a); return {r}; }}")
        elif form == "field":
            lines.append(f"function g{n}() {{ const o: any = {{ list: {c} }}; {{ const a = o.list; {m} }} const a = o.list; return {r}; }}")
        elif form == "variable":
            lines.append(f"let v{n}: any; function s{n}() {{ const a = v{n}; {m} }} function g{n}() {{ v{n} = {c}; s{n}(); const a = v{n}; return {r}; }}")
        else:
            lines.append(f"function g{n}() {{ const a: any = {c}; let s = ''; for (let i = 0; i < 2; i++) {{ if (i) {{ {m} }} s += show({r}) + ';'; }} return s; }}")
        table.append(f'["{mn} {rn}", g{n}]')
lines.append("const ALL: [string, () => unknown][] = [" + ", ".join(table) + "];")
lines.append('for (let turn = 0; turn < 2; turn++) for (const [name, f] of ALL) { const r = attempt(f); console.log(turn + " " + name + ": " + r); }')
print("\n".join(lines))
