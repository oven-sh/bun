// One of two constructors is not called at first. Objects of the other get a field by a store.
// Then setters come above each of them in turn, the first before the constructor above which it stands is first called.
function PlainNode(kind) {
  this.kind = kind;
  this.parent = undefined;
}
class NodeObject {
  constructor(kind) {
    this.kind = kind;
    this.parent = undefined;
  }
}
const allocator = { getNodeConstructor: () => NodeObject };
// Whoever listens may do anything to what it is handed.
process.emit(process.env.EVENT ?? "nothing", PlainNode, NodeObject);

const log = [];
const nodes = [];
function createNode(kind) {
  const Node = allocator.getNodeConstructor();
  nodes.push(new Node(kind));
}
function bind(position, symbol, flags) {
  const node = nodes[position];
  node.symbol = symbol;
  node.flags = flags;
}
function describe(position) {
  const node = nodes[position];
  return `${node.constructor.name} ${Object.keys(node).join()} ${node.symbol} ${node.flags}`;
}
function catchStoresOf(name, holder, label) {
  Object.defineProperty(holder, name, {
    configurable: true,
    set(value) {
      log.push(`${label} ${name} ${value}`);
    },
  });
}

for (let round = 0; round < 22; round++) {
  if (round === 2) {
    catchStoresOf("symbol", PlainNode.prototype, "PlainNode");
    allocator.getNodeConstructor = () => PlainNode;
  }
  if (round === 6) allocator.getNodeConstructor = () => NodeObject;
  if (round === 10) catchStoresOf("symbol", NodeObject.prototype, "NodeObject");
  if (round === 14) {
    const above = {};
    catchStoresOf("flags", above, "above NodeObject");
    Object.setPrototypeOf(NodeObject.prototype, above);
  }
  if (round === 18) {
    delete PlainNode.prototype.symbol;
    delete NodeObject.prototype.symbol;
    Object.setPrototypeOf(NodeObject.prototype, Object.prototype);
    allocator.getNodeConstructor = () => (nodes.length & 1 ? PlainNode : NodeObject);
  }
  createNode(round);
  bind(round, "s" + round, round);
}
for (let round = 0; round < 22; round++) console.log(round, describe(round));
console.log(log.join("\n"));
