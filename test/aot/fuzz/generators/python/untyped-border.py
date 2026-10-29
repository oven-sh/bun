#!/usr/bin/env python3
"""untyped-border.py <seed> [misfits]: values made by untyped code enter typed code, and typed code uses them. As plain Bun, line by line.

The untyped code is never `any` in the same file. It is a JavaScript file of the program, a CommonJS file, or a package under node_modules
with declarations. A row is one type, one way to make a value of it, one way into typed code, and some uses. Every row has a type of its
own with member names of its own, so that no row changes what the compiler knows about the type of another.

How a value is made: a literal, other key order, extra members, a Proxy of an object of ours or of a literal, with and without traps that
log, a class instance, accessors on the prototype or on the object, inherited members, an heir of an object of ours, no prototype, frozen,
sealed, parsed, cloned, a function, an array, a Map, an Error or a Date with the members, dictionary mode, members added later, deleted
and added again, not enumerable, not writable, symbols, the object of ours itself, with a member more.
How it gets in: a typed local in a try, a handler called as a value, a private field, a setter, a generator, a bound function, an annotated variable, a cast, a generic function of ours, what a typed function returns, a parameter of a callback,
of a method, `this`, a rest parameter, a store by untyped code to a field, an element, a Map of ours, a promise, a thenable, a throw,
an iterator, a pattern, an event, an array or a record made outside, a global.
What typed code does: reads and writes every member, keys, JSON, for-in, spread, rest, prototype, identity against what the untyped side
holds, one site that sees objects of ours and the foreign one in turn, containers of ours; the untyped side changes an object in the middle
of a typed function, in a loop, or an object that typed code made; at the end it changes its object and typed code reads again. After every line come the traps that ran.

With `misfits` the value does not satisfy its type: a member is missing, of another kind, undefined, an accessor that throws, a Proxy
that answers differently each time, or the value is null, undefined, a number, a string. The oracle does not change: a program that runs
under plain Bun runs the same compiled: it neither throws where plain Bun does not, nor goes on with a converted value."""
import random, sys

seed = int(sys.argv[1]) if len(sys.argv) > 1 else 1
MISFITS = len(sys.argv) > 2 and sys.argv[2] == "misfits"
R = random.Random(seed * 2 + (1 if MISFITS else 0))


def chance(p):
    return R.random() < p


NUMBERS = ["1", "1.5", "-0", "2147483647", "4294967296", "NaN", "0.1 + 0.2", "1e21", "-7", "0"]
STRINGS = ['"x"', '"\\u4e16"', '"ab".repeat(3)', '"hello world".slice(2, 7)', '"a" + String(1)', '""', "String.fromCharCode(233)"]


