// `x | 0`, a small constant and `+flag` are integers that fit int32, wherever they are kept. What is computed from them is not: each result goes into a parameter of its own, and the code there leans on its type.
const report = value =>
  console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value));
function toldSum(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldScaled(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldShifted(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldTally(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldCounted(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldWrapped(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldDepth(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldClimbed(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldTotal(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldFlag(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldBoth(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
class Point {
  constructor(x, y) {
    this.x = x | 0;
    this.y = y | 0;
  }
  sum() {
    toldSum(this.x + this.y);
  }
  scale(by) {
    this.x = this.x * by;
    toldScaled(this.x);
    return this;
  }
  shift() {
    this.y = this.y << 1;
    toldShifted(this.y);
    return this;
  }
}
class Tally {
  constructor() {
    this.n = 0;
  }
  up() {
    this.n++;
    toldTally(this.n);
  }
  by(step) {
    this.n += step;
    toldTally(this.n);
  }
}
function counter(start) {
  let n = start | 0;
  return {
    up() {
      n = n + 1;
      toldCounted(n);
    },
    wrap() {
      n = (n + 1) | 0;
      toldWrapped(n);
    },
  };
}
function depth(n) {
  return n <= 0 ? 0 : (depth((n - 1) | 0) + 1) | 0;
}
function climb(n, limit) {
  if (n >= limit) toldClimbed(n);
  else climb(n + n, limit);
}
function fill(length, from) {
  const list = [];
  for (let i = 0; i < length; i++) list[i] = (from + i) | 0;
  return list;
}
function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  toldTotal(sum);
}
function flag(b) {
  const n = +b;
  toldFlag(n);
  return n;
}
function pick(list, b) {
  return list[flag(b)];
}
function both(o) {
  toldBoth(o.low + o.high);
}
const point = new Point(2147483647, 1);
point.sum();
point.scale(2);
point.scale(0.5);
point.shift();
new Point(1.9, -1.9).sum();
new Point("7", null).sum();
new Point(4294967296, 2147483648).sum();
new Point(1073741824, 1073741824).shift();
const tally = new Tally();
tally.up();
tally.by(2147483646);
tally.up();
tally.by(0.5);
tally.by("!");
const count = counter(2147483646);
count.up();
count.up();
const wrapped = counter(2147483646);
wrapped.wrap();
wrapped.wrap();
toldDepth(depth(100));
climb(1, 3000000000);
climb(1, 1e17);
total(fill(3, 2147483646));
total(fill(4, 1073741823));
report(fill(3, 2147483646).join());
report(pick(["no", "yes"], true));
report(pick(["no", "yes"], false));
report(pick(["no", "yes"], "2.5"));
both({ low: 1, high: 2147483647 });
both({ low: -2147483648, high: -2147483648 });
both({ low: 1, high: "2" });
both({ low: 1 });
report("end");
