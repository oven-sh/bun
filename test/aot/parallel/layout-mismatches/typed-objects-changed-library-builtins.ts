// Typed objects read by small typed functions that run hot are changed by code that no statement of the program spells out: functions of Bun's library that store and delete under computed keys or through `this`, built-ins that construct, define or move on their own, class fields stamped onto a finished object, stores through `super` and Reflect with another receiver, number keys that spell a field's name. The readers must see what plain Bun sees.
import { EventEmitter } from "node:events";
import { ReadStream } from "node:fs";
import * as util from "node:util";

const lines: string[] = [];
function text(value: unknown): string {
  return JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : typeof v === "bigint" ? "#" + v + "n" : typeof v === "number" && v !== v ? "#NaN" : v === Infinity ? "#Infinity" : v);
}
function say(label: string, value: unknown) { lines.push(label + ": " + text(value)); }
function attempt(label: string, run: () => unknown) { try { say(label, run()); } catch (error) { say(label + " throws", (error as Error).constructor.name); } }

interface Kind { flags: number; id: number; name: string; next: Kind | undefined; run: () => number; length: number; stack: string; late?: number; }
const Kind = function (this: Kind, flags: number, id: number) {
  this.flags = flags; this.id = id; this.name = "k" + id; this.next = undefined; this.run = seven; this.length = 0; this.stack = "none";
} as unknown as new (flags: number, id: number) => Kind;
function seven(): number { return 7; }
class Mark { flags: number; id: number; owner: Kind | undefined; constructor(flags: number, id: number, owner: Kind | undefined) { this.flags = flags; this.id = id; this.owner = owner; } }

function flagsOf(kind: Kind): number { return kind.flags; }
function idOf(kind: Kind): number { return kind.id; }
function nameOf(kind: Kind): string { return kind.name; }
function nextId(kind: Kind): number { const next = kind.next; return next ? next.id : -1; }
function runOf(kind: Kind): number { return kind.run(); }
function lengthOf(kind: Kind): number { return kind.length; }
function stackOf(kind: Kind): string { return kind.stack; }
function hasFlag(kind: Kind, flag: number): boolean { return (kind.flags & flag) !== 0; }
function markFlags(mark: Mark): number { return mark.flags; }
function ownerId(mark: Mark): number { return mark.owner ? mark.owner.id : -1; }
function guarded<T>(read: () => T): T | string { try { return read(); } catch (error) { return "threw " + (error as Error).constructor.name; } }
function show(kind: Kind) {
  return [flagsOf(kind), idOf(kind), nameOf(kind), guarded(() => nextId(kind)), guarded(() => runOf(kind)), lengthOf(kind), typeof stackOf(kind), hasFlag(kind, 4), "flags" in kind, "run" in kind];
}
function showMark(mark: Mark) { return [markFlags(mark), mark.id, guarded(() => ownerId(mark)), Object.keys(mark).join()]; }

const warm: Kind[] = [], warmMarks: Mark[] = [];
for (let i = 0; i < 300; i++) { const kind = new Kind(i & 15, i); if (i) kind.next = warm[i - 1]; warm.push(kind); warmMarks.push(new Mark(i, i, kind)); }
function tally(): number {
  let t = 0;
  for (const kind of warm) t += flagsOf(kind) + idOf(kind) + nameOf(kind).length + nextId(kind) + runOf(kind) + lengthOf(kind) + stackOf(kind).length + (hasFlag(kind, 2) ? 1 : 0);
  for (const mark of warmMarks) t += markFlags(mark) + ownerId(mark);
  return t;
}
for (let round = 0; round < 60; round++) tally();
say("warm", tally());
let serial = 1000;
function fresh(): Kind { const kind = new Kind(5, serial++); kind.next = warm[7]; return kind; }

