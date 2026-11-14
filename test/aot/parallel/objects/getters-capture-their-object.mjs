// Accessors whose functions capture the object that a constructor defines them on.
const printed = [];
const print = (...values) => printed.push(values.map(String).join(" "));
const attempt = f => {
  try {
    return f();
  } catch (error) {
    return error.constructor.name;
  }
};
class Box {
  constructor(v) {
    this.v = v;
    Object.defineProperty(this, "size", { get: () => this.v, set: x => (this.v = x + 1), enumerable: true });
  }
}
const box = new Box(1);
let sum = 0;
for (let k = 0; k < 20; k++) {
  box.v = k & 7;
  sum += box.size;
  box.size = k & 3;
  sum += box.v;
}
print(sum, Object.keys(box).join());
class Early {
  constructor(v) {
    Object.defineProperty(this, "size", { get: () => this.w });
    this.last = this.size;
    this.w = v;
  }
}
const early = new Early(2);
print(early.last, early.size);
const kept = [];
class Kept {
  constructor(v) {
    const get = () => this.w;
    Object.defineProperty(this, "size", { get });
    kept.push(get);
    this.seen = kept[kept.length - 1]();
    this.w = v;
  }
}
const one = new Kept(3);
print(one.seen, one.size, kept[0]());
class Described {
  constructor(v) {
    const descriptor = { get: () => this.w };
    Object.defineProperty(this, "size", descriptor);
    this.seen = descriptor.get();
    this.w = v;
  }
}
const described = new Described(4);
print(described.seen, described.size);
class Below extends Box {
  constructor(v) {
    super(v);
    this.last = this.size;
    this.w = 5;
  }
}
const below = new Below(6);
print(below.last, below.size, below.w);
function Counter(v) {
  const self = this;
  this.v = v;
  Object.defineProperty(this, "size", {
    get: function () {
      return self.v;
    },
  });
}
const counter = new Counter(7);
const heir = Object.create(counter);
heir.v = 8;
print(counter.size, heir.size);
class Throws {
  constructor(v) {
    this.v = v;
    Object.defineProperty(this, "size", { get: () => this.v });
    if (v > 3) throw new Error("no");
  }
}
print(attempt(() => new Throws(4)), new Throws(2).size);
class Twice {
  constructor(v) {
    Object.defineProperty(this, "size", { get: () => this.v, configurable: true });
    Object.defineProperty(this, "size", { get: () => this.v * 2 });
    this.v = v;
  }
}
print(new Twice(9).size);
console.log(printed.join("\n"));
