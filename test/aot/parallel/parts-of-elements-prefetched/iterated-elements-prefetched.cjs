// STATISTIC: ArraysPrefetchedByLoops >= 2
// A loop with `of` over a long array prefetches the parts of the elements that the next iterations open, whatever changes the array or its iterator.
class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  norm() { return Math.abs(this.x) + Math.abs(this.y); }
}
class Edge {
  constructor(from, to) { this.from = from; this.to = to; this.weights = [from.x, to.y, 1]; }
  cost() { return this.from.norm() + this.to.norm() * this.weights[2]; }
}
class Node {
  constructor(i) {
    this.position = new Point(i, i % 7);
    this.size = new Point(1, i % 3);
    this.edges = [new Edge(this.position, this.size), new Edge(new Point(i % 5, 0), new Point(0, i % 11))];
    this.owner = { label: "n" + i, center: new Point(i % 13, 1) };
  }
  weight() { return this.position.norm() + this.size.norm() + this.owner.center.norm() + this.edges[0].cost() + this.edges[1].cost(); }
}
globalThis.KEPT = [Point, Edge, Node];
globalThis.total = nodes => { let sum = 0; for (const node of nodes) sum += node.weight(); return sum; };
globalThis.labels = nodes => { let length = 0, failed = 0; for (const node of nodes) { try { length += node.owner.label.length + measure(node); } catch { failed++; } } return length + ":" + failed; };
function measure(node) { return node.position.norm() + node.size.x + node.edges[1].from.norm() + node.edges[0].to.y + node.edges[0].weights[1] + node.owner.center.x; }
const nodes = [];
for (let i = 0; i < 6000; i++) nodes.push(new Node(i));
const mixed = nodes.map((node, i) => i % 40 ? node : [null, undefined, 1.5, "text", { weight: () => 1 }, [], new Proxy(node, {}), Object.freeze(new Node(i)), Object.create(node)][i / 40 % 9]);
const lines = [];
for (let turn = 0; turn < 3; turn++) {
  lines.push(globalThis.total(nodes), globalThis.labels(nodes), globalThis.labels(mixed), globalThis.labels(new Set(mixed)));
  if (turn === 0) for (let i = 0; i < 6000; i += 3) nodes[i].edges.reverse();
  if (turn === 1) { nodes.length = 3000; delete mixed[100]; }
}
let seen = 0;
Node.prototype.weight = function () { if (seen++ === 700) nodes.length = 900; if (seen % 500 === 0) nodes.push(new Node(seen)); return this.size.y; };
lines.push(globalThis.total(nodes), nodes.length);
nodes[Symbol.iterator] = function* () { yield this[0]; yield this[1]; };
lines.push(globalThis.labels(nodes));
console.log(lines.join("\n"));
