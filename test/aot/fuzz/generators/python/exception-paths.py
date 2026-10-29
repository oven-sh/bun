#!/usr/bin/env python3
"""exception-paths.py <seed>: exceptions through random chains of frames of every kind.

A row is a chain of two to seven functions. Each calls the next in a way of its own, drawn from some ninety: directly, in tail position, through
call, apply, bind and Reflect, as a callback of a built-in (map, sort, replace, JSON, Array.from ..), as a getter, setter, constructor, field
initializer, static block, proxy trap, conversion (toString, valueOf, Symbol.toPrimitive), iterator, generator (next, throw, return), default
parameter, tagged template, from code made at run time, as a promise reaction, an awaited thenable, an async generator. The last one throws,
in one of thirty ways, or returns. On the way up a frame may catch and rethrow, wrap, swallow, run a finally block, or return from one.
Every frame keeps values alive across its call and adds them up afterwards, so a register or stack slot that unwinding does not
restore changes the sum. A frame is typed TypeScript, TypeScript through `any`, or JavaScript in a file of its own.
Three files: main.ts, and after a line `//// <name>` each, typed.ts and untyped.js. As plain Bun, line by line."""
import random, re, sys

seed = int(sys.argv[1]) if len(sys.argv) > 1 else 1
R = random.Random(seed)

