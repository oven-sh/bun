// What the program itself puts on a built-in prototype is counted, not refused, whichever comes first in the text: the lookup or the definition.
class Node {
  constructor(weight) { this.weight = weight; }
}
class Failure extends Error {
  constructor(node) { super("failed"); this.node = node; this.code = 7; }
}
function describe(failure) { return [failure.node === undefined ? "no node" : failure.node.weight, failure.code, Object.keys(failure).join()].join(" "); }
console.log(describe(new Failure(new Node(1))), new Set().width, new Map().width);

let stored = 0;
Object.defineProperty(Error.prototype, "node", { set(value) { stored = value.weight; }, get() { return undefined; }, configurable: true });
Set.prototype.width = 2;
console.log(describe(new Failure(new Node(2))), stored, new Set().width, new Map().width);

delete Error.prototype.node;
delete Set.prototype.width;
console.log(describe(new Failure(new Node(3))), stored, new Set().width, new Map().width);
