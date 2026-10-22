// CALLS+ makeError operationAOTNewError
// CALLS- makeError ConstructInternalFunction
// CALLS+ makeTypeError operationAOTNewError
// CALLS+ makeRangeError operationAOTNewError
// CALLS+ callError operationAOTNewError
// CALLS- callError CallInternalFunction
// CALLS+ makeWithCause operationAOTNewError
// CALLS+ makeOfAnything operationAOTNewError
// CALLS- makeAggregate operationAOTNewError
// CALLS- Mine operationAOTNewError
// CALLS- MineToo operationAOTNewError
// CALLS- reflected operationAOTNewError
const print = (s: string) => console.log(s);
function show(x: unknown): string {
    if (typeof x !== "string")
        return Object.is(x, -0) ? "-0" : String(x);
    let out = '"';
    for (let i = 0; i < x.length; i++) {
        const c = x.charCodeAt(i);
        out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 0x10000).toString(16).slice(1);
    }
    return out + '"';
}
function attempt(f: () => unknown): string {
    try {
        return show(f());
    } catch (e) {
        return "throws " + (e as Error).name;
    }
}
function cat(a: string, b: string): string { return a + b; }
function cat3(a: string, b: string, c: string): string { return `${a}${b}${c}`; }
function part(s: string, from: number, to: number): string { return s.slice(from, to); }
function flattened(s: string): string { s.charCodeAt(0); return s; }
export function makeError(m: string): Error { return new Error(m); }
export function makeTypeError(m: string): Error { return new TypeError(m); }
export function makeRangeError(m: string): Error { return new RangeError(m); }
export function callError(m: string): Error { return Error(m); }
export function makeWithCause(m: string, c: unknown): Error { return new Error(m, { cause: c }); }
export function makeOfAnything(m: any, o: any): Error { return new Error(m, o); }
export function makeAggregate(m: string): Error { return new AggregateError([1], m); }
function describe(e: unknown): string {
    if (!(e instanceof Error))
        return "not an error: " + show(e);
    const own = Object.getOwnPropertyNames(e).filter(n => n !== "stack" && n !== "line" && n !== "column" && n !== "sourceURL" && n !== "originalLine" && n !== "originalColumn");
    let out = Object.prototype.toString.call(e) + " " + e.name + " " + show(e.message) + " [" + own.join() + "]";
    for (const n of own) {
        const d = Object.getOwnPropertyDescriptor(e, n)!;
        out += " " + n + ":" + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + "=" + show(d.value);
    }
    return out + " proto " + (Object.getPrototypeOf(e) as Error).constructor.name + " keys [" + Object.keys(e).join() + "] " + String(e) + " " + Error.isError(e);
}
for (let round = 0; round < 3; round++) {
    for (const m of ["", "m", "a longer message with \u00e9 and \u65e5", cat("a ", "rope"), "x".repeat(300)]) {
        print(describe(makeError(m)));
        print(describe(makeTypeError(m)));
        print(describe(makeRangeError(m)));
        print(describe(callError(m)));
        print(describe(makeAggregate(m)));
    }
    for (const c of [undefined, null, 0, "c", {}, makeError("inner")])
        print(describe(makeWithCause("m", c)) + " has cause " + ("cause" in makeWithCause("m", c)));
}
print(describe(new Error()));
print(describe(new Error(undefined)));
print(describe(new Error(null as any)));
print(describe(new Error(12 as any)));
print(describe(new Error(-0 as any)));
print(describe(new Error(1.5 as any)));
print(describe(new Error(true as any)));
print(describe(new Error(10n as any)));
print(describe(new EvalError("e")) + " | " + describe(new ReferenceError("r")) + " | " + describe(new SyntaxError("s")) + " | " + describe(new URIError("u")));
print(describe(new EvalError()) + " | " + describe(new ReferenceError()) + " | " + describe(new SyntaxError()) + " | " + describe(new URIError()) + " | " + describe(new TypeError()) + " | " + describe(new RangeError()));
print(describe(Error()) + " | " + describe(Error(undefined)) + " | " + describe(Error("m", { cause: 1 })));
print(attempt(() => describe(new Error(Symbol("s") as any))));
print(attempt(() => describe(new TypeError(Symbol("s") as any))));
print(attempt(() => describe(Error(Symbol("s") as any))));
print(attempt(() => describe(makeOfAnything(Symbol("s"), undefined))));