# «..» stands only in TypeScript. NEXT is the function to call, X its argument, r the number that comes back.
SYNC_CALLS = {
    "direct": "r = NEXT(X);",
    "call": "r = NEXT.call(undefined, X);",
    "apply": "r = NEXT.apply(undefined, [X]);",
    "apply array-like": "r = NEXT.apply(undefined, { length: 1, 0: X }« as any»);",
    "apply arguments": "r = (function («this: unknown, ..._: number[]») { return NEXT.apply(undefined, arguments« as any»); })(X);",
    "Reflect.apply": "r = Reflect.apply(NEXT, undefined, [X]);",
    "bind with argument": "r = NEXT.bind(undefined, X)();",
    "bind": "r = NEXT.bind(undefined)(X);",
    "bind twice": "r = NEXT.bind(undefined).bind(undefined, X)();",
    "spread call": "r = NEXT(...«(»[X]« as [number])»);",
    "optional call": "r = (NEXT« as ((x: number) => number) | undefined»)?.(X) ?? 0;",
    "map": "r = [X].map(v => NEXT(v))[0];",
    "map directly": "r = [X].map(NEXT)[0];",
    "forEach": "[X].forEach(v => { r = NEXT(v); });",
    "reduce": "r = [X].reduce((sum, v) => sum + NEXT(v), 0);",
    "reduceRight": "r = [X].reduceRight((sum, v) => sum + NEXT(v), 0);",
    "sort": "[2, 1].sort((p, q) => (r = NEXT(X), p - q));",
    "toSorted": "[2, 1].toSorted((p, q) => (r = NEXT(X), p - q));",
    "find": "[X].find(v => (r = NEXT(v), true));",
    "findLast": "[X].findLast(v => (r = NEXT(v), true));",
    "some": "[X].some(v => (r = NEXT(v), true));",
    "every": "[X].every(v => (r = NEXT(v), true));",
    "filter": "[X].filter(v => (r = NEXT(v), true));",
    "flatMap": "r = [X].flatMap(v => [NEXT(v)])[0];",
    "Array.from mapper": "r = Array.from({ length: 1 }, () => NEXT(X))[0];",
    "Array.from set": "r = Array.from(new Set([X]), v => NEXT(v))[0];",
    "typed array map": "r = new Float64Array([X]).map(v => NEXT(v))[0];",
    "typed array sort": "new Int32Array([2, 1]).sort((p, q) => (r = NEXT(X), p - q));",
    "Map.forEach": "new Map([[1, X]]).forEach(v => { r = NEXT(v); });",
    "Set.forEach": "new Set([X]).forEach(v => { r = NEXT(v); });",
    "replace string": '"a".replace("a", () => String(r = NEXT(X)));',
    "replace regexp": '"a".replace(/a/, () => String(r = NEXT(X)));',
    "replaceAll": '"aa".replaceAll("a", () => String(r = NEXT(X)));',
    "Symbol.replace": '"a".replace({ [Symbol.replace]() { return String(r = NEXT(X)); } }, "");',
    "Symbol.split": '"a".split({ [Symbol.split]() { r = NEXT(X); return []; } });',
    "JSON.parse reviver": 'JSON.parse("[1]", (key, value) => (key === "0" ? (r = NEXT(X)) : value));',
    "JSON.stringify replacer": 'JSON.stringify([1], (key, value) => (key === "0" ? (r = NEXT(X)) : value));',
    "toJSON": "JSON.stringify({ toJSON() { return (r = NEXT(X)); } });",
    "toString": "String({ toString() { return String(r = NEXT(X)); } });",
    "valueOf": "r = Number({ valueOf() { return NEXT(X); } });",
    "Symbol.toPrimitive": "r = Number({ [Symbol.toPrimitive]() { return NEXT(X); } });",
    "template": "void `${{ toString() { return String(r = NEXT(X)); } }}`;",
    "concatenation": 'void ("" + { toString() { return String(r = NEXT(X)); } });',
    "loose equality": "void (({ valueOf() { return (r = NEXT(X)); } }« as any») == 1);",
    "relational": "void (({ valueOf() { return (r = NEXT(X)); } }« as any») < 1);",
    "join": "[{ toString() { return String(r = NEXT(X)); } }].join();",
    "computed key": "void { [String(r = NEXT(X))]: 1 };",
    "property key conversion": "void («(»{}« as any)»)[{ toString() { return String(r = NEXT(X)); } }« as any»];",
    "getter": "r = { get v() { return NEXT(X); } }.v;",
    "setter": "({ set v(value« : number») { r = NEXT(value); } }).v = X;",
    "inherited getter": "r = «(»Object.create({ get v() { return NEXT(X); } })« as { v: number })».v;",
    "defineProperty getter": "r = «(»Object.defineProperty({}, \"v\", { get() { return NEXT(X); } })« as { v: number })».v;",
    "class getter": "r = new (class { get v()« : number» { return NEXT(X); } })().v;",
    "static method": "r = (class { static m(v« : number»)« : number» { return NEXT(v); } }).m(X);",
    "method": "r = new (class { m(v« : number»)« : number» { return NEXT(v); } })().m(X);",
    "private method": "r = new (class { #m(v« : number»)« : number» { return NEXT(v); } run(v« : number»)« : number» { return this.#m(v); } })().run(X);",
    "constructor": "r = new (class { v« : number»; constructor(v« : number») { this.v = NEXT(v); } })(X).v;",
    "field initializer": "r = new (class { v« : number» = NEXT(X); })().v;",
    "derived constructor": "{ class A { v« : number»; constructor(v« : number») { this.v = NEXT(v); } } class B extends A { constructor(v« : number») { super(v); } } r = new B(X).v; }",
    "argument of super": "{ class A { v« : number»; constructor(v« : number») { this.v = v; } } class B extends A { constructor(v« : number») { super(NEXT(v)); } } r = new B(X).v; }",
    "static block": "{ class S { static v« : number» = 0; static { S.v = NEXT(X); } } r = S.v; }",
    "Reflect.construct": "r = Reflect.construct(class { v« : number»; constructor(v« : number») { this.v = NEXT(v); } }, [X]).v;",
    "constructor function": "r = new («(»function («this: { v: number }, »v« : number») { this.v = NEXT(v); }« as unknown as new (v: number) => { v: number })»)(X).v;",
    "proxy get": "r = new Proxy({ v: 0 }, { get() { return NEXT(X); } }).v;",
    "proxy set": "new Proxy({ v: 0 }, { set(_target, _key, value) { r = NEXT(value); return true; } }).v = X;",
    "proxy has": 'void ("v" in new Proxy({}, { has() { r = NEXT(X); return true; } }));',
    "proxy apply": "r = new Proxy(NEXT, { apply(target, self, list) { return Reflect.apply(target, self, list); } })(X);",
    "transparent proxy": "r = new Proxy(NEXT, {})(X);",
    "proxy ownKeys": "Object.keys(new Proxy({}, { ownKeys() { r = NEXT(X); return []; } }));",
    "proxy getPrototypeOf": "Object.getPrototypeOf(new Proxy({}, { getPrototypeOf() { r = NEXT(X); return null; } }));",
    "proxy deleteProperty": "delete («(»new Proxy({}, { deleteProperty() { r = NEXT(X); return true; } })« as { v?: number })»).v;",
    "proxy construct": "r = new (new Proxy(class { v = 0; }, { construct() { return { v: NEXT(X) }; } }))().v;",
    "iterator next": "for (const v of { [Symbol.iterator]() { return { next() { return { done: false, value: NEXT(X) }; } }; } }) { r = v; break; }",
    "iterator return": "for (const _ of { [Symbol.iterator]() { return { next() { return { done: false, value: X }; }, return() { r = NEXT(X); return { done: true, value: 0 }; } }; } }) break;",
    "Symbol.iterator": "for (const _ of { [Symbol.iterator]() { r = NEXT(X); return [][Symbol.iterator](); } }) break;",
    "spread of generator": "r = [...(function* () { yield NEXT(X); })()][0];",
    "destructuring": "[r] = (function* () { yield NEXT(X); })();",
    "destructuring default": "({ v: r = NEXT(X) } = {}« as { v?: number }»);",
    "generator next": "r = (function* ()« : Generator<number, void, unknown>» { yield NEXT(X); })().next().value« as number»;",
    "yield*": "r = (function* ()« : Generator<number, void, unknown>» { yield* (function* ()« : Generator<number, void, unknown>» { yield NEXT(X); })(); })().next().value« as number»;",
    "generator throw": '{ const g = (function* ()« : Generator<number, void, unknown>» { try { yield 0; } catch { yield NEXT(X); } })(); g.next(); r = g.throw(new Error("in")).value« as number»; }',
    "generator return": "{ const g = (function* ()« : Generator<number, void, unknown>» { try { yield 0; } finally { r = NEXT(X); } })(); g.next(); g.return(); }",
    "tagged template": "r = ((_strings« : TemplateStringsArray», v« : number») => NEXT(v))`a${X}b`;",
    "default parameter": "r = ((v« : number» = NEXT(X)) => v)();",
    "new Function": 'r = new Function("f", "x", "return f(x);")(NEXT, X);',
    "new Function with finally": 'r = new Function("f", "x", "try { return f(x); } finally { }")(NEXT, X);',
    "new Function not in tail position": 'r = new Function("f", "x", "const y = f(x); return y;")(NEXT, X);',
    "indirect eval": '(globalThis« as any»).hook = NEXT; r = (0, eval)("hook(" + X + ")");',
    "Symbol.hasInstance": "void ({} instanceof («(»{ [Symbol.hasInstance]() { r = NEXT(X); return true; } }« as any)»));",
    "Object.assign getter": "r = Object.assign({ v: 0 }, { get v() { return NEXT(X); } }).v;",
    "spread getter": "r = { ...{ get v() { return NEXT(X); } } }.v;",
    "Object.values getter": "r = Object.values({ get v() { return NEXT(X); } })[0];",
    "Object.entries getter": "r = Object.entries({ get v() { return NEXT(X); } })[0][1];",
    "structuredClone getter": "r = structuredClone({ get v() { return NEXT(X); } }).v;",
    "species": "{ class L extends Array«<number>» { static get [Symbol.species]() { r = NEXT(X); return Array; } } new L(1).map(v => v); }",
    "isConcatSpreadable": "«(»[]« as unknown[])».concat({ get [Symbol.isConcatSpreadable]() { r = NEXT(X); return false; } });",
    "length getter": "Array.prototype.slice.call({ get length() { return (r = NEXT(X)), 0; } });",
    "closure in loop": "for (let i = 0; i < 1; i++) r = (() => NEXT(X + i))();",
    "nested arrow": "r = (() => (() => NEXT(X))())();",
    "conditional": "r = X > -1e9 ? NEXT(X) : 0;",
    "logical": "r = (X > -1e9 && NEXT(X)) || 0;",
    "argument": "r = Math.max(NEXT(X), -1e9);",
    "switch": "switch (X % 2) { case 0: r = NEXT(X); break; default: r = NEXT(X); }",
    "labeled block": "out: { r = NEXT(X); break out; }",
}
TAIL_CALLS = {
    "tail": "return NEXT(X);",
    "tail call": "return NEXT.call(undefined, X);",
    "tail apply": "return NEXT.apply(undefined, [X]);",
    "tail apply array-like": "return NEXT.apply(undefined, { length: 1, 0: X }« as any»);",
    "tail Reflect.apply": "return Reflect.apply(NEXT, undefined, [X]);",
    "tail bind": "return NEXT.bind(undefined, X)();",
    "tail conditional": "return X > -1e9 ? NEXT(X) : 0;",
    "tail logical": "return (X < -1e9 && 0) || NEXT(X);",
    "tail with more arguments": "return «(»NEXT« as (...list: number[]) => number)»(X, 1, 2, 3, 4, 5, 6, 7, 8);",
    "tail spread": "return NEXT(...«(»[X]« as [number])»);",
    "tail proxy": "return new Proxy(NEXT, {})(X);",
    "tail new Function": 'return new Function("f", "x", "return f(x);")(NEXT, X);',
    "tail method": "return { m: NEXT }.m(X);",
}
ASYNC_CALLS = {
    "await": "r = await NEXT(X);",
    "await after a turn": "await null; r = await NEXT(X);",
    "then": "r = await NEXT(X).then(v => v + 0);",
    "then with both": "r = await NEXT(X).then(v => v, e => { throw e; });",
    "catch rethrows": 'r = await NEXT(X).catch(e => { log.push("reaction"); throw e; });',
    "finally reaction": 'r = await NEXT(X).finally(() => { log.push("settled"); });',
    "Promise.all": "[r] = await Promise.all([NEXT(X)]);",
    "Promise.race": "r = await Promise.race([NEXT(X)]);",
    "Promise.any": "r = await Promise.any([NEXT(X)]).catch(e => { throw e.errors[0]; });",
    "Promise.resolve": "r = await Promise.resolve(NEXT(X));",
    "thenable": "r = await { then(resolve« : (v: number) => void», reject« : (e: unknown) => void») { NEXT(X).then(resolve, reject); } };",
    "new Promise": "r = await new Promise«<number>»((resolve, reject) => { NEXT(X).then(resolve, reject); });",
    "resolve with promise": "r = await new Promise«<number>»(resolve => resolve(NEXT(X)));",
    "for await": "for await (const v of [NEXT(X)]) r = v;",
    "async generator": "for await (const v of (async function* () { yield NEXT(X); })()) r = v;",
    "async generator awaits": "for await (const v of (async function* () { yield await NEXT(X); })()) r = v;",
    "async arrow": "r = await (async () => NEXT(X))();",
    "async arrow awaits": "r = await (async () => await NEXT(X))();",
    "async method": "r = await { async m(v« : number») { return NEXT(v); } }.m(X);",
    "then reaction calls": "r = await Promise.resolve(X).then(v => NEXT(v));",
    "then directly": "r = await Promise.resolve(X).then(NEXT);",
    "executor": "r = await new Promise«<number>»((resolve, reject) => { void (async () => { try { resolve(await NEXT(X)); } catch (e) { reject(e); } })(); });",
}
ASYNC_TAILS = {
    "return promise": "return NEXT(X);",
    "return await": "return await NEXT(X);",
    "return then": "return NEXT(X).then(v => v);",
}
THROWERS = {
    "returns": "return x;",
    "returns a double": "return x + 0.5;",
    "Error": 'throw new Error("thrown " + x);',
    "TypeError": 'throw new TypeError("thrown");',
    "subclass": "throw new Failure(x);",
    "number": "throw x;",
    "double": "throw x + 0.5;",
    "string": 'throw "text " + x;',
    "undefined": "throw undefined;",
    "null": "throw null;",
    "object": "throw { code: x };",
    "array": "throw [x];",
    "symbol": 'throw Symbol.for("thrown");',
    "function": "throw function thrown() {};",
    "call of undefined": "return («(»undefined« as any)»)(x);",
    "read of null": "return («(»null« as any)»).member;",
    "read of undefined member": "return («(»{}« as any)»).a.b;",
    "dead zone": "{ const read = () => late; const early = read(); const late = x; return early + late; }",
    "store to constant": "{ const fixed = x; («(»() => { eval(\"fixed = 1\"); }«)»)(); return fixed; }",
    "store to frozen": '"use strict"; { const frozen = Object.freeze({ v: x }); («(»frozen« as { v: number })»).v = 1; return frozen.v; }',
    "negative array length": "return new Array(-1 - x).length;",
    "repeat": 'return "x".repeat(-1 - x).length;',
    "JSON.parse": 'return JSON.parse("{" + x);',
    "symbol to string": 'return («(»Symbol()« as any)» + "").length;',
    "BigInt mixed": "return «(»(1n« as any») + x«) as number»;",
    "instanceof": "return {} instanceof («(»x« as any)») ? 1 : 0;",
    "in": 'return "a" in («(»x« as any)») ? 1 : 0;',
    "decodeURIComponent": 'return decodeURIComponent("%").length;',
    "toFixed": "return x.toFixed(101).length;",
    "not a constructor": "return new («(»x« as any)»)();",
    "this before super": "{ class A {} class B extends A { constructor() { («(»this« as any)»).v = 1; super(); } } new B(); return x; }",
    "class without new": "return («(»class {}« as any)»)();",
    "getter throws": 'return { get v()« : number» { if (x === x) throw new RangeError("getter"); return x; } }.v;',
    "proxy invariant": 'return Object.keys(new Proxy(Object.preventExtensions({ a: 1 }), { ownKeys() { return []; } })).length;',
    "revoked proxy": "{ const p = Proxy.revocable({ v: x }, {}); p.revoke(); return p.proxy.v; }",
    "running generator": "{ const h« : { g?: Generator<number, void, unknown> }» = {}; h.g = (function* ()« : Generator<number, void, unknown>» { h.g«!».next(); yield x; })(); h.g.next(); return x; }",
    "invalid regexp": 'return new RegExp("(" + x).lastIndex;',
    "normalize": 'return "a".normalize("x" + x).length;',
    "deep recursion": "{ const deep = (n« : number»)« : number» => 1 + deep(n + 1); return deep(x); }",
    "error with cause": 'throw new Error("outer", { cause: new RangeError("inner " + x) });',
    "AggregateError": 'throw new AggregateError([new Error("one"), x], "many");',
}
JAVASCRIPT_ONLY = {"this before super"}
HANDLERS = ["none"] * 7 + ["rethrow", "rethrow", "wrap", "swallow", "finally", "finally", "finally returns", "catch and finally", "finally throws", "catch without binding", "loop continue", "nested", "catch returns call"]

