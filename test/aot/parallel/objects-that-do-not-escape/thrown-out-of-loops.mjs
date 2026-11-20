// An object that only one way out of a loop passes on is allocated on that way.
class Vector {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  scale(k) {
    return new Vector(this.x * k, this.y * k);
  }
  add(o) {
    return new Vector(this.x + o.x, this.y + o.y);
  }
}
const A = new Vector(1.5, 2.5);
const B = new Vector(0.25, -0.5);
const kept = [];

function thrown(limit) {
  let s = 0;
  for (let i = 0; i < 100; i++) {
    const p = A.scale(i);
    if (p.x > limit) throw p;
    s += p.x + p.y;
  }
  return s;
}
function returned(limit) {
  let s = 0;
  for (let i = 0; i < 100; i++) {
    const p = A.scale(i).add(B);
    if (p.y > limit) return p;
    s += p.x - p.y;
  }
  return new Vector(s, -s);
}
function broken(limit) {
  let p = A;
  let s = 0;
  for (let i = 0; i < 100; i++) {
    const q = B.scale(i);
    s += q.x;
    if (q.x > limit) {
      p = q;
      break;
    }
  }
  kept.push(p);
  return p === A ? "A" : p.x + ":" + p.y + ":" + s;
}
function nested(limit) {
  const found = [];
  outer: for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 20; j++) {
      const p = A.scale(i).add(B.scale(j));
      if (p.x > limit + i) {
        found.push(p);
        continue outer;
      }
      if (p.y < -limit) throw p;
    }
    found.push(null);
  }
  return found.map(p => (p ? p.x + "," + p.y : "-")).join(" ");
}
function caught(limit) {
  let s = 0;
  for (let k = 0; k < 4; k++) {
    try {
      for (let i = 0; i < 50; i++) {
        const p = A.scale(i + k);
        if (p.x > limit * k) throw p;
        s += p.y;
      }
    } catch (e) {
      s += e.x + (e instanceof Vector ? 1000 : 0) + (kept.includes(e) ? 5 : 0);
      kept.push(e);
      e.x = -1;
    }
  }
  return s;
}
function* yielded(limit) {
  for (let i = 0; i < 30; i++) {
    const p = B.scale(i);
    if (p.x > limit) yield p;
  }
}
for (const limit of [1e6, 20, 3, -1]) {
  for (const f of [thrown, returned, broken, nested, caught]) {
    try {
      const result = f(limit);
      console.log(f.name, limit, result instanceof Vector ? result.x + "/" + result.y : result);
    } catch (e) {
      console.log(f.name, limit, "threw", e.x, e.y, e.constructor === Vector, Object.keys(e).join());
      e.z = 1;
      kept.push(e);
    }
  }
  console.log(Array.from(yielded(limit), p => p.x).join());
}
console.log(kept.length, new Set(kept).size, kept.map(p => JSON.stringify(p)).join(""));
