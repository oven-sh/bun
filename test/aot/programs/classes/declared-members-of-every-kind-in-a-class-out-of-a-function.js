// With declared functions: Members of every kind in the class that is returned; the arguments of the call and `this` are captured by them.
const lines = [];
class Base { constructor(x) { this.x = x; } value() { return this.x; } static from(x) { return new this(x); } static base = "B"; get twice() { return this.x * 2; } set twice(v) { this.x = v / 2; } }
class Other { constructor(x) { this.x = -x; } value() { return this.x; } static from(x) { return new this(x + 1); } static base = "O"; get twice() { return this.x * 3; } set twice(v) { this.x = v / 3; } }
function Full(Parent, step, options = { scale: step * 2 }) { return class Full extends Parent {
  scaled = this.x * options.scale; arrow = () => this.x + step; static steps = [step]; static make = (x) => new Full(x);
  constructor(x = step) { super(x); this.after = super.value() + step; }
  value() { return super.value() + step; }
  *walk() { for (let i = 0; i < step; i++) yield super.value() + i; }
  async later() { await null; return super.value() * step; }
  async *stream() { yield step; yield await this.later(); }
  get twice() { return super.twice + step; } set twice(v) { super.twice = v - step; }
  static from(x) { const made = super.from(x); made.via = "full" + step + super.base; return made; }
  static get base() { return "F" + super.base; }
  inner() { const read = () => super.value(); const args = (function () { return arguments.length; })(1, 2, step); return read() + args; }
  withDefault(a = this.x, b = () => a + step) { return b(); }
  toString() { return `Full(${this.x},${step})`; }
  static [Symbol.for("registered")]() { return step; }
  "quoted name"() { return "q" + step; } 42() { return 42 + step; }
}; }
const F1 = Full(Base, 1), F2 = Full(Other, 2), F3 = Full(Base, 3, { scale: 10 }); class G extends Full(F1, 4) { value() { return super.value() * 100; } }
const out = [];
for (const C of [F1, F2, F3, G]) { const o = new C(5), d = new C(); o.twice = 20;
  out.push([o.value(), d.value(), o.scaled, o.arrow(), o.after, [...o.walk()].join("+"), o.twice, o.x, C.from(7).via, C.from(7).x, C.base, o.inner(), o.withDefault(), o.withDefault(1), String(o), C.steps.join(), C.make(2).constructor === C, C.make(2).value(), C[Symbol.for("registered")](), o["quoted name"](), o[42](), Object.keys(o).join("/")].join(" ")); }
lines.push(...out);
let sum = 0; for (let i = 0; i < 3000; i++) { const a = new F1(i), b = new F2(i), c = new F3(i), g = new G(i); sum += a.value() + b.value() + c.value() + g.value() + a.arrow() + b.scaled + c.scaled + g.after + a.twice + b.twice + g.inner(); } lines.push(String(sum));
Promise.all([F1, F2, F3, G].map(async (C) => { const o = new C(3); const seen = []; for await (const v of o.stream()) seen.push(v); return (await o.later()) + ":" + seen.join(); })).then((r) => { lines.push(r.join(" ")); console.log(lines.join("\n")); });