class Member:
    def __init__(self, kind, n):
        self.kind, self.n = kind, n
        self.name = {"num": "a", "str": "b", "opt": "c", "rec": "nested", "arr": "list", "fn": "fn", "method": "m", "nullable": "d", "lit": "e", "tup": "t"}[kind] + str(n)
        self.inner = "x%d" % n

    def declared(self):
        t = {"num": "number", "str": "string", "opt": "boolean", "rec": "{ %s: number }" % self.inner, "arr": "number[]", "fn": "(n: number) => number", "nullable": "number | null", "lit": '"on" | "off"', "tup": "[number, string]"}
        if self.kind == "method": return "%s(): number;" % self.name
        return "%s%s: %s;" % (self.name, "?" if self.kind == "opt" else "", t[self.kind])

    def value(self, first, typed):
        k = self.kind
        if k == "num": return R.choice(NUMBERS)
        if k == "str": return R.choice(STRINGS)
        if k == "opt": return R.choice(["true", "false", "undefined"])
        if k == "rec": return "{ %s: %s }" % (self.inner, R.choice(NUMBERS))
        if k == "arr": return R.choice(["[1, 2.5, 3]", "[]", "[1]", "[0.5]", "[1, 2, 3, 4, 5, 6, 7, 8]"])
        if k == "fn": return R.choice(["(n: number): number => n + 1", "function (n: number): number { return n * 2; }"] if typed else ["n => n + 1", "function (n) { return n * 2; }"])
        if k == "nullable": return R.choice(["null"] + NUMBERS)
        if k == "lit": return R.choice(['"on"', '"off"'])
        if k == "tup": return '[%s, "t"]' % R.choice(NUMBERS)
        raise Exception(k)

    def entry(self, first, typed):
        if self.kind == "method":
            return "%s()%s { return this.%s * 2; }" % (self.name, ": number" if typed else "", first)
        return "%s: %s" % (self.name, self.value(first, typed))

    def reads(self, v):
        p = "%s.%s" % (v, self.name)
        return {
            "num": ["show(%s)" % p, "show(%s + 1)" % p, "show(%s * 2)" % p, "String(%s | 0)" % p, "String(%s > 1)" % p, "typeof %s" % p],
            "str": ['%s + "!"' % p, "String(%s.length)" % p, "%s.toUpperCase()" % p, "typeof %s" % p, 'String(%s === "x")' % p],
            "opt": ["String(%s)" % p, "String(%s === undefined)" % p, 'String("%s" in %s)' % (self.name, v), '(%s ? "yes" : "no")' % p, 'String(%s ?? "none")' % p],
            "rec": ["show(%s.%s)" % (p, self.inner), "Object.keys(%s).join()" % p, "JSON.stringify(%s)" % p],
            "arr": ["%s.join()" % p, "String(%s.length)" % p, "String(%s[0])" % p, "%s.map((each: number): number => each * 2).join()" % p, "String(Array.isArray(%s))" % p],
            "fn": ["show(%s(2))" % p, "typeof %s" % p, "String(%s.length)" % p],
            "method": ["show(%s())" % p, "typeof %s" % p],
            "nullable": ['String(%s ?? "none")' % p, "String(%s === null)" % p],
            "lit": ['((%s as string) === "on" ? "ON" : "OFF")' % p, "String(%s)" % p],
            "tup": ["%s[1] + show(%s[0])" % (p, p), "String(%s.length)" % p],
        }[self.kind]

    def writes(self, v):
        p = "%s.%s" % (v, self.name)
        return {
            "num": ["%s = 5;" % p, "%s += 1.5;" % p, "%s++;" % p, "%s = -0;" % p, "%s *= 2;" % p],
            "str": ['%s += "+";' % p, '%s = "new";' % p],
            "opt": ["%s = true;" % p, "delete %s;" % p, "%s = undefined;" % p],
            "rec": ["%s = { %s: 9 };" % (p, self.inner), "%s.%s = 3;" % (p, self.inner), "%s.%s += 0.5;" % (p, self.inner)],
            "arr": ["%s.push(4);" % p, "%s = [9];" % p, "%s[0] = 8;" % p, "%s.length = 0;" % p],
            "fn": ["%s = (n: number): number => n - 1;" % p],
            "method": [],
            "nullable": ["%s = null;" % p, "%s = 3;" % p],
            "lit": ['%s = "off";' % p],
            "tup": ['%s = [2, "u"];' % p, "%s[0] = 6;" % p],
        }[self.kind]


GIVEN = ("proxy of ours", "logging proxy of ours", "heir of ours", "ours as it is", "ours with a member more", "ours, frozen", "ours, cloned", "subclass of ours", "posing as an instance")


