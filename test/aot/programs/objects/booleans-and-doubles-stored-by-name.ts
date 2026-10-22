// Fields that lie unboxed in their objects (booleans, doubles) stored by code that knows nothing of the object: in code that runs once, in code that comes again, in strict and sloppy code, by definition.
// What is read back must be what was stored, whatever it was, and the keys must keep the order in which the properties came.

const lines: string[] = [];
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "a function";
  if (typeof value === "object" && value) return "{" + Object.keys(value).map(k => k + ":" + show((value as any)[k])).join(",") + "}";
  return String(value);
}
function say(label: string, ...values: unknown[]) { lines.push(label + ": " + values.map(show).join(" ")); }

type Settings = { on: boolean; ratio: number; maybe?: boolean; perhaps?: number; label: string };
function make(i: number): Settings {
  const s: Settings = { on: i % 2 === 0, ratio: i + 0.5, label: "s" + i };
  if (i % 3 === 0) s.maybe = i % 6 === 0;
  if (i % 4 === 0) s.perhaps = i / 8;
  return s;
}
class Flags {
  on: boolean; ratio: number; maybe?: boolean; perhaps?: number;
  constructor(i: number) { this.on = i % 2 === 1; this.ratio = i / 4; if (i % 5 === 0) this.maybe = true; if (i % 7 === 0) this.perhaps = -i; }
}
const hide = (v: unknown): any => new CustomEvent("x", { detail: v }).detail;

// Nothing here says what `o` is.
function storeAll(o: any, flag: unknown, number: unknown) { o.on = flag; o.ratio = number; o.maybe = flag; o.perhaps = number; }
function readAll(o: any) { return [o.on, o.ratio, o.maybe, o.perhaps]; }
const sloppyStore = new Function("o", "flag", "number", "o.on = flag; o.ratio = number; o.maybe = flag; o.perhaps = number;") as (o: any, flag: unknown, number: unknown) => void;

// Every kind of value, into slots that are filled and slots that are empty.
const flags: unknown[] = [true, false, undefined, null, 0, 1, "true", {}, Symbol.iterator === Symbol.iterator];
const numbers: unknown[] = [0, -0, 1, -1, 0.5, 2147483647, -2147483648, 2147483648, 4294967296, 1e308, 5e-324, NaN, Infinity, -Infinity, undefined, null, true, "7", 10n, { valueOf() { return 3; } }];
for (let i = 0; i < 12; i++) {
  for (const create of [make, (n: number) => new Flags(n)]) {
    const o = hide(create(i));
    const before = Object.keys(o).join();
    storeAll(o, flags[i % flags.length], numbers[(i * 3) % numbers.length]);
    say("stored " + i, before, o, ...readAll(o));
    storeAll(o, flags[(i + 4) % flags.length], numbers[(i * 5 + 1) % numbers.length]);
    say("again " + i, o);
    storeAll(o, i % 2 === 0, i * 1.5);
    say("back " + i, o);
  }
}
for (const number of numbers) { const o = hide(make(1)); o.ratio = number; o.perhaps = number; say("number", o.ratio, o.perhaps, typeof o.ratio, Object.keys(o).join()); }
for (const flag of flags) { const o = hide(make(1)); o.on = flag; o.maybe = flag; say("flag", o.on, o.maybe, typeof o.maybe, Object.keys(o).join()); }

// The order of the keys when the optional fields come late, and in the other order.
{ const o = hide(make(1)); o.perhaps = 1.5; o.maybe = false; say("perhaps first", Object.keys(o).join(), o); }
{ const o = hide(make(1)); o.maybe = true; o.extra = 1; o.perhaps = 2; say("an extra between", Object.keys(o).join(), o); }
{ const o = hide(make(12)); delete o.maybe; delete o.ratio; o.ratio = 9.25; o.maybe = true; say("deleted and given again", Object.keys(o).join(), o); }

// Objects that may not be stored to.
function attempt(label: string, o: any, store: (o: any, flag: unknown, number: unknown) => void) {
  let thrown = "nothing thrown";
  try { store(o, true, 3.5); } catch (e) { thrown = (e as Error).constructor.name; }
  say(label, thrown, o, Object.keys(o).join());
}
for (const [name, store] of [["strict", storeAll], ["sloppy", sloppyStore]] as const) {
  attempt(name + " frozen", hide(Object.freeze(make(12))), store);
  attempt(name + " frozen, fields missing", hide(Object.freeze(make(1))), store);
  attempt(name + " sealed", hide(Object.seal(make(12))), store);
  attempt(name + " sealed, fields missing", hide(Object.seal(make(1))), store);
  attempt(name + " not extensible, fields missing", hide(Object.preventExtensions(make(1))), store);
  const readOnly = make(12); Object.defineProperty(readOnly, "on", { writable: false }); Object.defineProperty(readOnly, "perhaps", { value: 1, writable: false });
  attempt(name + " read-only", hide(readOnly), store);
  const seen: unknown[] = [];
  const accessors = make(12); Object.defineProperty(accessors, "ratio", { set(v) { seen.push(v); }, get() { return "got"; }, enumerable: true }); Object.defineProperty(accessors, "maybe", { get() { return "only a getter"; }, enumerable: true });
  attempt(name + " accessors", hide(accessors), store); say(name + " the setter saw", ...seen);
}