// undefined and null where a number is declared, by stores that run hot and know nothing of the object. In the second half another field has left its slot first.
function pokeFlags(target: any, stored: unknown) { target.flags = stored; }
function pokeAt(target: any, key: string, stored: unknown) { target[key] = stored; }
for (let i = 0; i < 3000; i++) { pokeFlags(warm[i % 300], (i % 300) & 15); pokeAt(warm[i % 300], i & 1 ? "flags" : "id", i & 1 ? (i % 300) & 15 : i % 300); }
{ const a = fresh(); pokeFlags(a, undefined); say("undefined by name", show(a)); }
{ const a = fresh(); pokeFlags(a, null); say("null by name", show(a)); }
{ const a = fresh(); pokeAt(a, ["id"][0], undefined); say("undefined by key", show(a)); }
{ const a = fresh(); (a as unknown as { late: unknown }).late = "text"; pokeFlags(a, undefined); say("undefined by name, late has left its slot", show(a)); }
{ const a = fresh(); (a as unknown as { late: unknown }).late = "text"; pokeFlags(a, null); pokeAt(a, ["id"][0], null); say("null by name and by key, late has left its slot", show(a)); }
{ const a = fresh(); (a as unknown as { late: unknown }).late = "text"; Object.assign(a, { flags: undefined, id: null }); say("assigned, late has left its slot", show(a)); }
{ const a = fresh(); Object.defineProperty(a, "late", { get() { return 1; }, configurable: true }); Reflect.set(a, "flags", undefined); say("Reflect.set, late is an accessor", show(a)); }
{ const a = fresh(); pokeAt(a, ["id"][0], undefined); pokeFlags(a, undefined); say("undefined by name, id holds undefined already", show(a)); }
{ const a = fresh(); pokeAt(a, ["id"][0], null); for (let i = 0; i < 40; i++) pokeFlags(a, i < 39 ? i : null); say("null by name at the fortieth store, id holds null already", show(a)); }
{ const a = fresh(), record = { flags: 1, id: 2 }; pokeFlags(record, undefined); pokeAt(record, ["id"][0], null); Object.assign(a, record); say("assigned from a record that holds undefined and null", show(a)); }
{ const a = fresh(), records: { flags: number; id: number }[] = []; for (let i = 0; i < 60; i++) records.push({ flags: i, id: i }); pokeFlags(records[59], undefined); for (const record of records) Object.assign(a, record); say("assigned from the sixtieth record, which holds undefined", show(a)); }
{ say("undefined into the constructor", show(new Kind(undefined as unknown as number, 1))); }
{ say("null into the constructor", show(new Kind(3, null as unknown as number))); }
{ const many: Kind[] = []; for (let i = 0; i < 400; i++) many.push(new Kind((i === 399 ? undefined : i) as number, i)); say("undefined into a constructor that runs hot", show(many[399])); }

// Text that becomes code while the program runs: no build has seen it.
{ const a = fresh(); new Function("target", "target.flags = 'text'")(a); say("a function made of text stores", show(a)); }
{ const a = fresh(); (0, eval)("(function (target) { delete target.id; })")(a); say("evaluated text deletes", show(a)); }
{ const a = fresh(); new Function("target", "Object.defineProperty(target, 'name', { get() { return 'got'; }, configurable: true })")(a); say("a function made of text redefines", show(a)); }
{ const a = fresh(), store = new Function("target", "stored", "target.flags = stored"); for (let i = 0; i < 40; i++) store(a, i < 39 ? i : undefined); say("a function made of text stores undefined at the fortieth call", show(a)); }

// node:events keeps its listeners in an object that anybody may replace: it stores and deletes there under the name of the event.
{
  const a = fresh(); a.next = undefined;
  const emitter = new EventEmitter() as EventEmitter & { _events: unknown; _eventsCount: number };
  emitter._events = a; emitter._eventsCount = 20;
  emitter.on("next", seven);
  say("events: a listener stored under next", show(a));
  emitter.removeListener("run", a.run);
  say("events: run deleted", show(a));
  a.run = seven;
  say("events: run stored again", show(a));
}
{
  const a = fresh();
  const emitter = new EventEmitter() as EventEmitter & { _events: unknown; _eventsCount: number };
  emitter._events = a; emitter._eventsCount = 2;
  emitter.on("run", seven);
  say("events: two listeners under run", [typeof (a as unknown as { run: unknown }).run, Array.isArray((a as unknown as { run: unknown }).run), guarded(() => runOf(a))]);
}
attempt("events: the constructor on a typed object", () => { const a = fresh(); (EventEmitter as unknown as Function).call(a); return [show(a), Object.keys(a).length > 7]; });

// The constructor of a stream of node:fs stores a string under `flags` through `this`.
attempt("fs: ReadStream on a typed object", () => {
  const a = fresh();
  Object.setPrototypeOf(a, ReadStream.prototype);
  const never = { open() {}, read() {}, close(_: number, done: () => void) { done(); } };
  (ReadStream as unknown as Function).call(a, "/nowhere", { fs: never, autoClose: false, emitClose: false });
  return [flagsOf(a), idOf(a), hasFlag(a, 4), typeof (a as unknown as { path: unknown }).path];
});