def makers(row):
    n, first, names = row.n, row.members[0].name, [m.name for m in row.members]
    logging = "{ get(t, k, r) { if (typeof k === 'string') trace.push('get ' + k); return Reflect.get(t, k, r); }, set(t, k, v, r) { trace.push('set ' + String(k)); return Reflect.set(t, k, v, r); }, has(t, k) { trace.push('has ' + String(k)); return Reflect.has(t, k); }, ownKeys(t) { trace.push('ownKeys'); return Reflect.ownKeys(t); }, deleteProperty(t, k) { trace.push('delete ' + String(k)); return Reflect.deleteProperty(t, k); }, getPrototypeOf(t) { trace.push('getPrototypeOf'); return Reflect.getPrototypeOf(t); } }"
    plain = not any(m.kind in ("fn", "method") for m in row.members)
    found = {
        "literal": "const value = base%d();" % n,
        "other key order": "const b = base%d(); const value = {}; for (const k of Object.keys(b).reverse()) value[k] = b[k];" % n,
        "extra members": "const value = { before: 1, ...base%d(), after: 'z', 7: 'seven' };" % n,
        "proxy of a literal": "const value = new Proxy(base%d(), {});" % n,
        "logging proxy of a literal": "const value = new Proxy(base%d(), %s);" % (n, logging),
        "class instance": "class Made%d { constructor() { Object.assign(this, base%d()); } } const value = new Made%d();" % (n, n, n),
        "accessors on the prototype": "const store = base%d(); class Made%d {} for (const k of Object.keys(store)) Object.defineProperty(Made%d.prototype, k, { get() { trace.push('getter ' + k); return store[k]; }, set(v) { trace.push('setter ' + k); store[k] = v; }, enumerable: true, configurable: true }); const value = new Made%d();" % (n, n, n, n),
        "accessors on the object": "const store = base%d(); const value = {}; for (const k of Object.keys(store)) Object.defineProperty(value, k, { get() { trace.push('getter ' + k); return store[k]; }, set(v) { trace.push('setter ' + k); store[k] = v; }, enumerable: true, configurable: true });" % n,
        "inherited members": "const value = Object.create(base%d());" % n,
        "no prototype": "const value = Object.assign(Object.create(null), base%d());" % n,
        "frozen": "const value = Object.freeze(base%d());" % n,
        "sealed": "const value = Object.seal(base%d());" % n,
        "not extensible": "const value = Object.preventExtensions(base%d());" % n,
        "parsed": "const b = base%d(); const value = Object.assign(JSON.parse(JSON.stringify(b)), b);" % n,
        "a function": "const value = Object.assign(function () {}, base%d());" % n,
        "an array": "const value = Object.assign([], base%d());" % n,
        "a Map": "const value = Object.assign(new Map(), base%d());" % n,
        "an Error": "const value = Object.assign(new Error('e'), base%d());" % n,
        "a Date": "const value = Object.assign(new Date(0), base%d());" % n,
        "dictionary mode": "const value = {}; for (let i = 0; i < 80; i++) value['k' + i] = i; Object.assign(value, base%d()); for (let i = 0; i < 80; i++) delete value['k' + i];" % n,
        "deleted and added again": "const value = base%d(); const held = value.%s; delete value.%s; value.%s = held;" % (n, first, first, first),
        "not enumerable": "const value = base%d(); Object.defineProperty(value, '%s', { enumerable: false });" % (n, first),
        "not writable": "const value = base%d(); Object.defineProperty(value, '%s', { writable: false });" % (n, first),
        "grown one member at a time": "const b = base%d(); const value = {}; for (const k of Object.keys(b)) { value[k] = b[k]; }" % n,
        "with symbols": "const value = { ...base%d(), [Symbol.toStringTag]: 'Tagged', [Symbol('s')]: 1 };" % n,
        "proxy of ours": "const value = new Proxy(given, {});",
        "logging proxy of ours": "const value = new Proxy(given, %s);" % logging,
        "heir of ours": "const value = Object.create(given);",
        "ours as it is": "const value = given;",
        "ours with a member more": "const value = given; value.more = 'more';",
        "ours, frozen": "const value = Object.freeze(given);",
    }
    if plain: found["ours, cloned"] = "const value = structuredClone(given);"
    if row.is_class:
        found["subclass of ours"] = "class Sub%d extends given.constructor { constructor() { super(); this.added = 1; } } const value = new Sub%d();" % (n, n)
        found["posing as an instance"] = "const value = Object.setPrototypeOf(base%d(), Object.getPrototypeOf(given));" % n
    if not MISFITS: return found
    second = names[1] if len(names) > 1 else first
    return {
        "a member is missing": "const value = base%d(); delete value.%s;" % (n, first),
        "another member is missing": "const value = base%d(); delete value.%s;" % (n, second),
        "a text for the number": "const value = base%d(); value.%s = 'text';" % (n, first),
        "an object for the number": "const value = base%d(); value.%s = { valueOf() { trace.push('valueOf'); return 4; } };" % (n, first),
        "undefined for the number": "const value = base%d(); value.%s = undefined;" % (n, first),
        "null for the number": "const value = base%d(); value.%s = null;" % (n, first),
        "a bigint for the number": "const value = base%d(); value.%s = 5n;" % (n, first),
        "another member is a number": "const value = base%d(); value.%s = 3;" % (n, second),
        "another member is null": "const value = base%d(); value.%s = null;" % (n, second),
        "an accessor that throws": "const value = base%d(); Object.defineProperty(value, '%s', { get() { throw new RangeError('no'); }, enumerable: true, configurable: true });" % (n, first),
        "a proxy that answers differently": "let turn = 0; const value = new Proxy(base%d(), { get(t, k, r) { return k === '%s' ? [1, 'two', undefined, null][turn++ %% 4] : Reflect.get(t, k, r); } });" % (n, first),
        "an empty object": "const value = {};",
        "null": "const value = null;",
        "undefined": "const value = undefined;",
        "a number": "const value = 7;",
        "a text": "const value = 'text';",
        "ours, a member deleted": "const value = given; delete value.%s;" % first,
        "ours, a text stored": "const value = given; value.%s = 'text';" % first,
        "ours, an accessor defined": "const value = given; Object.defineProperty(value, '%s', { get() { trace.push('getter'); return 2; }, configurable: true, enumerable: true });" % first,
        "ours, another prototype": "const value = Object.setPrototypeOf(given, { inherited: 1 });",
    }


