// `this.x = x` in a constructor creates the property, unless something above the new object takes the store: a setter, a property that is read only, a proxy.
// What stands above may change between two constructions, and the function may be handed an object that somebody else has made. The keys come in the order in which they were stored.
const log = [];
function describe(o) {
  const names = [];
  for (const name in o) names.push(name);
  return `${JSON.stringify(o)} keys=${Object.keys(o).join()} in=${names.join()}`;
}
function say(what, run) {
  log.length = 0;
  try {
    const result = run();
    console.log(what, "->", typeof result === "object" && result ? describe(result) : String(result), log.join(","));
  } catch (e) {
    console.log(what, "->", e.constructor.name + ": " + e.message, log.join(","));
  }
}

function Node(kind, pos, end) {
  this.kind = kind;
  this.pos = pos;
  this.end = end;
  this.parent = undefined;
  this.flags = 0;
}
class Token {
  constructor(kind, text) {
    this.kind = kind;
    this.text = text;
    this.next = null;
  }
}
class Keyword extends Token {
  constructor(text) {
    super(1, text);
    this.reserved = true;
  }
}
function Branching(first, both) {
  if (first) this.a = 1;
  this.b = 2;
  if (both) this.a = 3;
  this.c = 4;
}
function Backwards() {
  this.z = 1;
  this.y = 2;
  this.x = 3;
}
function Twice(v) {
  this.a = v;
  this.b = v;
  this.a = v + 1;
}
function Looping(n) {
  this.count = 0;
  for (let i = 0; i < n; i++) this.count += i;
  this.done = true;
}
function ReadsItself(v) {
  this.a = v;
  this.b = this.a + 1;
  this.c = this.missing;
  this.d = "a" in this;
  this.e = "z" in this;
}
function CallsOut(hook) {
  this.a = 1;
  hook(this);
  this.b = 2;
  this.c = 3;
}
function Deletes() {
  this.a = 1;
  this.b = 2;
  delete this.a;
  this.a = 3;
}
function Upper(a) {
  this.a = a;
}
function Lower(a, b) {
  Upper.call(this, a);
  this.b = b;
}
Object.setPrototypeOf(Lower.prototype, Upper.prototype);
function ReturnsOther(o) {
  this.a = 1;
  return o;
}

for (let i = 0; i < 400; i++) {
  new Node(i, i, i + 1);
  new Token(i, "t");
  new Keyword("k");
  new Branching(i & 1, i & 2);
  new Backwards();
  new Twice(i);
  new Looping(3);
  new ReadsItself(i);
  new CallsOut(() => {});
  new Deletes();
  new Lower(i, i);
  new ReturnsOther(undefined);
}

say("Node", () => new Node(1, 2, 3));
say("Token", () => new Token(1, "t"));
say("Keyword", () => new Keyword("k"));
for (const first of [false, true]) for (const both of [false, true]) say(`Branching ${first} ${both}`, () => new Branching(first, both));
say("Backwards", () => new Backwards());
say("Twice", () => new Twice(1));
say("Looping", () => new Looping(4));
say("ReadsItself", () => new ReadsItself(1));
say("Deletes", () => new Deletes());
say("Lower", () => new Lower(1, 2));
say("ReturnsOther, nothing", () => new ReturnsOther(undefined));
say("ReturnsOther, an object", () => new ReturnsOther({ other: 1 }));
for (const [name, hook] of [
  ["adds a name", o => void (o.extra = 9)],
  ["adds b", o => void (o.b = 9)],
  ["adds c", o => void (o.c = 9)],
  ["deletes a", o => void delete o.a],
  ["defines b as a setter", o => void Object.defineProperty(o, "b", { set(v) { log.push("own b=" + v); }, configurable: true, enumerable: true })],
  ["defines b read only", o => void Object.defineProperty(o, "b", { value: 8, writable: false, enumerable: true })],
  ["lays it below a setter", o => void Object.setPrototypeOf(o, { set b(v) { log.push("above b=" + v); } })],
  ["lays it below nothing", o => void Object.setPrototypeOf(o, null)],
  ["closes it", o => void Object.preventExtensions(o)],
]) say(`CallsOut, the hook ${name}`, () => new CallsOut(hook));

