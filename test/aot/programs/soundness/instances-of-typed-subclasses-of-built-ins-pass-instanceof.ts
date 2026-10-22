// What `super()` of a class that extends Map, Error or Array makes is a cell of the built-in class, so no test for the layout of the class takes it.
// It is an instance of the class all the same: in a union, behind `instanceof`, as a typed parameter, in a typed field and after a trip through `any`.
declare const console: { log(...values: unknown[]): void };
class Registry extends Map<string, number> { tag = "r"; #n = 1; bump() { return ++this.#n; } }
class Failure extends Error { code = 7; describe() { return this.name + ":" + this.message + ":" + this.code; } }
class Stack extends Array<number> { label = "s"; top() { return this[this.length - 1]; } }
class Plain { tag = "p"; bump() { return 0; } }
function viaInstanceOf(x: Registry | Plain | string): string {
  if (x instanceof Registry) return "registry " + x.tag + x.size + x.bump();
  if (x instanceof Plain) return "plain " + x.tag + x.bump();
  return "string " + x;
}
function viaUnion(x: Registry | Plain): string { return x.tag + x.bump(); }
function typed(r: Registry): number { return r.size + r.bump(); }
function failing(f: Failure | null): string { return f ? f.describe() : "none"; }
function stack(s: Stack): string { return s.label + s.top() + s.length; }
const holder: { r: Registry | Plain } = { r: new Plain() };
const values: any[] = JSON.parse("[1]");
for (let i = 0; i < 3; i++) {
  const r = new Registry(); r.set("a", i);
  holder.r = i % 2 ? r : new Plain();
  const s = new Stack(); s.push(i, i + 1);
  console.log(viaInstanceOf(r), viaInstanceOf(new Plain()), viaInstanceOf("t"), viaUnion(r), viaUnion(holder.r), typed(r), failing(new Failure("m" + i)), failing(null), stack(s));
  values.push(r, s, new Failure("v"));
}
for (const v of values) console.log(typeof v === "number" ? v : v instanceof Registry ? typed(v) : v instanceof Stack ? stack(v) : failing(v));
