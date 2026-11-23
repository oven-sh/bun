// Object.keys() of objects of one structure that hold hidden names and symbols beside their fields: the names that are listed, listed again, and what the other lists say of the same objects.
const tag = Symbol("tag");
class Node { constructor(type, start) { this.type = type; this.start = start; this.end = start + 1; } }
class Wide extends Node { constructor(start) { super("Wide", start); this.body = [start]; this.kind = "w"; } }
function copy(node, hidden) { const made = Object.create(Object.getPrototypeOf(node), { original: { value: node, configurable: false, enumerable: hidden === 1, writable: true } }); for (const key of Object.keys(node)) made[key] = node[key]; if (hidden > 1) Object.defineProperty(made, "tokens", { value: [], enumerable: false, configurable: true, writable: true }); if (hidden > 2) made[tag] = hidden; return made; }
function literal(n) { const o = { a: n, b: "x", c: null }; Object.defineProperty(o, "secret", { value: n, enumerable: false, configurable: true, writable: true }); if (n & 1) o[tag] = n; if (n & 2) o.extra = n; return o; }
function unionOf() { const all = {}; for (let i = 0; i < arguments.length; i++) { const keys = Object.keys(arguments[i]); for (let j = 0; j < keys.length; j++) all[keys[j]] = true; } return Object.keys(all).join(); }
function count(list) { let sum = 0; for (const o of list) sum += Object.keys(o).length; return sum; }
function inEveryWay(o) { let text = ""; for (const k in o) text += k + ","; return [Object.keys(o).join(), Object.getOwnPropertyNames(o).join(), Reflect.ownKeys(o).map(String).join(), Object.entries(o).length, Object.values(o).length, Object.getOwnPropertySymbols(o).length, JSON.stringify(Object.keys({ ...o })), text].join(" / "); }
const collect = typeof Bun === "object" ? () => Bun.gc(true) : () => {};
for (let turn = 0; turn < 5; turn++) {
  for (let hidden = 0; hidden < 4; hidden++) {
    const nodes = [0, 1, 2, 3].map(n => copy(n & 1 ? new Wide(n) : new Node("N" + n, n), hidden));
    console.log(turn, hidden, unionOf(...nodes), count(nodes), nodes.map(o => Object.keys(o).join()).join(" "), inEveryWay(nodes[1]));
    nodes[0].late = 1; delete nodes[1].kind; nodes[2].start = { v: 1 };
    Object.defineProperty(nodes[3], "kind", { enumerable: false });
    console.log(count(nodes), nodes.map(inEveryWay).join(" | "));
    if (hidden > 1) { Object.defineProperty(nodes[0], "tokens", { enumerable: true }); delete nodes[1].tokens; Object.freeze(nodes[2]); console.log(count(nodes), nodes.map(o => Object.keys(o).join()).join(" "), nodes.map(o => Object.getOwnPropertyNames(o).join()).join(" ")); }
  }
  const literals = [0, 1, 2, 3, 4, 5].map(literal);
  console.log(unionOf(...literals), count(literals), literals.map(inEveryWay).join(" | "));
  for (const o of literals) { o.d = 1; Object.defineProperty(o, "b", { enumerable: turn > 2 }); }
  collect();
  console.log(count(literals), literals.map(o => Object.keys(o).join()).join(" "), literals.map(o => Reflect.ownKeys(o).length).join());
  const list = Object.keys(literals[3]); list.push("own"); list[0] = "changed";
  console.log(Object.keys(literals[3]).join(), Object.keys(literals[5]).join(), list.join());
}
