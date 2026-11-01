#!/usr/bin/env python3
"""literal-unions.py <folder>: A type of literals says WHICH CHARACTERS a text has, not which object it is, nor that it is joined, flat or hashed. A member of
`"red" | "green" | "blue"` is made at run time in 27 ways (a + b, a template, concat, slice | substring | substr, a part of a joined text, repeat, padEnd, replace, join,
fromCharCode, toLowerCase, normalize, trim, a 16-bit twin, Buffer, TextDecoder, a match, a key, JSON.parse, split) out of pieces that the build doesn't know, crosses a border
(parameter, return, module variable, field, element, closure) and is used in 87 ways: === and switch, a table's key read | written | asked for | deleted, Map and Set, lists,
the text's own methods, a field | member | element read later, a tag that is narrowed, an enum, keyof typeof, satisfies, a const assertion, a table of functions, a generic; and
held against A SECOND MADE TEXT of the same characters. In a loop of 50 turns or of 3; with a constant beside it at the call or none. Also for unions of texts that look like
numbers, of 16-bit texts and of texts that differ in one character. No cast lies: every made text is a member of its union. The driver walks a list out of JSON: a loop of three
constant turns is unrolled, and then no constant stands beside the made text. One file a case: <words>.<use>.<maker>.<crossing>.<hot|cold>.<beside|none>.ts; three numbers are printed.
Then a lookup behind other uses of the key, a member of a union of 54 literals: chain.<steps>.<T|S|O>.<in|out>.<loop|once>.ts: a text cut by slice, any of five steps (i list.includes(x),
a x === "..", r recordA[x], s recordB[x], b x === ".."), then has(x) of a ReadonlySet<string> of four names; T: the comparisons are true for the first text, S: false with the same length,
O: false with another length. joins.<operation>.<rope|slice>.<beside|none>.ts: one of 29 operations in front of the has(), in the same function; before.<..>.ts: the same at the caller, the
has() alone in the callee: hardly any operation joins a text or copies a part of one, so whatever is compiled behind it may not take the text for flat.
"""
import itertools, json, os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
WORDS = {"colors": ["red", "green", "blue"], "digits": ["100", "211", "322"], "wide": ["\u8d64\u3044\u3088", "\u7dd1\u8272\u306e", "\u9752\u3044\u306d"], "near": ["green", "greem", "greeN"]}
def data(w):
    d = {"H": [x[:-2] for x in w], "T": [x[-2:] for x in w], "A": [x[:1] for x in w], "M": [x[1:2] for x in w], "Z": [x[2:] for x in w], "P": ["x" + x + "x" for x in w], "U": [x.upper() for x in w], "S": [" " + x + " " for x in w],
         "C": [[ord(c) for c in x] for x in w], "Q": [json.dumps(x) for x in w], "L": ",".join(w), "W": [x + "\u0100" for x in w], "O": [{x: 1} for x in w], "X": "\u0100", "I": [0, 1, 2]}
    return "const D = JSON.parse(" + json.dumps(json.dumps(d)) + ") as { H: string[]; T: string[]; M: string[]; A: string[]; Z: string[]; P: string[]; U: string[]; S: string[]; C: number[][]; Q: string[]; L: string; W: string[]; O: Record<string, number>[]; X: string; I: number[] };\n"
