// A substring that Map and Set lookups have found stays a string in every test of what a value is.
const spaces = new Map([["/chat", { name: "space" }], ["/", { name: "root" }], ["name", 1]]);
const set = new Set(["/chat", "name"]);
class Base { constructor(v) { this.v = v; } tell() { return "base"; } }
class Heir extends Base { constructor(v) { super(v); this.w = 2; } }
function of(name) {
  if (typeof name === "function" || name instanceof RegExp) return "parent";
  return spaces.get(name)?.name;
}
function attempt(f) { try { return f(); } catch (error) { return error.name; } }
function kinds(x) {
  return [typeof x, typeof x === "function", typeof x === "object", x instanceof Base, x instanceof Function, x instanceof RegExp, Array.isArray(x), attempt(() => x()), attempt(() => new x()), attempt(() => x.tell()), x.v, x.length,
    attempt(() => [1].map(x).length), attempt(() => Reflect.apply(x, null, [])), typeof x === "bigint", x === "name", attempt(() => "v" in x), x?.size].join();
}
function sum(list) { let s = 0; for (const x of list) { if (typeof x === "function") s += x(); else if (x instanceof Base) s += x.v; else if (typeof x === "string") s += x.length; } return s; }
const ask = (table, key) => table.has(key);
const out = [];
for (const hits of [0, 1, 2, 3, 5]) {
  for (const [text, start, end] of [["0/chat,x", 1, 6], ["0/chot,x", 1, 6], ["a name b", 2, 6], ["a nome b", 2, 6], ["x/", 1, 2]]) {
    const key = text.substring(start, end) + (end < 0 ? "" : "").slice(0, 0);
    const piece = text.split("").join("").substring(start, end);
    for (let i = 0; i < hits; i++) out.push(ask(i & 1 ? set : spaces, piece), spaces.get(piece)?.name);
    out.push(of(piece), kinds(piece), sum([piece, () => 7, new Base(3), new Heir(4), piece, /r/]), of(key));
  }
}
out.push(of(/x/), of(() => 1), of("/"), kinds(() => 1), kinds(new Heir(5)), kinds(10n));
console.log(out.join("\n"));