typed, untyped, main = [], [], []
names = {"typed.ts": [], "untyped.js": []}


def for_language(text, is_typescript):
    return re.sub(r"«([^«»]*)»", r"\1" if is_typescript else "", text)


def strip(text, is_typescript):
    previous = None
    while previous != text:
        previous, text = text, for_language(text, is_typescript)
    return text


def frame(name, following, kind, call, handler, is_async, is_tail):
    """kind: typed | any | js"""
    ts = kind != "js"
    number, result = (": number", ": Promise<number>" if is_async else ": number") if kind == "typed" else (": any", ": Promise<any>" if is_async else ": any") if kind == "any" else ("", "")
    lines = ["export %sfunction %s(x%s)%s {" % ("async " if is_async else "", name, number, result)]
    call = call.replace("NEXT", following).replace("X", "(x + 1)")
    if is_tail:
        lines.append("  " + call)
        lines.append("}")
        return strip("\n".join(lines), ts)
    alive = R.randint(2, 9)
    makers = ["x + %d", "x * %d", "(x | 0) + %d", "x + %d.5", '("s" + x).length + %d', "[x, %d][1]", "{ v: %d }.v + x", "Math.abs(x) + %d", "(x ^ %d)"]
    for i in range(alive):
        lines.append("  const k%d%s = %s;" % (i, number if kind != "js" else "", R.choice(makers) % R.randint(1, 99)))
    held = R.choice([None, "const held = { a: x, b: \"h\" + x };", "const held = [x, x + 1];", "const held = \"held\" + x;"])
    if held: lines.append("  " + held)
    lines.append("  let r%s = 0;" % number)
    tag = '"%s"' % name
    body = "    " + call
    if handler == "none": lines.append("  " + call)
    elif handler == "rethrow": lines += ["  try {", body, "  } catch (e) {", "    log.push(%s + \" rethrows \" + describe(e));" % tag, "    throw e;", "  }"]
    elif handler == "wrap": lines += ["  try {", body, "  } catch (e) {", "    throw new Error(%s + \" wraps \" + describe(e), { cause: e });" % tag, "  }"]
    elif handler == "swallow": lines += ["  try {", body, "  } catch (e) {", "    log.push(%s + \" swallows \" + describe(e));" % tag, "    r = -1;", "  }"]
    elif handler == "finally": lines += ["  try {", body, "  } finally {", "    log.push(%s + \" finally \" + (%s));" % (tag, " + ".join("k%d" % i for i in range(alive))), "  }"]
    elif handler == "finally returns": lines += ["  try {", body, "  } finally {", "    if (x % 2 === 0) return " + " + ".join("k%d" % i for i in range(alive)) + ";", "  }"]
    elif handler == "catch and finally": lines += ["  try {", body, "  } catch (e) {", "    log.push(%s + \" caught \" + describe(e));" % tag, "    if (x % 3 === 0) throw e;", "    r = -2;", "  } finally {", "    log.push(%s + \" finally\");" % tag, "  }"]
    elif handler == "finally throws": lines += ["  try {", body, "  } finally {", "    if (x %% 2 === 1) throw new RangeError(%s + \" from finally\");" % tag, "  }"]
    elif handler == "catch without binding": lines += ["  try {", body, "  } catch {", "    r = -3;", "  }"]
    elif handler == "loop continue": lines += ["  for (let turn = 0; turn < 2; turn++) {", "    try {", "  " + body, "      break;", "    } catch (e) {", "      log.push(%s + \" turn \" + turn + \" \" + describe(e));" % tag, "      continue;", "    } finally {", "      log.push(%s + \" after turn \" + turn);" % tag, "    }", "  }"]
    elif handler == "nested": lines += ["  try {", "    try {", "  " + body, "    } finally {", "      log.push(%s + \" inner\");" % tag, "    }", "  } catch (e) {", "    log.push(%s + \" outer \" + describe(e));" % tag, "    throw e;", "  }"]
    elif handler == "catch returns call": lines += ["  try {", body, "  } catch (e) {", "    return %sidentity(%s);" % ("await " if False else "", " + ".join("k%d" % i for i in range(alive))), "  }"]
    total = " + ".join(["r"] + ["k%d" % i for i in range(alive)])
    if held: total += {"const held = {": " + held.a + held.b.length", "const held = [": " + held[0] + held[1]", "const held = \"": " + held.length"}[held[:14]]
    lines.append("  return %s;" % total)
    lines.append("}")
    return strip("\n".join(lines), ts)


