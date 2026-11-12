// A loop carries an object that it replaces, changes, joins, hands on, leaves with and compares.
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  add(o) {
    return new Point(this.x + o.x, this.y + o.y);
  }
  scale(f) {
    return new Point(this.x * f, this.y * f);
  }
  clamp() {
    this.x = this.x > 100 ? 100 : this.x;
    this.y = this.y < -100 ? -100 : this.y;
    return this;
  }
}
const ONE = new Point(1, -1);
const seen = [];
let calls = 0;
function touch(i) {
  calls += i;
  return globalThis.asText ? String(i) : i;
}
function replaced(n) {
  let p = new Point(0, 0.5);
  for (let i = 0; i < n; i++) {
    touch(i);
    p = p.add(ONE).scale(i % 3 === 0 ? 2 : 1);
  }
  return p.clamp();
}
function onSomeWays(n) {
  let p = ONE.scale(1);
  for (let i = 0; i < n; i++) {
    if (i & 1) p = p.add(ONE);
    touch(1);
    if (p.x > 4) p = p.scale(0.5).clamp();
    else if (i === 5) p.y += 10;
  }
  return p;
}
function changed(n) {
  let p = new Point(n, n);
  for (let i = 0; i < n; i++) {
    p.x += touch(i);
    if (i % 4 === 2) p = new Point(p.y, p.x);
    p.y -= 1;
  }
  return [p.x, p.y, p];
}
function namedBefore(n) {
  const first = new Point(5, 6);
  let p = first;
  for (let i = 0; i < n; i++) {
    touch(i);
    if (i > 1) p = p.add(ONE);
    p.x += 1;
  }
  return [first === p, first.x, p.x];
}
function kept(n) {
  let p = new Point(0, 0),
    old = null;
  for (let i = 0; i < n; i++) {
    if (i === 2) old = p;
    if (i === 4) seen.push(p);
    p.x += 1;
    if (i !== 3) p = p.add(ONE);
    touch(i);
  }
  return [old && old.x, old === p, seen.map(s => s.x).join(), seen.includes(p), p.x];
}
function swapped(n) {
  let p = new Point(1, 2),
    q = new Point(3, 4);
  for (let i = 0; i < n; i++) {
    touch(i);
    const t = p;
    p = q;
    q = t;
    if (i === 3) q = p;
    q.x += 1;
  }
  return [p === q, p.x, q.x];
}
function leaves(n) {
  let best = new Point(Infinity, 0);
  for (let i = 0; i < n; i++) {
    const found = new Point(Math.abs(i - 4), i);
    touch(i);
    if (found.x < best.x) best = found;
    if (i === 6) return best;
    if (best.x < 0) break;
  }
  best.y = -best.y;
  return best;
}
function caught(n) {
  let p = new Point(0, 0);
  try {
    for (let i = 0; i < n; i++) {
      p = p.add(ONE);
      if (touch(i) === 5) throw new Error("at " + i);
      p.y = i;
    }
  } catch (problem) {
    return [problem.message, p.x, p.y];
  }
  return [p.x, p.y];
}
function nested(n) {
  let p = new Point(0, 0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      touch(j);
      p = p.add(ONE);
      if (j === i) p.x *= 2;
    }
    p.y = p.x;
  }
  return p;
}
function captured(n) {
  let p = new Point(0, 0);
  const late = [];
  for (let i = 0; i < n; i++) {
    const own = p;
    late.push(() => own.x);
    p = p.add(ONE);
    touch(i);
    p.x += 1;
  }
  return late.map(f => f()).join() + p.x;
}
const show = value => JSON.stringify(value, (key, held) => (typeof held === "number" && !Number.isFinite(held) ? String(held) : held));
for (const run of [replaced, onSomeWays, changed, namedBefore, kept, swapped, leaves, caught, nested, captured]) {
  for (const n of [0, 1, 4, 9, 30]) console.log(run.name, n, show(run(n)));
}
console.log(calls, show(ONE), seen.length);
