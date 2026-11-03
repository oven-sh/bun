// `compare` hands both values to one function a kind. Each of those goes on to another kind and, with the parts of both,
// back to `compare`. So what any of the parameters is used as is what all of them are used as.
function compare(left, right) {
  if (left === right) return "same";
  if (left == null || right == null) return "nothing";
  if (left.kind === "list") return compareLists(left, right);
  if (left.kind === "pair") return comparePairs(left, right);
  if (left.kind === "leaf") return compareLeaves(left, right);
  return typeof left + " and " + typeof right;
}

function compareLists(left, right) {
  if (right.kind === "pair") return comparePairs(right, left);
  if (right.kind !== "list") return compareLeaves(left, right);
  if (left.items.length !== right.items.length) return "lengths " + left.items.length + " and " + right.items.length;
  return "[" + left.items.map((item, index) => compare(item, right.items[index])).join(", ") + "]";
}

function comparePairs(left, right) {
  if (right.kind === "leaf") return compareLeaves(right, left);
  if (right.kind === "list")
    return "(" + compare(left.first, right.items[0]) + " | " + compare(left.second, right.items[1]) + ")";
  return "(" + compare(left.first, right.first) + " | " + compare(left.second, right.second) + ")";
}

function compareLeaves(left, right) {
  if (left.kind !== "leaf") return right.kind === "leaf" ? compareLeaves(right, left) : compare(left.name, right.name);
  if (right.kind !== "leaf") return "leaf " + left.value + " and " + right.kind;
  return left.value === right.value ? "equal" : left.value + " is not " + right.value;
}

const leaf = value => ({ kind: "leaf", value });
const pair = (first, second) => ({ kind: "pair", first, second });
const list = (...items) => ({ kind: "list", items });

const values = [
  leaf(1),
  leaf("one"),
  leaf(1.5),
  pair(leaf(1), leaf(2)),
  pair(list(leaf(1)), pair(leaf(2), leaf("three"))),
  list(),
  list(leaf(1), leaf(2)),
  list(pair(leaf(1), leaf(2)), list(leaf(3), leaf(4))),
  // None of these is what the uses say.
  { kind: "list", items: "ab" },
  { kind: "pair" },
  { kind: "pair", first: 1, second: "two" },
  { kind: "leaf" },
  { kind: "other", name: leaf(7) },
  { name: "no kind" },
  Object.assign(Object.create({ kind: "leaf" }), { value: 9 }),
  {
    get kind() {
      return "leaf";
    },
    value: 10,
  },
  [leaf(1)],
  7,
  "text",
  true,
  null,
  undefined,
  Symbol.iterator,
  () => leaf(1),
];

for (let turn = 0; turn < 3; turn++) {
  const lines = [];
  for (const left of values) {
    for (const right of values) {
      let line;
      try {
        line = compare(left, right);
      } catch (error) {
        line = error.constructor.name;
      }
      lines.push(line);
    }
  }
  console.log(turn, lines.length, new Set(lines).size);
  if (turn === 2) console.log(lines.join("\n"));
}