// A copy loop of the library.
attempt("util: _extend", () => { const a = fresh(); (util as unknown as { _extend(target: object, source: object): object })._extend(a, { flags: "extended", id: null, more: 1 }); return show(a); });
attempt("util: inherits gives the constructor another prototype chain", () => {
  const Local = function (this: Kind, id: number) { this.flags = 1; this.id = id; this.name = "l"; this.next = undefined; this.run = seven; this.length = 0; this.stack = ""; } as unknown as new (id: number) => Kind;
  const before = new Local(1);
  util.inherits(Local as unknown as Function, EventEmitter);
  const after = new Local(2);
  return [show(before), show(after), after instanceof EventEmitter, before instanceof EventEmitter];
});

// Built-ins that construct what they are called on, with operands of their own choice.
const born: Kind[] = [];
const Listed = function (this: Kind, flags: number, id: number) {
  this.flags = flags; this.id = id; this.name = "listed"; this.next = undefined; this.run = seven; this.length = 0; this.stack = "none"; born.push(this);
} as unknown as new (flags: number, id: number) => Kind;
for (let i = 0; i < 200; i++) new Listed(i & 7, i);
born.length = 0;
attempt("Array.of constructs", () => show(Array.of.call(Listed, "a", "b", "c") as unknown as Kind));
attempt("Array.from constructs", () => show((Array.from as Function).call(Listed, ["x"]) as Kind));
attempt("Array.from constructs for an array-like", () => show((Array.from as Function).call(Listed, { length: 2, 0: "p", 1: "q" }) as Kind));
attempt("Promise.resolve constructs", () => Promise.resolve.call(Listed, 1));
attempt("Promise.all constructs", () => Promise.all.call(Listed, []));
attempt("Reflect.construct without arguments", () => show(Reflect.construct(Listed, [])));
attempt("a bound constructor brings a string", () => show(new ((Listed as unknown as Function).bind(null, "bound") as new (id: number) => Kind)(3)));
attempt("species", () => { class Odd extends Array<number> { static get [Symbol.species]() { return Listed as unknown as ArrayConstructor; } } return show(new Odd(1, 2, 3).map(x => x) as unknown as Kind); });
say("all that was born", born.map(show));

// The fields of a class are defined on whatever the constructor above returns.
class Back { constructor(given: object) { return given; } }
class Stamp extends Back { flags = "stamped"; id = undefined; run = 12; }
class StampAccessor extends Back { static { Object.defineProperty(this.prototype, "unused", { value: 1 }); } name = { toString() { return "object"; } }; }
{ const a = fresh(); new Stamp(a); say("class fields on a finished object", show(a)); }
{ const a = fresh(); new StampAccessor(a); say("an object for name", [typeof (a as unknown as { name: unknown }).name, guarded(() => nameOf(a).length), flagsOf(a)]); }
{ const m = new Mark(1, 2, warm[3]); new Stamp(m); say("class fields on an instance of a class", showMark(m)); }

// Stores with another receiver.
const base = {};
const thief = { __proto__: base, poke(this: unknown, stored: unknown) { super.flags = stored; }, pokeKey(this: unknown, key: string, stored: unknown) { super[key] = stored; } } as unknown as { poke(stored: unknown): void; pokeKey(key: string, stored: unknown): void };
{ const a = fresh(); thief.poke.call(a, "super"); say("super.flags with a typed receiver", show(a)); }
{ const a = fresh(); thief.pokeKey.call(a, ["id"][0], null); say("super[key] with a typed receiver", show(a)); }
{ const a = fresh(); Reflect.set({}, "flags", "reflected", a); Reflect.set({}, ["next"][0], 5, a); say("Reflect.set with a typed receiver", show(a)); }
{ const a = fresh(); const proxy = new Proxy({}, {}); Reflect.set(proxy, "name", 44, a); say("through a proxy with a typed receiver", [typeof (a as unknown as { name: unknown }).name, flagsOf(a)]); }
{ const a = fresh(); const heir = Object.create(new Proxy(a, {})) as Kind; heir.flags = 9; say("an heir of a proxy of a typed object", [flagsOf(a), Object.keys(heir).join()]); }
{ const a = fresh(); const proxy = new Proxy(a, {}) as Kind; (proxy as unknown as { flags: unknown }).flags = "proxied"; delete (proxy as unknown as { id?: number }).id; say("through a proxy of it", show(a)); }