// The order: ToString of the message, then HasProperty and Get of `cause`.
const log: string[] = [];
const message = { toString() { log.push("toString"); return "from toString"; }, valueOf() { log.push("valueOf"); return "from valueOf"; } };
const options = new Proxy({ cause: "proxied" }, {
    has(t, k) { log.push("has " + String(k)); return k in t; },
    get(t, k) { log.push("get " + String(k)); return (t as any)[k]; },
    getOwnPropertyDescriptor(t, k) { log.push("describe " + String(k)); return Object.getOwnPropertyDescriptor(t, k); },
});
print(describe(makeOfAnything(message, options)) + " :: " + log.join());
log.length = 0;
print(describe(makeOfAnything({ [Symbol.toPrimitive](hint: string) { log.push("toPrimitive " + hint); return 5; } }, { get cause() { log.push("getter"); return undefined; } })) + " :: " + log.join());
log.length = 0;
print(attempt(() => describe(makeOfAnything({ toString() { log.push("throws"); throw new RangeError("mine"); } }, { get cause() { log.push("getter"); return 1; } }))) + " :: " + log.join());
log.length = 0;
print(attempt(() => describe(makeOfAnything("m", { get cause() { log.push("getter throws"); throw new EvalError("mine"); } }))) + " :: " + log.join());
print(attempt(() => describe(makeOfAnything({ toString() { return {}; }, valueOf() { return {}; } }, undefined))));
for (const o of [undefined, null, 1, "cause", true, Symbol.iterator, 1n, [], () => 1, { cause: undefined }, { other: 1 }, Object.create({ cause: "inherited" }), new Error("x", { cause: "of an error" })])
    print(describe(makeOfAnything("m", o)));
class WithCause { cause = "a field"; }
class WithGetter { get cause(): string { return "an accessor of the class"; } }
print(describe(makeOfAnything("m", new WithCause())) + " | " + describe(makeOfAnything("m", new WithGetter())));
print(describe(new (Error as any)("m", { cause: 1 }, "more", "and more")));
print(describe((Error as any)("m", undefined, "more")));

// Not these constructors.
class Mine extends Error { constructor(m: string) { super(m); } }
class MineToo extends TypeError { kind = "mine"; }
print(describe(new Mine("m")) + " " + (new Mine("m") instanceof Mine) + " | " + describe(new MineToo("m")) + " " + (new MineToo("m") instanceof MineToo));
export function reflected(target: Function): Error { return Reflect.construct(Error, ["m"], target); }
print(describe(reflected(RangeError)) + " | " + describe(Reflect.construct(TypeError, ["m"], Mine)) + " | " + describe(reflected(Error)) + " | " + describe(reflected(Mine)));
{
    const Error = function (this: any, m: string) { this.shadowed = m; } as any;
    print(show(new Error("m").shadowed));
}
print(show(makeError("a") === makeError("a")) + " " + show(makeError("a").message === makeError("a").message));
const kept: Error[] = [];
for (let i = 0; i < 20000; i++) {
    const e = i & 1 ? makeError("n" + i) : makeTypeError("n" + i);
    if (i % 4000 === 1 || i % 4000 === 2)
        kept.push(e);
}
print(kept.map(e => e.name + ":" + e.message + ":" + typeof e.stack).join());
// The functions that the expectations name must stay functions: one that is inlined into all of its callers has no code of its own.
(globalThis as any).kept = [makeError, makeTypeError, makeRangeError, callError, makeWithCause, makeOfAnything, makeAggregate, reflected]; console.log("number");
