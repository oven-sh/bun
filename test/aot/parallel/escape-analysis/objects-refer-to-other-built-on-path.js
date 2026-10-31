// Objects that refer to each other (a closure over the object that holds it, a parent and its child) are needed on one path only. Where they are built, keys, values and identities are what the constructors made.
const lines = [];
function say(name, ...values) { lines.push(name + ": " + values.map(String).join(" ")); }

class Handler {
  constructor(name) {
    this.name = name;
    this.run = () => this.name;
    this.again = () => this.run() + "!";
    this.count = 0;
    this.last = null;
  }
}
const keptHandlers = [];
function makeHandler(name, keep) {
  const handler = new Handler(name);
  handler.count++;
  if (keep) {
    keptHandlers.push(handler);
    return handler.run;
  }
  return null;
}
let lastRun = null;
for (let i = 0; i < 1000; i++) {
  const run = makeHandler("h" + i, i % 400 === 7);
  if (run) lastRun = run;
}
for (const handler of keptHandlers) {
  say("handler keys", Object.keys(handler).join());
  say("handler text", JSON.stringify(handler));
  say("handler calls", handler.run(), handler.again(), handler.count, handler.last);
  say("handler identity", handler.run === handler.run, handler.again === handler.again, handler.run === handler.again);
}
say("last run", lastRun(), lastRun === keptHandlers[keptHandlers.length - 1].run);

class Parent {
  constructor(name) {
    this.name = name;
    this.child = new Child(this);
    this.size = 1;
  }
}
class Child {
  constructor(parent) {
    this.depth = 1;
    this.parent = parent;
    this.label = "child of " + parent.name;
  }
}
const keptParents = [];
const keptChildren = [];
function makeFamily(name, keepParent, keepChild) {
  const parent = new Parent(name);
  parent.size += parent.child.depth;
  if (keepParent) keptParents.push(parent);
  if (keepChild) keptChildren.push(parent.child);
  return parent.child.parent.size;
}
let total = 0;
for (let i = 0; i < 1000; i++) total += makeFamily("p" + i, i % 300 === 5, i % 450 === 9);
say("families", total, keptParents.length, keptChildren.length);
for (const parent of keptParents) {
  say("parent keys", Object.keys(parent).join(), Object.keys(parent.child).join());
  say("parent values", parent.name, parent.size, parent.child.depth, parent.child.label);
  say("parent identity", parent.child.parent === parent, parent.child.parent.child === parent.child);
}
for (const child of keptChildren) {
  say("child keys", Object.keys(child).join(), Object.keys(child.parent).join());
  say("child values", child.label, child.parent.name, child.parent.size);
  say("child identity", child.parent.child === child);
}

function makeRing(value, keep) {
  const first = { value, next: null, tag: "first" };
  const second = { value: value + 1, next: first, tag: "second" };
  first.next = second;
  if (keep) return first;
  return first.next.next.value + second.next.next.value;
}
let ringTotal = 0;
let ring = null;
for (let i = 0; i < 1000; i++) {
  const result = makeRing(i, i === 777);
  if (typeof result === "number") ringTotal += result;
  else ring = result;
}
say("ring", ringTotal, Object.keys(ring).join(), Object.keys(ring.next).join(), ring.value, ring.next.value, ring.tag, ring.next.tag, ring.next.next === ring);

let keptTop = null;
function makeShared(i, keep) {
  const leaf = { w: i };
  const middle = { id: i + 1, leaf, size: i + 2, half: i * 0.5 };
  const top = { leaf, middle };
  if (keep) keptTop = top;
  return middle.size + top.leaf.w;
}
let sharedTotal = 0;
for (let i = 0; i < 1000; i++) sharedTotal += makeShared(i, i === 777);
say("shared keys", sharedTotal, Object.keys(keptTop).join(), Object.keys(keptTop.middle).join(), Object.keys(keptTop.leaf).join());
say("shared text", JSON.stringify(keptTop));
say("shared identity", keptTop.leaf === keptTop.middle.leaf, keptTop.middle.id, keptTop.middle.size, keptTop.middle.half);

let keptSelf = null;
function makeLiteral(i, keep) {
  let literal;
  literal = { id: i, self: () => literal, count: i + 3, half: i * 0.5 };
  if (keep) keptSelf = literal.self;
  return literal.count;
}
let literalTotal = 0;
for (let i = 0; i < 1000; i++) literalTotal += makeLiteral(i, i === 555);
const keptLiteral = keptSelf();
say("literal keys", literalTotal, Object.keys(keptLiteral).join(), keptLiteral.id, keptLiteral.count, keptLiteral.half);
say("literal text", JSON.stringify(keptLiteral));
say("literal identity", keptLiteral.self === keptSelf, keptLiteral.self() === keptLiteral);

console.log(lines.join("\n"));
