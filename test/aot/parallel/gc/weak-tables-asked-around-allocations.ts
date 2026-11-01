// Loops ask a WeakMap and a WeakSet for keys that they hold, and make objects in every turn. Most of the other keys are held by nobody: a collection takes their entries out and may give the tables other buffers.
// What is asked behind an allocation is answered from the tables as they are then.
type Key = { id: number };

const weights = new WeakMap<Key, number>();
const marked = new WeakSet<Key>();
let newest: unknown = null;

function crowd(count: number): void {
  for (let k = 0; k < count; k++) {
    const key = { id: -k };
    weights.set(key, k);
    marked.add(key);
  }
}

function asks(kept: Key[], turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    const key = kept[turn % kept.length]!;
    sum += weights.get(key)! + (marked.has(key) ? 1 : 0);
    newest = { turn, list: [turn, turn + 0.5], text: "t" + turn };
    sum += weights.get(key)! + (marked.has(key) ? 1 : 0) + (weights.has(key) ? 2 : 0);
    if (turn % 50 === 0) crowd(200);
  }
  return sum;
}

const kept: Key[] = [];
for (let k = 0; k < 10; k++) {
  const key = { id: k };
  kept.push(key);
  weights.set(key, k * 7);
  if (k & 1) marked.add(key);
}
for (let round = 0; round < 4; round++) {
  crowd(3000);
  console.log(asks(kept, 2000));
}
