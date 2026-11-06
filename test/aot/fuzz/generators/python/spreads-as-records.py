#!/usr/bin/env python3
"""spreads-as-records.py <seed>: random strict TypeScript programs about object literals with spreads that are held as record types:
records, narrower and wider records, dictionaries made in many ways, odd sources (null, arrays, strings, accessors, symbols, frozen, dictionary mode, many keys, index keys,
__proto__), nested merges, and what is done to the result and to the sources afterwards. Everything is printed by typed readers and by a reader that knows nothing."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const lines: string[] = [];
function look(x: any, d: number): string {
  if (x === null || x === undefined) return String(x);
  if (typeof x === "function") return "fn";
  if (typeof x === "symbol") return x.toString();
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x !== "object") return typeof x + ":" + String(x);
  if (Array.isArray(x)) return "[" + x.map((e: any) => look(e, d - 1)).join() + "]";
  const names = Reflect.ownKeys(x).map(k => { const p = Object.getOwnPropertyDescriptor(x, k)!; return String(k) + (p.enumerable ? "" : "(hidden)") + (p.writable === false ? "(ro)" : "") + (p.get ? "(get)" : "") + ":" + (d > 0 ? look(p.get ? "accessor" : p.value, d - 1) : "."); });
  return "{" + names.join() + "}";
}
function every(x: any): string {
  const forIn: string[] = []; for (const k in x) forIn.push(k);
  return [look(x, 2), Object.keys(x).join("+"), forIn.join("+"), JSON.stringify(x), Object.entries(x).length, Object.getPrototypeOf(x) === Object.prototype, Object.isFrozen(x), Object.isExtensible(x)].join(" | ");
}
function attempt(f: () => string): string { try { return f(); } catch (e) { return e instanceof TypeError ? "TypeError" : "thrown " + String(e); } }
const sym = Symbol.for("sym");
function parsed(text: string): any { return JSON.parse(text); }
'''


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.L = []
        self.records = []
        self.n = 0

    NAMES = ["a", "b", "c", "d", "e", "f", "g", "h"]

    def fresh(self, p="v"):
        self.n += 1
        return f"{p}{self.n}"

    def make_records(self):
        r = self.r
        for i in range(r.randint(2, 4)):
            names = r.sample(self.NAMES, r.randint(1, 7))
            fields = []
            for n in names:
                fields.append((n, r.choice(["number", "number", "number", "string", "boolean", "number?", "string?", "number|null", "inner", "inner?", "numbers"])))
            self.records.append(fields)

    def ts(self, k):
        return {"number": "number", "string": "string", "boolean": "boolean", "number?": "number", "string?": "string", "number|null": "number | null", "inner": "Inner", "inner?": "Inner", "numbers": "number[]"}[k]

    def val(self, k):
        r = self.r
        b = k.rstrip("?")
        if b == "number": return r.choice(["1", "2.5", "-0", "NaN", "k", "k + 0.5", "1e21", "2147483648", "-1"])
        if b == "string": return r.choice(['"s"', '""', '"t" + k', '"long string " + k'])
        if b == "boolean": return r.choice(["true", "false", "k % 2 === 0"])
        if b == "number|null": return r.choice(["null", "3", "k"])
        if b == "inner": return r.choice(["{ v: k }", "{ v: 0.5 }", "shared"])
        if b == "numbers": return r.choice(["[]", "[1, 2]", "[k, 0.5]"])
        raise Exception(k)

    def emit_records(self):
        L = self.L
        L.append("interface Inner { v: number }")
        L.append("const shared: Inner = { v: 42 };")
        for i, fields in enumerate(self.records):
            L.append(f"interface R{i} {{ " + "; ".join(f"{n}{'?' if k.endswith('?') else ''}: {self.ts(k)}" for n, k in fields) + " }")
            variants = []
            for v in range(3):
                parts = [f"{n}: {self.val(k)}" for n, k in fields if not k.endswith("?") or self.r.random() < 0.5]
                self.r.shuffle(parts) if self.r.random() < 0.3 else None
                variants.append("{ " + ", ".join(parts) + " }")
            L.append(f"function make{i}(k: number): R{i} {{ switch (k % 3) {{ case 0: return {variants[0]}; case 1: return {variants[1]}; default: return {variants[2]}; }} }}")
            reads = []
            for n, k in fields:
                if k.startswith("inner"): reads.append(f"(x.{n} ? x.{n}.v : x.{n})")
                elif k == "numbers": reads.append(f"x.{n}.length + \"#\" + x.{n}.join(\"_\")")
                elif k.startswith("number"): reads.append(f"(Object.is(x.{n}, -0) ? \"-0\" : x.{n})")
                else: reads.append(f"x.{n}")
            L.append(f"function read{i}(x: R{i}): string {{ return [" + ", ".join(reads) + "].join(\";\"); }")

    def dictionary(self, value_kind, fields=()):
        """An expression of type Record<string, V> (or any), made in one of many ways. Returns (statements, expression)."""
        r = self.r
        v = self.fresh("d")
        vals = {"number": ["1", "k", "0.5", "-0", "NaN"], "string": ['"x"', '"y" + k'], "any": ["1", '"z"', "null", "undefined", "[1]", "{ q: 1 }", "true"]}[value_kind]
        T = {"number": "Record<string, number>", "string": "Record<string, string>", "any": "Record<string, any>"}[value_kind]
        pool = ["x", "y", "z", "w", "extra", "k1", "k2", "other name", "a", "b", "c", "h", "0", "1", "10", "-1", "1.5", "__proto__x", "constructor", "toString", "length"]
        keys = r.sample(pool, r.randint(0, 6))
        way = r.random()
        q = lambda s: '"' + s + '"'
        kinds = dict(fields)
        plain_vals = vals

        class Vals(list):
            pass
        def value(k):
            return self.val(kinds[k]) if k in kinds else r.choice(plain_vals)
        if way < 0.30:
            return [f"const {v}: {T} = {{ " + ", ".join(f"{q(k)}: {value(k)}" for k in keys) + " };"], v
        if way < 0.50:
            return [f"const {v}: {T} = {{}};"] + [f"{v}[{q(k)}] = {value(k)};" for k in keys], v
        if way < 0.58:
            S = [f"const {v}: {T} = {{}};"] + [f"{v}[{q(k)}] = {value(k)};" for k in keys]
            if keys: S.append(f"delete {v}[{q(r.choice(keys))}];")
            return S, v
        if way < 0.64:
            return [f"const {v}: {T} = {{}}; for (let i = 0; i < {r.choice([3, 20, 63, 64, 65, 70, 200])}; i++) {v}[\"n\" + i] = {r.choice(vals)};"], v
        if way < 0.70:
            text = "{" + ",".join(f'\\"{k}\\":{r.choice(["1", "2.5", "null"]) if value_kind != "string" else chr(92) + chr(34) + "p" + chr(92) + chr(34)}' for k in [k for k in keys if k not in kinds] + (["__proto__"] if r.random() < 0.4 else [])) + "}"
            return [f"const {v}: {T} = parsed(\"{text}\");"], v
        if way < 0.75:
            return [f"const {v}: {T} = Object.freeze({{ " + ", ".join(f"{q(k)}: {value(k)}" for k in keys) + " });"], v
        if way < 0.80:
            return [f"const {v}: {T} = {{ " + ", ".join(f"{q(k)}: {value(k)}" for k in keys) + f" }}; Object.defineProperty({v}, \"hiddenKey\", {{ value: {r.choice(vals)}, enumerable: false }}); Object.defineProperty({v}, \"got\", {{ get() {{ lines.push(\"getter ran\"); return {r.choice(vals)}; }}, enumerable: true }});"], v
        if way < 0.84:
            return [f"const {v}: {T} = {{ " + ", ".join(f"{q(k)}: {value(k)}" for k in keys) + f" }}; ({v} as any)[sym] = {r.choice(vals)};"], v
        if way < 0.88:
            return [f"const {v}: {T} = Object.create({{ inherited: {r.choice(vals)} }}); " + " ".join(f"{v}[{q(k)}] = {value(k)};" for k in keys)], v
        if way < 0.91:
            return [f"const {v}: {T} = Object.create(null); " + " ".join(f"{v}[{q(k)}] = {value(k)};" for k in keys)], v
        if way < 0.95:
            return [f"const {v}: any = " + r.choice(["null", "undefined", "[1, 2]", '"str"', "7", "true", "new Map([[1, 2]])", "() => 1", "new Proxy({ px: 1 }, {})", "new (class K { own = 1; get acc() { return 2; } })()", "Object.assign(() => 1, { onFn: 1 })"]) + ";"], v
        return [f"const {v}: any = make{self.target}(k + 1);"], v

    def case(self, number):
        r = self.r
        i = r.randrange(len(self.records))
        fields = self.records[i]
        kinds = set(k.rstrip("?") for _, k in fields)
        value_kind = "number" if kinds <= {"number"} and r.random() < 0.7 else "any"
        S = []
        src = self.fresh("r")
        S.append(f"const {src} = make{i}(k);")
        if r.random() < 0.15:
            opt = [n for n, k in fields if k.endswith("?")]
            if opt: S.append(f"delete {src}.{r.choice(opt)};")
        if r.random() < 0.1:
            S.append(f"({src} as any).stray = k;")
        self.target = i
        d1s, d1 = self.dictionary(value_kind, fields)
        S += d1s
        form = r.random()
        res = self.fresh("m")
        cast = "" if value_kind == "number" else f" as R{i}"
        sources = [src, d1]
        if form < 0.40:
            lit = f"{{ ...{src}, ...{d1} }}"
        elif form < 0.50:
            lit = f"{{ ...{d1}, ...{src} }}"
        elif form < 0.60:
            d2s, d2 = self.dictionary(value_kind, fields); S += d2s; sources.append(d2)
            lit = f"{{ ...{src}, ...{d1}, ...{d2} }}"
        elif form < 0.70:
            n, k = r.choice(fields)
            lit = f"{{ ...{src}, ...{d1}, {n}: {self.val(k)} }}"
        elif form < 0.78 and any(k.endswith("?") for _, k in fields):
            n, k = r.choice([f for f in fields if f[1].endswith("?")])
            lit = f"{{ {n}: {self.val(k)}, ...{src}, ...{d1} }}"
        elif form < 0.86:
            lit = f"{{ ...({{ ...{src}, ...{d1} }}{cast}), ...{d1} }}"
        elif form < 0.93:
            d2s, d2 = self.dictionary(value_kind, fields); S += d2s; sources.append(d2)
            inner = self.fresh("m")
            S.append(f"const {inner}: R{i} = {{ ...{src}, ...{d1} }}{cast};")
            lit = f"{{ ...{inner}, ...{d2} }}"
            sources.append(inner)
        else:
            lit = f"{{ ...{src}, ...make{i}(k + 2), ...{d1} }}"
        how = r.random()
        if how < 0.5:
            S.append(f"const {res}: R{i} = {lit}{cast};")
        elif how < 0.75:
            S.append(f"const {res} = ((): R{i} => ({lit}{cast}))();")
        else:
            S.append(f"const {res} = keep{i}({lit}{cast});")
        S.append(f"lines.push(\"{number} \" + read{i}({res}) + \" || \" + every({res}));")
        for _ in range(r.randint(0, 4)):
            c = r.random()
            n, k = r.choice(fields)
            if c < 0.15: S.append(f"{res}.{n} = {self.val(k)};")
            elif c < 0.30: S.append(f"({res} as any).{r.choice(['x', 'y', 'extra', 'fresh', 'k1'])} = {r.choice(['k', '9', 'undefined'])};")
            elif c < 0.42: S.append(f"delete ({res} as any).{r.choice(['x', 'y', 'extra', 'k1', 'z'])};")
            elif c < 0.52: S.append(f"if ({d1} && typeof {d1} === \"object\" && !Object.isFrozen({d1})) {d1}.{r.choice(['x', 'y', 'late'])} = {'77' if value_kind == 'number' else '77'};")
            elif c < 0.60: S.append("collect();")
            elif c < 0.70: S.append(f"lines.push(\"again \" + every({{ ...{res} }}) + \" \" + read{i}({{ ...{res} }}));")
            elif c < 0.78: S.append(f"lines.push(\"has \" + [\"x\" in {res}, \"{n}\" in {res}, Object.hasOwn({res}, \"y\"), ({res} as any).x, ({res} as any)[\"extra\"], ({res} as any)[sym]].join());")
            elif c < 0.85: S.append(f"lines.push(attempt(() => {{ Object.freeze({res}); ({res} as any).x = 5; return \"quiet\"; }}));")
            elif c < 0.92: S.append(f"lines.push(\"assign \" + every(Object.assign({{}}, {res})) );")
            else: S.append(f"{src}.{n} = {self.val(k)};")
        S.append(f"lines.push(\"{number}' \" + read{i}({res}) + \" || \" + every({res}) + \" || \" + " + " + \" ~ \" + ".join(f"look({s}, 1)" for s in sources) + ");")
        return S

    def loose_case(self, number):
        """A literal of no declared type: names, computed names and spreads in any order, over sources whose keys overlap."""
        r = self.r
        S = []
        names = []
        for j in range(r.randint(1, 3)):
            self.target = 0
            ds, d = self.dictionary("any", ())
            S += ds
            names.append(d)
        parts = []
        used = set()
        for _ in range(r.randint(1, 7)):
            c = r.random()
            free = [n for n in ["a", "b", "c", "x", "y", "z", "k1", "extra"] if n not in used]
            if not free: c = 0.0
            key = r.choice(free) if free else "a"
            if c >= 0.40 and (c < 0.78 or 0.91 <= c < 0.97): used.add(key)
            if c < 0.40: parts.append("..." + r.choice(names))
            elif c < 0.70: parts.append(('' + str(key) + ': ' + str(r.choice(['1', 'k', '"s"', 'null', 'undefined', '[k]', '{ n: k }']))))
            elif c < 0.78: parts.append(f"[\"{key}\"]: k")
            elif c < 0.84: parts.append(f"[\"k\" + (k % 2)]: \"computed\"")
            elif c < 0.88 and "idx" not in used: used.add("idx"); parts.append(f"{r.randint(0, 2)}: \"index\"")
            elif c < 0.91 and "sym" not in used: used.add("sym"); parts.append("[sym]: k")
            elif c < 0.94: parts.append(f"get {key}() {{ return \"getter\"; }}")
            elif c < 0.97: parts.append(f"{key}() {{ return 1; }}")
            else: parts.append("...(k % 2 ? { cond: 1 } : null)")
        res = self.fresh("u")
        S.append(f"const {res}{r.choice(['', ': any', ': Record<string, unknown>'])} = {{ {', '.join(parts)} }};")
        S.append(f"lines.push(\"{number}u \" + every({res}));")
        if r.random() < 0.5:
            S.append(f"({res} as any).late = k; delete ({res} as any).{r.choice(['a', 'x', 'k1'])}; lines.push(\"{number}v \" + every({res}) + \" ~ \" + " + " + \" ~ \" + ".join(f"look({n}, 1)" for n in names) + ");")
        return S

    def program(self):
        L = self.L
        L.append(f"// spreads-as-records.py seed {self.seed}")
        L.append(HEAD)
        self.make_records()
        self.emit_records()
        for i in range(len(self.records)):
            L.append(f"function keep{i}(x: R{i}): R{i} {{ return x; }}")
        cases = self.r.randint(6, 14)
        for c in range(cases):
            L.append(f"function case{c}(k: number): void {{")
            L.extend("  " + s for s in (self.loose_case(c) if self.r.random() < 0.35 else self.case(c)))
            L.append("}")
        L.append(f"for (let k = 0; k < {self.r.choice([4, 7, 12])}; k++) {{")
        for c in range(cases):
            L.append(f"  lines.push(attempt(() => {{ case{c}(k); return \"ok{c}\"; }}));")
        L.append("}")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
