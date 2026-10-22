// Which function a method call, a super call or an accessor reaches depends on prototype chains, and those are data: an instance gets another prototype, a class gets another base, a prototype object gets a new parent, the key `__proto__` is read, stored and written in a literal. The new callee keeps what the old one only read.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const report = () => kept.splice(0).map(k => k.tag).join("+");
class Quiet {
  take(t) {
    return t.n;
  }
  get size() {
    return 1;
  }
}
class Loud {
  take(t) {
    kept.push(t);
    return -t.n;
  }
  get size() {
    kept.push(this);
    return 2;
  }
}
class Heir extends Quiet {
  tag = "an heir";
  take(t) {
    return super.take(t) + 1;
  }
  get size() {
    return super.size + 10;
  }
}
function give(o, i) {
  return o.take({ n: i, tag: "given " + i });
}
function sizeOf(o) {
  return o.size;
}
const quiet = new Quiet();
const heir = new Heir();
let sum = 0;
for (let i = 0; i < 500; i++) sum += give(quiet, i) + give(heir, i) + sizeOf(heir) + sizeOf(quiet);
console.log(sum, kept.length);

// One instance gets another prototype.
Object.setPrototypeOf(quiet, Loud.prototype);
quiet.tag = "the instance that changed sides";
console.log(give(quiet, 1), sizeOf(quiet), give(new Quiet(), 2), quiet instanceof Quiet, quiet instanceof Loud, churn(30), report());

// The base of a class is exchanged: super now finds other methods.
Object.setPrototypeOf(Heir.prototype, Loud.prototype);
console.log(give(heir, 3), sizeOf(heir), give(new Heir(), 4), heir instanceof Quiet, churn(30), report());
Object.setPrototypeOf(Heir.prototype, Quiet.prototype);
console.log(give(heir, 5), sizeOf(heir), report() === "");

// A parent is put between.
const between = Object.create(Quiet.prototype, {
  take: {
    value(t) {
      kept.push(t);
      return 1000;
    },
  },
});
Object.setPrototypeOf(Heir.prototype, between);
console.log(give(heir, 6), churn(30), report());
Object.setPrototypeOf(Heir.prototype, Quiet.prototype);

// The constructor's own parent: `super(...)` calls whatever the class object inherits from at that moment.
class BaseA {
  constructor(t) {
    this.from = "A";
    this.n = t.n;
  }
}
class BaseB {
  constructor(t) {
    this.from = "B";
    kept.push(t);
  }
}
class Derived extends BaseA {
  constructor(t) {
    super(t);
  }
}
function construct(i) {
  return new Derived({ n: i, tag: "constructed with " + i });
}
for (let i = 0; i < 300; i++) sum += construct(i).n;
Object.setPrototypeOf(Derived, BaseB);
const made = construct(7);
console.log(made.from, made instanceof BaseA, made instanceof BaseB, churn(30), report());
Object.setPrototypeOf(Derived, BaseA);

// The key __proto__.
function protoOf(o) {
  return o.__proto__;
}
function setProto(o, p) {
  o.__proto__ = p;
  return o;
}
function literalBelow(p, i) {
  return { __proto__: p, own: i };
}
function notThePrototype(p) {
  return [{ ["__proto__"]: p }, { "__proto__": p }, JSON.parse('{"__proto__":{"tag":"parsed"}}')];
}
const spyProto = {
  tag: "the spying prototype",
  get watched() {
    kept.push(this);
    return 1;
  },
  set written(v) {
    kept.push(this, v);
  },
};
function touch(o) {
  o.written = { tag: "a value for " + o.tag };
  return o.watched;
}
let line = "";
for (let i = 0; i < 200; i++) {
  const plain = { tag: "plain " + i, watched: 0, written: null };
  sum += touch(plain);
  const p = { tag: "prototype " + i };
  line = [protoOf(literalBelow(p, i)) === p, protoOf(setProto({}, p)) === p, protoOf({}) === Object.prototype, protoOf(Object.create(null)), setProto({ tag: "own" }, p).tag, setProto({}, p).tag, setProto({}, 5).__proto__ === Object.prototype, setProto({}, null).__proto__].join();
}
console.log(line);
console.log(touch(setProto({ tag: "turned" }, spyProto)), touch(literalBelow(spyProto, 1)), churn(30), report());
console.log(notThePrototype(spyProto).map(o => [Object.getPrototypeOf(o) === spyProto, Object.hasOwn(o, "__proto__"), Object.keys(o).join()].join("/")).join(" "));

// The prototype is kept alive by the object alone, and the object's methods come from it.
function makeWithFreshPrototype(i) {
  return setProto({ i }, {
    tag: "fresh prototype " + i,
    describe() {
      return this.tag + " of " + this.i;
    },
  });
}
const survivors = [];
for (let i = 0; i < 300; i++) {
  const o = makeWithFreshPrototype(i);
  if (i % 100 === 99) survivors.push(o);
}
console.log(churn(60), survivors.map(o => o.describe()).join(" | "));

// A function's `prototype` property is stored to: later instances are of another kind.
function Widget(n) {
  this.n = n;
}
Widget.prototype.take = function (t) {
  return t.n + this.n;
};
function useWidget(i) {
  return new Widget(i).take({ n: i, tag: "for a widget " + i });
}
for (let i = 0; i < 300; i++) sum += useWidget(i);
const oldPrototype = Widget.prototype;
Widget.prototype = Loud.prototype;
console.log(useWidget(8), new Widget(1) instanceof Loud, Object.getPrototypeOf(new Widget(1)) === oldPrototype, churn(20), report(), sum);
