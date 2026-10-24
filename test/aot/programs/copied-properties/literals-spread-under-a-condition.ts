// `...(condition && { key: value })` and `...(condition ? { a } : { b })`: the literal is made for the spread alone. What the object gets, in which order, and when the values are computed is what a copy of the literal gives.
const lines: string[] = [];
const show = (label: string, value: object) => lines.push(label + " | " + JSON.stringify(value) + " | " + Reflect.ownKeys(value).map(String).join());
let ticks = 0;
const tick = (name: string) => { lines.push("computed " + name + " at " + ticks++); return name; };
for (const on of [true, false]) {
  show("and " + on, { a: 1, b: 2, ...(on && { c: 3 }), d: 4 });
  show("either " + on, { a: 1, ...(on ? { b: 2, c: 3 } : { z: 26 }), d: 4 });
  show("either or nothing " + on, { a: 1, ...(on ? { b: 2 } : {}), d: 4 });
  show("either or undefined " + on, { a: 1, ...(on ? { b: 2 } : undefined), d: 4 });
  show("either or null " + on, { a: 1, ...(on ? null : { b: 2 }), d: 4 });
  show("or " + on, { a: 1, ...((on || { b: 2 }) as object), d: 4 });
  show("first " + on, { ...(on && { c: 3 }), a: 1 });
  show("last " + on, { a: 1, ...(on && { c: 3 }) });
  show("alone " + on, { ...(on && { c: 3 }) });
  show("replaces what stands " + on, { a: 1, b: 2, ...(on && { a: 10 }), c: 3 });
  show("is replaced " + on, { a: 1, ...(on && { b: 2 }), b: 20 });
  show("several " + on, { a: 1, ...(on && { b: 2 }), ...(!on && { c: 3 }), ...(on && { d: 4, e: 5 }), f: 6 });
  show("one in another " + on, { a: 1, ...(on && { b: 2, ...(on && { c: 3 }) }), d: 4 });
  show("holds undefined " + on, { a: 1, ...(on && { b: undefined }), c: 3 });
  show("holds an object " + on, { a: 1, ...(on && { b: { inner: [1, 2] } }), c: 3 });
  show("a number for nothing " + on, { a: 1, ...((on ? 0 : { b: 2 }) as object) });
  show("in order " + on, { a: tick("a"), ...(on && { b: tick("b"), c: tick("c") }), d: tick("d") });
}
// Not plain data, or seen by somebody else: these are copied as ever.
for (const on of [true, false]) {
  let reads = 0;
  show("a getter " + on, { a: 1, ...(on && { get b() { return ++reads; } }), c: 3 });
  lines.push("reads " + reads);
  const key = "computed";
  show("a computed key " + on, { a: 1, ...(on && { [key]: 2 }), c: 3 });
  show("an index " + on, { a: 1, ...(on && { 7: "seven", b: 2 }), c: 3 });
  const symbol = Symbol("s");
  show("a symbol " + on, { a: 1, ...(on && { [symbol]: 2, b: 3 }), c: 4 });
  show("a prototype " + on, { a: 1, ...(on && { __proto__: { inherited: 1 }, b: 2 }), c: 3 });
  show("a method " + on, { a: 1, ...(on && { m() { return 1; } }), c: 3 });
  show("a text " + on, { a: 1, ...((on ? "xy" : { b: 2 }) as object), c: 3 });
  show("an empty text " + on, { a: 1, ...((on ? "" : { b: 2 }) as object), c: 3 });
  show("a list " + on, { a: 1, ...(on ? [8, 9] : { b: 2 }), c: 3 });
  let kept: object | false = false;
  show("kept too " + on, { a: 1, ...(kept = on && { b: 2 }), c: 3 });
  lines.push("kept " + JSON.stringify(kept));
  const named = on && { b: 2 };
  show("named first " + on, { a: 1, ...named, c: 3 });
  show("named again " + on, { z: 0, ...named });
}
// No condition, or one that is decided.
show("none", { a: 1, ...{ b: 2, c: 3 }, d: 4 });
show("none, replaced", { a: 1, ...({ a: 2, b: tick("b of none") } as object), b: 3 });
show("always", { a: 1, ...(true && { b: 2 }), c: 3 });
show("never", { a: 1, ...((false && { b: 2 }) as unknown as object), c: 3 });
type Attributes = Record<string, string | number | boolean | undefined>;
function attributes(user?: string, size?: number, fast?: boolean): Attributes {
  return { "app.name": "x", ...(user && { "user.id": user }), ...(size !== undefined && { "request.size": size, "request.known": true }), ...(fast && { "request.fast": true }) };
}
show("attributes", attributes()); show("attributes", attributes("u")); show("attributes", attributes("", 0)); show("attributes", attributes("u", 3, true)); show("attributes", attributes(undefined, undefined, false));
function three(which: number): object { return { a: 1, ...(which === 0 ? { b: 2 } : which === 1 ? { c: 3, d: 4 } : which === 2 ? false : { e: 5 }), f: 6 }; }
for (let which = 0; which < 4; which++) show("of four " + which, three(which));
function throws(on: boolean): object { return { a: 1, ...(on && { b: (() => { throw new Error("no value"); })() }), c: 3 }; }
for (const on of [false, true]) { try { show("throws " + on, throws(on)); } catch (e) { lines.push("threw " + (e as Error).message); } }
type Wire = { type: string; first?: number; shown?: string; id?: string; joined?: boolean };
function wire(first?: number, shown?: string, id?: string, joined?: boolean): Wire {
  return { type: "event", ...(first !== undefined && { first }), ...(shown !== undefined && { shown }), ...(id !== undefined && { id }), ...(joined && { joined: true }) };
}
show("wire", wire()); show("wire", wire(1)); show("wire", wire(undefined, "s")); show("wire", wire(1, "s", "i", true)); show("wire", wire(undefined, undefined, "i", false));
for (let i = 0; i < 3; i++) { const made: { n: number; odd?: boolean; even?: boolean } = { n: i, ...(i & 1 ? { odd: true } : { even: true }) }; show("in a loop", made); }
console.log(lines.join("\n"));
