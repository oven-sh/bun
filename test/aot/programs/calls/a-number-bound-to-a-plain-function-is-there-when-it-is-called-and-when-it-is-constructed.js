// A plain function can be constructed, so what `bind` makes of it can be too. The arguments that are bound here are numbers and booleans, which every caller passes as such.
const lines = [];
const say = (...parts) => lines.push(parts.map(part => (Object.is(part, -0) ? "-0" : String(part))).join(" "));

function multiply(a, b) {
  if (new.target) {
    this.product = a * b;
    this.target = new.target === multiply;
    return;
  }
  return a * b;
}
const triple = multiply.bind(null, 3);
let sum = 0;
for (let i = 0; i < 1000; i++) sum += triple(i & 255);
say("called", sum, triple.name, triple.length, typeof triple.prototype);
const made = new triple(5);
say("constructed", made.product, made.target, made instanceof multiply, made instanceof triple, Object.getPrototypeOf(made) === multiply.prototype);
say("by Reflect", Reflect.construct(triple, [6]).product, Reflect.construct(triple, [7], Array) instanceof Array);

const half = multiply.bind(null, 0.5);
say("a fraction", half(3), new half(4).product);
const nothing = multiply.bind(null, NaN);
say("no number", nothing(3), new nothing(4).product);
const negative = multiply.bind(null, -0);
say("minus zero", negative(3), new negative(4).product);
const large = multiply.bind(null, 2 ** 40);
say("past 32 bits", large(3), new large(4).product);
const both = multiply.bind(null, 6, 7);
say("both", both(), both(100), new both().product, both.length);
const more = multiply.bind(null, 6, 7, 8);
say("one too many", more(), new more().product, more.length);
const again = triple.bind(null, 4);
say("bound twice", again(), new again().product, again.name, again.length);

function choose(flag, a, b) {
  if (new.target) this.chosen = flag ? a : b;
  return flag ? a : b;
}
const first = choose.bind(null, true);
const second = choose.bind(null, false);
let chosen = 0;
for (let i = 0; i < 1000; i++) chosen += first(i, 1) + second(1, i);
say("a boolean", chosen, new first(1, 2).chosen, new second(1, 2).chosen);

function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.norm = function () {
  return this.x * this.x + this.y * this.y;
};
const OnTheLine = Point.bind(null, 3);
let norms = 0;
for (let i = 0; i < 1000; i++) norms += new OnTheLine(i & 7).norm();
say("a constructor function", norms, new OnTheLine(4) instanceof Point, Object.keys(new OnTheLine(4)).join());
try {
  class Below extends OnTheLine {}
  say("a class below it", new Below().x);
} catch (error) {
  say("a class below it", error.constructor.name);
}

console.log(lines.join("\n"));