def thrower(name, kind, text, is_async):
    ts = kind != "js"
    number, result = (": number", ": Promise<number>" if is_async else ": number") if kind == "typed" else (": any", ": Promise<any>" if is_async else ": any") if kind == "any" else ("", "")
    before = "  await null;\n" if is_async and R.random() < 0.5 else ""
    if kind == "js": before = "  if (x === undefined) return 0;\n" + before
    if kind == "js" and text.startswith("throw"): text += "\n  return x;"
    return strip("export %sfunction %s(x%s)%s {\n%s  %s\n}" % ("async " if is_async else "", name, number, result, before, text), ts)


def row(index):
    depth = R.randint(1, 6)
    asynchronous = R.randint(0, depth) if R.random() < 0.3 else 0
    said = []
    chain = ["r%df%d" % (index, i) for i in range(depth + 1)]
    for i in range(depth + 1):
        kind = R.choice(["typed", "typed", "typed", "any", "js", "js"])
        is_async = i < asynchronous
        last = i == depth
        if last:
            how = R.choice([h for h in THROWERS if kind == "js" or h not in JAVASCRIPT_ONLY])
            text = thrower(chain[i], kind, THROWERS[how], is_async)
            said.append(how)
        else:
            next_is_async = i + 1 < asynchronous
            if is_async and next_is_async:
                is_tail = R.random() < 0.15
                how = R.choice(list(ASYNC_TAILS if is_tail else ASYNC_CALLS))
                call = (ASYNC_TAILS if is_tail else ASYNC_CALLS)[how]
            else:
                is_tail = R.random() < 0.25
                how = R.choice(list(TAIL_CALLS if is_tail else SYNC_CALLS))
                call = (TAIL_CALLS if is_tail else SYNC_CALLS)[how]
            handler = R.choice(HANDLERS)
            text = frame(chain[i], chain[i + 1], kind, call, handler, is_async, is_tail)
            said.append(how + ("/" + handler if handler != "none" and not is_tail else ""))
        file = "untyped.js" if kind == "js" else "typed.ts"
        (untyped if kind == "js" else typed).append(text)
        names[file].append(chain[i])
    label = "row %d (%s)" % (index, " > ".join(said))
    start = R.choice(["0", "1", "2", "3", "7", "2147483640", "-5", "0.5"])
    return chain[0], label, start, asynchronous > 0


