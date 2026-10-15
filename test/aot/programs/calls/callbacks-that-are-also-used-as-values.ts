// A function written at the call is handed to a helper that calls it AND uses it as a value, in every way a value can be used. Each helper calls itself first, so that it stays a function of its own.
const lines: string[] = [];
function say(label: string, value: unknown): void { lines.push(label + ": " + String(value)); }
function attempt(label: string, run: () => unknown): void { try { say(label, run()); } catch (error) { say(label, "threw " + (error instanceof Error ? error.constructor.name : typeof error)); } }
type Callback = () => number;
let saved: unknown;
const kept: unknown[] = [];
const bag: Record<string, unknown> = {};
const unknownCallees: any[] = [(given: any) => typeof given + given(), (given: any) => { saved = given; return 1; }];

function typeOfIt(cb: Callback, depth: number): string { if (depth > 0) return typeOfIt(cb, depth - 1); return cb() + typeof cb; }
function typeOfInTemplate(cb: Callback, depth: number): string { if (depth > 0) return typeOfInTemplate(cb, depth - 1); return `${cb()} ${typeof cb}`; }
function typeOfIs(cb: Callback, depth: number): string { if (depth > 0) return typeOfIs(cb, depth - 1); return cb() + " " + (typeof cb === "function") + (typeof cb === "object") + (typeof cb === "undefined") + (typeof cb !== "string"); }
function sameAsSaved(cb: Callback, depth: number): string { if (depth > 0) return sameAsSaved(cb, depth - 1); return cb() + " " + (cb === saved) + (cb !== saved) + (cb == saved) + Object.is(cb, saved); }
function sameAsItself(cb: Callback, other: Callback, depth: number): string { if (depth > 0) return sameAsItself(cb, other, depth - 1); return cb() + other() + " " + (cb === other) + (cb === cb) + (cb == other); }
function looselyEqual(cb: Callback, depth: number): string { if (depth > 0) return looselyEqual(cb, depth - 1); const any: any = cb; return cb() + " " + (any == 1) + (any == "x") + (any == null) + (any != undefined) + (any == true); }
function nilTests(cb: Callback | undefined | null, depth: number): string { if (depth > 0) return nilTests(cb, depth - 1); return (cb ? cb() : -1) + " " + (cb === undefined) + (cb === null) + (cb == null) + !cb + !!cb + (cb?.() ?? "none"); }
function asText(cb: Callback, depth: number): string { if (depth > 0) return asText(cb, depth - 1); return cb() + " " + (String(cb).length > 5) + (`${cb}`.length > 5) + ((cb + "").length > 5) + (Function.prototype.toString.call(cb).length > 5); }
function asKey(cb: Callback, depth: number): string { if (depth > 0) return asKey(cb, depth - 1); const object: any = {}; object[cb as any] = 7; return cb() + " " + Object.keys(object).length + object[cb as any] + ((cb as any) in object); }
function storedInArray(cb: Callback, depth: number): number { if (depth > 0) return storedInArray(cb, depth - 1); kept.push(cb); return cb(); }
function storedInObject(cb: Callback, depth: number): number { if (depth > 0) return storedInObject(cb, depth - 1); bag.cb = cb; return cb(); }
function storedInVariable(cb: Callback, depth: number): number { if (depth > 0) return storedInVariable(cb, depth - 1); saved = cb; return cb(); }
function returned(cb: Callback, depth: number): Callback { if (depth > 0) return returned(cb, depth - 1); cb(); return cb; }
function thrown(cb: Callback, depth: number): number { if (depth > 0) return thrown(cb, depth - 1); cb(); throw cb; }
function captured(cb: Callback, depth: number): Callback { if (depth > 0) return captured(cb, depth - 1); const first = cb(); return () => first + cb(); }
function toUnknownCallee(cb: Callback, which: number, depth: number): unknown { if (depth > 0) return toUnknownCallee(cb, which, depth - 1); return cb() + "" + unknownCallees[which](cb); }
function spreadIt(cb: Callback, depth: number): string { if (depth > 0) return spreadIt(cb, depth - 1); const list = [...[cb, cb]]; const object = { ...{ cb } }; return cb() + " " + list.length + (list[0] === list[1]) + list[1]() + object.cb() + Math.max(...[cb(), 1]); }
function asJSON(cb: Callback, depth: number): string { if (depth > 0) return asJSON(cb, depth - 1); return cb() + " " + JSON.stringify(cb) + JSON.stringify({ cb }) + JSON.stringify([cb]); }
function instanceOfIt(cb: Callback, depth: number): string { if (depth > 0) return instanceOfIt(cb, depth - 1); return cb() + " " + (cb instanceof Function) + (cb instanceof Object) + (cb instanceof Array) + (({}) instanceof (cb as any) ? "y" : "n"); }
function constructed(cb: any, depth: number): string { if (depth > 0) return constructed(cb, depth - 1); return cb() + " " + typeof new cb(); }
function itsProperties(cb: Callback, depth: number): string { if (depth > 0) return itsProperties(cb, depth - 1); return cb() + " " + JSON.stringify(cb.name) + cb.length + typeof cb.call + typeof (cb as any).prototype + Object.keys(cb).length + Object.getOwnPropertyNames(cb).sort().join(); }
function calledOtherwise(cb: Callback, depth: number): string { if (depth > 0) return calledOtherwise(cb, depth - 1); return cb() + " " + cb.call(null) + cb.apply(undefined, []) + cb.bind(null)() + Reflect.apply(cb, undefined, []) + Function.prototype.call.call(cb, undefined); }
function givenProperties(cb: Callback, depth: number): string { if (depth > 0) return givenProperties(cb, depth - 1); const any: any = cb; any.tag = 5; Object.defineProperty(any, "hidden", { value: 6 }); const had = any.tag + any.hidden; delete any.tag; return cb() + " " + had + any.tag + ("hidden" in any); }
function asProxyTarget(cb: Callback, depth: number): string { if (depth > 0) return asProxyTarget(cb, depth - 1); const proxy = new Proxy(cb, { apply(target) { return target() + 100; } }); return cb() + " " + proxy() + typeof proxy; }
function inCollections(cb: Callback, depth: number): string { if (depth > 0) return inCollections(cb, depth - 1); const weak = new WeakMap<object, number>([[cb, 1]]); const weakSet = new WeakSet<object>([cb]); const map = new Map<unknown, number>([[cb, 2]]); const set = new Set<unknown>([cb, cb]); return cb() + " " + weak.get(cb) + weakSet.has(cb) + map.get(cb) + set.size + new WeakRef(cb).deref()!(); }
function throughArguments(cb: Callback, depth: number): string { if (depth > 0) return throughArguments(cb, depth - 1); return cb() + " " + arguments.length + typeof arguments[0] + (arguments[0] === cb) + arguments[0](); }
function throughRest(depth: number, ...all: Callback[]): string { if (depth > 0) return throughRest(depth - 1, ...all); return all[0]() + " " + all.length + typeof all[0]; }
function orAnother(cb: Callback | undefined, depth: number): string { if (depth > 0) return orAnother(cb, depth - 1); const one = cb || (() => -1); const two = cb ?? (() => -2); const three = cb && cb(); return one() + " " + two() + three + typeof one; }
function inSwitch(cb: Callback, depth: number): string { if (depth > 0) return inSwitch(cb, depth - 1); switch (cb as unknown) { case saved: return cb() + " the saved one"; case undefined: return "none"; default: return cb() + " another"; } }
function asThis(cb: Callback, depth: number): string { if (depth > 0) return asThis(cb, depth - 1); return cb() + " " + (function (this: unknown) { return typeof this; }).call(cb); }
function toPromise(cb: Callback, depth: number): Promise<number> { if (depth > 0) return toPromise(cb, depth - 1); cb(); return Promise.resolve().then(cb); }
async function acrossAwait(cb: Callback, depth: number): Promise<string> { if (depth > 0) return acrossAwait(cb, depth - 1); const before = cb(); await null; return before + " " + cb() + typeof cb; }
function* acrossYield(cb: Callback): Generator<number, string, unknown> { yield cb(); yield cb(); return typeof cb; }
function asPrototype(cb: Callback, depth: number): string { if (depth > 0) return asPrototype(cb, depth - 1); const heir = Object.create(cb); return cb() + " " + typeof heir + (Object.getPrototypeOf(heir) === cb) + (Object.getPrototypeOf(cb) === Function.prototype); }
function frozen(cb: Callback, depth: number): string { if (depth > 0) return frozen(cb, depth - 1); Object.freeze(cb); return cb() + " " + Object.isFrozen(cb); }
function toArrayMethods(cb: (x: number) => number, depth: number): string { if (depth > 0) return toArrayMethods(cb, depth - 1); return cb(1) + " " + [1, 2].map(cb).join() + Array.from([3], cb).join() + [cb].map(each => each(4)).join() + typeof cb; }
function errorInside(cb: Callback, depth: number): string { if (depth > 0) return errorInside(cb, depth - 1); try { return String(cb()); } catch (error) { return (error as Error).message + typeof (error as Error).stack + typeof cb; } }
function toNativeFunctions(cb: Callback, depth: number): string { if (depth > 0) return toNativeFunctions(cb, depth - 1); return cb() + " " + Array.isArray(cb) + Boolean(cb) + Number.isNaN(Number(cb)) + (Object(cb) === cb) + Object.entries(cb).length + [cb].includes(cb) + [cb].indexOf(cb) + Object.prototype.toString.call(cb) + Object.prototype.hasOwnProperty.call(cb, "name"); }
function comparedByOrder(cb: Callback, depth: number): string { if (depth > 0) return comparedByOrder(cb, depth - 1); const any: any = cb; return cb() + " " + (any < 1) + (any >= any) + Number.isNaN(any - 1) + Number.isNaN(+any) + (~any) + (any | 0) + typeof (any + 1); }
function onlyCalls(cb: (n?: number) => unknown, depth: number): unknown { if (depth > 0) return onlyCalls(cb, depth - 1); return cb(); }
function swapped(turns: number, one: Callback, two: Callback): string { if (turns === 0) return one() + "" + typeof one + two() + typeof two; return swapped(turns - 1, two, one); }

