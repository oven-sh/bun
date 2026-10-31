import { AsyncLocalStorage } from "node:async_hooks";
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
class Node {
  constructor(key, value, next) {
    this.key = key;
    this.value = value;
    this.next = next;
  }
}
const keys = [{}, {}, {}];
const first = new Node(keys[2], 3, new Node(keys[1], 2, new Node(keys[0], 1, undefined)));
function find(key) {
  for (let node = first; node !== undefined; node = node.next) {
    if (node.key === key) return node.value;
  }
  return 0;
}
const stores = [new AsyncLocalStorage(), new AsyncLocalStorage(), new AsyncLocalStorage()];
const loops = {
  "a walk along three nodes"(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += find(keys[0]);
    return sum;
  },
  "a store read under three runs"(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += stores[0].getStore();
    return sum;
  },
};
function run(name) {
  return stores[0].run(1, () => stores[1].run(2, () => stores[2].run(3, () => loops[name](rounds))));
}
if (which) console.log(which, run(which));
else for (const name in loops) console.log(name, run(name));
