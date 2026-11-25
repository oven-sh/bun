// family.ts: a family of classes in which some have members under computed keys, accessors, several evaluations; members and fields changed while objects live.
// @ts-nocheck
import { EventEmitter } from "node:events";
import { Duplex, Readable, Transform, Writable } from "node:stream";
import { inherits } from "node:util";
const keys = ["alpha", "beta", "gamma"].map(k => k + process.argv.length * 0);
const sym = Symbol("sym");
class Base { a = 1; b: any = "b"; [sym] = 0; get sum() { return this.a + String(this.b); } set sum(v: any) { this.a = v; } step() { this.a++; return this; } read() { return this.a + ":" + String(this.b) + ":" + this[sym]; } store(v: any) { this.b = v; this.a = v?.length ?? 2; this[sym]++; return this; } }
class Plain extends Base { c = 3; }
class Computed extends Base { [keys[0]!]() { return "computed"; } [keys[1]!] = 5; get [keys[2]!]() { return "getter"; } }
class ComputedField extends Base { [keys[0]! + "x"] = 1; a = 10; }
class Hides extends Base { [["a", "z"][process.argv.length > 99 ? 1 : 0]! + ""] = 77; }
class HidesByAccessor extends Base { get [["b", "q"][process.argv.length > 99 ? 1 : 0]!]() { return "hidden"; } set [["b", "q"][process.argv.length > 99 ? 1 : 0]!](v: any) { log.push("set b " + String(v)); } }
const make = (n: number) => class extends Base { n = n; step() { this.a += n; return super.step(); } };
const Twice1 = make(2), Twice2 = make(3);
class Deep extends Computed { d = 4; step() { return super.step(); } }
class Old { constructor(this: any) { Base.prototype.step.call(this); } }
function Func(this: any) { this.a = 1; this.b = "f"; }
inherits(Func as any, Base);
let log: string[] = [];
const all = () => [new Base(), new Plain(), new Computed(), new ComputedField(), new Hides(), new HidesByAccessor(), new Twice1(), new Twice2(), new Deep(), new (Func as any)()] as any[];
const touch = (o: any) => { try { return [o.read(), o.step().a, o.sum, o.store("xyz").read(), (o.sum = 5, o.a), o.store(null).b, Object.keys(o).join(), o.alpha?.(), o.gamma].map(String).join(" "); } catch (e) { return "THROWN " + (e as Error).message; } };
const round = (name: string, objects: any[]) => { log = []; const lines = objects.map(o => o.constructor.name + " " + touch(o)); console.log("# " + name + "\n" + lines.join("\n") + "\n" + log.join("\n")); };
for (let i = 0; i < 30; i++) all().forEach(touch);
round("as built", all());
const changes: [string, () => void, () => void][] = [
  ["step of Base", () => { (Base.prototype as any).held = Base.prototype.step; Base.prototype.step = function () { log.push("new step"); return this; }; }, () => { Base.prototype.step = (Base.prototype as any).held; delete (Base.prototype as any).held; }],
  ["accessor over b on Base", () => Object.defineProperty(Base.prototype, "b", { configurable: true, get() { return "of Base"; }, set(v) { log.push("b " + String(v)); } }), () => delete (Base.prototype as any).b],
  ["accessor over a on Plain", () => Object.defineProperty(Plain.prototype, "a", { configurable: true, get() { return 41; }, set(v) { log.push("a " + v); } }), () => delete (Plain.prototype as any).a],
  ["read-only c on Object.prototype's heir", () => Object.defineProperty(Computed.prototype, "b", { configurable: true, value: 1, writable: false }), () => delete (Computed.prototype as any).b],
  ["link of Plain", () => Object.setPrototypeOf(Plain.prototype, { read: () => "other", step() { return this; }, store() { return this; }, get sum() { return "s"; }, set sum(v) {} }), () => Object.setPrototypeOf(Plain.prototype, Base.prototype)],
  ["alpha on Base", () => { (Base.prototype as any).alpha = () => "alpha of Base"; }, () => delete (Base.prototype as any).alpha],
];
for (const [name, change, back] of changes) {
  const before = all();
  change();
  round(name + ": older objects", before);
  round(name + ": newer objects", all());
  back();
  round(name + ": back", before);
}
for (const how of ["freeze", "seal", "preventExtensions"] as const) round(how, all().map(o => Object[how](o)));
round("deleted", all().map(o => (delete o.a, delete o.b, o)));
round("own accessor", all().map(o => Object.defineProperty(o, "a", { configurable: true, get: () => 9, set: v => void log.push("own " + v) })));
round("more names", all().map(o => Object.assign(o, { x: 1, y: 2, read: 5 })));
// The same with streams below the library's classes.
const nameOfRead = "_re" + (keys.length === 3 ? "ad" : "");
class ComputedReadable extends Readable { n = 0; [nameOfRead]() { (this as any).push(this.n < 2 ? "c" + this.n++ : null); } [keys[0]!] = 1; }
class AccessorReadable extends Readable { n = 0; override _read() { this.push(this.n < 2 ? "a" + this.n++ : null); } get [keys[0]!]() { return 1; } }
class EventsReadable extends Readable { n = 0; override _read() { this.push(this.n < 2 ? "e" + this.n++ : null); } get [["_eventsCount", ""][0]!]() { return 3; } set [["_eventsCount", ""][0]!](v: any) { log.push("count " + v); } }
const makeStream = (name: string) => class extends Duplex { tag = name; override _read() { this.push(null); } override _write(c: any, _: any, done: any) { log.push(name + c); done(); } };
const D1 = makeStream("one"), D2 = makeStream("two");
class Emitter extends EventEmitter { [keys[1]! + "y"]() {} count = 0; }
class Emitter2 extends EventEmitter { override on(e: any, f: any) { log.push("on " + String(e)); return super.on(e, f); } }
for (let i = 0; i < 3; i++) for (const make of [() => new ComputedReadable(), () => new AccessorReadable(), () => new EventsReadable(), () => new D1(), () => new D2(), () => new Transform({ transform(c, _, d) { d(null, c); } }), () => new Writable({ write(c, _, d) { d(); } })] as (() => any)[]) {
  log = [];
  const s = make();
  for (const e of ["data", "end", "close", "finish", "error"]) s.on(e, (x: any) => log.push(e + (x === undefined ? "" : " " + x)));
  s.write?.("w");
  s.end?.();
  s.resume?.();
  await new Promise(r => setImmediate(() => setImmediate(() => setImmediate(r))));
  console.log("# " + s.constructor.name + " " + log.join(",") + " " + s._eventsCount + " " + Object.keys(s).join());
}
for (const E of [EventEmitter, Emitter, Emitter2] as any[]) { log = []; const e = new E(); const f = () => log.push("x"); e.on("x", f).once("x", f); e.emit("x"); e.emit("x"); e.off("x", f); e.removeAllListeners(); console.log(E.name, log.join(), e._eventsCount, Object.keys(e).join(), Object.keys(e._events).join()); const bare = Object.create(E.prototype); EventEmitter.call(bare); bare._events = undefined; bare.on("y", f); console.log(bare._eventsCount, bare.listenerCount("y")); }