// Built-ins that define or move on their own.
attempt("Error.captureStackTrace", () => { const a = fresh(); Error.captureStackTrace(a); return [typeof stackOf(a), stackOf(a) === "none", flagsOf(a), Object.keys(a).includes("stack")]; });
attempt("push on a typed object", () => { const a = fresh(); Array.prototype.push.call(a, "x", "y"); return [show(a), (a as unknown as string[])[1]]; });
attempt("push past the integers", () => { const a = fresh(); a.length = 4294967295; Array.prototype.push.call(a, "x"); return [lengthOf(a), lengthOf(a) + 1]; });
attempt("pop", () => { const a = fresh(); a.length = 1; (a as unknown as string[])[0] = "only"; return [Array.prototype.pop.call(a), lengthOf(a)]; });
attempt("a length that is no integer", () => { const a = fresh(); a.length = 2.5; Array.prototype.reverse.call(a); Array.prototype.fill.call(a, 1); return [lengthOf(a), Object.keys(a).length]; });
attempt("splice", () => { const a = fresh(); a.length = 3; Array.prototype.splice.call(a, 0, 1); return lengthOf(a); });
attempt("__defineGetter__ by a value", () => { const a = fresh(); const define = (Object.prototype as unknown as { __defineGetter__: Function }).__defineGetter__; define.call(a, ["flags"][0], () => 40); return show(a); });
attempt("__defineSetter__ by a value", () => { const a = fresh(); const define = (Object.prototype as unknown as { __defineSetter__: Function }).__defineSetter__; define.call(a, ["id"][0], () => {}); return show(a); });
attempt("defineProperty through Reflect.apply and bind", () => {
  const a = fresh(), b = fresh();
  Reflect.apply(Object.defineProperty, undefined, [a, "flags", { value: "applied" }]);
  Object.defineProperties.bind(null, b)({ id: { get() { return "got"; } }, name: { value: 3 } });
  return [show(a), guarded(() => idOf(b)), typeof (b as unknown as { name: unknown }).name];
});
attempt("Object.assign of an accessor's value", () => { const a = fresh(); Object.assign(a, { get flags() { delete (a as Partial<Kind>).id; return "late"; } }); return show(a); });
attempt("Object.fromEntries and a spread keep out of it", () => { const a = fresh(); const copy = { ...a, flags: "copy" }; return [show(a), copy.flags]; });

// `this` and the operands that native code hands to callbacks.
attempt("the replacer of JSON.stringify", () => { const a = fresh(); JSON.stringify(a, function (this: Record<string, unknown>, key, value) { if (key === "id") this.flags = "replaced"; return typeof value === "function" ? undefined : key === "next" ? undefined : value; }); return show(a); });
attempt("toJSON", () => { const a = fresh(); (a as unknown as { toJSON: unknown }).toJSON = function (this: Partial<Kind>) { delete this.name; return 1; }; JSON.stringify(a); return [guarded(() => nameOf(a)), flagsOf(a)]; });
attempt("thisArg of forEach", () => { const a = fresh(); [1].forEach(function (this: Partial<Kind>) { delete this.flags; }, a); return show(a); });
attempt("the comparator of sort", () => { const list = [fresh(), fresh(), fresh()]; list.sort((x: any, y: any) => { x.flags = "sorted"; return x.id - y.id; }); return list.map(kind => typeof (kind as unknown as { flags: unknown }).flags).sort().join(); });
attempt("a reviver's holder", () => JSON.parse('{"flags":1,"id":2}', function (this: Record<string, unknown>, key, value) { if (key === "flags") delete this.id; return value; }));

