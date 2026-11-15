// The second object of a kind has its fields replaced by accessors without asking anew for the order of its keys.
// COUNTER: FieldsEvictedByDelete <= 1000
"use strict";
const mark = Symbol("mark");
class Item { text = "t"; done = false; count = 0; tags = []; constructor(list) { this.list = list; Object.defineProperty(this, mark, { value: 1, enumerable: false, writable: true, configurable: true }); } }
const pairs = {};
const pairOf = (key) => pairs[key] || (pairs[key] = { get() { return key; }, set(value) { this.kept = value; } });
function observe(item, key) {
  if (Object.hasOwnProperty.call(item, key)) delete item[key];
  const pair = pairOf(key), descriptor = { configurable: true, enumerable: key !== "tags", get: pair.get, set: pair.set };
  Object.defineProperty(item, key, descriptor);
}
const seen = new Map();
for (let turn = 0; turn < 4000; turn++) {
  const item = new Item(turn);
  for (const key of ["text", "done", "count", "tags", "list"]) observe(item, key);
  const answer = Object.keys(item).join() + " " + Reflect.ownKeys(item).map(String).join() + " " + JSON.stringify(item);
  seen.set(answer, (seen.get(answer) ?? 0) + 1);
}
for (const [answer, times] of seen) console.log(times, answer);
