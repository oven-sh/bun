// o[key] with a key that is only known when the program runs, on objects whose fields lie packed in their cells: every kind of value, empty fields, fields that left their slots, names above the object.

const lines: string[] = [];
function say(label: string, value: unknown) {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : typeof v === "symbol" ? "#symbol" : typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? "#" + (Object.is(v, -0) ? "-0" : v) : v)));
}
class Item {
  id: number; big: number; ratio: number; label: string; next: Item | null; maybe?: Item; list: number[]; flag: boolean; any: unknown; opt?: number; text?: string | null; run: () => number;
  constructor(i: number, next: Item | null) {
    this.id = i; this.big = i * 1e10; this.ratio = i / 3; this.label = "l" + i; this.next = next; if (i % 3 === 0 && next) this.maybe = next; this.list = [i]; this.flag = i % 2 === 0;
    this.any = i % 4 === 0 ? i : i % 4 === 1 ? "s" + i : i % 4 === 2 ? null : undefined; if (i % 5 === 0) this.opt = -i; if (i % 7 === 0) this.text = i % 14 === 0 ? null : "t"; this.run = () => i;
  }
  method() { return "m" + this.id; }
  get twice() { return this.id * 2; }
}
const keys = ["id", "big", "ratio", "label", "next", "maybe", "list", "flag", "any", "opt", "text", "run", "method", "twice", "missing", "constructor", "toString", "0", "length", "__proto__"];
function read(o: any, key: PropertyKey) { return o[key]; }
function show(v: any): unknown { return v instanceof Item ? "item" + v.id : v === Item.prototype ? "proto" : v === Item ? "Item" : v; }

const items: Item[] = [];
for (let i = 0; i < 300; i++) items.push(new Item(i, i ? items[i - 1] : null));
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 14, 15, 21, 30, 105, 299]) say("item " + i, keys.map(key => show(read(items[i], key))));
{
  let t = 0;
  for (let round = 0; round < 50; round++) for (const item of items) for (let k = 0; k < 12; k++) { const v = read(item, keys[k]); if (typeof v === "number") t += v % 1000; else if (v instanceof Item) t += v.id; else if (v === null) t += 3; else if (v === undefined) t += 5; else if (v === true) t += 7; }
  say("total", t);
}
// Integers at the edges of what a narrow slot holds.
{
  const edges = [0, -0, 1, -1, 2147483647, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, 2147483648, 4294967295, 0.5, NaN, Infinity];
  const made = edges.map(v => { const item = new Item(1, null); item.id = v; item.opt = v; return item; });
  say("edges", made.map(item => [read(item, "id"), read(item, "opt")]));
  say("the same", made.map((item, i) => Object.is(read(item, "id"), edges[i]) && Object.is(read(item, "opt"), edges[i])));
}
// Other values than the types allow, deletion, redefinition, freezing, objects below, other objects with the same names.
{
  const o: any = new Item(6, items[2]);
  o.id = "text"; o.next = 5; o.label = null; o.list = undefined; o.flag = items[1]; o.maybe = 1.5;
  say("other values", keys.slice(0, 12).map(key => show(read(o, key))));
  o.id = 9; o.next = items[3]; say("back", keys.slice(0, 12).map(key => show(read(o, key))));
  const d: any = new Item(15, items[4]);
  delete d.id; delete d.next; delete d.any; say("deleted", [keys.slice(0, 12).map(key => show(read(d, key))), Object.keys(d).join()]);
  d.next = null; d.id = 4; say("again", [keys.slice(0, 12).map(key => show(read(d, key))), Object.keys(d).join()]);
  const r: any = new Item(20, items[5]); let reads = 0;
  Object.defineProperty(r, "id", { get() { return ++reads; }, configurable: true });
  Object.defineProperty(r, "next", { value: "fixed", writable: false });
  say("redefined", [read(r, "id"), read(r, "id"), read(r, "next"), reads]);
  say("frozen", keys.slice(0, 8).map(key => show(read(Object.freeze(new Item(3, items[1])), key))));
  const below = Object.create(items[9]); say("from above", keys.slice(0, 8).map(key => show(read(below, key))));
  below.id = "own"; say("shadowed", [read(below, "id"), read(items[9], "id")]);
  const mixed: any[] = [items[1], { id: "plain", next: 1 }, [1, 2], "string", 5, new Map([["id", 1]]), function id() {}, items[2], Object.create(null), new Proxy(items[3], {})];
  say("mixed", mixed.map(v => [show(read(v, "id")), show(read(v, "next")), show(read(v, "length"))]));
  const sym = Symbol("id"); (items[0] as any)[sym] = "by symbol"; say("symbols", [read(items[0], sym), read(items[1], sym), read(items[0], Symbol.iterator), typeof read([], Symbol.iterator)]);
  const built = ["i" + "d", "ne".concat("xt"), String(["label"]), `${"li"}st`]; say("keys that are made", built.map(key => show(read(items[7], key))));
  let threw = ""; try { read(null, "id"); } catch (error) { threw = (error as Error).constructor.name; } say("null", threw);
}

console.log(lines.join("\n"));
