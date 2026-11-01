// `seen.has(node)`, `order.get(node)` in a loop, where the keys are objects: the search stands in line, as it does for texts and numbers.
// Tables of every size, keys that are there, that are not, that were deleted, that are nothing at all, and tables that hold numbers or texts beside the objects.
// STATISTIC: ObjectKeysSearchedInLine >= 6
export {};

class Node {
  constructor(public id: number) {}
}
const lines: string[] = [];
const hidden = <T>(value: T): T => [value][Number(process.argv.length > 99)]!;

function sumOfValues(map: Map<object, number>, keys: (object | undefined | null)[], turns: number) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += map.get(keys[i % keys.length]!) ?? -1;
  return sum;
}
function countOfKeys(map: Map<object, number>, keys: (object | undefined | null)[], turns: number) {
  let count = 0;
  for (let i = 0; i < turns; i++) if (map.has(keys[i % keys.length]!)) count++;
  return count;
}
function countOfMembers(set: Set<object>, keys: (object | undefined | null)[], turns: number) {
  let count = 0;
  for (let i = 0; i < turns; i++) if (set.has(keys[i % keys.length]!)) count++;
  return count;
}
function hasThenGet(map: Map<object, number>, keys: (object | undefined | null)[], turns: number) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const key = keys[i % keys.length]!;
    sum += map.has(key) ? map.get(key)! : -3;
  }
  return sum;
}
function nodesAlone(map: Map<Node, number>, nodes: Node[], turns: number) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += map.get(nodes[i % nodes.length]!)!;
  return sum;
}
function membersAlone(set: Set<Node>, nodes: Node[], turns: number) {
  let count = 0;
  for (let i = 0; i < turns; i++) if (set.has(nodes[i % nodes.length]!)) count++;
  return count;
}

for (const size of [0, 1, 3, 7, 8, 9, 16, 100, 254, 255, 256, 300, 5000, 70000]) {
  const present: object[] = [];
  for (let k = 0; k < size; k++) present.push(k % 4 === 0 ? new Node(k) : k % 4 === 1 ? { k } : k % 4 === 2 ? [k] : () => k);
  const map = new Map<object, number>();
  const set = new Set<object>();
  for (let k = 0; k < size; k++) {
    map.set(present[k]!, k);
    set.add(present[k]!);
  }
  const asked: (object | undefined | null)[] = [];
  for (let k = 0; k < Math.min(size, 400); k++) asked.push(present[(k * 37) % size]!, k % 3 ? { absent: k } : new Node(-k));
  asked.push({}, undefined, null, map, set);
  const turns = hidden(asked.length * 3 + 1);
  lines.push(`${size}: ${sumOfValues(map, asked, turns)} ${countOfKeys(map, asked, turns)} ${countOfMembers(set, asked, turns)} ${hasThenGet(map, asked, turns)}`);
  for (let k = 0; k < size; k += 3) {
    map.delete(present[k]!);
    set.delete(present[k]!);
  }
  lines.push(`${size} less a third: ${sumOfValues(map, asked, turns)} ${countOfKeys(map, asked, turns)} ${countOfMembers(set, asked, turns)} ${hasThenGet(map, asked, turns)}`);
  (map as Map<unknown, number>).set(1.5, 7).set("text", 8).set(undefined, 9).set(null, 10);
  (set as Set<unknown>).add(1.5).add("text").add(undefined).add(null);
  lines.push(`${size} beside other keys: ${sumOfValues(map, asked, turns)} ${countOfKeys(map, asked, turns)} ${countOfMembers(set, asked, turns)} ${hasThenGet(map, asked, turns)}`);
}

const nodes: Node[] = [];
for (let k = 0; k < 40; k++) nodes.push(new Node(k));
const ranks = new Map<Node, number>(nodes.map((node, k) => [node, k * k] as const));
const marked = new Set<Node>(nodes.filter(node => node.id % 3 === 0));
lines.push(`nodes: ${nodesAlone(ranks, nodes, 1000)} ${membersAlone(marked, nodes, 1000)}`);

function grownInTheLoop(turns: number) {
  const seen = new Set<object>();
  const all: object[] = [];
  let again = 0;
  for (let i = 0; i < turns; i++) {
    const next = i % 5 === 4 ? all[(i * 7) % all.length]! : { i };
    if (seen.has(next)) again++;
    else {
      seen.add(next);
      all.push(next);
    }
  }
  return again + " " + seen.size;
}
lines.push("grown in the loop: " + grownInTheLoop(hidden(3000)));
console.log(lines.join("\n"));