// What stands above the new object changes between two constructions.
const above = [
  ["a setter", { set(v) { log.push("set " + v); }, configurable: true }],
  ["a getter alone", { get: () => 77, configurable: true }],
  ["read only", { value: 78, writable: false, configurable: true }],
  ["a plain value", { value: 79, writable: true, configurable: true }],
];
for (const [name, descriptor] of above) {
  for (const [title, holder, key, make] of [
    ["Node.prototype.pos", Node.prototype, "pos", () => new Node(1, 2, 3)],
    ["Node.prototype.flags", Node.prototype, "flags", () => new Node(1, 2, 3)],
    ["Token.prototype.text", Token.prototype, "text", () => new Token(1, "t")],
    ["Token.prototype.text, from below", Token.prototype, "text", () => new Keyword("k")],
    ["Token.prototype.reserved, from below", Token.prototype, "reserved", () => new Keyword("k")],
    ["Keyword.prototype.kind", Keyword.prototype, "kind", () => new Keyword("k")],
    ["Upper.prototype.b", Upper.prototype, "b", () => new Lower(1, 2)],
    ["Upper.prototype.a", Upper.prototype, "a", () => new Lower(1, 2)],
  ]) {
    Object.defineProperty(holder, key, descriptor);
    say(`${title} is ${name}`, make);
    delete holder[key];
    say(`${title} is gone again`, make);
  }
}

// Another object comes to stand above the prototype object, and goes again.
{
  const parent = { set end(v) { log.push("end=" + v); } };
  Object.setPrototypeOf(Node.prototype, parent);
  say("a setter above Node.prototype", () => new Node(1, 2, 3));
  Object.setPrototypeOf(Node.prototype, Object.prototype);
  say("Node.prototype below Object.prototype again", () => new Node(1, 2, 3));
  Object.setPrototypeOf(Node.prototype, new Proxy({}, { set(target, key, value, receiver) { log.push(`trap ${String(key)}`); return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }); } }));
  say("a proxy above Node.prototype", () => new Node(1, 2, 3));
  Object.setPrototypeOf(Node.prototype, Object.prototype);
  say("Node.prototype below Object.prototype once more", () => new Node(1, 2, 3));
}

// The function gets another prototype object.
{
  const former = Node.prototype;
  Node.prototype = { set kind(v) { log.push("kind=" + v); } };
  say("another Node.prototype, with a setter", () => new Node(1, 2, 3));
  Node.prototype = 5;
  say("Node.prototype is no object", () => new Node(1, 2, 3));
  Node.prototype = former;
  say("the former Node.prototype", () => new Node(1, 2, 3));
}

// The function is handed an object that somebody else has made.
for (const [name, make] of [
  ["an empty object", () => ({})],
  ["an object with some of the names", () => ({ pos: 0, extra: 1 })],
  ["an object of its own", () => new Node(7, 8, 9)],
  ["an object of its own with a name more", () => Object.assign(new Node(7, 8, 9), { extra: 1 })],
  ["an object of its own that lost a name", () => { const o = new Node(7, 8, 9); delete o.pos; return o; }],
  ["an object of its own whose pos is a setter", () => Object.defineProperty(new Node(7, 8, 9), "pos", { set(v) { log.push("own pos=" + v); }, configurable: true })],
  ["an object made below its prototype", () => Object.create(Node.prototype)],
  ["an object of another class", () => new Token(1, "t")],
  ["a list", () => []],
  ["a function", () => function named() {}],
]) {
  let o;
  say(`Node.call on ${name}`, () => (Node.call((o = make()), 1, 2, 3), o));
}
say("Node.call on nothing", () => Node.call(undefined, 1, 2, 3));
say("Node.call on a number", () => Node.call(5, 1, 2, 3));
say("Reflect.construct for a function with a setter", () => {
  function Other() {}
  Other.prototype = { set pos(v) { log.push("other pos=" + v); } };
  return Reflect.construct(Node, [1, 2, 3], Other);
});
say("a class below Node", () => {
  class Below extends Node {
    constructor() {
      super(1, 2, 3);
      this.own = 4;
    }
    set end(v) {
      log.push("below end=" + v);
    }
  }
  return new Below();
});
say("Node bound", () => new (Node.bind(null, 1))(2, 3));
say("Node, at the end", () => new Node(1, 2, 3));