for (let k = 0; k < 3; k++) {
    say("typeof", typeOfIt(() => k + 1, 2));
    say("typeof in a template", typeOfInTemplate(() => k + 2, 2));
    say("typeof compared", typeOfIs(() => k + 3, 2));
    const shared = () => k + 4;
    saved = shared;
    say("the same as one that was saved", sameAsSaved(shared, 2));
    say("another than the one saved", sameAsSaved(() => k + 5, 2));
    say("the same twice", sameAsItself(shared, shared, 2));
    say("two of one text", sameAsItself(() => k, () => k, 2));
    say("loosely equal", looselyEqual(() => k + 6, 2));
    say("tests for nothing", nilTests(() => k + 7, 2) + " | " + nilTests(undefined, 2) + " | " + nilTests(null, 2));
    say("as text", asText(() => k + 8, 2));
    say("as a key", asKey(() => k + 9, 2));
    say("stored in an array", storedInArray(() => k + 10, 2) + " " + (kept[kept.length - 1] as Callback)());
    say("stored in an object", storedInObject(() => k + 11, 2) + " " + (bag.cb as Callback)());
    say("stored in a variable", storedInVariable(() => k + 12, 2) + " " + (saved as Callback)());
    say("returned", returned(() => k + 13, 2)());
    try { thrown(() => k + 14, 2); } catch (what) { say("thrown", typeof what + (what as Callback)()); }
    say("captured", captured(() => k + 15, 2)());
    say("to a callee nobody knows", toUnknownCallee(() => k + 16, 0, 2));
    say("which keeps it", toUnknownCallee(() => k + 17, 1, 2) + " " + (saved as Callback)());
    say("spread", spreadIt(() => k + 18, 2));
    say("as JSON", asJSON(() => k + 19, 2));
    attempt("instanceof", () => instanceOfIt(function () { return k + 20; }, 2));
    attempt("instanceof an arrow function", () => instanceOfIt(() => k + 20, 2));
    attempt("new of an arrow function", () => constructed(() => k + 21, 2));
    attempt("new of a function", () => constructed(function () { return k + 22; }, 2));
    say("its properties", itsProperties(() => k + 23, 2) + " | " + itsProperties(function named() { return k; }, 2));
    say("called in other ways", calledOtherwise(() => k + 24, 2));
    say("given properties", givenProperties(() => k + 25, 2));
    say("the target of a proxy", asProxyTarget(() => k + 26, 2));
    say("in collections", inCollections(() => k + 27, 2));
    say("through arguments", throughArguments(() => k + 28, 2));
    say("through a rest parameter", throughRest(2, () => k + 29, () => k));
    say("or another", orAnother(() => k + 30, 2) + " | " + orAnother(undefined, 2));
    saved = shared;
    say("in a switch", inSwitch(shared, 2) + " | " + inSwitch(() => k + 31, 2));
    say("as this", asThis(() => k + 32, 2));
    say("as a prototype", asPrototype(() => k + 33, 2));
    say("frozen", frozen(() => k + 34, 2));
    say("to array methods", toArrayMethods(x => x + k, 2));
    say("an error inside", errorInside(() => { throw new RangeError("inside " + k); }, 2));
    say("to native functions", toNativeFunctions(() => k + 46, 2));
    say("in arithmetic and order", comparedByOrder(() => k + 47, 2));
    say("a function that calls itself by its name", onlyCalls(function down(n: number = 3): number { return n <= 0 ? k : 1 + down(n - 1); }, 2));
    const itself = onlyCalls(function me(): unknown { return me; }, 2) as () => unknown;
    say("a function that returns itself", typeof itself + (itself() === itself) + (itself as any).name);
    const inner = onlyCalls(() => () => k + 48, 2) as Callback;
    say("a function that returns another", typeof inner + inner());
    say("two that change places", swapped(k * 3 + 1, () => k + 44, () => k + 45));
    const steps = acrossYield(() => k + 35);
    say("across yield", steps.next().value + " " + steps.next().value + " " + steps.next().value);
}
const later: Promise<unknown>[] = [];
for (let k = 0; k < 3; k++) later.push(toPromise(() => k + 36, 2), acrossAwait(() => k + 37, 2));
Promise.all(later).then(all => { say("to a promise, across await", all.join(" | ")); say("what was kept still works", kept.map(each => (each as Callback)()).join()); console.log(lines.join("\n")); });
