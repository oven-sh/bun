function Shape(step) { this.step = step; this.count = 0; }
Shape.prototype.run = function (n) { this.count++; return this.step(n); };
function Child(step) { Shape.call(this, step); this.extra = 1; }
Child.prototype = Object.create(Shape.prototype);
Child.prototype.constructor = Child;
Child.prototype.run = function (n) { return 10 + Shape.prototype.run.call(this, n); };
class Base { constructor(step) { this.step = step; } run(n) { return this.step(n); } static make(step) { return new this(step); } get twice() { return n => this.step(this.step(n)); } set other(step) { this.step = step; } }
class Derived extends Base { constructor(step) { super(step); this.more = true; } run(n) { return 100 + super.run(n); } }
function mixin(target, source) { for (const name in source) target[name] = source[name]; return target; }
function pick(o, name) { return o[name]; }
function callAll() { let sum = 0; for (let i = 1; i < arguments.length; i++) sum += arguments[i](arguments[0]); return sum; }
function rest(n, ...steps) { return steps.map(step => step(n)).join(); }
export class JsPlugin { constructor(act) { this.act = act; this.name = "js"; } }
export function changePlugin(plugin, act) { plugin.act = act; }
export function untyped(steps) {
  const out = [];
  const shape = new Shape(steps.plusOne);
  out.push(shape.run(1));
  shape.step = steps.double;
  out.push(shape.run(2));
  out.push(new Child(steps.square).run(3));
  Shape.prototype.run = function (n) { return -1 * this.step(n); };
  out.push(shape.run(2), new Child(steps.square).run(3));
  out.push(new Base(steps.negate).run(4), new Derived(steps.negate).run(4), Derived.make(steps.half).run(4), Base.make(steps.half).twice(8));
  const based = new Base(steps.plusOne);
  based.other = steps.square;
  out.push(based.run(5));
  Base.prototype.run = function (n) { return 7000 + this.step(n); };
  out.push(based.run(5), new Derived(steps.plusOne).run(5));
  const mixed = mixin({ a: steps.plusOne }, { a: steps.double, b: steps.square });
  out.push(mixed.a(3), mixed.b(3), pick(mixed, "a")(4), pick(steps, "negate")(4));
  out.push(callAll(2, steps.plusOne, steps.double, steps.square), rest(3, steps.negate, steps.half));
  const holder = { step: steps.plusOne };
  const alias = holder;
  alias.step = steps.double;
  out.push(holder.step(8));
  const holders = [holder, { step: steps.square }];
  for (const each of holders) each.step = steps.negate;
  out.push(holder.step(8), holders[1].step(8));
  const swap = (a, b) => { const kept = a.step; a.step = b.step; b.step = kept; };
  const left = { step: steps.plusOne }, right = { step: steps.double };
  swap(left, right);
  out.push(left.step(9), right.step(9));
  const counterOf = step => { let calls = 0; return { step: n => (calls++, step(n)), calls: () => calls }; };
  const counted = counterOf(steps.half);
  out.push(counted.step(10), counted.calls());
  const withGetter = { get step() { return steps.square; } };
  out.push(withGetter.step(3));
  const chain = Object.create(Object.create({ step: steps.plusOne }));
  out.push(chain.step(1));
  Object.getPrototypeOf(Object.getPrototypeOf(chain)).step = steps.double;
  out.push(chain.step(1));
  const fromEntries = Object.fromEntries([["step", steps.negate]]);
  out.push(fromEntries.step(2), Object.values(fromEntries)[0](3), Object.entries(fromEntries)[0][1](4));
  const cloned = structuredClone({ n: 1 });
  cloned.step = steps.square;
  out.push(cloned.step(5));
  out.push(steps.run({ step: steps.square, label: "plain" }, 6));
  const runners = [steps.run, (holder, n) => holder.step(n) + 1];
  for (const runner of runners) out.push(runner({ step: steps.negate, label: "plain" }, 6));
  const typedHolder = steps.makeHolder(steps.half);
  out.push(typedHolder.step(6), steps.run(typedHolder, 6));
  typedHolder.step = steps.double;
  out.push(typedHolder.step(6), steps.run(typedHolder, 6));
  const either = [typedHolder, { step: steps.plusOne, label: "plain" }];
  for (const each of either) out.push(each.step(7), steps.run(each, 7));
  return out;
}