DATA = "\0DATA\0"
MAKERS = {
 "rope": "D.H[i] + D.T[i]", "rope3": "D.A[i] + (D.M[i] + D.Z[i])", "template": "`${D.H[i]}${D.T[i]}`", "concat": "D.H[i].concat(D.T[i])", "concat0": '"".concat(D.H[i], D.T[i])',
 "slice": "D.P[i].slice(1, -1)", "substring": "D.P[i].substring(1, D.P[i].length - 1)", "substr": "D.P[i].substr(1, D.P[i].length - 2)", "slice-of-rope": '("x" + D.H[i] + D.T[i] + "x").slice(1, -1)',
 "repeat": "D.H[i] + D.T[i].repeat(1)", "padEnd": "D.H[i].padEnd(D.H[i].length + D.T[i].length, D.T[i])", "replace": 'D.P[i].replace(/x/g, "")', "replaceAll": 'D.P[i].replaceAll("x", "")',
 "join": '[D.H[i], D.T[i]].join("")', "codes": "String.fromCharCode(...D.C[i])", "lower": "D.U[i].toLowerCase()", "normalize": "(D.H[i] + D.T[i]).normalize()", "trim": "D.S[i].trim()",
 "wide": "D.W[i].slice(0, -1)", "wide-rope": "(D.X + D.H[i]).slice(1) + D.T[i]", "buffer": "Buffer.from(D.C[i]).toString()", "decoder": "new TextDecoder().decode(new Uint8Array(D.C[i]))",
 "matched": "/[a-z]+/.exec(D.S[i])![0]", "key": "Object.keys(D.O[i])[0]", "spread": '[...D.P[i]].slice(1, -1).join("")', "parsed": "JSON.parse(D.Q[i])", "split": 'D.L.split(",")[i]',
}
T = 'type Color = "red" | "green" | "blue";\n'
TABLE = "const table: Record<Color, number> = { red: 1, green: 2, blue: 3 };\n"
NAMES = 'const names: Color[] = ["red", "green", "blue"];\n'
MAP = 'const map = new Map<Color, number>([["red", 1], ["green", 2], ["blue", 3]]);\n'
SET = 'const set = new Set<Color>(["red", "green"]);\n'
# A use: the types, the declarations of the module, a number out of X (the text) and k (the turn).
USES = {
 "eq": (T, "", '(X === "green" ? 1 : 0)'), "ne": (T, "", '(X !== "green" ? 1 : 0)'), "loose": (T, "", '(X == "green" ? 1 : 0)'), "is": (T, "", '(Object.is(X, "green") ? 1 : 0)'),
 "switch": (T, "function pick(c: Color): number { switch (c) { case \"red\": return 1; case \"green\": return 2; case \"blue\": return 3; } return -1; }\n", "pick(X)"),
 "chain": (T, "", '(X === "red" ? 1 : X === "green" ? 2 : X === "blue" ? 3 : -1)'),
 "table-read": (T, TABLE, "(table[X] ?? -1)"), "table-write": (T, "const counts: Partial<Record<Color, number>> = {};\n", "((counts[X] = k), (counts.green ?? -1) + Object.keys(counts).length * 100)"),
 "in": (T, TABLE, "(X in table ? 1 : 0)"), "hasOwn": (T, TABLE, "(Object.hasOwn(table, X) ? 1 : 0)"), "hasOwnProperty": (T, TABLE, "(table.hasOwnProperty(X) ? 1 : 0)"), "reflect-get": (T, TABLE, "((Reflect.get(table, X) as number | undefined) ?? -1)"),
 "delete-key": (T, "", "(() => { const o: Partial<Record<Color, number>> = { red: 1, green: 2, blue: 3 }; delete o[X]; return Object.keys(o).length * 10 + (o.green ?? 0); })()"),
 "map-get": (T, MAP, "(map.get(X) ?? -1)"), "map-has": (T, MAP, "(map.has(X) ? 1 : 0)"), "map-set": (T, "const made = new Map<Color, number>();\n", '(made.set(X, k), made.size * 100 + (made.get("green") ?? -1))'),
 "map-delete": (T, "", '(() => { const m = new Map<Color, number>([["red", 1], ["green", 2]]); return (m.delete(X) ? 10 : 0) + m.size; })()'),
 "map-string-keys": (T, 'const map = new Map<string, number>([["red", 1], ["green", 2], ["blue", 3]]);\n', "(map.get(X) ?? -1)"),
 "map-made-of-it": (T, "", '(new Map<Color, number>([[X, 7]]).get("green") ?? -1)'), "map-found-by-it": (T, "const stored = new Map<Color, number>();\n", '(stored.set("green", k), stored.get(X) ?? -1)'),
 "set-has": (T, SET, "(set.has(X) ? 1 : 0)"), "set-add": (T, "const seen = new Set<Color>();\n", '(seen.add(X), seen.size * 10 + (seen.has("green") ? 1 : 0))'),
 "set-delete": (T, "", '(() => { const s = new Set<Color>(["red", "green"]); return (s.delete(X) ? 10 : 0) + s.size; })()'), "set-made-of-it": (T, "", '(new Set<Color>([X]).has("green") ? 1 : 0)'),
 "keys-includes": (T, TABLE, "(Object.keys(table).includes(X) ? 1 : 0)"), "includes": (T, NAMES, "(names.includes(X) ? 1 : 0)"), "indexOf": (T, NAMES, "names.indexOf(X)"), "lastIndexOf": (T, NAMES, "names.lastIndexOf(X)"),
 "findIndex": (T, NAMES, "names.findIndex(name => name === X)"), "entries-find": (T, TABLE, "(Object.entries(table).find(([name]) => name === X)?.[1] ?? -1)"),
 "template": (T, "", "(`${X}!`.length * 1000 + `${X}!`.charCodeAt(2))"), "plus": (T, "", '((X + "!").length * 1000 + (X + "!").charCodeAt(1))'), "length": (T, "", "X.length"), "charCodeAt": (T, "", "X.charCodeAt(0)"),
 "index": (T, "", "X[0].charCodeAt(0)"), "at": (T, "", "X.at(-1)!.charCodeAt(0)"), "localeCompare": (T, "", 'X.localeCompare("green")'), "less": (T, "", '(X < "h" ? 1 : 0)'), "regexp": (T, "", "(/^green$/.test(X) ? 1 : 0)"),
 "stringify": (T, "", "JSON.stringify(X).length"), "upper": (T, "", "X.toUpperCase().charCodeAt(1)"), "startsWith": (T, "", '(X.startsWith("gr") ? 1 : 0)'), "typeof": (T, "", '(typeof X === "string" ? 1 : 0)'),
 "split-by": (T, "", '"a green b red c".split(X).length'), "charAt": (T, "", "X.charAt(0).charCodeAt(0)"), "number": (T, "", "(Number.isNaN(Number(X)) ? 1 : 0)"), "indexOf-in-text": (T, "", '"a green b red c".indexOf(X)'),
 "replace-it": (T, "", '"a green b red c".replace(X, "").length'), "text-includes": (T, "", '("a green b".includes(X) ? 1 : 0)'), "endsWith": (T, "", '(X.endsWith("en") ? 1 : 0)'), "code-sum": (T, "", "(() => { let sum = 0; for (let at = 0; at < X.length; at++) sum = (sum * 31 + X.charCodeAt(at)) | 0; return sum; })()"),
 "object-key-literal": (T, "", "(() => { const o = { [X]: 5 } as Partial<Record<Color, number>>; return (o.green ?? -1) + Object.keys(o)[0].length * 10; })()"),
 "sort": (T, "", '[X, "blue" as Color, "red" as Color].sort()[1].length'),
 "class-field": (T, MAP + "class Box { constructor(public color: Color) {} }\n", '(() => { const box = new Box(X); return (box.color === "green" ? 10 : 0) + (map.get(box.color) ?? -1); })()'),
 "record-member": (T, MAP, '(() => { const record: { color: Color } = { color: X }; return (record.color === "green" ? 10 : 0) + (map.get(record.color) ?? -1); })()'),
 "array-element": (T, MAP, '(() => { const own: Color[] = [X]; return (own[0] === "green" ? 10 : 0) + (map.get(own[0]) ?? -1); })()'),
 "tag-if": (T + "type Shape = { kind: \"red\"; r: number } | { kind: \"green\"; g: number } | { kind: \"blue\"; b: number };\n", 'function area(shape: Shape): number { if (shape.kind === "red") return shape.r; if (shape.kind === "green") return shape.g; return shape.b; }\n', "area({ kind: X, r: 1, g: 2, b: 3 } as unknown as Shape)"),
 "tag-switch": (T + "type Shape = { kind: \"red\"; r: number } | { kind: \"green\"; g: number } | { kind: \"blue\"; b: number };\n", 'function area(shape: Shape): number { switch (shape.kind) { case "red": return shape.r; case "green": return shape.g; case "blue": return shape.b; } }\n', "(area({ kind: X, r: 1, g: 2, b: 3 } as unknown as Shape) ?? -1)"),
 "enum": ('enum Color { Red = "red", Green = "green", Blue = "blue" }\n', "const map = new Map<Color, number>([[Color.Red, 1], [Color.Green, 2], [Color.Blue, 3]]);\n", "((X === Color.Green ? 10 : 0) + (map.get(X) ?? -1))"),
 "keyof": ("const table = { red: 1, green: 2, blue: 3 };\ntype Color = keyof typeof table;\n", "const map = new Map<Color, number>([[\"red\", 1], [\"green\", 2], [\"blue\", 3]]);\n", "((table[X] ?? -1) * 10 + (map.get(X) ?? -1))"),
 "const-assertion": ('const all = ["red", "green", "blue"] as const;\ntype Color = (typeof all)[number];\n', "const map = new Map<Color, number>(all.map((name, at) => [name, at + 1]));\n", "(all.indexOf(X) * 10 + (map.get(X) ?? -1))"),
 "satisfies": (T, 'const table = { red: 1, green: 2, blue: 3 } satisfies Record<Color, number>;\n', "(table[X] ?? -1)"),
}
TWIN = 'let twin: Color = "red";\n'
MORE = {
 "twin-eq": (T, TWIN, "(X === twin ? 1 : 0)"), "twin-ne": (T, TWIN, "(X !== twin ? 1 : 0)"), "twin-is": (T, TWIN, "(Object.is(X, twin) ? 1 : 0)"), "twin-switch": (T, TWIN, "(() => { switch (X) { case twin: return 1; default: return 0; } })()"),
 "twin-includes": (T, TWIN, "([twin].includes(X) ? 1 : 0)"), "twin-indexOf": (T, TWIN, "[twin].indexOf(X)"), "twin-set": (T, TWIN, "(new Set<Color>([twin]).has(X) ? 1 : 0)"), "twin-map": (T, TWIN, "(new Map<Color, number>([[twin, 7]]).get(X) ?? -1)"),
 "twin-map-kept": (T, TWIN + "const kept2 = new Map<Color, number>();\n", "(kept2.set(twin, k), (kept2.get(X) ?? -1) + kept2.size * 1000)"), "twin-set-kept": (T, TWIN + "const kept3 = new Set<Color>();\n", "(kept3.add(twin), kept3.add(X), kept3.size)"),
 "twin-key": (T, TWIN, "(() => { const o: Partial<Record<Color, number>> = {}; o[twin] = 5; return (o[X] ?? -1) + Object.keys(o).length * 10; })()"), "twin-compare": (T, TWIN, "X.localeCompare(twin)"), "twin-less": (T, TWIN, "((X < twin ? 1 : 0) + (X <= twin ? 2 : 0))"),
 "dispatch": (T, 'const handlers: Record<Color, (n: number) => number> = { "red": n => n + 1, "green": n => n + 2, "blue": n => n + 3 };\n', "handlers[X](k)"),
 "generic": (T, 'const map = new Map<Color, number>([["red", 1], ["green", 2], ["blue", 3]]);\nfunction find<K extends Color>(key: K): number { return (map.get(key) ?? -1) + (key === "green" ? 10 : 0); }\n', "find(X)"),
 "optional": (T, 'const map = new Map<Color, number>([["red", 1], ["green", 2], ["blue", 3]]);\nfunction find(key?: Color): number { return map.get(key ?? "red") ?? -1; }\n', "find(X)"),
 "widened": (T, 'const map = new Map<string, number>([["red", 1], ["green", 2], ["blue", 3]]);\nfunction find(key: string): number { return (map.get(key) ?? -1) + (key === "green" ? 10 : 0); }\n', "find(X)"),
 "list-of-made": (T, TWIN, '(() => { let c = 0; for (const name of [X, twin, "blue" as Color]) if (name === "green") c++; return c; })()'), "filter": (T, TWIN, "[X, twin].filter(name => name === X).length"),
 "stringify-record": (T, "", "JSON.stringify({ color: X }).length"), "template-key": (T, 'const map = new Map<string, number>([["red!", 1], ["green!", 2], ["blue!", 3]]);\n', "(map.get(`${X}!`) ?? -1)"),
 "array-by-text": (T, 'const table: Record<string, number> = { "red": 1, "green": 2, "blue": 3 };\n', "(table[X] ?? -1)"), "number-of": (T, "", "(Number(X) || 0)"), "unary-plus": (T, "", "(+X || 0)"), "parseInt": (T, "", "(parseInt(X, 10) || 0)"),
}
USES.update(MORE)
def red(use): return "Color.Red" if use == "enum" else '"red"'
def program(use, maker, crossing, heat, beside):
    types, decls, expr = USES[use]; turns = 50 if heat == "hot" else 3
    value = "(i === 1 ? ((%s) as Color) : %s)" % (MAKERS[maker], red(use)) if beside == "beside" else "((%s) as Color)" % MAKERS[maker]
    loop = lambda x: "let n = 0; for (let k = 0; k < %d; k++) n += %s; return n;" % (turns, expr.replace("X", x))
    head = types + DATA + decls
    if crossing == "parameter": return head + "function use(x: Color): number { %s }\nfor (const i of D.I) console.log(use(%s));\n" % (loop("x"), value)
    if crossing == "return": return head + "function make(i: number): Color { return %s; }\nfunction use(i: number): number { const x = make(i); %s }\nfor (const i of D.I) console.log(use(i));\n" % (value, loop("x"))
    if crossing == "variable": return head + "let current: Color = %s;\nfunction use(): number { %s }\nfor (const i of D.I) { current = %s; console.log(use()); }\n" % (red(use), loop("current"), value)
    if crossing == "field": return head + "class Holder { held: Color = %s; }\nconst holder = new Holder();\nfunction use(h: Holder): number { %s }\nfor (const i of D.I) { holder.held = %s; console.log(use(holder)); }\n" % (red(use), loop("h.held"), value)
    if crossing == "element": return head + "const kept: Color[] = [%s];\nfunction use(list: Color[]): number { %s }\nfor (const i of D.I) { kept[0] = %s; console.log(use(kept)); }\n" % (red(use), loop("list[0]"), value)
    if crossing == "closure": return head + "function bind(x: Color): () => number { return () => { %s }; }\nfor (const i of D.I) console.log(bind(%s)());\n" % (loop("x"), value)
