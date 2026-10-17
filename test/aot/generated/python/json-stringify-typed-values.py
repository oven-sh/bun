#!/usr/bin/env python3
"""json-stringify-typed-values.py <seed>: JSON.stringify by functions made for the layouts of typed records, with what no function is made for HANDED OVER per value or per list to the engine's stringifier.
THE ATTACK: well-typed TypeScript made at random: record types and classes that hold each other, lists, unions, optional members, dates, `any` and `unknown` members; values at the edges (numbers, strings that need escapes, halves of pairs, dates out of range); objects made in one piece, built up by stores in any order, with members deleted or set to undefined; and in the untyped places everything JavaScript has: toJSON, accessors, boxed primitives, holes, proxies, keys like indices, symbols, hidden members, cycles, BigInt. Every form of the call: plain, an indent, a list of keys, a replacer; inside a fresh literal; a list at the top.
NO MODEL: the judge is plain Bun's text, line by line."""
import sys, random
seed = int(sys.argv[1]); R = random.Random(seed)
NUM = ["0", "-0", "1", "-1", "1.5", "NaN", "Infinity", "-Infinity", "1e21", "1e-7", "123456789012345680000", "2147483647", "-2147483648", "2147483648", "0.1 + 0.2", "5e-324", "4294967295", "9007199254740993", "255", "-128"]
STR = ['""', '"a"', '"q\\"q"', '"b\\\\s"', '"\\n\\t\\r\\b\\f"', '"\\u0000\\u001f\\u007f"', '"\\u2028\\u2029"', '"\\ud800"', '"\\udc00x"', '"\\ud83d\\ude00"', '"\\u00e9\\u00ff"', '"</script>"', '"x".repeat(40)', '"\\u4e2d\\u6587"', '"a" + "\\"".repeat(3)', '"tail\\\\"', 'String(n)', '"k" + n']
DATE = ["new Date(0)", "new Date(NaN)", "new Date(8.64e15)", "new Date(-8.64e15)", "new Date(-1)", "new Date(-62198755200000)", "new Date(253402300800000)", "new Date(1700000000123)", "new Date(n * 86400000)", "new Date(951782400000)"]
ANY = ["null", "undefined", "1.5", '"s"', "true", "[1, , 3]", "[undefined, () => 1, Symbol.iterator]", "{ b: 1, a: 2, 1: 3, 0: 4 }", "{ toJSON() { return { from: 'toJSON' }; } }", "{ toJSON(k: string) { return 'key ' + k; } }", "{ get g() { return 7; }, h: undefined, f() {} }",
       "new Number(3)", 'new String("boxed")', "new Boolean(false)", "Object(Symbol.iterator)", "new Map([[1, 2]])", "new Set([1])", "new Uint8Array([1, 2])", "Object.create(null)", "Object.create({ inherited: 1 })", "Object.assign(Object.create(null), { z: 1 })",
       "Object.defineProperty({ shown: 1 }, 'hidden', { value: 2, enumerable: false })", "{ [Symbol.iterator]: 1, s: 2 }", "new Proxy([1, 2], {})", "new Proxy({ p: 1 }, {})", "JSON.parse('{\"x\":[1,{\"y\":null}],\"__proto__\":5}')", "Object.assign([1, 2], { extra: 3 })", "new Array(3)", "/re/g", "new Error('e')",
       "(function (...a: number[]) { return arguments; })(1, 2)", "new Date(86400000)", "Object.assign(new Date(0), { toISOString() { return 'own'; } })", "Object.assign(new Date(0), { toJSON() { return 'own toJSON'; } })", "new (class extends Date {})(0)", "new (class extends Date { toJSON() { return 'heir'; } })(0)", "new (class extends Array<number> {})(2)", "[[[[[1]]]]]", "{ a: { b: { c: { d: {} } } } }", "-0", "NaN", "[NaN, -0, Infinity]", "Object.freeze({ fr: 1 })", "new (class { x = 1; #y = 2; static z = 3; get w() { return 4; } })()"]
