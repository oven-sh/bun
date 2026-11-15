// Nodes of a parser gain properties after their construction, while collections of the kept trees run beside.
function Position(line, column) {
  this.line = line;
  this.column = column;
}

function Node(start) {
  this.type = "";
  this.start = start;
  this.end = 0;
  this.position = new Position(start >> 4, start & 15);
}
globalThis.Node = Node;

const factories = { create: (start) => new globalThis.Node(start) };
const finish = (node, type, end) => {
  node.type = type;
  node.end = end;
  return node;
};

function createLeaf(start) {
  const node = factories.create(start);
  if (start & 1) {
    node.name = "n" + (start & 7);
    node.optional = undefined;
    return finish(node, "Identifier", start + 1);
  }
  node.value = start / 2;
  node.raw = String(start);
  node.extra = { parenthesized: start % 3 === 0 };
  return finish(node, "Literal", start + 2);
}

function createTree(start, depth) {
  if (depth === 0) return createLeaf(start);
  const node = factories.create(start);
  node.left = createTree(start + 1, depth - 1);
  node.operator = depth & 1 ? "+" : "*";
  node.right = createTree(start + 2, depth - 1);
  if (depth % 4 === 0) {
    for (let i = 0; i < 9; i++) node["comment" + i] = [start, i];
  }
  return finish(node, "Binary", start + depth);
}

function sum(node) {
  switch (node.type) {
    case "Identifier":
      return node.name.length + (node.optional === undefined && "optional" in node ? 1 : 0);
    case "Literal":
      return node.value + node.raw.length + (node.extra.parenthesized ? 1 : 0);
    default: {
      let comments = 0;
      for (let i = 0; i < 9; i++) comments += node["comment" + i]?.[1] ?? 0;
      return sum(node.left) + sum(node.right) + comments + node.operator.length;
    }
  }
}

const kept = [];
let total = 0;
for (let i = 0; i < 160; i++) {
  kept[i % 40] = createTree(i, 10);
  const old = kept[(i * 7) % 40];
  if (old) old["visited" + (i % 5)] = createLeaf(i);
  total += sum(kept[(i * 3) % 40] ?? kept[0]);
}
console.log(total);
console.log(Object.keys(kept[3]).join());
console.log(JSON.stringify(createTree(5, 2)));