def spell(text, w):
    text = text.replace("{ red: 1, green: 2, blue: 3 }", '{ "red": 1, "green": 2, "blue": 3 }').replace(".green ", '["green"] ').replace(".green)", '["green"])')
    for word, mark in (("green", "\0001"), ("blue", "\0002"), ("red", "\0000")): text = text.replace(word, mark)
    return text.replace("\0001", w[1]).replace("\0002", w[2]).replace("\0000", w[0])
def case(words, use, maker, crossing, heat, beside):
    head, tail = program(use, maker, crossing, heat, beside).split(DATA)
    if "twin" in USES[use][1]:
        other = "D.P[i].slice(1, -1)" if maker.startswith("rope") or maker in ("template", "concat") else "D.A[i] + (D.M[i] + D.Z[i])"
        made = '(i === 1 ? ((%s) as Color) : "red")' % other if beside == "beside" else "((%s) as Color)" % other
        lines = tail.rstrip("\n").split("\n"); body = lines[-1][len("for (const i of D.I) "):]; body = body[1:-1].strip() if body.startswith("{") else body
        lines[-1] = "for (const i of D.I) { twin = %s; %s }" % (made, body); tail = "\n".join(lines) + "\n"
    return spell(head, WORDS[words]) + data(WORDS[words]) + spell(tail, WORDS[words])
