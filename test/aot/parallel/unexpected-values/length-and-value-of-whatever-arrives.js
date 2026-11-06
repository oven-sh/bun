// Two loops that ask an object nobody could follow for `length` and for `value` alone. The program has a literal with a length and a class with a value,
// and hands the loops those, arrays, and everything else that answers to the names in some other way.
let sink;
const log = [];
class Item {
  constructor(value) {
    this.flag = true;
    this.value = value;
  }
}
class Heir extends Item {
  constructor(value) {
    super(value);
    this.more = 1;
  }
}
class List extends Array {}
function count(queue, turns) {
  let n = 0;
  queue.length = turns;
  for (let i = 0; i < queue.length; i++) n++;
  return n;
}
function shrink(queue, turns) {
  let n = 0;
  queue.length = turns;
  for (let i = 0; i < queue.length; i++) {
    n++;
    if (i === 2) queue.length = 4;
  }
  return n;
}
function sum(item, turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total += item.value;
  return total;
}
function attempt(name, run) {
  try {
    log.push(name + ": " + String(run()));
  } catch (error) {
    log.push(name + ": " + error.constructor.name);
  }
}
const hidden = process.env.NAMES_OF_THIS_TEST ?? "";
sink = { count, shrink, sum };
const call = (name, ...operands) => sink[name + hidden](...operands);

let reads = 0;
let stored;
const queues = {
  literal: () => ({ length: 0 }),
  array: () => [1, 2, 3],
  "heir of Array": () => new List(2),
  "frozen literal": () => Object.freeze({ length: 3 }),
  "frozen array": () => Object.freeze([1, 2, 3]),
  "literal without its length": () => {
    const queue = { length: 0 };
    delete queue.length;
    return queue;
  },
  "literal with a getter in place of the field": () => {
    const queue = { length: 0 };
    Object.defineProperty(queue, "length", { get: () => (++reads, 5), set: value => void (stored = value), configurable: true });
    return queue;
  },
  "literal whose length cannot be written": () => Object.defineProperty({ length: 0 }, "length", { value: 2, writable: false }),
  "object below a literal": () => Object.create({ length: 0 }),
  "object without a prototype": () => Object.create(null),
  proxy: () => new Proxy({ length: 0 }, { get: (target, key) => (key === "length" ? 3 : target[key]), set: () => true }),
  string: () => "text",
  "string object": () => new String("text"),
  function: () => function (a, b) {},
  bytes: () => new Uint8Array(3),
  arguments: () => (function () { return arguments; })(1, 2),
  number: () => 7,
  null: () => null,
  undefined: () => undefined,
};
for (const [name, make] of Object.entries(queues)) {
  for (const turns of [6, 0, 2.5, -1, "3", NaN]) {
    attempt(`count of ${name} to ${String(turns)}`, () => call("count", make(), turns));
  }
  attempt(`shrink of ${name}`, () => call("shrink", make(), 9));
}
log.push(`getter ran ${reads} times, setter got ${String(stored)}`);

const items = {
  item: () => new Item(3),
  heir: () => new Heir(4),
  "item with a text": () => new Item("a"),
  "item with a fraction": () => new Item(0.5),
  "item with a large number": () => new Item(2 ** 40),
  "item with nothing": () => new Item(undefined),
  "item with a bigint": () => new Item(1n),
  "item without its value": () => {
    const item = new Item(3);
    delete item.value;
    return item;
  },
  "item with a getter in place of the field": () => Object.defineProperty(new Item(3), "value", { get: () => (++reads, 2) }),
  "result of an iterator": () => [5][Symbol.iterator]().next(),
  descriptor: () => Object.getOwnPropertyDescriptor({ a: 6 }, "a"),
  "look-alike": () => ({ flag: true, value: 7 }),
  "object below an item": () => Object.create(new Item(8)),
  global: () => new WebAssembly.Global({ value: "i32", mutable: true }, 9),
  proxy: () => new Proxy(new Item(3), { get: (target, key) => (key === "value" ? 10 : target[key]) }),
  text: () => "text",
  null: () => null,
};
for (const [name, make] of Object.entries(items)) attempt(`sum of ${name}`, () => call("sum", make(), 4));
log.push(`getters ran ${reads} times`);
console.log(log.join("\n"));
