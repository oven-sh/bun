#!/usr/bin/env python3
"""reference-holding-members.py <seed>: random strict TypeScript programs about typed objects whose members hold objects, strings, functions,
arrays, maps and sets, or null | undefined | nothing in their place. Every program reads, stores, swaps, clears, compares and reads through such members, in loops, closures,
async functions and generators, with collections in between, and prints what it sees. The answer does not depend on when anything is collected."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const young: () => void = typeof G.edenGC === "function" ? G.edenGC : () => G.Bun.gc(false);
let out: string[] = [];
let hash = 7;
let said = 0;
function say(s: string): void { said++; for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 1000000007; if (said % STRIDE === 0 || said < 40) out.push(said + " " + s); }
let trash: unknown[] = [];
let serial = 0;
function churn(k: number): void {
  for (let i = 0; i < 60; i++) { const made = { v: i, label: "c" + (i + k), more: [i, k] }; if (i % 29 === 0) trash.push(made); }
  if (trash.length > 25) trash = [];
}
function attempt(f: () => string): string { try { return f(); } catch (e) { return e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "thrown " + String(e); } }
'''


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.lines = []
        self.types = []  # list of dicts: name, fields [(name, kind, target)]
        self.functions = []  # (name, [param type indexes], is_async)
        self.var = 0

    def fresh(self, p="v"):
        self.var += 1
        return f"{p}{self.var}"

    # kinds of members. target: a type index or None
    KINDS = ["ref", "refnull", "refopt", "refundef", "refboth", "str", "strnull", "stropt", "num", "int", "numopt", "bool", "boolnull", "fn", "fnnull", "arr", "nums", "mapstr", "setref", "mapref", "sym", "anyv", "union", "big"]

    def make_types(self):
        n = self.r.randint(2, 5)
        for i in range(n):
            fields = [("id", "int", None)]
            for j in range(self.r.randint(2, 11)):
                kind = self.r.choice(self.KINDS + ["refnull", "refopt", "strnull", "refnull", "ref", "str"])
                target = None
                if kind in ("ref",):
                    if i == 0:
                        kind = "refnull"
                    else:
                        target = self.r.randrange(0, i)
                if kind in ("refnull", "refopt", "refundef", "refboth", "arr", "mapstr", "setref", "mapref", "union"):
                    target = self.r.randrange(0, n)
                fields.append((f"m{j}", kind, target))
            self.types.append({"name": f"T{i}", "fields": fields, "is_class": self.r.random() < 0.6})

    def ts_type(self, kind, target):
        t = f"T{target}" if target is not None else ""
        return {
            "ref": t, "refnull": f"{t} | null", "refopt": t, "refundef": f"{t} | undefined", "refboth": f"{t} | null", "str": "string", "strnull": "string | null", "stropt": "string",
            "num": "number", "int": "number", "numopt": "number", "bool": "boolean", "boolnull": "boolean | null", "fn": "(x: number) => number", "fnnull": "((x: number) => number) | null",
            "arr": f"{t}[]", "nums": "number[]", "mapstr": f"Map<string, {t}>", "setref": f"Set<{t}>", "mapref": f"Map<{t}, number>", "sym": "symbol", "anyv": "unknown", "union": f"{t} | string | number | null", "big": "bigint",
        }[kind]

    def is_optional(self, kind):
        return kind in ("refopt", "refboth", "stropt", "numopt")

    def initial(self, kind, target, depth):
        r = self.r
        if kind == "ref": return f"make{target}({depth})"
        if kind in ("refnull",): return "null" if r.random() < 0.5 or depth != "d - 1" else f"(d > 0 ? make{target}(d - 1) : null)"
        if kind == "refundef": return "undefined" if r.random() < 0.5 else f"(d > 0 ? make{target}(d - 1) : undefined)"
        if kind in ("str", "strnull"): return r.choice(['"s" + serial', '""', '"fixed"', '"a" + serial + "b"', "String(serial)"]) if kind == "str" or r.random() < 0.6 else "null"
        if kind == "num": return r.choice(["serial + 0.5", "serial / 3", "-0", "NaN", "1e300", "serial"])
        if kind == "int": return "serial"
        if kind == "bool": return r.choice(["true", "false", "serial % 2 === 0"])
        if kind == "boolnull": return r.choice(["true", "false", "null"])
        if kind == "fn": return r.choice(["x => x + 1", "x => x * serial", "double", "(x: number) => -x"])
        if kind == "fnnull": return r.choice(["null", "x => x - 1", "double"])
        if kind in ("arr", "nums"): return "[]" if kind == "arr" or r.random() < 0.4 else r.choice(["[1, 2, 3]", "[0.5, 1.5]", "[serial]"])
        if kind in ("mapstr", "mapref"): return "new Map()"
        if kind == "setref": return "new Set()"
        if kind == "sym": return r.choice(['Symbol.for("a")', 'Symbol.for("b" + (serial % 3))', "Symbol.iterator"])
        if kind == "anyv": return r.choice(["undefined", "null", "serial", '"u" + serial', "[serial]", "{ z: serial }", "true", "0.25"])
        if kind == "union": return r.choice(["null", "serial", '"w" + serial', "serial + 0.25"])
        if kind == "big": return r.choice(["10n", "BigInt(serial)", "123456789012345678901234567890n", "-1n"])
        raise Exception(kind)

    def emit_types(self):
        L = self.lines
        L.append("function double(x: number): number { return x * 2; }")
        for i, t in enumerate(self.types):
            decl = []
            for (name, kind, target) in t["fields"]:
                q = "?" if self.is_optional(kind) else ""
                decl.append(f"{name}{q}: {self.ts_type(kind, target)}")
            if t["is_class"]:
                L.append(f"class T{i} {{ " + "; ".join(decl) + ";")
                required = [(n, k, g) for (n, k, g) in t["fields"] if not self.is_optional(k)]
                L.append("  constructor(d: number) { serial++; " + " ".join(f"this.{n} = {self.initial(k, g, 'd - 1')};" for (n, k, g) in required) + " }")
                L.append(f"  tag(): string {{ return \"T{i}#\" + this.id; }}")
                L.append("}")
                L.append(f"function make{i}(d: number): T{i} {{ return new T{i}(d); }}")
            else:
                L.append(f"interface T{i} {{ " + "; ".join(decl) + " }")
                required = [(n, k, g) for (n, k, g) in t["fields"] if not self.is_optional(k)]
                L.append(f"function make{i}(d: number): T{i} {{ serial++; return {{ " + ", ".join(f"{n}: {self.initial(k, g, 'd - 1')}" for (n, k, g) in required) + " }; }")
        # printers: typed, and one that knows nothing
        for i, t in enumerate(self.types):
            parts = []
            for (name, kind, target) in t["fields"]:
                x = f"x.{name}"
                if kind in ("ref",): parts.append(f"show{target}({x}, d - 1)")
                elif kind in ("refnull", "refopt", "refundef", "refboth"): parts.append(f"show{target}({x}, d - 1)")
                elif kind in ("str", "strnull", "stropt", "num", "int", "numopt", "bool", "boolnull"): parts.append(f"String({x})")
                elif kind == "fn": parts.append(f"String({x}(3))")
                elif kind == "fnnull": parts.append(f"String({x} ? {x}(3) : {x})")
                elif kind == "arr": parts.append(f'"[" + {x}.map(e => show{target}(e, d - 1)).join() + "]"')
                elif kind == "nums": parts.append(f'"[" + {x}.join() + "]"')
                elif kind == "mapstr": parts.append(f'"M" + {x}.size + [...{x}].map(e => e[0] + show{target}(e[1], d - 1)).join()')
                elif kind == "setref": parts.append(f'"S" + {x}.size + [...{x}].map(e => show{target}(e, d - 1)).join()')
                elif kind == "mapref": parts.append(f'"R" + {x}.size + [...{x}].map(e => show{target}(e[0], d - 1) + e[1]).join()')
                elif kind == "sym": parts.append(f"{x}.toString()")
                elif kind == "anyv": parts.append(f"look({x}, 1)")
                elif kind == "union": parts.append(f'(typeof {x} === "object" ? show{target}({x}, d - 1) : typeof {x} + {x})')
                elif kind == "big": parts.append(f"String({x})")
            L.append(f"function show{i}(x: T{i} | null | undefined, d: number): string {{ if (x === null) return \"null\"; if (x === undefined) return \"undef\"; if (d <= 0) return \"T{i}#\" + x.id; return \"T{i}(\" + [" + ", ".join(parts) + "].join(\";\") + \")\"; }")
        L.append('''function look(x: any, d: number): string {
  if (x === null || x === undefined) return String(x);
  if (typeof x === "function") return "fn";
  if (typeof x === "symbol" || typeof x === "bigint") return x.toString();
  if (typeof x !== "object") return typeof x + ":" + String(x);
  if (x instanceof Map || x instanceof Set) return "coll" + x.size;
  if (Array.isArray(x)) return "[" + (d > 0 ? x.map((e: any) => look(e, d - 1)).join() : x.length) + "]";
  if (d <= 0) return "{" + Object.keys(x).join("") + "}";
  return "{" + Object.keys(x).map(k => k + ":" + look(x[k], d - 1)).join() + "}";
}''')

    # ---- statements. env: list of (name, type index) non-nil typed locals that are const
    def fields_of(self, ti, kinds):
        return [(n, k, g) for (n, k, g) in self.types[ti]["fields"] if k in kinds]

    def pick_obj(self, env, ti=None):
        c = [e for e in env if ti is None or e[1] == ti]
        return self.r.choice(c) if c else None

    def value_of_type(self, env, ti):
        e = self.pick_obj(env, ti)
        if e and self.r.random() < 0.75: return e[0]
        return f"make{ti}({self.r.randint(0, 2)})"

    def gc(self):
        return self.r.choice(["collect();", "young();", "churn(1);", "churn(2); young();", "collect(); churn(3);"])

    def statement(self, env, depth, in_async, in_gen):
        r = self.r
        o = self.pick_obj(env)
        name, ti = o
        fs = self.types[ti]["fields"]
        f = r.choice(fs)
        fn, kind, target = f
        x = f"{name}.{fn}"
        roll = r.random()
        S = []
        REFS = ("refnull", "refopt", "refundef", "refboth")
        if roll < 0.08:
            return [self.gc()]
        if roll < 0.14:
            return [f"say(show{ti}({name}, {r.randint(1, 2)}));"]
        if roll < 0.17:
            return [f"say(look({name}, {r.randint(1, 2)}));"]
        if roll < 0.20 and self.functions:
            fname, params, is_async = r.choice(self.functions)
            args = ", ".join(self.value_of_type(env, p) for p in params)
            if is_async and not in_async:
                return [f"pending.push({fname}({args}, {r.randint(0, 9)}));"]
            return [f"say(\"call \" + {'await ' if is_async else ''}{fname}({args}, {r.randint(0, 9)}));"]
        if kind == "ref":
            v = self.fresh()
            c = r.random()
            if c < 0.4:
                body = self.block(env + [(v, target)], depth - 1, in_async, in_gen)
                return [f"{{ const {v} = {x};"] + body + ["}"]
            if c < 0.7:
                return [f"{x} = {self.value_of_type(env, target)};"]
            return [f"say(String({x}.id) + ({x} === {self.value_of_type(env, target)}));"]
        if kind in REFS:
            nil = {"refnull": "null", "refopt": "undefined", "refundef": "undefined", "refboth": r.choice(["null", "undefined"])}[kind]
            c = r.random()
            v = self.fresh()
            if c < 0.22:
                clear = r.random() < 0.6
                body = self.block(env + [(v, target)], depth - 1, in_async, in_gen)
                return [f"{{ const {v} = {x}; if ({v}) {{" + (f" {x} = {nil}; {self.gc()}" if clear else "")] + body + ["} else say(\"nil \" + String(" + v + ")); }"]
            if c < 0.40:
                return [f"{x} = {self.value_of_type(env, target)};"]
            if c < 0.50:
                return [f"{x} = {nil};"]
            if c < 0.55 and kind in ("refopt", "refboth"):
                return [f"delete {x};"]
            if c < 0.63:
                return [f"say([{x} === null as unknown, {x} === undefined as unknown, {x} == null, !{x}, typeof {x}, \"{fn}\" in {name}, {x}?.id, {x}?.id ?? -1].join());"]
            if c < 0.70:
                return [f"say(attempt(() => String({x}!.id)));"]
            if c < 0.76:
                others = [(e, g) for e in env for g in self.fields_of(e[1], REFS) if g[2] == target and g[1] == kind]
                if others:
                    e, g = r.choice(others)
                    y = f"{e[0]}.{g[0]}"
                    return [f"{{ const {v} = {x}; {x} = {y}; {self.gc() if r.random() < 0.5 else ''} {y} = {v}; say(String({x} === {y}) + String({x} === {v})); }}"]
            if c < 0.82:
                return [f"say(attempt(() => {{ {x}!.id = {x}!.id + 0; return \"kept\"; }}));"]
            if c < 0.90:
                w = self.fresh("k")
                return [f"{{ let {v} = {x}; const {w} = () => {{ const t = {v}; {v} = {nil}; {self.gc()} return show{target}(t, 1); }}; say({w}() + {w}()); }}"]
            return [f"say(show{target}({x}, 1));"]
        if kind in ("str", "strnull", "stropt"):
            c = r.random()
            if c < 0.3:
                return [f"{x} = " + r.choice([f'"n" + {name}.id', '"lit"', '""', f'String({name}.id) + "x".repeat({r.randint(0, 5)})', f'({x} ?? "none") + "+"' if kind != "str" else f'{x}.slice(0, 6) + "+"']) + ";"]
            if c < 0.4 and kind != "str":
                return [f"{x} = " + ("null" if kind == "strnull" else "undefined") + ";"]
            if c < 0.45 and kind == "stropt":
                return [f"delete {x};"]
            if c < 0.7:
                v = self.fresh()
                nilv = "null" if kind == "strnull" else "undefined"
                clear = f"{x} = {nilv};" if kind != "str" else f'{x} = "";'
                return [f"{{ const {v} = {x}; {clear} {self.gc()} say(String({v}) + typeof {v} + ({v} ? {v}.length : -1)); }}"]
            if kind == "str":
                return [f"say({x} + {x}.length + {x}.charCodeAt(0) + ({x} === \"fixed\") + {x}.toUpperCase());"]
            return [f"say([{x}, typeof {x}, {x}?.length, {x} ?? \"dflt\", !{x}, {x} === \"lit\", {x} == null].join() + attempt(() => String({x}!.length)));"]
        if kind in ("num", "int", "numopt"):
            c = r.random()
            if c < 0.5:
                return [f"{x} = " + r.choice([f"{name}.id + 1" if kind == "int" and fn != "id" else f"{name}.id", "0.5" if kind != "int" else "3", "-0" if kind != "int" else "0", "2147483647", "-2147483648", "4294967296" if kind != "int" else "7", "NaN" if kind != "int" else "9", "1073741840", "3221225488"]) + ";"] if fn != "id" else [f"say(String({x}));"]
            if c < 0.6 and kind == "numopt":
                return [r.choice([f"delete {x};", f"{x} = undefined;"])]
            return [f"say(String({x}) + Object.is({x}, -0) + typeof {x});"]
        if kind in ("bool", "boolnull"):
            return [r.choice([f"{x} = !{x};", f"say(String({x}) + typeof {x});", f"{x} = {name}.id % 2 === 1;"] + ([f"{x} = null;"] if kind == "boolnull" else []))]
        if kind in ("fn", "fnnull"):
            c = r.random()
            e = self.pick_obj(env)
            if c < 0.4:
                return [f"{x} = " + r.choice([f"y => y + {e[0]}.id", "double", "y => y", f"((k: number) => (y: number) => y * k)({r.randint(1, 5)})"]) + ";"]
            if c < 0.5 and kind == "fnnull":
                return [f"{x} = null;"]
            v = self.fresh()
            if kind == "fn":
                return [f"{{ const {v} = {x}; {x} = double; {self.gc()} say(String({v}(4)) + ({v} === double)); }}"]
            return [f"{{ const {v} = {x}; {x} = null; {self.gc()} say(String({v} ? {v}(4) : {v}) + attempt(() => String({x}!(1)))); }}"]
        if kind == "arr":
            c = r.random()
            if c < 0.35: return [f"{x}.push({self.value_of_type(env, target)});"]
            if c < 0.45: return [f"{{ const p = {x}.pop(); {self.gc()} say(show{target}(p, 1)); }}"]
            if c < 0.55: return [f"{{ const p = {x}.shift(); {self.gc()} say(show{target}(p, 1)); }}"]
            if c < 0.65: return [f"if ({x}.length > 6) {x}.length = 2;"]
            if c < 0.8:
                v = self.fresh()
                body = self.block(env + [(v, target)], depth - 1, in_async, in_gen)
                return [f"for (const {v} of {x}.slice(0, 3)) {{"] + body + ["}"]
            return [f"say({x}.length + \":\" + {x}.map(e => e.id).join() + show{target}({x}[{r.randint(0, 3)}], 1) + {x}.indexOf({self.value_of_type(env, target)}));"]
        if kind == "nums":
            c = r.random()
            if c < 0.3: return [f"{x}.push(" + r.choice(["1", "0.5", f"{name}.id", "NaN", "-0", "1e10"]) + ");"]
            if c < 0.4: return [f"{x}[{x}.length + {r.randint(0, 2)}] = {r.choice(['2', '2.5'])};"]
            if c < 0.5: return [f"if ({x}.length > 8) {x}.length = {r.randint(0, 3)};"]
            if c < 0.75: return [f"{{ let s = 0; for (let i = 0; i < {x}.length; i++) s += {x}[i]; say(\"sum \" + s); }}"]
            return [f"say({x}.join() + \"|\" + {x}[{r.randint(0, 9)}] + \"|\" + ({x}[{r.randint(0, 4)}] + 1) + \"|\" + {x}.length);"]
        if kind == "mapstr":
            c = r.random()
            key = r.choice(['"a"', '"b"', f'"k" + {name}.id % 4', '""', '"long key " + ' + f"{name}.id % 3"])
            if c < 0.4: return [f"{x}.set({key}, {self.value_of_type(env, target)});"]
            if c < 0.5: return [f"say(String({x}.delete({key})));"]
            if c < 0.55: return [f"if ({x}.size > 5) {x}.clear();"]
            if c < 0.8: return [f"{{ const g = {x}.get({key}); {x}.delete({key}); {self.gc()} say(show{target}(g, 1) + {x}.has({key}) + {x}.size); }}"]
            return [f"say([...{x}.keys()].join() + [...{x}.values()].map(e => e.id).join());"]
        if kind == "setref":
            c = r.random()
            val = self.value_of_type(env, target)
            if c < 0.4: return [f"{x}.add({val});"]
            if c < 0.55: return [f"say(String({x}.delete({val})) + {x}.has({val}));"]
            if c < 0.6: return [f"if ({x}.size > 5) {x}.clear();"]
            return [f"{{ let s = \"\"; for (const e of {x}) {{ s += e.id + \",\"; if (s.length > 20) {x}.delete(e); }} {self.gc()} say(s + {x}.size); }}"]
        if kind == "mapref":
            c = r.random()
            val = self.value_of_type(env, target)
            if c < 0.4: return [f"{x}.set({val}, {name}.id);"]
            if c < 0.55: return [f"say(String({x}.get({val})) + {x}.has({val}) + {x}.delete({val}));"]
            if c < 0.6: return [f"if ({x}.size > 5) {x}.clear();"]
            return [f"{{ let s = 0; for (const [k, n] of {x}) s += k.id * 3 + n; {self.gc()} say(\"mr\" + s + \":\" + {x}.size); }}"]
        if kind == "sym":
            return [r.choice([f"say({x}.toString() + ({x} === Symbol.for(\"a\")) + typeof {x});", f"{x} = Symbol.for(\"c\" + {name}.id % 2);", f"{{ const y = {x}; {x} = Symbol.iterator; {self.gc()} say(String(y.description)); }}"])]
        if kind == "anyv":
            e = self.pick_obj(env)
            return [r.choice([f"{x} = {e[0]};", f"{x} = {e[0]}.id;", f"{x} = \"any\" + {e[0]}.id;", f"{x} = undefined;", f"{x} = null;", f"say(look({x}, 1) + typeof {x});", f"{x} = [{e[0]}, 1, \"two\"];", f"{{ const y = {x}; {x} = 0; {self.gc()} say(look(y, 1)); }}", f"{x} = 1073741840 + {e[0]}.id * 16;"])]
        if kind == "union":
            return [r.choice([f"{x} = {self.value_of_type(env, target)};", f"{x} = {name}.id;", f"{x} = \"un\" + {name}.id;", f"{x} = null;", f"{x} = 0.75;", f"{x} = 3221225488;",
                              f"{{ const y = {x}; {x} = null; {self.gc()} say(typeof y === \"object\" ? show{target}(y, 1) : typeof y + y); }}", f"say(typeof {x} + (typeof {x} === \"object\" && {x} ? {x}.id : String({x})));"])]
        if kind == "big":
            return [r.choice([f"{x} = {x} + 1n;", f"{x} = {x} * 1000000007n;", f"say(String({x}) + typeof {x});", f"{x} = BigInt({name}.id);", f"{{ const y = {x}; {x} = 0n; {self.gc()} say(String(y)); }}", f"if ({x} > 10n ** 60n || {x} < -(10n ** 60n)) {x} = 1n;"])]
        return [f"say(\"nothing {kind}\");"]

    def block(self, env, depth, in_async, in_gen):
        r = self.r
        n = r.randint(1, 4) if depth > 0 else 1
        S = []
        for _ in range(n):
            roll = r.random()
            if depth > 0 and roll < 0.08:
                i = self.fresh("i")
                S += [f"for (let {i} = 0; {i} < {r.randint(1, 4)}; {i}++) {{"] + self.block(env, depth - 1, in_async, in_gen) + ["}"]
            elif depth > 0 and roll < 0.14:
                e = self.pick_obj(env)
                S += [f"if ({e[0]}.id % {r.randint(2, 3)} === 0) {{"] + self.block(env, depth - 1, in_async, in_gen) + ["} else {"] + self.block(env, depth - 1, in_async, in_gen) + ["}"]
            elif depth > 0 and roll < 0.18:
                S += ["try {"] + self.block(env, depth - 1, in_async, in_gen) + ["} catch (e) { say(\"caught \" + (e instanceof TypeError)); } finally {"] + self.block(env, 0, in_async, in_gen) + ["}"]
            elif in_async and roll < 0.28:
                S += [r.choice(["await null;", "await Promise.resolve(1);", "await new Promise<void>(done => { later.push(done); });", "await 0; " + self.gc()])]
            elif in_gen and roll < 0.28:
                e = self.pick_obj(env)
                S += [f"yield {e[0]}.id;"]
            elif depth > 0 and roll < 0.32:
                ti = r.randrange(len(self.types))
                v = self.fresh()
                S += [f"{{ const {v} = make{ti}({r.randint(0, 2)});"] + self.block(env + [(v, ti)], depth - 1, in_async, in_gen) + ["}"]
            else:
                S += self.statement(env, depth, in_async, in_gen)
        return S

    def emit_functions(self):
        L = self.lines
        L.append("const pending: Promise<string>[] = [];")
        L.append("let later: (() => void)[] = [];")
        for k in range(self.r.randint(4, 10)):
            params = [self.r.randrange(len(self.types)) for _ in range(self.r.randint(1, 3))]
            style = self.r.random()
            is_async = style < 0.2
            is_gen = 0.2 <= style < 0.3
            env = [(f"p{j}", p) for j, p in enumerate(params)]
            body = self.block(env, 3, is_async, is_gen)
            sig = ", ".join(f"p{j}: T{p}" for j, p in enumerate(params)) + ", salt: number"
            if is_gen:
                L.append(f"function* g{k}({sig}): Generator<number, void, unknown> {{")
                L.extend("  " + s for s in body)
                L.append("}")
                L.append(f"function f{k}({sig}): string {{ let s = \"\"; for (const y of g{k}({', '.join(e[0] for e in env)}, salt)) {{ s += y + \",\"; if (salt % 3 === 0) young(); }} return s; }}")
            else:
                L.append(f"{'async ' if is_async else ''}function f{k}({sig}): {'Promise<string>' if is_async else 'string'} {{")
                L.extend("  " + s for s in body)
                L.append(f"  return \"f{k}:\" + " + " + \",\" + ".join(f"{e[0]}.id" for e in env) + " + salt;")
                L.append("}")
            self.functions.append((f"f{k}", params, is_async))

    def emit_main(self):
        L = self.lines
        r = self.r
        n = len(self.types)
        for i in range(n):
            L.append(f"const pool{i}: T{i}[] = []; for (let i = 0; i < 5; i++) pool{i}.push(make{i}({r.randint(0, 2)}));")
        L.append("async function main(): Promise<void> {")
        L.append(f"  for (let round = 0; round < {r.randint(20, 60)}; round++) {{")
        for (fname, params, is_async) in self.functions:
            args = ", ".join(f"pool{p}[(round * {r.randint(1, 7)} + {r.randint(0, 4)}) % 5]" for p in params)
            if is_async:
                L.append(f"    pending.push({fname}({args}, round));")
            else:
                L.append(f"    say({fname}({args}, round));")
            if r.random() < 0.3:
                i = r.randrange(n)
                L.append(f"    if (round % {r.randint(2, 6)} === 0) pool{i}[round % 5] = make{i}({r.randint(0, 2)});")
        L.append("    for (let spins = 0; spins < 4 && later.length; spins++) { const now = later; later = []; for (const done of now) done(); await null; }")
        L.append("    if (round % 7 === 0) collect();")
        L.append("  }")
        L.append("  while (later.length) { const now = later; later = []; for (const done of now) done(); await null; await null; }")
        L.append("  for (const p of pending) say(\"settled \" + await p);")
        for i in range(n):
            L.append(f"  for (const x of pool{i}) say(show{i}(x, 2));")
        L.append("  console.log(out.join(\"\\n\")); console.log(\"said \" + said + \" hash \" + hash);")
        L.append("}")
        L.append("main().catch(e => { console.log(out.join(\"\\n\")); console.log(\"main failed: \" + (e instanceof TypeError ? \"TypeError\" : String(e)) + \" said \" + said + \" hash \" + hash); });")

    def program(self):
        self.make_types()
        self.lines.append(f"// reference-holding-members.py seed {self.seed}")
        self.lines.append(f"const STRIDE = {self.r.choice([7, 13, 29])};")
        self.lines.append(HEAD)
        self.emit_types()
        self.emit_functions()
        self.emit_main()
        return "\n".join(self.lines) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