class Row:
    def __init__(self, n, in_package):
        self.n = n
        kinds = ["num"] + R.sample(["str", "opt", "rec", "arr", "fn", "method", "nullable", "lit", "tup"], R.randint(1, 5))
        self.members = [Member(k, n) for k in kinds]
        self.is_class = chance(0.25)
        self.type = ("C%d" if self.is_class else "T%d") % n
        self.declared_in_package = in_package and not self.is_class and chance(0.5)
        all_makers = makers(self)
        self.maker = R.choice(sorted(all_makers))
        self.make = all_makers[self.maker]
        self.door = R.choice(sorted(DOORS))

    def first(self):
        return self.members[0].name

    def declaration(self, exported=False):
        head = "export " if exported else ""
        if not self.is_class:
            return "%sinterface %s { %s }" % (head, self.type, " ".join(m.declared() for m in self.members))
        fields = []
        for m in self.members:
            if m.kind == "method": fields.append("%s(): number { return this.%s * 2; }" % (m.name, self.first()))
            else: fields.append("%s = %s;" % (m.declared().rstrip(";"), m.value(self.first(), True)))
        return "class %s { %s }" % (self.type, " ".join(fields))

    def ours(self):
        if self.is_class: return "function ours%d(): %s { return new %s(); }" % (self.n, self.type, self.type)
        return "function ours%d(): %s { return { %s }; }" % (self.n, self.type, ", ".join(m.entry(self.first(), True) for m in self.members if not (m.kind == "opt" and chance(0.4))))

    def base(self):
        return "function base%d() { return { %s }; }" % (self.n, ", ".join(m.entry(self.first(), False) for m in self.members if not (m.kind == "opt" and chance(0.4))))


