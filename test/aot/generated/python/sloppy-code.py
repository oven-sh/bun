#!/usr/bin/env python3
"""sloppy-code.py <seed>: random SLOPPY JavaScript programs (CommonJS files without "use strict") about the arguments object and what else only sloppy code does: parameters that are kept in the mapped
arguments object, read and stored by name and by index in any order, with fewer and more arguments than parameters; the mapping cut by delete, defineProperty, freeze; arguments handed to helpers that store into it, sliced, spread, applied,
kept in a variable, captured by closures, returned; arguments.length stored to; functions with defaults | rest | destructuring (no mapping); strict functions beside them; duplicate parameter names; `this` that is the global object or a boxed
primitive; stores to names nobody declared; functions declared in blocks; var hoisting and redeclaration."""
import random, sys, os

HEAD = r'''var lines = [];
function q(x) { return x === undefined ? "undef" : x === null ? "null" : typeof x === "number" && Object.is(x, -0) ? "-0" : typeof x === "string" ? "'" + x + "'" : typeof x === "function" ? "fn" : Array.isArray(x) ? "[" + x.map(q).join() + "]" : typeof x === "object" ? "{" + Object.keys(x).map(function (k) { return k + ":" + q(x[k]); }).join() + "}" : String(x); }
function args(a) { var s = a.length + "<"; for (var i = 0; i < Math.max(a.length, 4); i++) s += (i in a ? q(a[i]) : "hole") + ","; return s + ">"; }
function attempt(f) { try { return q(f()); } catch (e) { return "threw " + e.constructor.name; } }
function poke(a, i, v) { a[i] = v; return a; }
function pokeAll(a) { for (var i = 0; i < a.length; i++) a[i] = "p" + i; }
function keep(a) { return a; }
'''
VALS = ["1", "2.5", "'s'", "null", "undefined", "{z: 1}", "[7]", "-0", "true", "k", "k + 0.5", "'k' + k"]


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed

    def statement(self, params):
        r = self.r
        p = r.choice(params) if params else "k"
        i = r.randint(0, 4)
        v = r.choice(VALS)
        return r.choice([
            f"{p} = {v};", f"arguments[{i}] = {v};", f"lines.push(q({p}) + args(arguments));", f"lines.push(args(arguments));", f"lines.push(q({p}));", f"{p} = {p} || {v};", f"delete arguments[{i}];", f"poke(arguments, {i}, {v});", "pokeAll(arguments);",
            f"var saved = arguments; saved[{i}] = {v};", f"lines.push(q(Array.prototype.slice.call(arguments, {r.randint(0, 2)})));", f"arguments.length = {r.randint(0, 5)};", f"Object.defineProperty(arguments, '{i}', {{ value: {v}, writable: {r.choice(['true', 'false'])}, configurable: true, enumerable: true }});",
            f"Object.defineProperty(arguments, '{i}', {{ get: function () {{ return 'got'; }}, configurable: true }});", f"(function () {{ {p} = {v}; }})();", f"lines.push(q((function () {{ return {p}; }})()));", f"{p}++;", f"arguments[{i}]++;",
            f"lines.push(q([].concat.apply([], arguments)));", f"lines.push(String(arguments.length) + typeof arguments + Object.prototype.toString.call(arguments));", f"lines.push(q(Math.max.apply(null, arguments)));", f"lines.push(q(Object.keys(arguments)));",
            f"for (var j = 0; j < arguments.length; j++) arguments[j] = j * 2;", f"lines.push(q(keep(arguments)[{i}]));", f"if (k % 2) {p} = {v}; else arguments[{i}] = {v};", f"lines.push(String(arguments.callee === self));", f"[].push.call(arguments, {v});", f"[].shift.call(arguments);",
            f"lines.push(q(JSON.stringify(arguments)));", f"var {p};", f"var {p} = {v};" if r.random() < 0.5 else f"lines.push(q(typeof {p}));", f"arguments[{i}] = {p};", f"{p} = arguments[{i}];", f"lines.push(String({i} in arguments) + arguments.hasOwnProperty({i}));",
            f"try {{ throw {v}; }} catch ({p}2) {{ {p} = {p}2; }}", f"lines.push(q([...arguments]));", f"Object.setPrototypeOf(arguments, {{ 9: 'proto' }}); lines.push(q(arguments[9]));",
        ])

    def function(self, k):
        r = self.r
        n = r.randint(0, 4)
        params = ["a", "b", "c", "d"][:n]
        style = r.random()
        sig = ", ".join(params)
        pre = ""
        if style < 0.08 and n: sig = ", ".join(params[:-1] + [params[-1] + " = 'dflt'"])
        elif style < 0.14: sig = ", ".join(params + ["...rest"])
        elif style < 0.0: pre = '"use strict"; '
        body = [self.statement(params) for _ in range(r.randint(2, 9))]
        if pre: body = [b for b in body if "callee" not in b and not b.startswith("var saved")]
        L = [f"function f{k}({sig}) {{ {pre}var self = f{k}; var k = {r.randint(0, 3)};"] + ["  " + b for b in body] + [f"  return args(arguments) + {' + '.join('q(' + p + ')' for p in params) if params else q_empty()};", "}"]
        calls = []
        for count in sorted(set([0, n, max(0, n - 1), n + 1, n + 2])):
            calls.append(f"lines.push('f{k}/{count} ' + attempt(function () {{ return f{k}({', '.join(r.choice(['1', '2', 'null', 'undefined', chr(39) + 'x' + chr(39), '{y: 2}', '0.5']) for _ in range(count))}); }}));")
        return L, calls

    def other(self, k):
        r = self.r
        return r.choice([
            [f"function g{k}() {{ return this === globalThis ? 'global' : typeof this + ':' + String(this); }}", f"lines.push('g{k} ' + [g{k}(), g{k}.call(5), g{k}.call('s'), g{k}.call(null), g{k}.call(undefined), g{k}.call(true), g{k}.apply({{ toString: function () {{ return 'obj'; }} }})].join());"],
            [f"function g{k}() {{ implicit{k} = 5; return typeof implicit{k} + (globalThis.implicit{k}) + delete globalThis.implicit{k} + typeof implicit{k}; }}", f"lines.push('g{k} ' + attempt(g{k}));"],
            [f"function g{k}(x) {{ if (x) {{ function inner() {{ return 'in block'; }} }} return typeof inner + (typeof inner === 'function' ? inner() : ''); }}", f"lines.push('g{k} ' + attempt(function () {{ return g{k}(true) + g{k}(false); }}));"],
            [f"function g{k}() {{ lines.push(q(v)); var v = 1; {{ var v = 2; }} for (var v = 3; v < 4; v++) {{ }} return v; }}", f"lines.push('g{k} ' + attempt(g{k}));"],
            [f"function g{k}(a, b) {{ var f = () => arguments[0] + arguments.length; a = 10; return f(); }}", f"lines.push('g{k} ' + attempt(function () {{ return g{k}(1, 2, 3); }}));"],
            [f"function g{k}(a) {{ return function () {{ return q(a) + args(arguments); }}; }}", f"lines.push('g{k} ' + attempt(function () {{ return g{k}(1)(2, 3); }}));"],
            [f"function g{k}(a, b) {{ var out = arguments; a = 'late'; return out; }}", f"lines.push('g{k} ' + attempt(function () {{ var o = g{k}(1, 2); o[1] = 'after'; return args(o); }}));"],
            [f"function g{k}(n, acc) {{ acc = acc || []; acc.push(arguments.length); return n ? g{k}(n - 1, acc) : acc; }}", f"lines.push('g{k} ' + attempt(function () {{ return g{k}(3); }}));"],
            [f"function g{k}() {{ return 010 + 0o10 + '\\101'; }}", f"lines.push('g{k} ' + attempt(g{k}));"],
            [f"var o{k} = {{ f: function (a) {{ arguments[0] = this.v; return a; }}, v: 'mine' }};", f"lines.push('g{k} ' + attempt(function () {{ var f = o{k}.f; return o{k}.f(1) + q(f(1)); }}));"],
        ])

    def program(self):
        r = self.r
        L = [f"// sloppy-code.py seed {self.seed}", HEAD]
        calls = []
        for k in range(r.randint(6, 16)):
            if r.random() < 0.75:
                t, c = self.function(k)
                L += t
                calls += c
            else:
                t = self.other(k)
                L += t[:-1]
                calls.append(t[-1])
        L.append("for (var round = 0; round < 2; round++) {")
        L += ["  " + c for c in calls]
        L.append("}")
        L.append('console.log(lines.join("\\n"));')
        L.append("module.exports = lines.length;")
        return "\n".join(L) + "\n"


def q_empty():
    return "''"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
