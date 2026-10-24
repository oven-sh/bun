// Arrow functions that a constructor stores on `this`, constructed so often that the store keeps what it learned; then a setter, a read-only property and a sealed object come between the store and what it learned.
class Core {
  constructor(seed, wide) {
    this.seed = seed;
    if (wide) this.wide = seed * 2;
    this.add = (x) => this.seed + x;
    this.twice = () => this.seed * 2;
    this.label = () => "core" + this.seed;
    this.self = () => this;
  }
}
class Router extends Core {
  constructor(seed, wide) {
    super(seed, wide);
    this.route = (path) => path + ":" + this.seed;
  }
}
function make(i) {
  return i % 3 === 0 ? new Core(i, false) : i % 3 === 1 ? new Router(i, false) : new Router(i, true);
}
let sum = 0, previous = null;
for (let i = 0; i < 6000; i++) {
  const made = make(i);
  if (i % 7 === 0) sum += made.add(1) + made.twice();
  if (i % 11 === 0 && made.self() !== made) sum += 1e9;
  if (previous && (previous.add === made.add || previous.self === made.self)) sum += 1e9;
  if (i % 1500 < 3) console.log(i, Object.keys(made).join(), made.label(), typeof made.route, made.add.name, made.add.length);
  previous = made;
}
console.log(sum);

// A setter on the prototype takes the store from now on.
const seen = [];
Object.defineProperty(Core.prototype, "twice", { set(value) { seen.push(typeof value + this.seed); }, get() { return () => -1; }, configurable: true });
for (let i = 0; i < 40; i++) {
  const made = make(i);
  if (i < 3) console.log(Object.keys(made).join(), made.twice(), Object.hasOwn(made, "twice"), made.label(), made.self() === made);
}
console.log(seen.length, seen.slice(0, 4).join());
delete Core.prototype.twice;
for (let i = 0; i < 40; i++) sum += make(i).twice();
console.log(make(4).twice(), Object.hasOwn(make(4), "twice"), Object.keys(make(5)).join(), sum);

// A setter further up the chain, on the base class's prototype, seen from the subclass's own store.
Object.defineProperty(Core.prototype, "route", { set(value) { seen.push("route" + this.seed); }, configurable: true });
console.log(Object.hasOwn(make(1), "route"), Object.keys(make(2)).join(), Object.keys(make(3)).join(), seen.length, seen.at(-1));
delete Core.prototype.route;
console.log(Object.hasOwn(make(1), "route"), make(1).route("a"));

// A read-only property on the prototype: the store throws in a class body.
Object.defineProperty(Router.prototype, "label", { value: 1, writable: false, configurable: true });
for (const i of [0, 1, 2]) {
  try {
    console.log(make(i).label());
  } catch (error) {
    console.log(error instanceof TypeError, error.message);
  }
}
delete Router.prototype.label;
console.log(make(1).label(), make(2).label());

// An object that takes no more properties.
class Sealed extends Core {
  constructor(seed, when) {
    super(seed, false);
    if (when) Object.preventExtensions(this);
    this.late = () => this.seed;
  }
}
let thrown = 0, stored = 0;
for (let i = 0; i < 3000; i++) {
  try {
    stored += new Sealed(i, i % 1000 === 999).late() === i ? 1 : 1000000;
  } catch (error) {
    thrown += error instanceof TypeError ? 1 : 1000000;
  }
}
console.log(stored, thrown);

// More functions than an object holds in line.
class Wide {
  constructor(n) {
    this.n = n;
    this.f00 = () => this.n + 0; this.f01 = () => this.n + 1; this.f02 = () => this.n + 2; this.f03 = () => this.n + 3;
    this.f04 = () => this.n + 4; this.f05 = () => this.n + 5; this.f06 = () => this.n + 6; this.f07 = () => this.n + 7;
    this.f08 = () => this.n + 8; this.f09 = () => this.n + 9; this.f10 = () => this.n + 10; this.f11 = () => this.n + 11;
    this.f12 = () => this.n + 12; this.f13 = () => this.n + 13; this.f14 = () => this.n + 14; this.f15 = () => this.n + 15;
    this.f16 = () => this.n + 16; this.f17 = () => this.n + 17; this.f18 = () => this.n + 18; this.f19 = () => this.n + 19;
    this.f20 = () => this.n + 20; this.f21 = () => this.n + 21; this.f22 = () => this.n + 22; this.f23 = () => this.n + 23;
  }
}
let wide = 0;
const kept = [];
for (let i = 0; i < 4000; i++) {
  const made = new Wide(i);
  if (i % 13 === 0) wide += made.f00() + made.f07() + made.f12() + made.f23();
  if (i % 400 === 0) kept.push(made);
}
console.log(wide, Object.keys(kept[3]).length, kept.map(each => each.f23() - each.f00()).join(), kept[2].f05 === kept[2].f05, kept[2].f05 === kept[3].f05);

// The same store reached with an object that is no instance of the class.
function Plain(seed) {
  this.seed = seed;
  this.read = () => this.seed;
}
const borrowed = { first: 1 };
let plain = 0;
for (let i = 0; i < 3000; i++) plain += new Plain(i).read();
Plain.call(borrowed, 7);
const frozen = Object.freeze({ seed: 1 });
try {
  Plain.call(frozen, 8);
} catch (error) {
  console.log(error instanceof TypeError, error.message);
}
console.log(plain, Object.keys(borrowed).join(), borrowed.read(), Object.keys(frozen).join(), frozen.seed);