# a way in: (the untyped function: name, parameters, body after `make`), its declaration with X for the type, the typed statements that leave the value in `v<n>`
DOORS = {
    "annotated variable": ("make", None, "const v: @T = make@N(ours@N()); v@N = v;"),
    "cast": ("make", None, "v@N = make@N(ours@N()) as @T;"),
    "generic function of ours": ("make", None, "v@N = through@N<@T>(ours@N());"),
    "returned by a typed function": ("make", None, "v@N = get@N();"),
    "one arm of a conditional": ("make", None, "const v: @T = lines.length >= 0 ? make@N(ours@N()) : ours@N(); v@N = v;"),
    "callback parameter": (("call", "f, given", "f(make@N(given));", "<X>(f: (v: X) => void, given: X): void"), None, "call@N((v: @T): void => { v@N = v; }, ours@N());"),
    "callback parameter, function": (("call", "f, given", "f(make@N(given));", "<X>(f: (v: X) => void, given: X): void"), None, "call@N(function (v: @T): void { v@N = v; }, ours@N());"),
    "rest parameter": (("call", "f, given", "f(make@N(given), make@N(given));", "<X>(f: (...all: X[]) => void, given: X): void"), None, "call@N((...all: @T[]): void => { v@N = all[0]; }, ours@N());"),
    "parameter with a default": (("call", "f, given", "f(make@N(given));", "<X>(f: (v?: X) => void, given: X): void"), None, "call@N((v: @T = ours@N()): void => { v@N = v; }, ours@N());"),
    "pattern in a parameter": (("call", "f, given", "f({ inner@N: make@N(given) });", "<X>(f: (holder: { inner@N: X }) => void, given: X): void"), None, "call@N(({ inner@N }: { inner@N: @T }): void => { v@N = inner@N; }, ours@N());"),
    "method parameter": (("call", "taker, given", "taker.take(make@N(given));", "<X>(taker: { take(v: X): void }, given: X): void"), None, "const taker = new Taker@N(); call@N(taker, ours@N()); v@N = taker.held;"),
    "this": (("call", "f, given", "f.call(make@N(given));", "<X>(f: (this: X) => void, given: X): void"), None, "call@N(function (this: @T): void { v@N = this; }, ours@N());"),
    "stored to a field of ours": (("call", "holder, given", "holder.held@N = make@N(given);", "<X>(holder: { held@N: X }, given: X): void"), None, "const holder: { held@N: @T } = { held@N: ours@N() }; call@N(holder, ours@N()); v@N = holder.held@N;"),
    "pushed to an array of ours": (("call", "list, given", "list.push(make@N(given));", "<X>(list: X[], given: X): void"), None, "const list: @T[] = []; call@N(list, ours@N()); v@N = list[0];"),
    "stored to an element of ours": (("call", "list, given", "list[0] = make@N(given);", "<X>(list: X[], given: X): void"), None, "const list: @T[] = [ours@N()]; call@N(list, ours@N()); v@N = list[0];"),
    "put into a Map of ours": (("call", "map, given", "map.set('k', make@N(given));", "<X>(map: Map<string, X>, given: X): void"), None, 'const map = new Map<string, @T>(); call@N(map, ours@N()); v@N = map.get("k");'),
    "promise": (("call", "given", "return Promise.resolve().then(() => make@N(given));", "<X>(given: X): Promise<X>"), "async", "const v: @T = await call@N(ours@N()); v@N = v;"),
    "thenable": (("call", "given", "return { then(resolve) { resolve(make@N(given)); } };", "<X>(given: X): PromiseLike<X>"), "async", "const v: @T = await (call@N(ours@N()) as unknown as PromiseLike<@T>); v@N = v;"),
    "thrown": (("call", "given", "throw make@N(given);", "(given: unknown): void"), None, "try { call@N(ours@N()); } catch (error) { v@N = error as @T; }"),
    "iterated": (("call", "given", "return (function* () { yield make@N(given); })();", "<X>(given: X): Iterable<X>"), None, "for (const each of call@N(ours@N()) as Iterable<@T>) v@N = each;"),
    "pattern": (("call", "given", "return { inner@N: make@N(given) };", "<X>(given: X): { inner@N: X }"), None, "const { inner@N }: { inner@N: @T } = call@N(ours@N()); v@N = inner@N;"),
    "array made outside": (("call", "given", "return [make@N(given)];", "<X>(given: X): X[]"), None, "const list: @T[] = call@N(ours@N()); v@N = list[0];"),
    "array made outside, forEach": (("call", "given", "return [make@N(given)];", "<X>(given: X): X[]"), None, "(call@N(ours@N()) as @T[]).forEach((each: @T): void => { v@N = each; });"),
    "record made outside": (("call", "given", "return { k: make@N(given) };", "<X>(given: X): Record<string, X>"), None, "const record: Record<string, @T> = call@N(ours@N()); v@N = Object.values(record)[0];"),
    "event": (("call", "emitter, given", "emitter.emit('made', make@N(given));", "(emitter: { emit(name: string, ...values: unknown[]): boolean }, given: unknown): void"), None, 'const emitter = new EventEmitter(); emitter.on("made", (v: @T): void => { v@N = v; }); call@N(emitter, ours@N());'),
    "any stored to a typed local in a try": (("call", "given", "return make@N(given);", "(given: unknown): any"), None, "let v: @T = ours@N(); try { v = call@N(ours@N()); } catch {} v@N = v;"),
    "parsed by typed code": ("make", None, "let v: @T = ours@N(); try { v = JSON.parse(JSON.stringify(make@N(ours@N()))); } catch {} v@N = v;"),
    "handler in a Map, called as a value": ("make", None, 'const handlers = new Map<string, (v: any) => void>(); handlers.set("h", (v: @T): void => { v@N = v; }); handlers.get("h")!(make@N(ours@N()));'),
    "bound to a private field": ("make", None, "const holder = new Holder@N(); holder.bind(make@N(ours@N())); v@N = holder.held();"),
    "setter of ours": (("call", "holder, given", "holder.it = make@N(given);", "<X>(holder: { it: X }, given: X): void"), None, "const holder = new Settable@N(); call@N(holder, ours@N()); v@N = holder.it;"),
    "sent to a generator": (("call", "generator, given", "generator.next(); generator.next(make@N(given));", "<X>(generator: Generator<number, void, X>, given: X): void"), None, "function* taking(): Generator<number, void, @T> { v@N = yield 1; } call@N(taking(), ours@N());"),
    "constructor called outside": (("call", "Made, given", "return new Made(make@N(given));", "<X, Y>(Made: new (v: X) => Y, given: X): Y"), None, "v@N = call@N(Keeper@N, ours@N()).kept;"),
    "bound function": (("call", "f, given", "f.bind(null, make@N(given))();", "<X>(f: (v: X) => void, given: X): void"), None, "call@N((v: @T): void => { v@N = v; }, ours@N());"),
    "async callback": (("call", "f, given", "return f(make@N(given));", "<X>(f: (v: X) => Promise<void>, given: X): Promise<void>"), "async", "await call@N(async (v: @T): Promise<void> => { await null; v@N = v; }, ours@N());"),
    "global": (("call", "given", "globalThis.shared@N = make@N(given);", "(given: unknown): void"), None, "call@N(ours@N()); v@N = (globalThis as unknown as { shared@N: @T }).shared@N;"),
}


def SPOILS_THAT_FIT(row):
    f = row.first()
    return ["value.%s = 2.5;" % f, "value.extra = 'extra';", "value[7] = 'seven';", "value[Symbol.for('s')] = 1;", "Object.freeze(value);", "Object.seal(value);", "Object.preventExtensions(value);",
            "const held = value.%s; delete value.%s; value.%s = held;" % (f, f, f), "for (let i = 0; i < 70; i++) value['k' + i] = i;",
            "Object.defineProperty(value, '%s', { enumerable: false });" % f, "Object.defineProperty(value, '%s', { writable: false });" % f]