// What runs between two reads of one typed function.
function sum(kind: Kind, other: number): number { const first = kind.flags + other; return first + kind.id + kind.flags; }
function twice(kind: Kind, between: () => void): unknown[] { const first = kind.flags; between(); return [first, kind.flags, kind.id]; }
for (let i = 0; i < 3000; i++) { sum(warm[i % 300], i); twice(warm[i % 300], () => {}); }
attempt("valueOf between two reads", () => { const a = fresh(); return sum(a, { valueOf() { (a as unknown as { flags: unknown }).flags = "mid"; delete (a as Partial<Kind>).id; return 1; } } as unknown as number); });
attempt("a call between two reads", () => { const a = fresh(); return twice(a, () => { Object.defineProperty(a, "flags", { get() { return "getter"; } }); (a as unknown as { id: unknown }).id = 0.5; }); });
async function later(kind: Kind): Promise<unknown[]> { const first = kind.flags; await undefined; return [first, kind.flags, kind.id, nameOf(kind)]; }
function* stepwise(kind: Kind): Generator<unknown> { yield kind.flags; yield kind.flags; yield [kind.id, kind.name]; }
{ const a = fresh(); const steps = stepwise(a); const seen = [steps.next().value]; (a as unknown as { flags: unknown }).flags = null; seen.push(steps.next().value); delete (a as Partial<Kind>).name; seen.push(steps.next().value); say("a generator", seen); }

// A number spells the name of a field.
interface Odd { NaN: number; Infinity: number; "-1": number; "1e+21": number; "0.5": number; plain: number; }
const Odd = function (this: Odd, seed: number) { this.NaN = seed; this.Infinity = seed + 1; this["-1"] = seed + 2; this["1e+21"] = seed + 3; this["0.5"] = seed + 4; this.plain = seed + 5; } as unknown as new (seed: number) => Odd;
function showOdd(odd: Odd) { return [odd.NaN, odd.Infinity, odd["-1"], odd["1e+21"], odd["0.5"], odd.plain, Object.keys(odd).join()]; }
const odds: Odd[] = []; for (let i = 0; i < 200; i++) odds.push(new Odd(i));
for (let round = 0; round < 40; round++) for (const odd of odds) showOdd(odd);
function storeAt(list: Record<number, unknown>, index: number, stored: unknown) { list[index] = stored; }
function dropAt(list: Record<number, unknown>, index: number) { delete list[index]; }
const plainList: unknown[] = []; for (let i = 0; i < 3000; i++) { storeAt(plainList, i & 63, i); if ((i & 511) === 0) dropAt(plainList, 70); }
{ const o = new Odd(1) as Odd & Record<number, unknown>; storeAt(o, 0 / 0, "nan"); storeAt(o, 1 / 0, "inf"); storeAt(o, -1, "minus"); storeAt(o, 1e21, "large"); storeAt(o, 0.5, "half"); say("number keys store", showOdd(o)); }
{ const o = new Odd(2) as Odd & Record<number, unknown>; dropAt(o, 0 / 0); dropAt(o, -1); dropAt(o, 0.5); say("number keys delete", showOdd(o)); }

// A bigint comes out of `|=`.
function raise(kind: Kind, flag: number) { kind.flags |= flag; }
for (let i = 0; i < 3000; i++) raise(warm[i % 300], 0);
attempt("bigints in |=", () => { const a = fresh(); (a as unknown as { flags: unknown }).flags = 1n; raise(a, 2n as unknown as number); return [typeof (a as unknown as { flags: unknown }).flags, guarded(() => hasFlag(a, 2)), String(flagsOf(a))]; });
attempt("a bigint and a number in |=", () => { const a = fresh(); raise(a, 2n as unknown as number); return show(a); });

// An object that is kept although its constructor threw half way.
const kept: Kind[] = [];
const Half = function (this: Kind, id: number, fails: boolean) {
  this.flags = 3; this.id = id; kept.push(this); if (fails) throw new RangeError("half"); this.name = "h"; this.next = undefined; this.run = seven; this.length = 0; this.stack = "";
} as unknown as new (id: number, fails: boolean) => Kind;
for (let i = 0; i < 200; i++) new Half(i, false);
kept.length = 0;
attempt("the constructor throws", () => new Half(1, true));
say("kept half made", kept.map(kind => [flagsOf(kind), idOf(kind), guarded(() => nameOf(kind)), guarded(() => runOf(kind)), guarded(() => lengthOf(kind)), Object.keys(kind).join()]));

later(fresh()).then(value => {
  say("an async function, nothing between", value);
  const a = fresh(); const pending = later(a);
  (a as unknown as { flags: unknown }).flags = "awaited"; delete (a as Partial<Kind>).id; Object.defineProperty(a, "name", { get() { return "by getter"; } });
  return pending;
}).then(value => {
  say("an async function, changed at the await", value);
  say("the others are as they were", tally());
  console.log(lines.join("\n"));
});
