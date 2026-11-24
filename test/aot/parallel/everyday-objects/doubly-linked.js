// Nodes that know both neighbors: inserted, moved to the front, taken out
class Ring {
  constructor() {
    this.prev = this.next = this;
    this.value = null;
  }
  add(value) {
    const node = { value, prev: this.prev, next: this };
    node.prev.next = node.next.prev = node;
    return node;
  }
  front(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
    node.next = this.next;
    node.prev = this;
    this.next.prev = node;
    this.next = node;
  }
  values(out = []) {
    for (let node = this.next; node !== this; node = node.next) out.push(node.value);
    return out;
  }
}
function run(values, at) {
  const ring = new Ring();
  const nodes = values.map(value => ring.add(value));
  ring.front(nodes[at]);
  ring.front(nodes[values.length - 1]);
  return ring.values().join() + " " + ring.prev.value;
}
console.log(run([1, 2, 3], 1));
console.log(run([10, 20, 30, 40], 3));
console.log(run([5], 0));