BORDERS = ("parameter", "return", "variable", "field", "element", "closure")
cases = set()
for use in USES:
    for maker in MAKERS: cases.add(("colors", use, maker, "parameter", "hot", "beside"))
    for cell in itertools.product(("rope", "slice"), BORDERS, ("hot", "cold"), ("beside", "none")): cases.add(("colors", use, *cell))
    if use in ("enum", "keyof", "const-assertion"): continue
    for words in ("digits", "wide", "near"):
        for maker, crossing, beside in itertools.product(("rope", "slice", "template", "trim", "wide", "substring", "replace"), ("parameter", "field", "closure"), ("beside", "none")): cases.add((words, use, maker, crossing, "hot", beside))
for cell in sorted(cases): open(os.path.join(OUT, ".".join(cell) + ".ts"), "w").write(case(*cell))

INSIDE = ["alpha", "bravo", "delta", "gamma"]; OUTSIDE = ["omega", "sigma", "theta"]
names = INSIDE + OUTSIDE + ["kappa", "pi"] + ["w%02d" % n + "x" * (n % 7) for n in range(45)]
assert len(names) == 54
UNION = "type Name = " + " | ".join(json.dumps(n) for n in names) + ";\n"
def pieces(words): return "const D = JSON.parse(" + json.dumps(json.dumps({"P": ["x" + w + "x" for w in words], "H": [w[:-2] for w in words], "T": [w[-2:] for w in words], "I": [0, 1, 2]})) + ") as { P: string[]; H: string[]; T: string[]; I: number[] };\n"
for present in itertools.product((0, 1), repeat=5):
    for compare, where, loop in itertools.product("TSO", ("in", "out"), ("loop", "once")):
        words = INSIDE[:3] if where == "in" else OUTSIDE; literal = {"T": words[0], "S": "kappa", "O": "pi"}[compare]
        steps = ["if (listed.includes(x)) n += 1;", 'if (x === "%s") n += 2;' % literal, "n += recordA[x] ?? 0;", "n += recordB[x] ?? 0;", 'if (x === "%s") n += 4;' % literal]
        body = " ".join(s for s, p in zip(steps, present) if p)
        has = "for (let k = 0; k < 50; k++) if (table.has(x)) n += 1000;" if loop == "loop" else "if (table.has(x)) n += 1000;"
        text = UNION + pieces(words) + 'const table: ReadonlySet<string> = new Set(["alpha", "bravo", "delta", "gamma"]);\nconst listed: readonly Name[] = ["alpha", "omega", "pi"];\nconst recordA: Partial<Record<Name, number>> = { alpha: 10, sigma: 20 };\nconst recordB: Partial<Record<Name, number>> = { bravo: 100, theta: 200 };\n'
        text += "function ask(x: Name): number { let n = 0; %s %s return n; }\nfor (const i of D.I) console.log(ask(D.P[i].slice(1, -1) as Name));\n" % (body, has)
        open(OUT + "/chain.%s.%s.%s.%s.ts" % ("".join(c if p else "-" for c, p in zip("iarsb", present)), compare, where, loop), "w").write(text)