def SPOILS(row):
    f = row.first()
    return SPOILS_THAT_FIT(row) + ["value.%s = 'text';" % f, "value.%s = undefined;" % f, "value.%s = null;" % f, "value.%s = { valueOf() { trace.push('valueOf'); return 4; } };" % f, "value.%s = 5n;" % f, "delete value.%s;" % f,
            "Object.defineProperty(value, '%s', { get() { trace.push('getter'); return 2; }, set(v) { trace.push('setter'); }, configurable: true, enumerable: true });" % f,
            "Object.defineProperty(value, '%s', { get() { throw new RangeError('no'); }, configurable: true });" % f,
            "Object.setPrototypeOf(value, null);", "Object.setPrototypeOf(value, { inherited: 1, %s: 9 });" % f, "Object.setPrototypeOf(value, new Proxy({}, { get(t, k) { trace.push('proto get'); return 6; } }));"]


def uses(row):
    n, T, v = row.n, row.type, "v"
    first = row.first()
    found = []
    for m in row.members:
        found.append(("reads " + m.kind, 'return [%s].join(" ");' % ", ".join(R.sample(m.reads(v), min(len(m.reads(v)), R.randint(1, 3))))))
    whole = [
        ("keys", "return Object.keys(v).join();"),
        ("JSON", 'return JSON.stringify(v) ?? "undefined";'),
        ("for in", 'const seen: string[] = []; for (const key in v) seen.push(key); return seen.join();'),
        ("entries", "return String(Object.entries(v).length);"),
        ("spread", "const copy: %s = { ...v }; return Object.keys(copy).join() + show(copy.%s);" % (T, first) if not row.is_class else "const copy = { ...v }; return Object.keys(copy).join() + show(copy.%s);" % first),
        ("rest", "const { %s: taken, ...others } = v; return show(taken) + Object.keys(others).join();" % first),
        ("own names", 'return Object.getOwnPropertyNames(v).filter((name: string): boolean => !name.startsWith("original")).join();'),
        ("prototype", "return String(Object.getPrototypeOf(v) === Object.prototype) + String(Object.getPrototypeOf(v) === null);"),
        ("tag", "return Object.prototype.toString.call(v) + typeof v + String(Array.isArray(v)) + String(v instanceof Object);"),
        ("frozen", "return String(Object.isFrozen(v)) + String(Object.isSealed(v)) + String(Object.isExtensible(v));"),
        ("identity", "return String(same%d(v)) + String(again%d(v) === v);" % (n, n)),
        ("handed back", "return back%d(v);" % n),
        ("one site", "let sum = 0; const mine = ours%d(); for (let i = 0; i < 60; i++) sum += read%d(i %% 3 === 1 ? v : mine); return show(sum);" % (n, n)),
        ("in a field of ours", "const box: { it%d: %s } = { it%d: v }; return show(box.it%d.%s) + String(box.it%d === v);" % (n, T, n, n, first, n)),
        ("in an array of ours", "const list: %s[] = [ours%d(), v]; return show(list[1].%s) + String(list.indexOf(v)) + String(list.includes(v));" % (T, n, first)),
        ("in a Map of ours", 'const map = new Map<string, %s>([["k", v]]); return String(map.get("k") === v) + show(map.get("k")?.%s ?? -1);' % (T, first)),
        ("key of a Map", 'const map = new Map<%s, string>([[v, "found"]]); return String(map.get(v)) + String(new Set<%s>([v, v]).size) + String(new WeakSet<object>([v]).has(v));' % (T, T)),
        ("in a class of ours", "return show(new Keeper%d(v).kept.%s);" % (n, first)),
        ("captured", "const later = (): number => v.%s; return show(later() + later());" % first),
        ("descriptor", 'const d = Object.getOwnPropertyDescriptor(v, "%s"); return d === undefined ? "none" : [typeof d.get, String(d.writable), String(d.enumerable), String(d.configurable)].join();' % first),
        ("has own", 'return String(Object.hasOwn(v, "%s")) + String("%s" in v) + String("more" in v);' % (first, first)),
        ("assign", "const target = ours%d(); Object.assign(target, v); return show(target.%s);" % (n, first)),
        ("read, a change outside, read", "const before = v.%s; poke%d(); return show(before) + \" \" + show(v.%s);" % (first, n, first)),
        ("a change in a loop", "let sum = 0; for (let i = 0; i < 40; i++) { sum += read%d(v); if (i === 20) poke%d(); } return show(sum);" % (n, n)),
        ("a change inside a typed call", "return show(around%d(v, poke%d));" % (n, n)),
        ("a method of ours on it", "return show(sum%d.call(v));" % n),
        ("ours, changed outside", "const mine = ours%d(); const first = read%d(mine); spoil%d(mine); return [show(first), show(around%d(mine, poke%d)), Object.keys(mine).join(), JSON.stringify(mine) ?? \"undefined\"].join(\" \");" % (n, n, n, n, n)),
        ("ours, changed inside a typed call", "const mine = ours%d(); return show(around%d(mine, (): void => spoil%d(mine)));" % (n, n, n)),
        ("ours, changed in a loop", "const mine = ours%d(); let sum = 0; for (let i = 0; i < 40; i++) { sum += read%d(mine); if (i === 20) spoil%d(mine); } return show(sum);" % (n, n, n)),
        ("equal to ours", "return String(v === ours%d()) + String(v == v);" % n),
    ]
    if row.is_class: whole.append(("instanceof", "return String(v instanceof %s) + String(v.constructor === %s);" % (T, T)))
    found += R.sample(whole, R.randint(3, 7))
    for m in R.sample(row.members, min(len(row.members), R.randint(1, 3))):
        if m.writes(v):
            found.append(("writes " + m.kind, "%s return %s + \" / \" + peek%d();" % (" ".join(R.sample(m.writes(v), min(len(m.writes(v)), R.randint(1, 2)))), R.choice(m.reads(v)), n)))
    R.shuffle(found)
    found.append(("after a change outside", "poke%d(); return [%s].join(\" \") + Object.keys(v).join();" % (n, ", ".join(R.choice(m.reads(v)) for m in row.members))))
    return found


