const order = [];
const part = text => ({ toString() { order.push(text); return text; } });
class Graph {
  nodes = {};
  seen = new Map();
  set = new Set();
  add(name, weight) { this.nodes[name] = (this.nodes[name] || 0) + weight; return name; }
  has(name) { return name in this.nodes; }
  mark(name) { this.seen.set(name, (this.seen.get(name) || 0) + 1); return this.seen.get(name); }
  drop(name) { return delete this.nodes[name]; }
  keep(name) { this.set.add(name); return this.set.has(name); }
  maybe(name, rarely) { return rarely ? this.nodes[name] : name.length; }
  text(name) { const copy = name; return copy.charCodeAt(copy.length - 1) + (this.nodes[copy] === undefined ? 0 : 1000); }
}
function lookUp(table, name) { return table[name]; }
function lookUpBehind(table, name) { return lookUp(table, name); }
function listAt(list, place) { return list[place]; }
const graph = new Graph(), out = [];
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < 12; i++) {
  out.push(graph.add("v" + i, i), graph.add(i + "", 1), graph.add("v" + i + "/" + turn, 2), graph.has("v" + (i + 6)), graph.mark("m" + (i & 3)), graph.keep("k" + i), graph.maybe("long" + i, i === 7), graph.text("v" + i));
  out.push(lookUp(graph.nodes, "v" + i), lookUpBehind(graph.nodes, "v" + i), listAt([1, 2, 3], "" + (i & 3)), listAt("text", "" + (i & 3)), listAt({ length: 5 }, "len" + "gth"));
  if (i === 11) out.push(graph.drop("v" + (turn + 1)), graph.has("v" + (turn + 1)));
}
const odd = [part("o"), null, undefined, true, -0, 1.5, 10n, NaN, "", "ā", "x".repeat(70), [1, 2], Symbol("s"), Object.create(null)];
for (const one of odd) for (const use of [value => graph.add("p" + value, 1), value => graph.mark(value + "q"), value => lookUp(graph.nodes, "p" + value), value => graph.maybe("z" + value, true)]) {
  try { out.push(String(use(one)).slice(0, 9)); } catch (error) { out.push(error.constructor.name); }
}
const shadow = { __proto__: { vproto: 7 }, get vgetter() { return 8; } };
for (const name of ["proto", "getter", "none", "alueOf"]) out.push(typeof lookUp(shadow, "v" + name));
console.log(out.join());
console.log(order.join(""), Object.keys(graph.nodes).join(), [...graph.seen].join("|"), [...graph.set].join());