SHARED = '''export const log%s = [];
export class Failure extends Error { code%s; constructor(code%s) { super("failure " + code); this.name = "Failure"; this.code = code; } }
export function identity(x%s)%s { return x; }
export function describe(e%s)%s {
  if (e instanceof Failure) return "Failure " + e.code;
  if (e instanceof AggregateError) return "AggregateError " + e.errors.length;
  if (e instanceof Error) return e.name + (e.cause === undefined ? "" : " caused by " + describe(e.cause));
  if (typeof e === "function") return "function " + e.name;
  if (typeof e === "object" && e !== null) return JSON.stringify(e);
  return typeof e + " " + String(e);
}'''

rows = [row(i) for i in range(R.randint(12, 30))]
print('declare const console: { log(...values: unknown[]): void; error(...values: unknown[]): void };')
print('import { log, describe } from "./shared";')
for file, module in (("typed.ts", "./typed"), ("untyped.js", "./untyped.js")):
    wanted = [first for first, _, _, _ in rows if first in names[file]]
    if wanted: print("import { %s } from \"%s\";" % (", ".join(wanted), module))
print('''function num(value: unknown): string { return typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : typeof value + " " + String(value); }
function tell(label: string, text: string): void { console.log(label + ": " + text + (log.length ? " | " + log.splice(0).join("; ") : "")); }
function say(label: string, run: () => unknown): void {
  let text: string;
  try { text = num(run()); } catch (e) { text = "THROWS " + describe(e); console.error(label, String(e)); }
  tell(label, text);
}
async function sayLater(label: string, run: () => Promise<unknown>): Promise<void> {
  let text: string;
  try { text = num(await run()); } catch (e) { text = "THROWS " + describe(e); console.error(label, String(e)); }
  tell(label, text);
}''')
for first, label, start, is_async in rows:
    rounds = R.choice([1, 1, 1, 2, 30])
    if rounds == 1:
        print('%s(%s, () => %s(%s));' % ("await sayLater" if is_async else "say", repr(label).replace("'", '"'), first, start))
    else:
        print('for (let round = 0; round < %d; round++) { if (round < %d) log.length = 0; %s(%s + " round " + round, () => %s(%s + round)); }' % (rounds, 0, "await sayLater" if is_async else "say", repr(label).replace("'", '"'), first, start) if rounds == 2 else
              'for (let round = 0; round < %d; round++) { try { %s%s(%s + round); } catch {} log.length = 0; }\n%s(%s, () => %s(%s));' % (rounds, "await " if is_async else "", first, start, "await sayLater" if is_async else "say", repr(label).replace("'", '"'), first, start))
together = [r for r in rows if r[3]]
if len(together) > 1:
    print("await Promise.all([%s]);" % ", ".join('sayLater("together %d", () => %s(%s))' % (i, first, start) for i, (first, _, start, _) in enumerate(together)))
print("export {};")
imports = lambda own: "\n".join('import { %s } from "%s";' % (", ".join(names[file]), module) for file, module in (("typed.ts", "./typed"), ("untyped.js", "./untyped.js")) if file != own and names[file])
print("//// shared.ts")
print(SHARED % (": string[]", ": number", ": number", ": number", ": number", ": unknown", ": string"))
print("//// typed.ts")
print('import { log, describe, identity, Failure } from "./shared";')
print(imports("typed.ts"))
print("\n".join(typed))
print("export {};")
print("//// untyped.js")
print('import { log, describe, identity, Failure } from "./shared";')
print(imports("untyped.js"))
print("\n".join(untyped))
print("export {};")