OPS = {
 "nothing": "", "eq-true": 'if (x === "bravo") n += 1;', "eq-same-length": 'if (x === "kappa") n += 1;', "eq-other-length": 'if (x === "pi") n += 1;', "ne-same-length": 'if (x !== "kappa") n += 1;',
 "switch": 'switch (x) { case "alpha": n += 1; break; case "kappa": n += 2; break; case "pi": n += 3; break; }', "record-read": "n += record[x] ?? 0;", "record-write": "counts[x] = 1;", "in": "if (x in record) n += 1;", "hasOwn": "if (Object.hasOwn(record, x)) n += 1;",
 "includes": "if (listed.includes(x)) n += 1;", "indexOf": "n += listed.indexOf(x);", "template": "n += `${x}!`.length;", "plus": 'n += (x + "!").length;', "length": "n += x.length;", "charCodeAt": "n += x.charCodeAt(0);", "index": "n += x[0].length;", "charAt-last": "n += x.charCodeAt(x.length - 1);",
 "startsWith": 'if (x.startsWith("br")) n += 1;', "number": "if (Number.isNaN(Number(x))) n += 1;", "stringify": "n += JSON.stringify(x).length;", "regexp": "if (/^b/.test(x)) n += 1;", "localeCompare": 'n += x.localeCompare("kappa");', "less": 'if (x < "kappa") n += 1;',
 "map-get-string": "n += other.get(x) ?? 0;", "set-add": "seen.add(x);", "upper": "n += x.toUpperCase().length;", "typeof": 'if (typeof x === "string") n += 1;', "console": "sink(x);",
}
for (name, op), maker, beside in itertools.product(OPS.items(), ("rope", "slice"), ("beside", "none")):
    made = "D.H[i] + D.T[i]" if maker == "rope" else "D.P[i].slice(1, -1)"; value = '(i === 1 ? ((%s) as Name) : "alpha")' % made if beside == "beside" else "((%s) as Name)" % made
    text = UNION + pieces(INSIDE[:3]) + 'const table = new Set<Name>(["alpha", "bravo", "delta", "gamma"]);\nconst listed: readonly Name[] = ["alpha", "omega", "pi"];\nconst record: Partial<Record<Name, number>> = { alpha: 10, bravo: 20 };\nconst counts: Partial<Record<Name, number>> = {};\nconst other = new Map<string, number>([["zulu", 1]]);\nconst seen = new Set<string>();\nlet sunk = 0;\nfunction sink(text: string): void { sunk += text.length; }\n'
    text += "function ask(x: Name): number { let n = 0; %s for (let k = 0; k < 50; k++) if (table.has(x)) n += 1000; return n; }\nfor (const i of D.I) console.log(ask(%s));\n" % (op, value)
    open(OUT + "/joins.%s.%s.%s.ts" % (name, maker, beside), "w").write(text)
