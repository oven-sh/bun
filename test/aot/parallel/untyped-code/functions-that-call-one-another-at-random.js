// Each function reads the tag of a node and hands the next node to one of the others, so all of them call one another in one cycle.
function first(node, depth) {
  if (node.tag === 0) return third(node.next, depth + 1);
  if (node.tag === 1) return sixth(node.next, depth + 2);
  if (node.tag === 2) return second(node.next, depth + 3);
  return node.value;
}

function second(node, depth) {
  if (node.tag === 0) return fifth(node.next, depth + 1);
  if (node.tag === 1) return first(node.next, depth + 2);
  if (node.tag === 2) return second(node.next, depth + 3);
  return node.value + depth;
}

function third(node, depth) {
  if (node.tag === 0) return fourth(node.next, depth + 1);
  if (node.tag === 1) return fourth(node.next, depth + 2);
  if (node.tag === 2) return first(node.next, depth + 3);
  return depth;
}

function fourth(node, depth) {
  if (node.tag === 0) return sixth(node.next, depth + 1);
  if (node.tag === 1) return third(node.next, depth + 2);
  if (node.tag === 2) return fifth(node.next, depth + 3);
  return [node.value, depth];
}

function fifth(node, depth) {
  if (node.tag === 0) return second(node.next, depth + 1);
  if (node.tag === 1) return fifth(node.next, depth + 2);
  if (node.tag === 2) return fourth(node.next, depth + 3);
  return node.value;
}

function sixth(node, depth) {
  if (node.tag === 0) return first(node.next, depth + 1);
  if (node.tag === 1) return second(node.next, depth + 2);
  if (node.tag === 2) return third(node.next, depth + 3);
  return { value: node.value, depth };
}

function chain(tags, last) {
  let node = last;
  for (let index = tags.length - 1; index >= 0; index--) node = { tag: tags[index], value: index, next: node };
  return node;
}

function show(start, node, depth) {
  try {
    console.log(start.name, JSON.stringify(start(node, depth)));
  } catch (error) {
    console.log(start.name, error instanceof TypeError ? "TypeError" : String(error));
  }
}

const starts = [first, second, third, fourth, fifth, sixth];
const ends = [
  { tag: 9, value: 1, next: null },
  { tag: 9, value: "text", next: null },
  { tag: 9 },
  { tag: "0", value: 2.5 },
  Object.assign(Object.create({ tag: 3 }), { value: 7 }),
  {
    get tag() {
      return 4;
    },
    get value() {
      return "read";
    },
  },
  [1, 2],
  "a text",
  5,
  null,
  undefined,
];

let seed = 7;
for (let round = 0; round < 40; round++) {
  const tags = [];
  for (let index = round % 9; index > 0; index--) tags.push((seed = (seed * 48271) % 2147483647) % 3);
  const end = ends[round % ends.length];
  for (const start of starts) show(start, chain(tags, end), round % 5 === 4 ? 0.5 : round);
}
show(first, chain([0, 1, 2], ends[0]), "depth ");
show(fourth, chain([2, 2, 2, 2], ends[0]), 2147483646);
show(sixth, { tag: 0 }, 0);
