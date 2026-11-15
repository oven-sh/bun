// util.inherits links two functions, and throws for what is no function.
const util = require("util");

function Counter(n) { this.n = n; this.i = 0; }
Counter.prototype.step = function () { this.i = (this.i + 1) & 7; return this.i; };
Counter.prototype.get = function () { return this.n; };
function Doubled(n) { Counter.call(this, n * 2); }
util.inherits(Doubled, Counter);
Doubled.prototype.own = function () { return this.get() + 1; };
function Last(n) { Doubled.super_.call(this, n); this.last = true; }
util.inherits(Last, Doubled);

function run(list) {
  let sum = 0;
  for (let i = 0; i < 100; i++) {
    const object = list[i % list.length];
    sum += object.step() + object.own();
  }
  return sum;
}
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.code + ": " + error.message;
  }
}

console.log(run([new Doubled(1), new Doubled(2)]), run([new Last(3), new Doubled(4)]));
console.log(Doubled.super_ === Counter, Last.super_ === Doubled, new Last(1) instanceof Counter, new Last(1).last, Object.keys(Doubled).join());
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(Doubled, "super_"), (key, value) => (typeof value === "function" ? value.name : value)));
for (const child of [undefined, null, 0, "", {}]) console.log(String(child), attempt(() => util.inherits(child, Counter)));
for (const parent of [undefined, null, 0, {}, { prototype: undefined }, { prototype: null }]) console.log(String(parent), attempt(() => util.inherits(function Child() {}, parent)));

Counter.prototype.get = function () { return 100; };
console.log(run([new Doubled(1), new Last(2)]));
Object.setPrototypeOf(Doubled.prototype, { step() { return 5; }, get() { return 6; } });
console.log(run([new Doubled(1), new Last(2)]), new Doubled(1) instanceof Counter);
util.inherits = () => "replaced";
function Never() {}
console.log(util.inherits(Never, Counter), new Never() instanceof Counter);
