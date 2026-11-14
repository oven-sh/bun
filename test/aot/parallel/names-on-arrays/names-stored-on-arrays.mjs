class Node {
  constructor(value) {
    this.value = value;
  }
  read() {
    return this.value;
  }
}
class Nodes {
  constructor(list, root) {
    for (let i = 0; i < list.length; i++) this[i] = list[i];
    this.length = list.length;
    this.root = root;
  }
  first() {
    return this[0].read();
  }
}
class Listed extends Array {
  set first(node) {
    seen.push("setter " + node.read());
  }
}
const seen = [];
function isNodes(value) {
  return !!value.root || value instanceof Nodes;
}
function build(content, kind) {
  const list = content && "length" in content ? content : [content];
  const root = isNodes(list) ? list : kind & 1 ? new Nodes(list, null) : list;
  root.root = root;
  root.first_ = new Node(kind);
  if (kind % 3 === 0) root.first = root.first_;
  return root;
}
function show(root) {
  const names = Object.keys(root).filter(name => name !== "root").join();
  return names + " " + root.first_.read() + " " + (root.root === root) + " " + root[0].read() + " " + (typeof root.first);
}
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 12; i++) {
    const contents = [new Node(i), [new Node(i + 1), new Node(i + 2)], new Nodes([new Node(i + 3)], null), Listed.of(new Node(i + 4)), "xyz".match(/y/) && [new Node(i + 5)]];
    for (const content of contents) {
      try {
        console.log(round, i, show(build(content, i)));
      } catch (error) {
        console.log(round, i, error.constructor.name);
      }
    }
  }
}
const frozen = Object.freeze([new Node(1)]);
try {
  build(frozen, 2);
} catch (error) {
  console.log("frozen", error.constructor.name);
}
const linked = [new Node(8)];
Object.setPrototypeOf(linked, {
  set root(value) {
    seen.push("linked " + value.length);
  },
  get root() {
    return "linked";
  },
});
try {
  linked.root = linked;
  linked.first_ = new Node(9);
  console.log(linked.root, linked.first_.read(), Object.keys(linked).join());
} catch (error) {
  console.log("linked", error.constructor.name);
}
const matched = "a-b".match(/(?<left>a)-(b)/);
matched.groups.late = new Node(4);
matched.index = new Node(5);
matched.later = new Node(6);
console.log(matched.groups.late.read(), matched.index.read(), matched.later.read(), matched.input, Object.keys(matched).join());
const proxied = new Proxy([new Node(3)], {
  set(target, key, value) {
    seen.push("proxy " + String(key));
    target[key] = value;
    return true;
  },
});
console.log(show(build(proxied, 6)), seen.join(";"));
