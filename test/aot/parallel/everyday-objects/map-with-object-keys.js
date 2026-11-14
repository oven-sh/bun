// A Map whose keys are instances, read while some are deleted
class Node {
  constructor(id) {
    this.id = id;
  }
}
function weigh(count) {
  const nodes = [];
  const weights = new Map();
  for (let i = 0; i < count; i++) {
    nodes.push(new Node(i));
    weights.set(nodes[i], i * 10);
  }
  weights.set(new Node(0), 999);
  for (const [node, weight] of weights) if (weight % 20 === 0) weights.delete(node);
  return nodes.map(node => weights.get(node)).map(String).join() + " " + weights.size + " " + [...weights.keys()].map(node => node.id).join();
}
console.log(weigh(3));
console.log(weigh(6));
console.log(weigh(0));