nt = R.choice([3, 5, 8]); types = []; out = []
def member_type(i):
    k = R.randrange(22)
    if k < 3: return ("number", "num")
    if k < 5: return ("string", "str")
    if k < 6: return ("boolean", "bool")
    if k < 8: return ("Date", "date")
    if k < 10 and i > 0: j = R.randrange(i); return ("T%d" % j, "rec%d" % j)
    if k < 12 and i > 0: j = R.randrange(i); return ("T%d[]" % j, "recs%d" % j)
    if k < 13: return ("number[]", "nums")
    if k < 14: return ("string[]", "strs")
    if k < 15: return ("any", "any")
    if k < 16: return ("unknown", "any")
    if k < 17: return ("any[]", "anys")
    if k < 18: return ("number | string", "numstr")
    if k < 19 and i > 0: j = R.randrange(i); return ("T%d | null" % j, "recnull%d" % j)
    if k < 20: return ("Record<string, number>", "dict")
    if k < 21: return ("[number, string]", "tuple")
    return ('"on" | "off"', "lit")
def value(kind, depth):
    if kind == "num": return R.choice(NUM + ["n", "n + 0.5", "n & 255"])
    if kind == "str": return R.choice(STR)
    if kind == "bool": return R.choice(["true", "false", "n % 2 === 0"])
    if kind == "date": return R.choice(DATE)
    if kind.startswith("recnull"): return R.choice(["null", "make%s(n + 1)" % kind[7:]])
    if kind.startswith("recs"): return "[" + ", ".join("make%s(n + %d)" % (kind[4:], d) for d in range(R.randrange(4))) + "]"
    if kind.startswith("rec"): return "make%s(n + 1)" % kind[3:]
    if kind == "nums": return "[" + ", ".join(R.choice(NUM) for _ in range(R.randrange(5))) + "]"
    if kind == "strs": return "[" + ", ".join(R.choice(STR) for _ in range(R.randrange(4))) + "]"
    if kind == "any": return "(" + R.choice(ANY + (["make%d(n)" % R.randrange(len(types))] if types else [])) + ")"
    if kind == "anys": return "[" + ", ".join(R.choice(ANY + (["make%d(n)" % R.randrange(len(types))] * 6 if types else [])) for _ in range(R.randrange(6))) + "]"
    if kind == "numstr": return R.choice(NUM + STR)
    if kind == "dict": return R.choice(["{}", "{ a: 1 }", "{ b: 2, a: NaN, 10: 1, 9: 2 }", '{ ["k" + n]: n }', '{ "with \\" quote": 1, "": 2 }'])
    if kind == "tuple": return "[%s, %s]" % (R.choice(NUM), R.choice(STR))
    return R.choice(['"on"', '"off"'])
