// `const c = x.inner` and then something, seen or unseen, wants the object for itself before `c` is used again. Whatever it was, `c` names the one object.
import { edenGC, fullGC } from "bun:jsc";

type Leaf = { id: number };
type Inner = { count: number; leaf: Leaf; text: string };
type Outer = { inner: Inner; tag: number };

function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, leaf: { id: i }, text: "t" + i }, tag: i });
    }
  }
}

const sink: unknown[] = [];
let current: Outer | null = null;
function show(c: Inner): string { return c.count + "," + c.leaf.id + "," + c.text; }
function takeCurrent(): number { sink.push(current!.inner); return 1; }

const withGetter = { get trap(): number { return takeCurrent(); } };
const withValueOf = { valueOf(): number { return takeCurrent(); } };
const withToString = { toString(): string { takeCurrent(); return "s"; } };
const withToPrimitive = { [Symbol.toPrimitive](): number { return takeCurrent(); } };
const proxy = new Proxy({} as Record<string, number>, { get() { return takeCurrent(); }, has() { takeCurrent(); return true; } });
const iterable = { *[Symbol.iterator]() { takeCurrent(); yield 1; } };

type Way = (x: Outer) => string;
const ways: [string, Way][] = [
  ["push", x => { const c = x.inner; const a = c.count; sink.push(x.inner); c.count += 100; return a + " " + show(c) + " " + show(x.inner); }],
  ["spread", x => { const c = x.inner; const a = c.count; const copy = { ...x }; c.count += 100; return a + " " + show(c) + " " + show(copy.inner) + " " + (copy.inner === x.inner); }],
  ["spread of it", x => { const c = x.inner; const copy = { ...x.inner }; c.count += 100; return show(c) + " " + show(copy) + " " + (copy === (x.inner as unknown)); }],
  ["assign", x => { const c = x.inner; const copy = Object.assign({}, x); c.count += 100; return show(c) + " " + show(copy.inner) + " " + (copy.inner === x.inner); }],
  ["assign into", x => { const c = x.inner; Object.assign(x, { tag: -1 }); c.count += 100; return show(c) + " " + x.tag; }],
  ["values", x => { const c = x.inner; const values = Object.values(x); c.count += 100; return show(c) + " " + (values[0] === x.inner); }],
  ["entries", x => { const c = x.inner; const entries = Object.entries(x); c.count += 100; return show(c) + " " + (entries[0][1] === x.inner); }],
  ["keys", x => { const c = x.inner; const keys = Object.keys(x); c.count += 100; return show(c) + " " + keys.join(); }],
  ["for in", x => { const c = x.inner; let found: unknown; for (const key in x) if (key === "inner") found = (x as any)[key]; c.count += 100; return show(c) + " " + (found === x.inner); }],
  ["by key", x => { const c = x.inner; const key = sink.length >= 0 ? "inner" : "tag"; const found = (x as any)[key]; c.count += 100; return show(c) + " " + show(found); }],
  ["stored by key", x => { const c = x.inner; const key = sink.length >= 0 ? "inner" : "tag"; (x as any)[key] = { count: -1, leaf: { id: -1 }, text: "other" }; c.count += 100; return show(c) + " " + show(x.inner); }],
  ["json", x => { const c = x.inner; const text = JSON.stringify(x); c.count += 100; return show(c) + " " + text; }],
  ["clone", x => { const c = x.inner; const clone = structuredClone(x); c.count += 100; return show(c) + " " + show(clone.inner); }],
  ["getter", x => { const c = x.inner; const a = withGetter.trap; c.count += 100; return a + " " + show(c) + " " + (sink[sink.length - 1] === c); }],
  ["value of", x => { const c = x.inner; const a = (withValueOf as any) * 2; c.count += 100; return a + " " + show(c) + " " + (sink[sink.length - 1] === c); }],
  ["to string", x => { const c = x.inner; const a = `${withToString}`; c.count += 100; return a + " " + show(c) + " " + (sink[sink.length - 1] === c); }],
  ["to primitive", x => { const c = x.inner; const a = (withToPrimitive as any) + 1; c.count += 100; return a + " " + show(c) + " " + (sink[sink.length - 1] === c); }],
  ["proxy get", x => { const c = x.inner; const a = proxy.anything; c.count += 100; return a + " " + show(c) + " " + (sink[sink.length - 1] === c); }],
  ["proxy has", x => { const c = x.inner; const a = "anything" in proxy; c.count += 100; return a + " " + show(c) + " " + (sink[sink.length - 1] === c); }],
  ["iterator", x => { const c = x.inner; const [a] = iterable; c.count += 100; return a + " " + show(c) + " " + (sink[sink.length - 1] === c); }],
  ["caught", x => { const c = x.inner; try { sink.push(x.inner); (null as any).nothing; } catch { c.count += 100; } return show(c) + " " + show(x.inner); }],
  ["finally", x => { const c = x.inner; try { return show(c); } finally { sink.push(x.inner); c.count += 100; sink.push(show(c)); } }],
  ["loop", x => { const c = x.inner; let sum = 0; for (let i = 0; i < 5; i++) { if (i === 2) sink.push(x.inner); c.count += 1; sum += c.count + c.leaf.id; } return sum + " " + show(x.inner); }],
  ["other name", x => { const y = x; const c = x.inner; sink.push(y.inner); c.count += 100; return show(c) + " " + show(y.inner); }],
  ["itself", x => { const c = x.inner; x.inner = x.inner; c.count += 100; return show(c) + " " + show(x.inner) + " " + (c === x.inner); }],
  ["out of itself", x => { const c = x.inner; x.inner = { count: x.inner.count + 1, leaf: x.inner.leaf, text: x.inner.text + "!" }; c.count += 100; return show(c) + " " + show(x.inner) + " " + (c === x.inner); }],
  ["null", x => { const c = x.inner; (x as any).inner = null; c.count += 100; return show(c) + " " + (x as any).inner; }],
  ["deleted", x => { const c = x.inner; delete (x as any).inner; c.count += 100; return show(c) + " " + ("inner" in x); }],
  ["frozen", x => { const c = x.inner; Object.freeze(x); c.count += 100; return show(c) + " " + show(x.inner) + " " + Object.isFrozen(x) + Object.isFrozen(x.inner); }],
  ["it is frozen", x => { const c = x.inner; Object.freeze(x.inner); try { c.count += 100; } catch (error) { sink.push((error as Error).name); } return show(c) + " " + Object.isFrozen(c) + " " + sink[sink.length - 1]; }],
  ["extra property", x => { const c = x.inner; (x.inner as any).extra = "extra"; c.count += 100; return show(c) + " " + (c as any).extra + " " + Object.keys(c).join(); }],
  ["extra on the outer", x => { const c = x.inner; (x as any).extra = "extra"; c.count += 100; return show(c) + " " + show(x.inner) + " " + Object.keys(x).join(); }],
  ["prototype", x => { const c = x.inner; Object.setPrototypeOf(x.inner, { inherited: "inherited" }); c.count += 100; return show(c) + " " + (c as any).inherited; }],
  ["prototype of the outer", x => { const c = x.inner; Object.setPrototypeOf(x, { inherited: "inherited" }); c.count += 100; return show(c) + " " + show(x.inner) + " " + (x as any).inherited; }],
  ["defined", x => { const c = x.inner; Object.defineProperty(x, "inner", { value: x.inner, writable: false, enumerable: false, configurable: true }); c.count += 100; return show(c) + " " + show(x.inner) + " " + Object.keys(x).join(); }],
  ["accessor", x => { const c = x.inner; const kept = x.inner; Object.defineProperty(x, "inner", { get() { return kept; }, configurable: true }); c.count += 100; return show(c) + " " + show(x.inner); }],
  ["descriptor", x => { const c = x.inner; const descriptor = Object.getOwnPropertyDescriptor(x, "inner")!; c.count += 100; return show(c) + " " + (descriptor.value === x.inner); }],
  ["reflect", x => { const c = x.inner; const found = Reflect.get(x, "inner"); c.count += 100; return show(c) + " " + (found === x.inner); }],
  ["collections", x => { const c = x.inner; const a = c.count; fullGC(); c.count += 100; edenGC(); return a + " " + show(c) + " " + show(x.inner); }],
  ["collected after", x => { const c = x.inner; sink.push(x.inner); sink.pop(); fullGC(); c.count += 100; c.leaf = { id: -c.leaf.id }; edenGC(); return show(c) + " " + show(x.inner); }],
];

function swap(x: Outer, y: Outer): string {
  const c = x.inner, d = y.inner;
  const held = x.inner;
  x.inner = y.inner;
  y.inner = held;
  c.count += 100;
  d.count += 200;
  return show(c) + " " + show(d) + " " + show(x.inner) + " " + show(y.inner) + " " + (x.inner === d) + (y.inner === c);
}
function give(x: Outer, y: Outer): string {
  const c = x.inner, d = y.inner;
  y.inner = x.inner;
  c.count += 100;
  d.count += 200;
  return show(c) + " " + show(d) + " " + show(y.inner) + " " + (x.inner === y.inner);
}

for (let round = 0; round < 3; round++) {
  const outers: Outer[] = [];
  fill(outers, 10, 10);
  let next = 0;
  for (const [name, way] of ways) {
    current = outers[next++];
    console.log(round, name + ":", way(current));
    sink.length = 0;
  }
  console.log(round, "swap:", swap(outers[next++], outers[next++]));
  console.log(round, "give:", give(outers[next++], outers[next++]));
  if (round === 1) fullGC();
}
