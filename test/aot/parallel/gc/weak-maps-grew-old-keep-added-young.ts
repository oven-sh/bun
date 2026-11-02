// A young collection need not look into a WeakMap or WeakSet that has grown old and was not written since the last collection. One that was written has to be looked into: a value that only the map holds lives as long as its key, whether the key is old or new, whether the value is reached through a chain of maps, and an entry whose key died goes
const collectAll: () => void = () => Bun.gc(true);

class Key {
  constructor(public id: number) {}
}
class Value {
  text: string;
  next: Key | undefined;
  constructor(id: number, next?: Key) {
    this.text = "value " + id;
    this.next = next;
  }
}

let sink = 0;
function churn(rounds: number): void {
  for (let round = 0; round < rounds; round++) {
    const scratch: { a: number; b: string; c: number[] }[] = [];
    for (let i = 0; i < 4000; i++) scratch.push({ a: i, b: "s" + i, c: [i, i + 1, i + 2] });
    sink += scratch[round % scratch.length].c[1];
  }
}

const lines: string[] = [];
const oldKeys: Key[] = [];
for (let i = 0; i < 300; i++) oldKeys.push(new Key(i));

const map = new WeakMap<Key, Value>();
const second = new WeakMap<Key, Value>();
const set = new WeakSet<Key>();
for (let i = 0; i < 100; i++) {
  map.set(oldKeys[i], new Value(i));
  set.add(oldKeys[i]);
}
collectAll();
collectAll();
churn(30);

function check(title: string, from: number, to: number): void {
  let right = 0;
  let inSet = 0;
  for (let i = from; i < to; i++) {
    if (map.get(oldKeys[i])?.text === "value " + i) right++;
    if (set.has(oldKeys[i])) inSet++;
  }
  lines.push(title + ": " + right + " values, " + inSet + " in the set, of " + (to - from));
}
check("untouched since it grew old", 0, 100);

for (let step = 0; step < 10; step++) {
  for (let i = 100 + step * 10; i < 110 + step * 10; i++) {
    map.set(oldKeys[i], new Value(i));
    set.add(oldKeys[i]);
  }
  churn(6);
}
check("new values under old keys, added between young collections", 100, 200);
check("the first hundred again", 0, 100);

const newKeys: Key[] = [];
for (let step = 0; step < 10; step++) {
  for (let i = 0; i < 10; i++) {
    const key = new Key(1000 + step * 10 + i);
    newKeys.push(key);
    map.set(key, new Value(key.id));
  }
  churn(6);
}
let rightUnderNewKeys = 0;
for (const key of newKeys) if (map.get(key)?.text === "value " + key.id) rightUnderNewKeys++;
lines.push("new values under new keys: " + rightUnderNewKeys + " of " + newKeys.length);

for (let i = 200; i < 300; i++) {
  const link = new Key(5000 + i);
  map.set(oldKeys[i], new Value(i, link));
  second.set(link, new Value(i + 10000));
  if (i % 10 === 9) churn(4);
}
churn(20);
let rightThroughBoth = 0;
for (let i = 200; i < 300; i++) {
  const link = map.get(oldKeys[i])?.next;
  if (link && link.id === 5000 + i && second.get(link)?.text === "value " + (i + 10000)) rightThroughBoth++;
}
lines.push("a value of one map is the key of the other: " + rightThroughBoth + " of 100");

for (let i = 0; i < 50; i++) {
  map.delete(oldKeys[i]);
  set.delete(oldKeys[i]);
}
churn(10);
check("behind fifty deletions", 0, 100);
for (let i = 0; i < 50; i++) map.set(oldKeys[i], new Value(i));
churn(10);
check("and fifty put back", 0, 100);

let many = 0;
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < 500; i++) map.set(new Key(-i), new Value(-i));
  churn(1);
  many += map.has(oldKeys[150]) ? 1 : 0;
}
collectAll();
check("behind twenty thousand entries whose keys died", 0, 200);
lines.push("seen each round: " + many);
lines.push("sink is a number: " + (typeof sink === "number" && sink > 0));

console.log(lines.join("\n"));
