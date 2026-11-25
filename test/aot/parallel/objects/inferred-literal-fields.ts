// Loops over objects that literals without a written type allocate. Later stores may put a value of any type in their fields.
const base: number[] = JSON.parse("[0,1,2,3,4,5]");
function show(v: any): string {
  if (typeof v === "function") return "f";
  if (v === null || typeof v !== "object") return Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v);
  if (Array.isArray(v)) return "[" + v.map(show).join() + "]";
  return "{" + Object.keys(v).map(key => key + ":" + show(v[key])).join() + "}";
}
function integers() {
  const few = base.map(k => ({ left: k * 3, right: k + 1 }));
  return { few, name: "left", read() { let s = 0; for (let i = 0; i < few.length; i++) { const p = few[i]!; s = (s + p.left - p.right) | 0; } return s; } };
}
function doubles() {
  const few = base.map(k => ({ width: k / 2, height: k * 0.25 + 1 }));
  return { few, name: "width", read() { let s = 0; for (let i = 0; i < few.length; i++) s += few[i]!.width * few[i]!.height; return s; } };
}
function strings() {
  const few = Array.from({ length: 6 }, (_, k) => ({ first: "a" + k, second: "b" + k }));
  return { few, name: "first", read() { let s = 0; for (const p of few) s += p.first.length + (p.second === "b2" ? 10 : 0); return s; } };
}
function booleans() {
  const few = base.map(function (k) { return { open: k > 2, shut: k < 4 }; });
  return { few, name: "open", read() { let s = 0; for (const { open, shut } of few) { if (open) s += 1; if (open === shut) s += 100; } return s; } };
}
function records() {
  const few = base.map(k => ({ at: { row: k, column: k + 1 }, size: k }));
  return { few, name: "at", read() { let s = 0; for (let i = 0; i < few.length; i++) { const p = few[i]!; s = (s + p.at.row * 10 + p.at.column + p.size) | 0; } return s; } };
}
function arrays() {
  const few = base.map(k => ({ items: [k, k + 1], count: 2 }));
  return { few, name: "items", read() { let s = 0; for (let i = 0; i < few.length; i++) { const p = few[i]!; for (let j = 0; j < p.count; j++) s += p.items[j]!; } return s; } };
}
function optionals() {
  const few = base.map(k => ({ from: k > 2 ? k : undefined, to: k > 3 ? { end: k } : null }));
  return { few, name: "from", read() { let s = 0; few.forEach(p => { if (p.from !== undefined) s += p.from; s += p.to?.end ?? 50; }); return s; } };
}
function copies() {
  const few = base.map(k => ({ key: k })).map(o => ({ ...o, value: o.key * 2 }));
  return { few, name: "value", read() { return few.reduce((s, p) => (s + p.value + p.key) | 0, 0); } };
}
function methods() {
  const few = base.map(k => ({ total: k, add(n: number) { this.total += n; return this; } }));
  return { few, name: "total", read() { let s = 0; for (const p of few) s += p.add(1).total; return s; } };
}
class Shelf { books = base.map(k => ({ pages: k * 100, title: "t" + k })); }
function fields() {
  const shelf = new Shelf(), few = shelf.books;
  return { few, name: "pages", read() { let s = 0; for (let i = 0; i < shelf.books.length; i++) { const p = shelf.books[i]!; s = (s + p.pages + p.title.length) | 0; } return s; } };
}
const ways: [string, (few: any, name: string, value: any) => void][] = [
  ["store", (few, name, value) => { few[2][name] = value; }],
  ["assign", (few, name, value) => { Object.assign(few[2], { [name]: value }); }],
  ["reflect", (few, name, value) => { Reflect.set(few[2], name, value); }],
  ["every", (few, name, value) => { for (const p of few) p[name] = value; }],
  ["delete", (few, name) => { delete few[2][name]; }],
  ["getter", (few, name, value) => { Object.defineProperty(few[2], name, { get: () => value, configurable: true, enumerable: true }); }],
  ["frozen", (few, name, value) => { Object.freeze(few[2]); Reflect.set(few[2], name, value); }],
  ["parsed", few => { few[2] = JSON.parse(JSON.stringify(few[2])); }],
  ["reordered", few => { few[2] = Object.fromEntries(Object.entries(few[2]).reverse()); }],
  ["spread", (few, name, value) => { few[2] = { ...few[2], [name]: value }; }],
  ["hole", few => { delete few[2]; }],
  ["null", few => { few[2] = null; }],
  ["number", few => { few[2] = 5; }],
  ["proxy", few => { few[2] = new Proxy(few[2], {}); }],
  ["shorter", few => { few.length = 3; }],
];
const values = [7, "s", 1.5, -0, undefined, null, true, 10000000000, { valueOf: () => 4, row: "r", length: 2 }, ["q", 1]];
let digest = 0;
for (const make of [integers, doubles, strings, booleans, records, arrays, optionals, copies, methods, fields]) {
  const lines: string[] = [];
  for (const [way, change] of ways) {
    for (const value of values) {
      const { few, name, read } = make();
      const out: string[] = [];
      const go = () => { try { for (let r = 0; r < 3; r++) out.push(show(read())); } catch (e: any) { out.push(e.constructor.name); } };
      go();
      change(few, name, value);
      go();
      lines.push(way + " " + show(value) + " " + out.join(" ") + " " + show(few[2]));
      if (way === "delete" || way === "hole") break;
    }
  }
  const text = lines.join("\n");
  for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0;
  console.log(make.name, lines.length, digest, lines[1], "|", lines[23], "|", lines[lines.length - 2]);
}
