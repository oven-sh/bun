// Accessors that a constructor defines on `this` with Object.defineProperty.
const printed = [];
const print = (...values) => printed.push(values.join(" "));
const attempt = f => {
  try {
    return f();
  } catch (error) {
    return error.constructor.name;
  }
};
const kept = [];

class Box {
  constructor(v) {
    this.v = v;
    Object.defineProperty(this, "size", {
      get() {
        return this.v;
      },
      set(x) {
        this.v = x * 2;
      },
    });
  }
}
class Counted {
  constructor(items) {
    this.items = items;
    Object.defineProperty(this, "length", { get: () => items.length, enumerable: true });
    Object.defineProperty(this, "first", { get: () => this.items[0], configurable: true });
  }
}
function Queue() {
  const items = [1, 2];
  Object.defineProperty(this, "size", { get: function () { return items.length; } });
  this.push = x => items.push(x);
}
Queue.prototype.twice = function () {
  return this.size * 2;
};
class Base {
  constructor(v) {
    this.v = v;
    Object.defineProperty(this, "size", { get() { return this.v; }, enumerable: true, configurable: true });
  }
}
class Heir extends Base {
  constructor(v) {
    super(v);
    this.own = v + 1;
  }
  twice() {
    return this.size * 2 + this.own;
  }
}
class Shadowed extends Base {
  get size() {
    return "never";
  }
}
class Late {
  constructor(isLate) {
    this.v = 5;
    if (isLate) Object.defineProperty(this, "size", { get() { return this.v; } });
  }
}
class Shown {
  constructor() {
    kept.push(this);
    this.v = 6;
    Object.defineProperty(this, "size", { get() { return this.v; } });
  }
}
class Stored {
  constructor() {
    this.v = 7;
    this.size = "stored";
    Object.defineProperty(this, "size", { get() { return this.v; }, configurable: true });
  }
}
function Parent() {
  this.v = 8;
  this.size = 9;
  Object.defineProperty(this, "size", { get() { return this.v; }, set(x) { this.v = x; }, configurable: true });
}
function Child() {
  Parent.call(this);
  this.own = 1;
}
Child.prototype = Object.create(Parent.prototype);

const box = new Box(1);
const counted = new Counted(["a", "b"]);
const queue = new Queue();
const heirs = [new Base(2), new Heir(3), new Shadowed(4)];
function run(turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    sum += box.size;
    box.size = turn & 7;
    sum += counted.length + queue.size + queue.twice();
    for (const heir of heirs) sum += heir.size;
    sum += heirs[1].twice();
  }
  return sum;
}
for (let round = 0; round < 3; round++) print(run(20));
queue.push(3);
counted.items.push("c");
print(run(5), counted.first, JSON.stringify(counted), Object.keys(queue).join(), JSON.stringify(heirs));
print(attempt(() => { queue.size = 1; }), attempt(() => { counted.length = 1; }), attempt(() => { delete box.size; }), box.size);
print(new Late(true).size, new Late(false).size, new Shown().size, kept.map(one => one.size), new Stored().size);
for (const made of [new Parent(), new Child()]) {
  let sum = 0;
  for (let turn = 0; turn < 5; turn++) {
    sum += made.size;
    made.size = turn;
  }
  print(sum, made.v, Object.keys(made).join());
}
for (const one of [new Box(1), new Heir(2), new Counted([]), new Stored()]) {
  const described = Object.getOwnPropertyDescriptor(one, "size") ?? Object.getOwnPropertyDescriptor(one, "length");
  print(typeof described.get, typeof described.set, described.enumerable, described.configurable);
}
const redefined = new Base(10);
print(redefined.size);
Object.defineProperty(redefined, "size", { value: "data", writable: true });
print(redefined.size, new Base(11).size, attempt(() => { redefined.size = 12; return redefined.size; }));
const deleted = new Heir(13);
delete deleted.size;
print(deleted.size, deleted.twice(), "size" in deleted, heirs[1].size);
const copy = { ...new Base(14) };
copy.v = 15;
print(copy.size, Object.assign({}, new Base(16)).size, structuredClone(new Base(17)).size);
const below = Object.create(box);
below.v = 18;
print(below.size, attempt(() => { below.size = 19; return below.v; }), box.v);
console.log(printed.join("\n"));
