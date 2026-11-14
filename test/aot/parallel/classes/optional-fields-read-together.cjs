// Optional fields of one object that are read together in loops, while they are there, missing, deleted, answered by prototypes, accessors, proxies and heirs.
"use strict";
const out = [];
const disturbances = {
  none() {},
  above(Node) { Node.prototype.visited = "above"; },
  getter(Node) { Object.defineProperty(Node.prototype, "marked", { get() { return "got" + this.i; }, set(v) { this.hidden = v; }, configurable: true }); },
  deleted(Node, nodes) { delete nodes[3].visited; delete nodes[2].marked; },
  accessor(Node, nodes) { Object.defineProperty(nodes[1], "visited", { get() { return "own" + this.i; }, configurable: true, enumerable: true }); },
  prototype(Node, nodes) { Object.setPrototypeOf(nodes[2], { visited: "other" }); },
  undefinedValue(Node, nodes) { nodes[4].visited = undefined; nodes[1].marked = null; },
  late(Node, nodes) { nodes[5].mark(); nodes[4].flag(); nodes[4].visited = NaN; },
  proxy(Node) { Object.setPrototypeOf(Node.prototype, new Proxy({}, { get(t, k, r) { return k === "visited" || k === "marked" || k === "third" ? "p:" + k : Reflect.get(t, k, r); } })); },
  plain(Node, nodes) { nodes[2] = { visited: 1, i: 5 }; nodes[3] = { marked: 0, i: 6 }; },
  dictionary(Node, nodes) { for (let k = 0; k < 80; k++) nodes[1]["x" + k] = k; delete nodes[1].x3; delete nodes[1].visited; },
};
function makeClass() {
  return class Node {
    constructor(i) { this.i = i; this.kids = []; }
    mark() { this.visited = true; }
    flag() { this.marked = this.i + 0.5; }
    tag(t) { this.third = t; }
  };
}
class Node { constructor(i) { this.i = i; this.kids = []; } mark() { this.visited = true; } flag() { this.marked = this.i + 0.5; } tag(t) { this.third = t; } }
class Holder { constructor(node) { this.node = node; } }
const show = (a, b, c) => String(a) + "|" + String(b) + "|" + String(c);
const looks = {
  apart(n) { const a = n.visited, b = n.marked; return String(a) + "," + String(b); },
  literal(n) { const o = { a: n.visited, b: n.marked, i: n.i }; return JSON.stringify([o.a, o.b, o.i, "a" in o]); },
  call(n) { return show(n.visited, n.marked, n.third); },
  held(n) { const h = new Holder(n); const a = h.node.visited, b = h.node.marked; return String(a) + ";" + String(b) + ";" + String(h.node.i); },
  store(n) { const a = n.visited; n.i = n.i; const b = n.marked; n.count = (n.count || 0) + 1; return String(a) + "/" + String(b) + "/" + n.count; },
  truth(n) { const a = n.visited, b = n.marked, c = n.third; return a ? "a" : b ? "b" : c ? "c" : "none"; },
  number(n) { const x = n.visited + 0, y = n.marked + 0; return Object.is(x, NaN) + " " + Object.is(y, NaN); },
};
function all(look, list, round, disturb) {
  const said = [];
  for (let k = 0; k < list.length; k++) {
    if (k === 4 && round === 1) disturb();
    let s;
    try { s = look(list[k]); } catch (e) { s = e.constructor.name; }
    said.push(s);
  }
  return said.join(" ");
}
globalThis.kept = [Node, Holder, looks, makeClass];
for (const way of Object.keys(disturbances)) {
  for (const name of Object.keys(looks)) {
    const prototype = Object.getOwnPropertyDescriptors(Node.prototype), above = Object.getPrototypeOf(Node.prototype);
    const nodes = [];
    for (let i = 0; i < 8; i++) nodes.push(new Node(i));
    nodes[3].mark(); nodes[2].flag(); nodes[6].mark(); nodes[6].flag(); nodes[7].tag("t");
    for (let round = 0; round < 3; round++) out.push(way + " " + name + " " + all(looks[name], nodes, round, () => disturbances[way](Node, nodes)));
    for (const key of Reflect.ownKeys(Node.prototype)) if (!(key in prototype)) delete Node.prototype[key];
    Object.setPrototypeOf(Node.prototype, above);
  }
}
for (const line of out) console.log(line);
