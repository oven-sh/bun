// This of a function that is not strict is a primitive or nothing.
function kind() {
  return typeof this;
}
function same() {
  return this === this;
}
function store(v) {
  this.stored = v;
  return this;
}
function Stored(x) {
  this.x = x;
}
console.log(
  kind.call(1),
  kind.call("a"),
  kind.call(true),
  kind.call(undefined),
  kind.call(null),
  kind.call(Symbol.iterator),
  kind.call(1n),
  kind(),
);
console.log(same.call(1), same.call(undefined));
console.log(
  store.call(undefined, 3) === globalThis,
  globalThis.stored,
  store.call(5, 1) instanceof Number,
  store.call("s", 1).stored,
  Object.prototype.toString.call(store.call(false, 1)),
);
Stored(11);
console.log(globalThis.x, typeof x === "number" ? x : "none");
Stored.call(null, 12);
console.log(globalThis.x);
const wrapped = store.call(7, 8);
console.log(wrapped.stored, wrapped + 1, new Stored(4).x);
function pick(c) {
  const holder = c ? {} : undefined;
  const kept = { n: 1 };
  store.call(holder, kept);
  return holder;
}
console.log(pick(true).stored.n, pick(false), globalThis.stored.n);
function Counted(n) {
  if (!(this instanceof Counted)) return new Counted(n);
  this.n = n;
}
Counted.prototype.next = function () {
  return this.n + 1;
};
console.log(
  Counted(1).next(),
  new Counted(2).next(),
  Counted.call(3, 4).next(),
  Counted.prototype.next.call({ n: 9 }),
  Counted.prototype.next.call(5),
);
function Either(v) {
  this.v = v;
  return this;
}
let sumOfMade = 0;
for (let i = 0; i < 50; i++) sumOfMade += (i % 10 === 9 ? Either.call(undefined, i) : new Either(i)).v;
console.log(sumOfMade, globalThis.v, Object.keys(new Either(1)).join());
const unbound = new Either(6).constructor.prototype.constructor;
console.log(
  unbound === Either,
  typeof unbound.call("text", 1),
  unbound.call("text", 1).length,
  unbound.call(Symbol.iterator, 2).v,
  unbound.call(10n, 3) + 1n,
);
