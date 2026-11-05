// None of these is exported, so what each takes is what its callers pass, and they pass what they were passed. The
// program begins with the one that is written last.
function weigh(node, depth) {
  if (node.kind === "branch") return weighBranch(node, depth + 1);
  return weighLeaf(node, depth);
}

function weighBranch(node, depth) {
  let total = 0;
  for (const child of node.children) total += weigh(child, depth);
  return node.next ? total + weighLeaf(node.next, depth) : total;
}

function weighLeaf(node, depth) {
  if (node.kind === "branch") return weighBranch(node, depth);
  if (node.next) return node.weight * depth + weigh(node.next, depth + 0.5);
  return node.weight * depth;
}

const leaf = (weight, next) => ({ kind: "leaf", weight, next });
const branch = (children, next) => ({ kind: "branch", children, next });

console.log(weighLeaf(leaf(2, leaf(3)), 1));
console.log(weighBranch(branch([leaf(1), branch([leaf(2), leaf(3, leaf(4))])], leaf(5)), 0));
console.log(weigh(branch([], branch([leaf(6)])), 2));

const values = [
  leaf(1),
  leaf(1.5, leaf(2)),
  leaf("7"),
  leaf(undefined),
  leaf(2n),
  branch([]),
  branch([leaf(1), leaf(2)], leaf(3)),
  branch("ab"),
  branch(new Set([leaf(4)])),
  branch([null]),
  // None of these is what the callers above pass.
  { kind: "branch" },
  { weight: 3 },
  { kind: "leaf", weight: 2, next: 5 },
  Object.assign(Object.create({ kind: "branch" }), { children: [leaf(8)] }),
  {
    get kind() {
      return "leaf";
    },
    weight: 9,
  },
  [leaf(1)],
  7,
  "text",
  null,
  undefined,
  () => leaf(1),
];

for (let turn = 0; turn < 3; turn++) {
  const lines = [];
  for (const start of [weighLeaf, weighBranch, weigh]) {
    for (const value of values) {
      for (const depth of [0, 1, 2.5, "3", undefined]) {
        let line;
        try {
          line = String(start(value, depth));
        } catch (error) {
          line = error.constructor.name;
        }
        lines.push(line);
      }
    }
  }
  console.log(turn, lines.length, new Set(lines).size);
  if (turn === 2) console.log(lines.join(" "));
}
