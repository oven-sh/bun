const log = [];

function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

class Link {
  constructor(value, next) {
    this.value = value;
    this.next = next;
  }
}

class Tree {
  constructor(value, left, right) {
    this.value = value;
    this.left = left;
    this.right = right;
  }
}

function sumByLoop(head) {
  let sum = 0;
  for (let link = head; link; link = link.next) sum += link.value;
  return sum;
}

function sumByWhile(head) {
  let sum = 0;
  let link = head;
  while (link !== null && link !== undefined) {
    sum += link.value;
    link = link.next;
  }
  return sum;
}

function sumByRecursion(link) {
  return link ? link.value + sumByRecursion(link.next) : 0;
}

function lengthOf(head) {
  let length = 0;
  for (let link = head; link; link = link.next) length++;
  return length;
}

function valuesOf(head) {
  const values = [];
  for (let link = head; link; link = link.next) values.push(link.value);
  return values;
}

function doubleAll(head) {
  for (let link = head; link; link = link.next) link.value *= 2;
  return valuesOf(head);
}

function reverse(head) {
  let previous = null;
  let link = head;
  while (link) {
    const next = link.next;
    link.next = previous;
    previous = link;
    link = next;
  }
  return valuesOf(previous);
}

function sumOfTree(tree) {
  if (!tree) return 0;
  return sumOfTree(tree.left) + tree.value + sumOfTree(tree.right);
}

function depthOfTree(tree) {
  return tree ? 1 + Math.max(depthOfTree(tree.left), depthOfTree(tree.right)) : 0;
}

const impostors = [
  ["an honest one", (value, next) => new Link(value, next)],
  ["a literal", (value, next) => ({ value, next })],
  ["a literal in the other order", (value, next) => ({ next, value })],
  ["a literal with more members", (value, next) => ({ before: 0, value, between: 0, next, after: 0 })],
  ["a tree node used as a link", (value, next) => Object.assign(new Tree(value, null, null), { next })],
  ["getters that log", (value, next) => ({ get value() { log.push("get value"); return value; }, get next() { log.push("get next"); return next; } })],
  ["members on the prototype", (value, next) => Object.create({ value, next })],
  ["no prototype", (value, next) => Object.assign(Object.create(null), { value, next })],
  ["a proxy around an honest one", (value, next) => new Proxy(new Link(value, next), {})],
  ["a frozen honest one", (value, next) => Object.freeze(new Link(value, next))],
  ["a string value", (value, next) => new Link(String(value), next)],
  ["a fraction", (value, next) => new Link(value + 0.5, next)],
  ["-0", (value, next) => new Link(-0, next)],
  ["2 ** 31", (value, next) => new Link(2147483648, next)],
  ["a bigint value", (value, next) => new Link(BigInt(value), next)],
  ["an object with valueOf", (value, next) => new Link({ valueOf() { log.push("valueOf"); return value; } }, next)],
  ["no value", (value, next) => { const link = new Link(value, next); delete link.value; return link; }],
  ["a next that was deleted", (value, next) => { const link = new Link(value, next); delete link.next; return link; }],
  ["from JSON, so the list ends there", (value, next) => JSON.parse('{"value":' + value + ',"next":null}')],
  ["an array with the names", (value, next) => Object.assign([], { value, next })],
  ["a function with the names", (value, next) => Object.assign(function () {}, { value, next })],
  ["a number, which ends the walk", () => 7],
  ["a string, which ends the walk", () => "link"],
];

function build(position, make) {
  let head = null;
  for (let index = 4; index >= 0; index--) head = index === position ? make(index + 1, head) : new Link(index + 1, head);
  return head;
}

const uses = [
  ["for", sumByLoop],
  ["while", sumByWhile],
  ["recursion", sumByRecursion],
  ["length", lengthOf],
  ["values", valuesOf],
  ["double", doubleAll],
  ["reverse", reverse],
];

for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(build(-1, null));
console.log("honest", uses.map(([name, use]) => name + " " + show(use(build(-1, null)))).join(" | "));

for (const [label, make] of impostors) {
  for (const position of [0, 2, 4]) {
    const parts = uses.map(([name, use]) => {
      try {
        return name + " " + show(use(build(position, make)));
      } catch (error) {
        return name + " threw " + error.constructor.name;
      }
    });
    console.log(label + " at " + position + " | " + parts.join(" | ") + (log.length ? " | log has " + log.splice(0).length : ""));
  }
}

function grow(depth, odd) {
  if (depth === 0) return null;
  const left = grow(depth - 1, odd);
  const right = grow(depth - 1, null);
  return depth === 2 && odd ? odd(depth, left, right) : new Tree(depth, left, right);
}

for (let i = 0; i < 500; i++) sumOfTree(grow(4, null)), depthOfTree(grow(4, null));
console.log("an honest tree", sumOfTree(grow(4, null)), depthOfTree(grow(4, null)));
for (const [label, odd] of [
  ["a literal", (value, left, right) => ({ value, left, right })],
  ["a literal in another order", (value, left, right) => ({ right, value, left })],
  ["a link used as a tree node", (value, left, right) => Object.assign(new Link(value, null), { left, right })],
  ["a node with a string", (value, left, right) => new Tree("two", left, right)],
  ["a node whose left is a getter", (value, left, right) => Object.defineProperty(new Tree(value, null, right), "left", { get: () => left })],
  ["a node whose right was deleted", (value, left, right) => { const tree = new Tree(value, left, right); delete tree.right; return tree; }],
  ["a number", () => 9],
]) {
  console.log("a tree with " + label, show(sumOfTree(grow(4, odd))), depthOfTree(grow(4, odd)));
}
