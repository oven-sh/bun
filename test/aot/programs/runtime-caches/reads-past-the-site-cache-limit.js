// Past the limit on site caches a read by name calls a stub that takes the receiver in the register it is already in, and the receiver has to outlive the call for the next read.
function two(o) { return o.first === o.second; }
function three(o) { return [o.first, o.second, o.third]; }
function sum(o) { return o.first + o.second + o.third + o.first + o.second + o.third; }
function twoReceivers(a, b) { return [a.first, b.first, a.second, b.second, a.third, b.third]; }
function manyReceivers(a, b, c, d, e, f) { return [a.first, b.first, c.first, d.first, e.first, f.first, a.second, b.second, c.second, d.second, e.second, f.second]; }
function inLoop(o, n) { let s = 0; for (let i = 0; i < n; i++) s += o.first + o.second; return s; }
function nested(o) { return o.inner.first + o.inner.second + o.first; }

class Point { constructor(x) { this.first = x; this.second = x; this.third = x + 1; } }
class WithAccessors { #x; constructor(x) { this.#x = x; } get first() { return this.#x; } get second() { return this.#x; } get third() { return this.#x + 1; } }
function outOfLine(x) { const o = {}; for (let i = 0; i < 40; i++) o["own" + i] = i; o.first = x; o.second = x; o.third = x + 1; return o; }
function dictionary(x) { const o = outOfLine(x); for (let i = 0; i < 40; i += 2) delete o["own" + i]; return o; }
function inherited(x) { return Object.create({ first: x, second: x, third: x + 1 }); }
function partlyInherited(x) { const o = Object.create({ second: x }); o.first = x; o.third = x + 1; return o; }
Number.prototype.first = 1; Number.prototype.second = 1; Number.prototype.third = 2;
String.prototype.third = 3;

const receivers = [
  x => ({ first: x, second: x, third: x + 1 }), x => ({ third: x + 1, second: x, first: x }), x => new Point(x), x => new WithAccessors(x), outOfLine, dictionary, inherited, partlyInherited,
  x => x, x => "text" + x, x => [x], x => ({}), x => Object.assign(() => x, { first: x, second: x, third: x + 1 }), x => new Proxy({ first: x, second: x, third: x + 1 }, {}),
];
const show = v => JSON.stringify(v, (k, w) => (w === undefined ? "undefined" : w));
for (let round = 0; round < 3; round++) {
  const lines = [];
  receivers.forEach((make, i) => {
    const o = make(i + round);
    lines.push([two(o), three(o), sum(o), inLoop(o, 100), nested({ inner: o, first: round })].map(show).join(" "));
    receivers.forEach((other, j) => lines.push(show(twoReceivers(o, other(j)))));
  });
  lines.push(show(manyReceivers(...receivers.slice(round, round + 6).map((make, i) => make(i)))));
  if (!round) console.log(lines.join("\n"));
  else console.log(lines.length);
}
