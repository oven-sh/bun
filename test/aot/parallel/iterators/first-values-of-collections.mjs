const out = [];
const written = new Map([["a", 1], ["b", 2]]);
function repeat(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) n += written.values().next().value;
  return n;
}
out.push(repeat(1000), repeat(0), repeat(1));
written.delete("a");
out.push(repeat(10));
written.set("a", 7);
out.push(repeat(10));
written.clear();
out.push(repeat(3));
written.set("c", "text");
out.push(repeat(2));

const names = new Set(["x", "y", "z"]);
function firstName(turns) {
  let text = "";
  for (let k = 0; k < turns; k++) text += names.values().next().value;
  return text;
}
out.push(firstName(3), firstName(0));

// The loop changes the collection, by itself or by what it calls.
const queue = new Map();
for (let k = 0; k < 40; k++) queue.set(k, "v" + k);
function takeFirst(turns) {
  const taken = [];
  for (let k = 0; k < turns; k++) {
    taken.push(queue.keys().next().value);
    queue.delete(queue.keys().next().value);
  }
  return taken.join(" ");
}
out.push(takeFirst(5), takeFirst(3), queue.size);
function add(map, key) {
  if (key % 3 === 0) map.delete(map.keys().next().value);
  map.set(key, key);
}
function firstBesideCalls(map, turns) {
  const seen = [];
  for (let k = 0; k < turns; k++) {
    seen.push(map.values().next().value);
    add(map, k);
  }
  return seen.join(" ");
}
out.push(firstBesideCalls(new Map(), 9), firstBesideCalls(new Map([["m", "n"]]), 4));
function firstAndSecond(map, turns) {
  const seen = [];
  for (let k = 0; k < turns; k++) {
    const entries = map.entries();
    seen.push(String(entries.next().value));
    if (k === 2) map.clear();
    seen.push(String(entries.next().value), entries.next().done);
  }
  return seen.join(" ");
}
out.push(firstAndSecond(new Map([[1, 2], [3, 4], [5, 6]]), 5));
function keptIterators(set, turns) {
  const kept = [];
  for (let k = 0; k < turns; k++) kept.push(set.values());
  set.delete("x");
  set.add("w");
  return kept.map(iterator => iterator.next().value + iterator.next().value).join();
}
out.push(keptIterators(names, 3));
let moving = new Set([1]);
function firstOfMoving(turns) {
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    sum += moving.values().next().value;
    if (k === 3) moving = new Set([100]);
  }
  return sum;
}
out.push(firstOfMoving(6));
function firstOf(collection, turns) {
  let last;
  for (let k = 0; k < turns; k++) last = collection.values().next().value;
  return last;
}
for (const collection of [new Map([[{}, "object"]]), new Set([NaN]), [4, 5], new Map(), queue]) out.push(String(firstOf(collection, 3)));
console.log(out.join("|"));
