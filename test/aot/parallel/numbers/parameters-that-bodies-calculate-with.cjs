// Nobody describes the parameters: the file exports its functions, and its objects escape. Bodies that only calculate with a parameter expect a number; other values run the slow version.
const show = v => console.log(typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : typeof v === "string" ? JSON.stringify(v) : String(v));
function newton(x) {
  x = x < 0 ? x * -1 : x;
  let g = x / 2 + 0.1;
  for (let i = 0; i < 6; i++) g = (g + x / g) / 2;
  return g;
}
function steps(x, y) {
  let s = 0;
  for (let i = 1; i < 7; i++) s = s + x / i - y * i;
  return s + x;
}
function remainder(n, m) {
  let c = 0;
  while (n > 1 && c < 9) {
    n = n % 2 === 0 ? n / 2 : n - m;
    c++;
  }
  return n + c;
}
function mixed(x) {
  for (let i = 0; i < 5; i++) x = x > 100 ? 0.5 : x - i > 3 ? x + 1 : x * 2;
  return x;
}
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.next = function (t) {
  for (let i = 0; i < 4; i++) t = t > 50 ? t - 49.5 : t * 1.5 + this.x;
  return t;
};
Point.prototype.sum = function (n) {
  let t = this.y;
  for (let i = 0; i < n; i++) t = this.next(t);
  return t;
};
const lib = { newton, steps, remainder, mixed };
module.exports = { lib, Point, newton, steps, remainder, mixed };

const numbers = JSON.parse("[0.5, 1, -2.25, 3, 7, 0, 1e21, 9007199254740992]").concat([-0, NaN, Infinity, 2147483648]);
const odd = { valueOf() { show("valueOf"); return 2.5; } };
const others = ["4", "x", undefined, null, true, 5n, odd, [3], Symbol.iterator];
function attempt(call) {
  try {
    show(call());
  } catch (e) {
    show(e.constructor.name);
  }
}
for (const pool of [numbers, others, numbers]) {
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i], b = pool[(i + 1) % pool.length];
    attempt(() => lib.newton(a));
    attempt(() => lib.steps(a, b));
    attempt(() => remainder(a, b));
    attempt(() => mixed(a));
    attempt(() => new Point(a, b).sum(3));
    attempt(() => new Point(1.5, a).next(b));
  }
}
let s = 0;
for (let i = 0; i < 200; i++) s += lib.newton(numbers[i & 3]) + lib.steps(i, numbers[i % 5]) + remainder(i, 1) + mixed(i * 0.5) + new Point(0.5, i).sum(2);
show(Math.round(s * 1e6));
