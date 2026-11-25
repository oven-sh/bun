// Whoever is handed an iterator steps it by the protocol. The engine's own iterators are stepped without a call and without an object for each step.
function drain(steps: Iterator<unknown>, most: number): string {
  const said: string[] = [];
  for (let taken = 0; taken < most; taken++) {
    const step = steps.next();
    if (step.done) { said.push("done"); break; }
    said.push(JSON.stringify(step.value));
  }
  return said.join(" ");
}
function walk(things: Iterable<unknown>): string {
  const said: string[] = [];
  for (const thing of things) said.push(JSON.stringify(thing));
  return said.join(" ");
}
const set = new Set<unknown>([1, "two", 3.5, null]);
const map = new Map<unknown, unknown>([[1, "one"], ["two", 2], [3.5, undefined]]);
const list = [1, , "three", 4.5];
const bytes = new Uint8Array([7, 8, 9]);
const said = [
  walk(set.values()), walk(set.keys()), walk(set.entries()), walk(set[Symbol.iterator]()),
  walk(map.values()), walk(map.keys()), walk(map.entries()), walk(map[Symbol.iterator]()),
  walk(list.values()), walk(list.keys()), walk(list.entries()), walk(bytes.values()), walk(bytes.entries()),
  drain(set.values(), 2), drain(map.entries(), 9), drain(list.keys(), 9),
];
const half = set.values();
said.push(drain(half, 1));
set.delete("two");
set.add("five");
said.push(drain(half, 9), drain(half, 2));
const grows = map.keys();
said.push(drain(grows, 2));
map.clear();
map.set("new", 1);
said.push(drain(grows, 9));
const longer = list.values();
said.push(drain(longer, 4));
list.push("five");
said.push(drain(longer, 9), drain(longer, 1));
console.log(said.join("\n"));