NAMES = ["id", "name", "title", "at", "rows", "total", "flag", "note", "meta", "kind", "size", "tags", "owner", "next", "data", "w\\u00e9", "with space", "0", "12", "a-b", "toJSONish", "__proto__x", "constructor2", "length"]
for i in range(nt):
    names = R.sample(NAMES, R.choice([1, 2, 3, 5, 8, 12])); members = []
    for nm in names:
        t, kind = member_type(i); members.append((nm, t, kind, R.random() < 0.3))
    is_class = R.random() < 0.3; q = lambda s: s if s.replace("_", "a").isalnum() and not s[0].isdigit() and "\\" not in s else '"%s"' % s
    acc = lambda s: "." + s if q(s) == s else '["%s"]' % s
    req = [m for m in members if not m[3]]; opt = [m for m in members if m[3]]
    if is_class:
        extra = R.choice(["", "", " get computed(): number { return 1; }", " method(): number { return 2; }", " toJSON(): unknown { return { classy: %d, n: this.seed }; }" % i, " static s = 1;"])
        out.append("class T%d { seed: number; %s constructor(n: number) { this.seed = n; %s }%s }" % (i, " ".join("%s%s: %s;" % (q(nm), "?" if o else "", t) for nm, t, k, o in members), " ".join("this%s = %s;" % (acc(nm), value(k, 0)) for nm, t, k, o in req), extra))
        body = "const r = new T%d(n);" % i
    else:
        out.append("type T%d = { %s };" % (i, " ".join("%s%s: %s;" % (q(nm), "?" if o else "", t) for nm, t, k, o in members)))
        body = "const r: T%d = { %s };" % (i, ", ".join("%s: %s" % (q(nm), value(k, 0)) for nm, t, k, o in req))
    R.shuffle(opt)
    if len(opt) >= 2 and R.random() < 0.6:
        # the order of the keys is made at run time: one list of stores, in two or three orders, by n
        orders = [list(opt) for _ in range(R.choice([2, 3]))]
        for l in orders: R.shuffle(l)
        vals = {nm: value(k, 0) for nm, t, k, o in opt}
        body += " switch (n %% %d) { %s }" % (len(orders), " ".join("case %d: %s break;" % (j, " ".join("r%s = %s;" % (acc(nm), vals[nm]) for nm, t, k, o in l[:R.randrange(1, len(l) + 1)])) for j, l in enumerate(orders)))
        if R.random() < 0.4: nm = opt[0][0]; body += " if (n %% 3 === 1) { const kept = r%s; delete r%s; r%s = kept; }" % (acc(nm), acc(nm), acc(nm))
        opt = []
    for nm, t, k, o in opt:
        how = R.randrange(6)
        if how < 3: body += " if (n %% %d !== 0) r%s = %s;" % (R.choice([1, 2, 3]) + 1, acc(nm), value(k, 0))
        elif how == 3: body += " r%s = undefined;" % acc(nm)
        elif how == 4: body += " r%s = %s; if (n %% 2) delete r%s;" % (acc(nm), value(k, 0), acc(nm))
    out.append("function make%d(n: number): T%d { %s return r; }" % (i, i, body)); types.append(i)
print("declare const console: any;")
print("function say(label: string, f: () => unknown) { let t: unknown; try { t = f(); } catch (e: any) { t = 'THROWS ' + e.constructor.name; } console.log(label, typeof t === 'string' ? t : String(t)); }")
print("\n".join(out))
for i in range(nt):
    print("for (let n = 0; n < %d; n++) {" % R.choice([3, 6, 13]))
    print("  say('T%d', () => JSON.stringify(make%d(n)));" % (i, i))
    forms = ["JSON.stringify([make%d(n), make%d(n + 1)])", "JSON.stringify({ total: n, rows: [make%d(n)], at: new Date(n) })", "JSON.stringify(make%d(n), null, 2)", "JSON.stringify(make%d(n), null, '\\t')", "JSON.stringify(make%d(n), ['id', 'name', 'rows', 'at', 'seed', '0'])",
             "JSON.stringify(make%d(n), (k, v) => typeof v === 'number' ? v + 1 : v)", "JSON.stringify(make%d(n), (k, v) => k === 'id' ? undefined : v)", "JSON.stringify({ ok: true, data: make%d(n) as unknown })", "JSON.stringify({ a: make%d(n), b: [1, 'x', null] as any[] })", "JSON.stringify([make%d(n)] as any[])",
             "JSON.stringify(Object.assign({}, make%d(n)))", "JSON.stringify({ ...make%d(n), more: 1 })", "JSON.stringify(Object.freeze(make%d(n)))", "JSON.stringify(new Array(3).fill(make%d(n)))", "JSON.stringify(make%d(n), undefined, 20)", "JSON.stringify(make%d(n), null, 'abcdefghijklmnop')", "JSON.stringify(JSON.parse(JSON.stringify(make%d(n)) ?? 'null'))"]
    for f in R.sample(forms, R.choice([3, 6, 10])):
        print("  say('T%d: %s', () => %s);" % (i, f.split("(")[1][:14].replace("'", "").replace("%", ""), f.replace("%d", str(i))))
    print("}")
print("const cyclic: any = { a: 1 }; cyclic.self = cyclic; say('a cycle in an untyped place', () => JSON.stringify({ total: 1, rows: [cyclic] as any[] }));")
print("say('a BigInt in an untyped place', () => JSON.stringify({ total: 1, rows: [1n] as any[] }));")
print("say('nothing', () => [JSON.stringify(undefined), JSON.stringify(() => 1), JSON.stringify(Symbol.iterator), JSON.stringify(null), JSON.stringify(-0), JSON.stringify('\\ud800')].join());")
