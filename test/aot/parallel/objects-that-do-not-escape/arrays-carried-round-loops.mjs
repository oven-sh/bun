// A loop carries a short array that nothing else names by its elements.
const kept = [];
const numbers = [];
for (let i = 0; i < 20; i++) numbers.push((i * 37) % 11);

function pairs(n) {
  let m = [0, 1, 2];
  for (let i = 0; i < n; i++) m = [m[1], m[2], (m[0] + i) & 255];
  return m[0] + m[1] * 2 + m[2] * 3;
}
function matrices(n) {
  let m = [1, 0, 0, 1];
  const r = [0.8, -0.6, 0.6, 0.8];
  for (let i = 0; i < n; i++) m = [m[0] * r[0] + m[1] * r[2], m[0] * r[1] + m[1] * r[3], m[2] * r[0] + m[3] * r[2], m[2] * r[1] + m[3] * r[3]];
  return m.map(v => Math.round(v * 1e6)).join();
}
function overList(list) {
  let s = [0, 1];
  for (let i = 0; i < list.length; i++) s = [s[1], s[0] + s[1] + list[i]];
  return s[0] + ":" + s[1];
}
function leaves(n, limit) {
  let m = [1, 2];
  for (let i = 0; i < n; i++) {
    if (m[0] > limit) {
      kept.push(m);
      return m;
    }
    m = [m[1], m[0] + m[1]];
  }
  return m;
}
function sometimes(n) {
  let m = [5, -1];
  for (let i = 0; i < n; i++) if (i % 3 === 1) m = [m[1], i];
  kept.push(m);
  return m.length + m[0] * m[1];
}
function written(n) {
  let m = [0, 0];
  for (let i = 0; i < n; i++) {
    m[i & 1] += i;
    if (i === 4) m = [m[1], m[0]];
  }
  return m.join();
}
function grows(n) {
  let m = [1];
  for (let i = 0; i < n; i++) {
    m = [m[0] + 1];
    if (i === 3) m.push(i);
  }
  return m.length;
}
function aliased(n) {
  let m = [1, 2], first = null;
  for (let i = 0; i < n; i++) {
    if (i === 2) first = m;
    m = [m[1], m[0] + 1];
    if (first) first[0] = 100;
  }
  return [m, first].join(";");
}
function kinds(n) {
  let m = ["a", true, 0.5, null];
  for (let i = 0; i < n; i++) m = [m[0] + i, !m[1], i === 5 ? "half" : m[2], m[3]];
  return m.map(v => typeof v + String(v)).join();
}
function holes(n) {
  let m = [1, , 3];
  for (let i = 0; i < n; i++) m = [m[2], , m[0]];
  return m.length + ":" + (1 in m) + m[0];
}
function frozen(n) {
  let m = [1, 2];
  let failures = 0;
  for (let i = 0; i < n; i++) {
    m = [m[1], i];
    if (i === 3) Object.freeze(m);
    try {
      m[0] = -i;
    } catch {
      failures++;
    }
  }
  return m.join() + failures;
}
function thrown(n) {
  let m = [0, 0];
  try {
    for (let i = 0; i < n; i++) {
      m = [m[1], i];
      if (i === 6) throw m;
    }
  } catch (caught) {
    return (caught === m) + caught.join();
  }
  return "no";
}
function* yielded(n) {
  let m = [1, 1];
  for (let i = 0; i < n; i++) {
    yield m[0];
    m = [m[1], m[0] + m[1]];
  }
  return m;
}
function nested(n) {
  let m = [0, 1];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) m = [m[1], (m[0] + j) & 63];
    m = [m[0] + 1, m[1]];
  }
  return m.join();
}

class Sum {
  constructor(min, max) {
    this.min = min;
    this.max = max;
  }
}
// The call alone takes the accumulator that it is given.
const range = list => list.reduce(([min, max], v) => [Math.min(min, v), Math.max(max, v)], [1000, -1000]);
const ranges = list => list.reduce((a, v) => ({ min: Math.min(a.min, v), max: Math.max(a.max, v), n: a.n + 1 }), { min: 1000, max: -1000, n: 0 });
const sums = list => list.reduce((a, v) => new Sum(a.min - v, a.max + v), new Sum(0, 0));
const counted = list => list.reduce((a, v) => { a.n++; a.s += v; return a; }, { n: 0, s: 0 });
const named = list => {
  const start = { n: 1, s: 2 };
  const end = list.reduce((a, v) => { a.s += v; return a; }, start);
  return [end === start, start.s, end.n];
};
const keeps = list => list.reduce((a, v) => { if (v === 4) kept.push(a); return { n: a.n + 1, s: a.s + v }; }, { n: 0, s: 0 });
const stops = list => {
  try {
    return list.reduce((a, v) => { if (v === 3) throw a; return [a[0] + v, v]; }, [0, 0]);
  } catch (caught) {
    return caught;
  }
};

for (let round = 0; round < 2; round++) {
  console.log(pairs(9), pairs(0), matrices(7), overList(numbers), overList([1, 2.5, 3]), overList(["x", 2]), overList([2 ** 31, 1]), overList([]));
  console.log(leaves(20, 50).join(), leaves(3, 50).join(), leaves(5, -1).join(), sometimes(9), sometimes(1), written(9), grows(6), aliased(6), kinds(8), holes(3), frozen(6), thrown(9));
  console.log([...yielded(8)].join(), nested(6));
  for (const list of [numbers, [], [3.5, -0], [1, "2", 3], [1, , 3], [NaN, 4]]) console.log(range(list).join(), JSON.stringify(ranges(list)), JSON.stringify(sums(list)), JSON.stringify(counted(list)), named(list).join(), JSON.stringify(keeps(list)), JSON.stringify(stops(list)));
}
console.log(kept.length, new Set(kept).size, JSON.stringify(kept));