// What stands above the object decides about a field that the object does not have yet.
class Watched { on = false; ratio = 0.5; maybe?: boolean; perhaps?: number; }
const caught: unknown[] = [];
{
  const before = hide(new Watched()); storeAll(before, true, 1.25); say("nothing above", before);
  Object.defineProperty(Watched.prototype, "maybe", { set(v) { caught.push("maybe", v); }, configurable: true });
  Object.defineProperty(Watched.prototype, "perhaps", { value: 7, writable: false, configurable: true });
  const o = hide(new Watched());
  attempt("a setter and a read-only property above", o, storeAll); say("caught", ...caught, o.perhaps);
  sloppyStore(o, false, 2.5); say("sloppy", o, ...caught);
  Object.defineProperty(o, "maybe", { value: true, writable: true, enumerable: true, configurable: true }); Object.defineProperty(o, "perhaps", { value: 4.5, writable: true, enumerable: true, configurable: true });
  storeAll(o, false, 8.5); say("defined on the object itself", o, Object.keys(o).join());
  delete (Watched.prototype as any).maybe; delete (Watched.prototype as any).perhaps;
  const after = hide(new Watched()); storeAll(after, true, 6.5); say("nothing above again", after);
}
{
  const o = hide(make(1)); Object.setPrototypeOf(o, { set maybe(v: unknown) { caught.push("other prototype", v); } }); o.maybe = true; o.perhaps = 0.25; say("another prototype", o, caught[caught.length - 1]);
  const below = Object.create(hide(make(12))); below.on = "own"; below.ratio = 1; say("an object below", Object.keys(below).join(), below.on, Object.getPrototypeOf(below).on);
}

// Definitions: an object literal's spread, Object.assign, a class field on an object that a base constructor returns.
{
  const target = hide(make(1)); Object.assign(target, { maybe: false, perhaps: -0, on: null, ratio: "text" }); say("assigned", target);
  class Base { constructor(o: object) { return o; } }
  class Stamps extends Base { on = true; ratio = 12.5; maybe = false; perhaps = NaN; }
  say("class fields on a given object", new Stamps(hide(make(1))), new Stamps(hide(make(12))));
  let thrown = "nothing thrown"; try { new Stamps(hide(Object.freeze(make(12)))); } catch (e) { thrown = (e as Error).constructor.name; } say("class fields on a frozen object", thrown);
}

// Receivers that are no such objects.
for (const other of [{ on: 1 }, [], function () {}, new Map(), Object.create(null)]) { const o = hide(other); storeAll(o, true, 0.5); say("another receiver", ...readAll(o)); }
for (const primitive of [1, "s", true, Symbol.iterator, 1n]) { let thrown = "nothing thrown"; try { storeAll(hide(primitive), true, 0.5); } catch (e) { thrown = (e as Error).constructor.name; } sloppyStore(hide(primitive), true, 0.5); say("a primitive", thrown); }
for (const nothing of [undefined, null]) { let thrown = "nothing thrown"; try { storeAll(hide(nothing), true, 0.5); } catch (e) { thrown = (e as Error).constructor.name; } say("nothing", thrown); }

// Code that comes again and again, over many objects of both kinds, so that whatever remembers a site gets to remember it.
const rounds = Number(process.argv[2] ?? 300);
const many: any[] = [];
for (let i = 0; i < 64; i++) many.push(hide(i % 2 ? make(i) : new Flags(i)));
let total = 0, yes = 0;
for (let r = 0; r < rounds; r++) {
  for (let i = 0; i < many.length; i++) {
    const o = r % 16 === 15 ? (many[i] = hide(i % 2 ? make(i + r) : new Flags(i + r))) : many[i];
    storeAll(o, (i + r) % 3 === 0, (i + r) % 5 === 0 ? i + r : (i + r) / 16);
    if (o.on === true && o.maybe === true) yes++;
    total += o.ratio + o.perhaps;
  }
}
say("many", total, yes, many[0], many[1], many[63]);
console.log(lines.join("\n"));