where = R.choice(["./untyped.js", "./untyped.js", "./untyped.cjs", "./declared.js", "untyped-package", "untyped-package", "untyped-commonjs-package"])
in_package = not where.startswith(".") or where == "./declared.js"
commonjs = where.endswith(".cjs") or "commonjs" in where
rows = [Row(n, in_package) for n in range(1, R.randint(4, 9))]

javascript = ["const trace = [];",
              "function drain() { return trace.splice(0).join(', '); }",
              "function show(x) { return typeof x === 'function' ? 'fn' : typeof x === 'object' && x !== null ? JSON.stringify(x) : typeof x === 'bigint' ? x + 'n' : Object.is(x, -0) ? '-0' : String(x); }"]
exports, declarations, imports = ["drain"], ["export declare function drain(): string;"], ["drain"]
typed = []
for row in rows:
    n, T = row.n, row.type
    fill = lambda text: text.replace("@N", str(n)).replace("@T", T)
    helper, is_async, enter = DOORS[row.door]
    names = ", ".join("'%s'" % m.name for m in row.members)
    javascript += ["const kept%d = [];" % n, row.base(),
                   "function make%d(given) { %s kept%d.push(value); return kept%d[kept%d.length - 1]; }" % (n, row.make, n, n, n),
                   "function same%d(value) { return kept%d.includes(value); }" % (n, n),
                   "function again%d(like) { return kept%d[0]; }" % (n, n),
                   "function back%d(value) { return value === null || value === undefined ? String(value) : [%s].map(k => k + '=' + show(value[k])).join(' '); }" % (n, names),
                   "function peek%d() { return back%d(kept%d[0]); }" % (n, n, n),
                   "function poke%d() { const value = kept%d[0]; if (value === null || typeof value !== 'object' && typeof value !== 'function') return; try { %s } catch (error) { trace.push('poke THROWS ' + error.name); console.error('r%d refused change', String(error)); } }" % (n, n, R.choice([
                       "value.%s = 41;" % row.first(), "value.%s += 10;" % row.first(), "value.late = 'late';", "delete value.late; value.%s = 0.25;" % row.first(),
                       "Object.defineProperty(value, '%s', { value: 12, writable: true, enumerable: true, configurable: true });" % row.first(), "Object.freeze(value);"] + ([
                       "value.%s = 'text';" % row.first(), "delete value.%s;" % row.first(), "Object.defineProperty(value, '%s', { get() { trace.push('getter'); return 3; }, configurable: true, enumerable: true });" % row.first()] if MISFITS else [])), n),
                   "function spoil%d(value) { try { %s } catch (error) { trace.push('spoil THROWS ' + error.name); console.error('r%d refused change', String(error)); } }" % (n, R.choice(SPOILS(row) if MISFITS else SPOILS_THAT_FIT(row)), n)]
    used = ["make", "same", "again", "back", "peek", "poke", "spoil"]
    X = T if row.declared_in_package else None
    sign = lambda text: text.replace("<X>", "").replace("X", X) if X else text
    declarations += [row.declaration(True)] if row.declared_in_package else []
    declarations += ["export declare function make%d%s;" % (n, sign("<X>(given: X): X")), "export declare function same%d(value: unknown): boolean;" % n, "export declare function again%d%s;" % (n, sign("<X>(like: X): X")),
                     "export declare function back%d(value: unknown): string;" % n, "export declare function peek%d(): string;" % n, "export declare function poke%d(): void;" % n, "export declare function spoil%d(value: unknown): void;" % n]
    if helper != "make":
        name, parameters, body, signature = helper
        javascript.append(fill("function call@N(%s) { %s }" % (parameters, body)))
        declarations.append(fill("export declare function call@N%s;" % sign(signature)))
        used.append("call")
    exports += ["%s%d" % (name, n) for name in used]
    imports += ["%s%d" % (name, n) for name in used] + (["type " + T] if row.declared_in_package else [])
    if not row.declared_in_package: typed.append(row.declaration())
    typed += [row.ours(), "function read%d(each: %s): number { return each.%s; }" % (n, T, row.first()), "class Keeper%d { constructor(public kept: %s) {} }" % (n, T),
              "function around%d(each: %s, between: () => void): number { const before = each.%s; between(); return before + each.%s; }" % (n, T, row.first(), row.first()),
              "function sum%d(this: %s): number { return this.%s + this.%s; }" % (n, T, row.first(), row.first())]
    if chance(0.25): typed.append("const stray%d: %s = (globalThis as any).absent%d ?? ours%d();" % (n, T, n, n))
    if row.door == "generic function of ours": typed.append(fill("function through@N<X>(x: X): X { return make@N(x)%s; }" % (" as X" if row.declared_in_package else "")) if not row.declared_in_package else fill("function through@N<X extends @T>(x: X): X { return make@N(x) as X; }"))
    if row.door == "returned by a typed function": typed.append(fill("function get@N(): @T { return make@N(ours@N()); }"))
    if row.door == "bound to a private field": typed.append(fill("class Holder@N { #held: @T | undefined; bind(v: @T): void { this.#held = v; } held(): @T { return this.#held!; } }"))
    if row.door == "setter of ours": typed.append(fill("class Settable@N { #it: @T | undefined; set it(v: @T) { this.#it = v; } get it(): @T { return this.#it!; } }"))
    if row.door == "method parameter": typed.append(fill("class Taker@N { held: @T | undefined = undefined; take(v: @T): void { this.held = v; } }"))
    label = "r%d [%s] [%s]" % (n, row.maker, row.door)
    typed.append("let v%d: %s | undefined;" % (n, T))
    typed.append('%s("%s enters", %s(): %s => { %s return "in"; });' % ("await sayLater" if is_async else "say", label, "async " if is_async else "", "Promise<string>" if is_async else "string", fill(enter)))
    for what, body in uses(row):
        typed.append('say("%s %s", (): string => { const v = v%d; if (v === undefined) return "is undefined"; %s });' % (label, what, n, body))

