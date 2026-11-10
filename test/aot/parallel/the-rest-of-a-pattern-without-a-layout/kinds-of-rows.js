// `const { id, tags, ...rest } = row`, nothing written of row: each kind of row answers as written: the keys of the rest, their order, their values, what runs on the way, and that the row itself stays whole.
const log = [];
function show(o) { return Reflect.ownKeys(o).map(k => String(k) + "=" + String(Object.getOwnPropertyDescriptor(o, k).get ? "getter" : o[k])).join(",") + "#" + Object.isExtensible(o) + (Object.getPrototypeOf(o) === Object.prototype); }
const key = text => JSON.parse(JSON.stringify(text));
function put(o, k, v) { o[k] = v; }
function drop(o, k) { delete o[k]; }
function define(o, k, d) { Object.defineProperty(o, k, d); }
const sym = Symbol("s");
function born(i) { return { id: i, name: "n" + i, tags: [i], age: 20 + i, active: i % 2 === 0 }; }
class Row { constructor(i) { this.id = i; this.name = "c" + i; this.tags = [i]; this.age = i; } get shown() { return "no"; } }
const grown = born(10); put(grown, key("extra"), "x");
const grownById = born(11); drop(grownById, key("id")); put(grownById, key("id"), 99);
const turned = { active: true, age: 1, tags: [], name: "t", id: 12 };
const hidden = born(13); define(hidden, key("age"), { enumerable: false });
const hiddenId = born(14); define(hiddenId, key("id"), { enumerable: false });
const shrunk = born(15); drop(shrunk, key("tags"));
const marked = born(16); put(marked, sym, "sym");
const indexed = born(17); put(indexed, key("1"), "one");
const watched = born(18); define(watched, key("age"), { get() { log.push("age"); return 19; }, enumerable: true, configurable: true });
const watchedId = born(19); define(watchedId, key("id"), { get() { log.push("id"); return 20; }, enumerable: true, configurable: true });
const frozen = Object.freeze(born(21));
const sealed = Object.seal(born(22));
const heir = Object.setPrototypeOf(born(23), { inherited: 1, id: "above" });
const bare = Object.assign(Object.create(null), born(24));
const rows = [born(1), born(2), grown, born(3), grownById, turned, hidden, hiddenId, shrunk, marked, indexed, watched, watchedId, frozen, sealed, heir, bare, new Row(25), JSON.parse('{"id":26,"tags":1,"z":2,"__proto__":{"evil":1}}'), [7, 8], "ab", 5, new Proxy(born(27), { ownKeys(t) { log.push("keys"); return Reflect.ownKeys(t); } }), born(4)];
function omit(row) { const { id, tags, ...rest } = row; return rest; }
function omitAbsent(row) { const { nothing, ...rest } = row; return rest; }
function omitAll(row) { const { id, name, tags, age, active, ...rest } = row; return rest; }
function omitWithDefault(row) { const { id = -1, missing = "d", ...rest } = row; return [id, missing, rest]; }
const lines = [];
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], before = typeof row === "object" ? show(row) : "";
    const [id, missing, rest] = omitWithDefault(row);
    lines.push([i, show(omit(row)), show(omitAbsent(row)), show(omitAll(row)), id, missing, show(rest), (typeof row === "object" ? show(row) : "") === before].join(" | "));
  }
}
console.log(lines.join("\n"));
console.log(log.join());
for (const bad of [null, undefined]) { try { omit(bad); } catch (e) { console.log(e.name); } }