for (name, op), maker, beside in itertools.product(OPS.items(), ("rope", "slice"), ("beside", "none")):
    made = "D.H[i] + D.T[i]" if maker == "rope" else "D.P[i].slice(1, -1)"; value = '(i === 1 ? ((%s) as Name) : "alpha")' % made if beside == "beside" else "((%s) as Name)" % made
    text = UNION + pieces(INSIDE[:3]) + 'const table = new Set<Name>(["alpha", "bravo", "delta", "gamma"]);\nconst listed: readonly Name[] = ["alpha", "omega", "pi"];\nconst record: Partial<Record<Name, number>> = { alpha: 10, bravo: 20 };\nconst counts: Partial<Record<Name, number>> = {};\nconst other = new Map<string, number>([["zulu", 1]]);\nconst seen = new Set<string>();\nlet sunk = 0;\nfunction sink(text: string): void { sunk += text.length; }\n'
    text += "function ask(x: Name): number { let n = 0; for (let k = 0; k < 50; k++) if (table.has(x)) n += 1000; return n; }\nfor (const i of D.I) { const x: Name = %s; let n = 0; %s console.log(ask(x) + n); }\n" % (value, op)
    open(OUT + "/before.%s.%s.%s.ts" % (name, maker, beside), "w").write(text)
