// Object.defineProperty(Class.prototype, "name", { get, set }) over a name that the constructor stores: the setter runs, what it stores is part of the object.
const said = [];
class Node {
  constructor(kind, pos) {
    this.pos = pos;
    this.kind = kind;
    this.flags = 0;
    this.parent = undefined;
  }
  getStart() {
    return this.pos;
  }
}
const early = new Node(1, 2);
Object.defineProperty(Node.prototype, "flags", {
  get() { return this._flags; },
  set(value) { this._flags = value; },
});
function create(kind, parent) {
  const node = new Node(kind, 1);
  node.parent = parent;
  return node;
}
function depth(node) {
  let sum = 0;
  while (node) {
    sum += node.kind + node.flags + node.getStart();
    node = node.parent;
  }
  return sum;
}
let sum = 0;
for (let i = 0; i < 200; i++) {
  let last;
  for (let k = 0; k < 4; k++) {
    last = create(k, last);
    last.flags = k & 1;
  }
  sum += depth(last);
}
said.push(sum, Object.keys(create(1)).join(), Object.keys(early).join(), early.flags, JSON.stringify(create(2)));
early.flags = 8;
said.push(early.flags, early._flags, Object.keys(early).join());

class Heir extends Node {
  constructor(kind) {
    super(kind, 3);
    this.flags = 5;
    this.more = kind;
  }
}
said.push(Object.keys(new Heir(1)).join(), new Heir(2).flags, depth(new Heir(3)));

class Conditional {
  constructor(value) {
    this.before = 1;
    this.value = value;
    this.after = 2;
  }
}
Object.defineProperty(Conditional.prototype, "value", {
  configurable: true,
  enumerable: true,
  get: function () { return this.held; },
  set: function (value) {
    if (value > 2) this.held = value;
    else this.small = value;
  },
});
const conditional = value => {
  const object = new Conditional(value);
  return Object.keys(object).join() + object.value + object.before + object.after;
};
for (let i = 0; i < 6; i++) said.push(conditional(i));
delete Conditional.prototype.value;
said.push(conditional(1), conditional(9));

function Old(a) {
  this.a = a;
  this.b = 2;
}
Object.defineProperty(Old.prototype, "a", { get() { return this.x + 1; }, set(value) { this.x = value; this.y = this; }, configurable: true });
said.push(Object.keys(new Old(4)).join(), new Old(4).a, new Old(4).y.b);

class Unused {
  constructor() {
    this.name = 1;
    this.other = 2;
  }
}
function never() {
  Object.defineProperty(Unused.prototype, "name", { get() { return 0; }, set(value) { this.hidden = value; } });
}
said.push(Object.keys(new Unused()).join(), new Unused().name + new Unused().other);
if (said.length > 1000) never();

class Getter {
  constructor() {
    this.first = 1;
    try { this.fixed = 2; } catch (error) { this.error = error.constructor.name; }
  }
}
Object.defineProperty(Getter.prototype, "fixed", { get() { return 7; } });
said.push(Object.keys(new Getter()).join(), new Getter().fixed, new Getter().error);

class Twice {
  constructor(v) {
    this.v = v;
    this.w = 1;
  }
}
Object.defineProperty(Twice.prototype, "v", { get() { return 1; }, set(v) { this.one = v; }, configurable: true });
said.push(Object.keys(new Twice(3)).join(), new Twice(3).v);
Reflect.defineProperty(Twice.prototype, "v", { get() { return 2; }, set(v) { this.two = v; }, configurable: true });
said.push(Object.keys(new Twice(3)).join(), new Twice(3).v);
Object.defineProperty(Twice.prototype, "v", { value: 4, writable: true });
said.push(Object.keys(new Twice(3)).join(), new Twice(3).v);

let Held = class {
  constructor(p) {
    this.p = p;
    this.q = 1;
  }
};
Object.defineProperty(Held.prototype, "p", { get() { return this.kept; }, set(v) { eval("this.kept = v + 1"); } });
said.push(Object.keys(new Held(3)).join(), new Held(3).p);
console.log(said.join("\n"));