head = ['import { %s } from "%s";' % (", ".join(imports), where)]
if any(row.door == "event" for row in rows): head.append('import { EventEmitter } from "node:events";')
head += ["const lines: string[] = [];",
         'function show(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }',
         "function tell(label: string, text: string): void { lines.push(label); console.log(label + \": \" + text + \" | \" + drain()); }",
         "function say(label: string, run: () => string): void {", "  let text: string;",
         '  try { text = run(); } catch (error) { text = "THROWS " + (error instanceof Error ? error.name : typeof error); console.error(label, String(error)); }', "  tell(label, text);", "}",
         "async function sayLater(label: string, run: () => Promise<string>): Promise<void> {", "  let text: string;",
         '  try { text = await run(); } catch (error) { text = "THROWS " + (error instanceof Error ? error.name : typeof error); console.error(label, String(error)); }', "  tell(label, text);", "}"]
javascript.append(("module.exports = { %s };" if commonjs else "export { %s };") % ", ".join(exports))
out = head + typed
if where == "./declared.js":
    out.append("//// declared.d.ts\n%s" % "\n".join(declarations))
    out.append("//// declared.js\n%s" % "\n".join(javascript))
elif in_package:
    out.append('//// node_modules/%s/package.json\n{ "name": "%s", "version": "1.0.0", %s"main": "index.js", "types": "index.d.ts" }' % (where, where, "" if commonjs else '"type": "module", '))
    out.append("//// node_modules/%s/index.d.ts\n%s" % (where, "\n".join(declarations)))
    out.append("//// node_modules/%s/index.js\n%s" % (where, "\n".join(javascript)))
else:
    out.append("//// %s\n%s" % (where[2:], "\n".join(javascript)))
print("\n".join(out))
