// `this` of Base is an object of Base, or of one of the functions that make() lays below it. Those are made again and again, so no guard speaks for what stands above their objects:
// the typed stores of Base are built for the objects of Base alone, and the others take the stores by name, past whatever their own prototype objects hold.
function Base(a) {
  this.a = a;
  this.b = a + 1;
  this.c = "c" + a;
}
Base.prototype.sum = function () {
  return this.a + this.b + this.c;
};
function make(kind) {
  function Below(a) {
    Base.call(this, a);
    this.kind = kind;
  }
  Object.setPrototypeOf(Below.prototype, Base.prototype);
  Object.setPrototypeOf(Below, Base);
  if (kind === "setter") Object.defineProperty(Below.prototype, "b", { set(value) { this.taken = value; }, get() { return -1; }, configurable: true });
  if (kind === "read only") Object.defineProperty(Below.prototype, "c", { value: "fixed", writable: false });
  if (kind === "proxy") Object.setPrototypeOf(Below.prototype, new Proxy(Base.prototype, { set(target, key, value, receiver) { return Reflect.defineProperty(receiver, key, { value: "through " + String(value), writable: true, enumerable: true, configurable: true }); } }));
  return Below;
}
function describe(made) {
  return Object.keys(made).join() + " | " + made.sum() + " | " + JSON.stringify(made);
}
const kinds = ["plain", "setter", "read only", "proxy", "plain"];
let text = "";
for (let round = 0; round < 300; round++) {
  const Below = make(kinds[round % kinds.length]);
  const base = new Base(round);
  let below;
  try {
    below = new Below(round);
  } catch (error) {
    below = { sum() { return error.constructor.name; } };
  }
  if (round < 10 || round > 295) console.log(describe(below), "||", describe(base));
  text = below.sum() + base.sum();
}
console.log(text);
// What stands above the objects of Base changes: the guard ends, and the stores go by name.
Object.defineProperty(Base.prototype, "b", { set(value) { this.late = value * 2; }, get() { return 100; }, configurable: true });
console.log(describe(new Base(1)), "||", describe(new (make("plain"))(2)), "||", describe(new (make("setter"))(3)));
delete Base.prototype.b;
console.log(describe(new Base(4)), "||", describe(new (make("proxy"))(5)));
const frozen = Object.freeze(Object.create(Base.prototype));
try {
  Base.call(frozen, 6);
} catch (error) {
  console.log(error.constructor.name);
}
console.log(Object.keys(frozen).length, describe(Base.call({ sum: Base.prototype.sum }, 7) ?? new Base(8)));
