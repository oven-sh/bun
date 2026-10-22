// Optional fields that few objects have lie outside the object's cell. A read by name of one that is missing answers undefined only while nothing above the object has the name,
// and a field that was stored as undefined, as null or taken away again is told apart by `in`, by hasOwnProperty and by the keys, never by the read.
class Leaf { constructor(public id: number) {} }
interface Common {
  a?: unknown; b?: unknown; c?: unknown; d?: unknown; e?: unknown; f?: unknown; g?: unknown; h?: unknown;
  n1?: Leaf | null; n2?: Leaf | null; n3?: Leaf | null; n4?: Leaf | null; n5?: Leaf | null; n6?: Leaf | null; n7?: Leaf | null; n8?: Leaf | null;
  s1?: string; s2?: string; s3?: string; s4?: string; x1?: number; x2?: number; x3?: number; x4?: number; t1?: boolean; t2?: boolean; t3?: boolean; t4?: boolean;
}
interface First extends Common { first: number }
interface Second extends Common { second: number }
interface Third extends Common { third: number }
const box: unknown[] = JSON.parse("[0]");
function hidden<T>(value: T): any { box[0] = value; return box[0]; }
const leaf = new Leaf(7);
function fill(o: Common, i: number): void {
  o.a = i;
  o.n1 = leaf;
  if (i % 8 === 1) { o.g = "g" + i; o.n7 = leaf; o.s4 = "s" + i; o.x4 = i + 0.5; o.t4 = true; }
  if (i % 8 === 2) { o.g = undefined; o.n7 = undefined; o.s4 = undefined; o.x4 = undefined; o.t4 = undefined; }
  if (i % 8 === 3) { o.g = null; o.n7 = null; o.h = 0; o.n8 = leaf; o.x4 = 0; o.t4 = false; o.s4 = ""; }
  if (i % 8 === 4) { o.g = 1; o.n7 = leaf; delete o.g; delete o.n7; }
}
const objects: any[] = [];
for (let i = 0; i < 24; i++) {
  const o: Common = i % 3 === 0 ? ({ first: i } as First) : i % 3 === 1 ? ({ second: i } as Second) : ({ third: i } as Third);
  fill(o, i);
  objects.push(hidden(o));
}
const names = ["g", "h", "f", "n7", "n8", "n6", "s4", "s3", "x4", "x3", "t4", "t3"];
function show(value: any): string { return value instanceof Leaf ? "leaf" + value.id : typeof value === "string" ? JSON.stringify(value) : String(value); }
function byName(o: any): string {
  return [o.g, o.h, o.f, o.n7, o.n8, o.n6, o.s4, o.s3, o.x4, o.x3, o.t4, o.t3].map(show).join(",");
}
function byKey(o: any): string { return names.map(name => show(o[name])).join(","); }
function presence(o: any): string { return names.map(name => (name in o ? "i" : "-") + (Object.prototype.hasOwnProperty.call(o, name) ? "o" : "-")).join(""); }
function round(title: string): void {
  const lines = new Set<string>();
  for (let repeat = 0; repeat < 40; repeat++) {
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const read = byName(o);
      if (read !== byKey(o)) console.log(title, i, "by name and by key differ", read, byKey(o));
      lines.add(`${i % 8}: ${read} ${presence(o)} ${Object.keys(o).length}`);
    }
  }
  console.log(title);
  for (const line of [...lines].sort()) console.log("  " + line);
}
round("as made");
for (let i = 0; i < objects.length; i += 5) Object.setPrototypeOf(objects[i], { n7: "n7 of another prototype", x3: 33, get t3() { return "t3 of " + Object.keys(this).length; } });
round("every fifth object has another prototype");
for (let i = 1; i < objects.length; i += 5) Object.defineProperty(objects[i], "h", { get() { return "own getter"; }, configurable: true, enumerable: false });
for (let i = 2; i < objects.length; i += 5) { objects[i].n8 = leaf; objects[i].h = i; objects[i].s3 = "late"; objects[i].extra = i; }
for (let i = 3; i < objects.length; i += 5) Object.freeze(objects[i]);
round("own getters, late stores, frozen objects");
