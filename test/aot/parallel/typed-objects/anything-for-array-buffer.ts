// `ArrayBuffer` names a class of the engine, and a place typed by it is tested for that class: it takes an ArrayBuffer, undefined or null. Anything else throws a TypeError where it enters the place: a proxy or an heir of one, another class of the engine, a look-alike, a primitive.
// Places: a parameter, a variable, a field, a field of a class, a result, an element. undefined and null pass and meet JavaScript's own answer or error at the use.
// VALIDATED compiles
function claim<T>(v: unknown): T { return v as T }
function say(name: string, f: () => unknown): void {
  let said: string;
  try { said = String(f()) } catch (e) { said = "throws " + (e as Error).name }
  console.log(name + ": " + said);
}
class Holder { held: ArrayBuffer; constructor(held: ArrayBuffer) { this.held = held } }
function result(v: unknown): ArrayBuffer { return claim<ArrayBuffer>(v) }
function use0(v: ArrayBuffer): unknown { return v.byteLength }
function use1(v: ArrayBuffer): unknown { return v.slice(1).byteLength }
function use2(v: ArrayBuffer): unknown { return new Uint8Array(v).length }
function use3(v: ArrayBuffer): unknown { return v instanceof ArrayBuffer }
function use4(v: ArrayBuffer): unknown { return typeof v }
const values: [string, () => unknown][] = [
  ["the real thing", () => new ArrayBuffer(8)], ["a proxy of it", () => new Proxy(new ArrayBuffer(8), {})], ["an heir of it", () => Object.create(new ArrayBuffer(8))], ["another class of the engine", () => new Uint16Array([7, 8])],
  ["an array", () => [1, 2]], ["a look-alike", () => ({ byteLength: 5, slice() { return { byteLength: 2 } } })], ["a function", () => () => 1], ["a number", () => 5], ["a string", () => "text"], ["null", () => null], ["undefined", () => undefined],
];
for (const [name, make] of values) {
  say("a parameter, " + name + ", v.byteLength", () => use0(claim<ArrayBuffer>(make())));
  say("a variable, " + name + ", v.byteLength", () => { const v: ArrayBuffer = claim<ArrayBuffer>(make()); return v.byteLength });
  say("a field, " + name + ", v.byteLength", () => { const o: { v: ArrayBuffer } = { v: claim<ArrayBuffer>(make()) }; const v = o.v; return v.byteLength });
  say("a field of a class, " + name + ", v.byteLength", () => { const v = new Holder(claim<ArrayBuffer>(make())).held; return v.byteLength });
  say("a result, " + name + ", v.byteLength", () => { const v = result(make()); return v.byteLength });
  say("an element, " + name + ", v.byteLength", () => { const all: ArrayBuffer[] = [claim<ArrayBuffer>(make())]; const v = all[0]; return v.byteLength });
  say("a parameter, " + name + ", v.slice(1).byteLength", () => use1(claim<ArrayBuffer>(make())));
  say("a variable, " + name + ", v.slice(1).byteLength", () => { const v: ArrayBuffer = claim<ArrayBuffer>(make()); return v.slice(1).byteLength });
  say("a field, " + name + ", v.slice(1).byteLength", () => { const o: { v: ArrayBuffer } = { v: claim<ArrayBuffer>(make()) }; const v = o.v; return v.slice(1).byteLength });
  say("a field of a class, " + name + ", v.slice(1).byteLength", () => { const v = new Holder(claim<ArrayBuffer>(make())).held; return v.slice(1).byteLength });
  say("a result, " + name + ", v.slice(1).byteLength", () => { const v = result(make()); return v.slice(1).byteLength });
  say("an element, " + name + ", v.slice(1).byteLength", () => { const all: ArrayBuffer[] = [claim<ArrayBuffer>(make())]; const v = all[0]; return v.slice(1).byteLength });
  say("a parameter, " + name + ", new Uint8Array(v).length", () => use2(claim<ArrayBuffer>(make())));
  say("a variable, " + name + ", new Uint8Array(v).length", () => { const v: ArrayBuffer = claim<ArrayBuffer>(make()); return new Uint8Array(v).length });
  say("a field, " + name + ", new Uint8Array(v).length", () => { const o: { v: ArrayBuffer } = { v: claim<ArrayBuffer>(make()) }; const v = o.v; return new Uint8Array(v).length });
  say("a field of a class, " + name + ", new Uint8Array(v).length", () => { const v = new Holder(claim<ArrayBuffer>(make())).held; return new Uint8Array(v).length });
  say("a result, " + name + ", new Uint8Array(v).length", () => { const v = result(make()); return new Uint8Array(v).length });
  say("an element, " + name + ", new Uint8Array(v).length", () => { const all: ArrayBuffer[] = [claim<ArrayBuffer>(make())]; const v = all[0]; return new Uint8Array(v).length });
  say("a parameter, " + name + ", v instanceof ArrayBuffer", () => use3(claim<ArrayBuffer>(make())));
  say("a variable, " + name + ", v instanceof ArrayBuffer", () => { const v: ArrayBuffer = claim<ArrayBuffer>(make()); return v instanceof ArrayBuffer });
  say("a field, " + name + ", v instanceof ArrayBuffer", () => { const o: { v: ArrayBuffer } = { v: claim<ArrayBuffer>(make()) }; const v = o.v; return v instanceof ArrayBuffer });
  say("a field of a class, " + name + ", v instanceof ArrayBuffer", () => { const v = new Holder(claim<ArrayBuffer>(make())).held; return v instanceof ArrayBuffer });
  say("a result, " + name + ", v instanceof ArrayBuffer", () => { const v = result(make()); return v instanceof ArrayBuffer });
  say("an element, " + name + ", v instanceof ArrayBuffer", () => { const all: ArrayBuffer[] = [claim<ArrayBuffer>(make())]; const v = all[0]; return v instanceof ArrayBuffer });
  say("a parameter, " + name + ", typeof v", () => use4(claim<ArrayBuffer>(make())));
  say("a variable, " + name + ", typeof v", () => { const v: ArrayBuffer = claim<ArrayBuffer>(make()); return typeof v });
  say("a field, " + name + ", typeof v", () => { const o: { v: ArrayBuffer } = { v: claim<ArrayBuffer>(make()) }; const v = o.v; return typeof v });
  say("a field of a class, " + name + ", typeof v", () => { const v = new Holder(claim<ArrayBuffer>(make())).held; return typeof v });
  say("a result, " + name + ", typeof v", () => { const v = result(make()); return typeof v });
  say("an element, " + name + ", typeof v", () => { const all: ArrayBuffer[] = [claim<ArrayBuffer>(make())]; const v = all[0]; return typeof v });
}
