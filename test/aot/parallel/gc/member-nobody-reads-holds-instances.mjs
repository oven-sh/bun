// Forty holders a row, kept in a list, each with a member that nothing reads. What that member holds, by itself, through its class or through other objects, is known to a WeakRef or a
// FinalizationRegistry: it is there for as long as its holder is.
const holders = [];
const rows = [];
function row(name, make) {
  const weak = [];
  for (let n = 0; n < 40; n++) holders.push(make(n, weak));
  rows.push({ name, weak });
}
const watch = (weak, value) => (weak.push(new WeakRef(value)), value);
row("a getter of a record captures it", (n, weak) => {
  const w = watch(weak, { g1: n });
  return {
    read: n,
    keep: {
      get x1() {
        return w.g1;
      },
    },
  };
});
row("a setter of a record captures it", (n, weak) => {
  const w = watch(weak, { g2: n });
  return {
    read: n,
    keep: {
      set x2(v) {
        w.g2 = v;
      },
    },
  };
});
row("a method of a record captures it", (n, weak) => {
  const w = watch(weak, { g3: n });
  return {
    read: n,
    keep: {
      m3() {
        return w.g3;
      },
    },
  };
});
class Plain {
  constructor(v) {
    this.v = v;
  }
}
row("the instance itself", (n, weak) => ({ read: n, keep: watch(weak, new Plain(n)) }));
class Box {
  constructor(inner) {
    this.inner = inner;
  }
}
row("a record in an instance", (n, weak) => ({ read: n, keep: new Box(watch(weak, { b1: n })) }));
class Box2 {
  constructor(inner) {
    this.inner = inner;
  }
}
class Leaf2 {
  constructor(v) {
    this.v = v;
  }
}
row("an instance in an instance", (n, weak) => ({ read: n, keep: new Box2(watch(weak, new Leaf2(n))) }));
class Box3 {
  #inner;
  constructor(inner) {
    this.#inner = inner;
  }
}
row("in a private field", (n, weak) => ({ read: n, keep: new Box3(watch(weak, { b3: n })) }));
class Base4 {
  constructor(inner) {
    this.inner = inner;
  }
}
class Derived4 extends Base4 {
  constructor(inner) {
    super(inner);
    this.own = 1;
  }
}
row("in an inherited field", (n, weak) => ({ read: n, keep: new Derived4(watch(weak, { b4: n })) }));
class Base5 {
  constructor() {
    this.flat = 1;
  }
}
class Derived5 extends Base5 {
  constructor(inner) {
    super();
    this.inner = inner;
  }
}
function pick5(n, inner) {
  return n & 1 ? new Base5() : new Derived5(inner);
}
row("in a field of an heir", (n, weak) => {
  const w = { b5: n };
  if (!(n & 1)) weak.push(new WeakRef(w));
  return { read: n, keep: pick5(n, w) };
});
row("a class made for each holder, a method captures it", (n, weak) => {
  const w = watch(weak, { c6: n });
  class Local6 {
    get() {
      return w.c6;
    }
  }
  return { read: n, keep: new Local6() };
});
row("a class made for each holder, a static field holds it", (n, weak) => {
  class Local7 {
    static kept = watch(weak, { c7: n });
  }
  return { read: n, keep: new Local7() };
});
row("a class made for each holder, its prototype holds it", (n, weak) => {
  class Local8 {}
  Local8.prototype.extra = watch(weak, { c8: n });
  return { read: n, keep: new Local8() };
});
row("a class made for each holder is watched", (n, weak) => {
  class Local9 {}
  weak.push(new WeakRef(Local9));
  return { read: n, keep: new Local9() };
});
row("the prototype of a class made for each holder is watched", (n, weak) => {
  class Local10 {}
  weak.push(new WeakRef(Local10.prototype));
  return { read: n, keep: new Local10() };
});
row("a method of a class made for each holder is watched", (n, weak) => {
  class Local11 {
    m() {
      return 1;
    }
  }
  weak.push(new WeakRef(Local11.prototype.m));
  return { read: n, keep: new Local11() };
});
const once = [];
function makeOnce(weak) {
  const w = watch(weak, { c12: 1 });
  class Once12 {
    get() {
      return w.c12;
    }
  }
  weak.push(new WeakRef(Once12), new WeakRef(Once12.prototype), new WeakRef(Once12.prototype.get));
  return { read: 0, keep: new Once12() };
}
{
  const weak = [];
  holders.push(makeOnce(weak));
  rows.push({ name: "a class made once in a function that has returned", weak });
}
class Keeps13 extends Map {}
row("an heir of Map holds it", (n, weak) => {
  const m = new Keeps13();
  m.set(1, watch(weak, { c13: n }));
  return { read: n, keep: m };
});
class Keeps14 extends Array {}
row("an heir of Array holds it", (n, weak) => {
  const m = new Keeps14();
  m.push(watch(weak, { c14: n }));
  return { read: n, keep: m };
});
class Late15 {
  constructor() {
    this.a = 1;
  }
}
row("a property given later", (n, weak) => {
  const x = new Late15();
  x.late = watch(weak, { c15: n });
  return { read: n, keep: x };
});
class Late16 {
  constructor() {
    this.a = 1;
  }
}
row("a getter defined later captures it", (n, weak) => {
  const x = new Late16();
  const w = watch(weak, { c16: n });
  Object.defineProperty(x, "late", {
    get() {
      return w.c16;
    },
  });
  return { read: n, keep: x };
});
const key17 = Symbol("k");
class Keyed17 {
  constructor(v) {
    this[key17] = v;
  }
}
row("under a symbol", (n, weak) => ({ read: n, keep: new Keyed17(watch(weak, { c17: n })) }));
class Node18 {
  constructor(next, value) {
    this.next = next;
    this.value = value;
  }
}
row("at the end of a chain of nodes", (n, weak) => {
  let node = new Node18(null, watch(weak, { c18: n }));
  for (let i = 0; i < 6; i++) node = new Node18(node, null);
  return { read: n, keep: node };
});
class Ring19 {
  constructor() {
    this.other = this;
    this.extra = null;
  }
}
row("in a ring", (n, weak) => {
  const a = new Ring19(),
    b = new Ring19();
  a.other = b;
  b.other = a;
  b.extra = watch(weak, { c19: n });
  return { read: n, keep: a };
});
class Handler20 {
  constructor(w) {
    this.run = () => w.c20;
  }
}
row("an arrow in a field captures it", (n, weak) => ({ read: n, keep: new Handler20(watch(weak, { c20: n })) }));
class Returns21 {
  constructor(other) {
    return other;
  }
}
row("a constructor returns it", (n, weak) => ({ read: n, keep: new Returns21(watch(weak, { c21: n })) }));
class Target22 {
  constructor() {
    this.a = 1;
  }
}
class Other22 {}
row("constructed for another class whose prototype holds it", (n, weak) => {
  function Fresh() {}
  Fresh.prototype = { held: watch(weak, { c22: n }) };
  return { read: n, keep: Reflect.construct(Target22, [], Fresh) };
});
class Proto23 {
  constructor() {
    this.a = 1;
  }
}
row("given another prototype that holds it", (n, weak) => {
  const x = new Proto23();
  Object.setPrototypeOf(x, { held: watch(weak, { c23: n }) });
  return { read: n, keep: x };
});
class List24 {
  constructor(items) {
    this.items = items;
  }
}
row("in a list in an instance", (n, weak) => ({ read: n, keep: new List24([watch(weak, { c24: n })]) }));
class Map25 {
  constructor(items) {
    this.items = items;
  }
}
row("in a map in an instance", (n, weak) => ({ read: n, keep: new Map25(new Map([[1, watch(weak, { c25: n })]])) }));
const weakMap = new WeakMap();
class Key26 {
  constructor(v) {
    this.v = v;
  }
}
row("the key of a weak map whose value is watched", (n, weak) => {
  const k = new Key26(n);
  weakMap.set(k, watch(weak, { c26: n }));
  return { read: n, keep: k };
});
let cleaned = 0;
const registry = new FinalizationRegistry(() => cleaned++);
class Registered27 {
  constructor(v) {
    this.v = v;
  }
}
row("registered", (n, weak) => {
  const x = new Registered27(n);
  registry.register(x, n);
  return { read: n, keep: { inner: x } };
});
class Holder28 {
  constructor(read, keep) {
    this.read = read;
    this.keep = keep;
  }
}
class Leaf28 {
  constructor(v) {
    this.v = v;
  }
}
row("an instance holds a watched instance", (n, weak) => new Holder28(n, watch(weak, new Leaf28(n))));
function Old29(inner) {
  this.inner = inner;
}
row("made by a constructor function", (n, weak) => ({ read: n, keep: new Old29(watch(weak, { c29: n })) }));
class Field30 {
  inner = null;
  fill(v) {
    this.inner = v;
    return this;
  }
}
row("stored by a method later", (n, weak) => ({ read: n, keep: new Field30().fill(watch(weak, { c30: n })) }));
class Blob31 {
  constructor(b) {
    this.b = b;
  }
}
row("a blob in an instance", (n, weak) => ({ read: n, keep: new Blob31(watch(weak, new Blob(["x" + n]))) }));
class Indexed32 {
  constructor() {
    this.a = 1;
  }
}
row("an element of an instance", (n, weak) => {
  const x = new Indexed32();
  x[0] = watch(weak, { c32: n });
  return { read: n, keep: x };
});
class Indexed33 {
  constructor() {
    this.a = 1;
  }
}
row("an element of an instance under a number that is worked out", (n, weak) => {
  const x = new Indexed33();
  x[n + 3] = watch(weak, { c33: n });
  return { read: n, keep: x };
});
row("an element of a record", (n, weak) => {
  const x = { a34: 1 };
  x[n] = watch(weak, { c34: n });
  return { read: n, keep: x };
});
function Old35(v) {
  this.v = v;
}
row("what a constructor function made is watched", (n, weak) => ({ read: n, keep: watch(weak, new Old35(n)) }));
class Base36 {
  constructor() {
    this.a = 1;
  }
}
class Other36 {
  constructor() {
    this.b = 1;
  }
}
row("constructed for another class and watched", (n, weak) => ({
  read: n,
  keep: watch(weak, Reflect.construct(Base36, [], Other36)),
}));
class Base37 {
  constructor() {
    this.a = 1;
  }
}
class Heir37 extends Base37 {
  constructor() {
    super();
    this.b = 2;
  }
}
function make37(n) {
  return n & 1 ? new Base37() : new Heir37();
}
row("one of a class and its heir is watched", (n, weak) => ({ read: n, keep: watch(weak, make37(n)) }));
class Self38 {
  constructor(weak) {
    weak.push(new WeakRef(this));
  }
}
row("watched by its own constructor", (n, weak) => ({ read: n, keep: new Self38(weak) }));
class Base39 {
  constructor(weak) {
    weak.push(new WeakRef(this));
  }
}
class Heir39 extends Base39 {
  constructor(weak) {
    super(weak);
    this.b = 2;
  }
}
row("watched by the constructor of its base", (n, weak) => ({ read: n, keep: new Heir39(weak) }));
class Self40 {
  watchMe(weak) {
    weak.push(new WeakRef(this));
    return this;
  }
}
row("watched by its own method", (n, weak) => ({ read: n, keep: new Self40().watchMe(weak) }));
const weakSet = new WeakSet();
class Member41 {
  constructor(v) {
    this.v = v;
  }
}
const members41 = [];
row("a member of a weak set", (n, weak) => {
  const x = new Member41(n);
  weakSet.add(x);
  weak.push(new WeakRef(x));
  return { read: n, keep: x };
});
class Outer42 {
  constructor(inner) {
    this.inner = inner;
  }
}
class Middle42 {
  constructor(inner) {
    this.inner = inner;
  }
}
class Inner42 {
  constructor(v) {
    this.v = v;
  }
}
row("three classes deep", (n, weak) => ({ read: n, keep: new Outer42(new Middle42(watch(weak, new Inner42(n)))) }));
class Tree43 {
  constructor(left, right, value) {
    this.left = left;
    this.right = right;
    this.value = value;
  }
}
function grow43(depth, leaf) {
  return depth ? new Tree43(grow43(depth - 1, leaf), grow43(depth - 1, leaf), null) : new Tree43(null, null, leaf);
}
row("in the leaves of a tree", (n, weak) => ({ read: n, keep: grow43(4, watch(weak, { c43: n })) }));
class Swap44 {
  constructor() {
    this.inner = null;
  }
}
row("stored over null from outside", (n, weak) => {
  const x = new Swap44();
  const holder = { read: n, keep: x };
  x.inner = watch(weak, { c44: n });
  return holder;
});
class Sym45 {
  constructor(s) {
    this.s = s;
  }
}
row("a symbol in an instance", (n, weak) => ({ read: n, keep: new Sym45(watch(weak, Symbol("s" + n))) }));
class Reference46 extends WeakRef {}
class Leaf46 {
  constructor(v) {
    this.v = v;
  }
}
row("watched by an heir of WeakRef", (n, weak) => {
  const x = new Leaf46(n);
  weak.push(new Reference46(x));
  return { read: n, keep: x };
});
const Found47 = globalThis["Weak" + "Ref".slice(0)];
class Leaf47 {
  constructor(v) {
    this.v = v;
  }
}
row("watched by what a worked-out name of the global object gives", (n, weak) => {
  const x = new Leaf47(n);
  weak.push(new Found47(x));
  return { read: n, keep: x };
});
class Leaf48 {
  constructor(v) {
    this.v = v;
  }
}
const silent = new FinalizationRegistry(() => {});
row("the token of a registration", (n, weak) => {
  const x = new Leaf48(n);
  weak.push(new WeakRef(x));
  silent.register({ gone: n }, n, x);
  return { read: n, keep: x };
});
for (let round = 0; round < 6; round++) {
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 1));
}
let sum = 0;
for (const holder of holders) sum += holder.read;
for (const { name, weak } of rows)
  console.log(name + ":", weak.filter(w => w.deref() !== undefined).length, "of", weak.length);
console.log("cleaned", cleaned, "sum", sum, holders.length);
