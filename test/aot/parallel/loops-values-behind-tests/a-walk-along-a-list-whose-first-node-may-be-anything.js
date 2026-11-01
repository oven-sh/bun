import { AsyncLocalStorage } from "node:async_hooks";
class Node {
  constructor(key, value, next) {
    this.key = key;
    this.value = value;
    this.next = next;
  }
}
const starts = new AsyncLocalStorage();
function find(key) {
  for (let node = starts.getStore(); node !== undefined; node = node.next) {
    if (node.key === key) return node.value;
  }
  return "nothing";
}
function count() {
  let n = 0;
  for (let node = starts.getStore(); node !== undefined; node = node.next) n++;
  return n;
}
function sumOfWalks(turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += find("a") + find("c");
  return sum;
}
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
}
const lines = [];
function walkFrom(start) {
  starts.run(start, () => {
    for (const key of ["a", "b", "c", "x", "missing"]) lines.push(attempt(() => find(key)));
    lines.push(attempt(count));
  });
}
const tail = new Node("c", 3, undefined);
const middle = new Node("b", 2, tail);
const head = new Node("a", 1, middle);
walkFrom(head);
walkFrom(tail);
walkFrom(undefined);
walkFrom(null);
walkFrom({ __proto__: null, key: "x", value: 10, next: head });
walkFrom({ key: "x", value: 11, get next() { lines.push("read next"); return middle; } });
walkFrom({ key: "x", value: 12 });
walkFrom({ key: "x", value: 13, next: null });
walkFrom({ key: "x", value: 14, next: { key: "missing", value: 15, next: tail } });
for (const start of [7, "text", true, 5n, Symbol.iterator, () => 1, [1, 2]]) walkFrom(start);
starts.run(head, () => lines.push(sumOfWalks(3000)));
starts.run({ key: "a", value: 100, next: head }, () => lines.push(sumOfWalks(3000)));
lines.push(find("a"), count());
console.log(lines.join("\n"));
