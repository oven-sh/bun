// Native functions define, replace and remove properties of objects that compiled code made and goes on reading.
import { inspect, inherits } from "node:util";
import { EventEmitter } from "node:events";
function show(f: () => unknown): string { try { const v = f(); return typeof v === "function" ? "function" : typeof v === "string" && v.length > 60 ? "text of " + (v.includes("\n") ? "lines" : v.length) : String(v); } catch (e: any) { return "threw " + e.constructor.name; } }
class Point { x: number; y: number; stack?: string; constructor(x: number, y: number) { this.x = x; this.y = y; } norm() { return this.x * this.x + this.y * this.y; } }
class Named extends Point { name = "n"; message = "m"; }
interface Bag { a: number; b: string; stack?: string; c?: number }
const makers: Record<string, () => any> = {
    point: () => new Point(1, 2), named: () => new Named(3, 4), literal: (): Bag => ({ a: 1, b: "two" }), array: () => [1, 2, 3], doubles: () => [1.5, 2.5], fn: () => function f() {}, arrow: () => () => 1,
    frozen: () => Object.freeze(new Point(5, 6)), sealed: () => Object.seal({ a: 1, b: "s" }), closed: () => Object.preventExtensions(new Point(7, 8)), emitter: () => new EventEmitter(), error: () => new TypeError("t"),
    klass: () => class K { static s = 1; }, map: () => new Map([[1, 2]]), bound: () => function g() {}.bind(null),
};
function read(o: any) { return [o.x, o.y, o.a, o.b, o.c, typeof o.stack, o.name, o.message, o.length, o[0], o.s, Object.keys(o).join("+"), show(() => o.norm && o.norm())].join(","); }
const natives: Record<string, (o: any) => unknown> = {
    capture: o => (Error as any).captureStackTrace(o),
    captureTwice: o => { (Error as any).captureStackTrace(o); (Error as any).captureStackTrace(o, read); return typeof o.stack; },
    captureThenStore: o => { (Error as any).captureStackTrace(o); o.stack = "mine"; return o.stack; },
    captureThenDelete: o => { (Error as any).captureStackTrace(o); return delete o.stack; },
    assign: o => Object.assign(o, { x: 10, c: 11, extra: 12 }),
    assignFromParsed: o => Object.assign(o, JSON.parse('{"y":20,"a":"text","z":[1]}')),
    defineProperties: o => Object.defineProperties(o, { x: { get() { return "gx"; }, configurable: true }, q: { value: 1, enumerable: true } }),
    entries: o => Object.assign(o, Object.fromEntries([["b", 1.5], ["x", "s"]])),
    clone: o => read(structuredClone(o)),
    inspect: o => inspect(o).length > 0,
    bunInspect: o => Bun.inspect(o).length > 0,
    deepEquals: o => Bun.deepEquals(o, o, true),
    emitterCall: o => { EventEmitter.call(o); return Object.keys(o).join("+"); },
    setProto: o => Object.setPrototypeOf(o, EventEmitter.prototype) && typeof o.on,
    reflectSet: o => Reflect.set(o, "x", 1.25) + "," + Reflect.set(o, "y", "why") + "," + Reflect.set(o, "b", 3),
    reflectSetReceiver: o => Reflect.set({}, "x", { big: 1 }, o),
    reflectDelete: o => Reflect.deleteProperty(o, "x") + "," + Reflect.deleteProperty(o, "a"),
    symbolKeys: o => { o[Symbol.toPrimitive] = () => 42; o[Symbol.iterator] = function* () { yield 1; }; return +o + [...o].length; },
    freeze: o => Object.isFrozen(Object.freeze(o)),
    inherits: o => typeof o === "function" ? (inherits(o, EventEmitter), Object.getPrototypeOf(o.prototype ?? {}) === EventEmitter.prototype) : "not a function",
    spawnOptions: o => { o.stdout = "pipe"; o.env = { A: "1" }; return Bun.spawnSync({ cmd: ["true"], ...o }).exitCode; },
    headers: o => (new Headers(typeof o === "object" && !Array.isArray(o) && !(o instanceof Map) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) : {}) as any).count,
    stringifyWithToJSON: o => { o.toJSON = function () { delete this.x; this.late = 1; return 1; }; return JSON.stringify(o); },
    sortByGetter: o => Array.isArray(o) ? o.sort(() => { o.length = 1; return 0; }).length : "no list",
    withResolvers: o => Object.assign(o, Promise.withResolvers()) && typeof o.resolve,
    groupBy: o => Object.keys(Object.groupBy([o], (v: any) => { v.grouped = true; return "k"; })).join(),
};
const order = process.argv[2] ?? "cold";
for (const [n, native] of Object.entries(natives)) for (const [m, make] of Object.entries(makers)) {
    const o = make(), twin = make();
    const before = order === "warm" ? read(o) + read(o) + read(twin) : "";
    const did = show(() => native(o));
    console.log(n, m, before.length, did, "|", show(() => read(o)), "|", show(() => read(o)), "|", show(() => read(twin)), "|", show(() => { o.x = 99; o.a = 98; o.y = 1.5; return read(o); }));
}
