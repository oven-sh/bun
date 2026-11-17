// A function whose every return passes an object that it has allocated returns the fields, and a caller allocates the object where it needs one.
// STATISTIC: ScalarizedCalls >= 4
class Hit {
  found = false;
  at = 0;
  name: string | null = null;
  list: number[] | null = null;
  constructor(at: number) {
    this.at = at;
  }
  far() {
    return this.at > 5;
  }
}
const xs = [3, 1.5, -0, 9, 2 ** 31, 7];

function nearest(k: number): Hit {
  let best = new Hit(100);
  for (let i = 0; i < xs.length; i++) {
    const hit = new Hit(Math.abs(xs[i]! - k));
    hit.found = hit.at < 4;
    hit.name = hit.found ? "x" + i : null;
    if (hit.found && hit.at < best.at) best = hit;
  }
  best.list = best.found ? xs : null;
  return best;
}
function range(list: number[]) {
  let min = Infinity;
  let max = -Infinity;
  for (const x of list) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return { min, max, of: list };
}
function sum(k: number): { total: number; depth: number } {
  if (k <= 0) return { total: -0, depth: 0 };
  const rest = sum(k - 1);
  rest.total += k;
  rest.depth++;
  return rest;
}
function thrower(k: number) {
  const made = { first: k, second: String(k) };
  for (let i = 0; i < k; i++) if (i === 3) throw made.second;
  return made;
}
const kept = new WeakMap<object, number>();
function rows(k: number) {
  const a = nearest(k);
  const b = nearest(k);
  kept.set(a, k);
  const r = range(xs);
  r.min = k;
  const other = range(a.list ?? [k]);
  const { total, depth } = sum(k);
  let text = "";
  try {
    text = thrower(k).second;
  } catch (e) {
    text = "thrown " + e;
  }
  Object.freeze(b);
  return [a.found, a.at, a.name, a.far(), a === b, kept.get(a), kept.has(b), Object.isFrozen(b), Object.keys(a).join(), JSON.stringify(b), a instanceof Hit, Object.keys(r).join(), r.min, r.max, r.of === xs, other.max, Object.is(total, -0), total, depth, text].join(" ");
}
for (let k = 0; k < 9; k++) console.log(rows(k));
function last(k: number): Hit {
  const hit = new Hit(k);
  for (const x of xs) hit.at += x;
  return hit;
}
const byValue: ((k: number) => Hit)[] = [last];
for (const f of byValue) console.log(JSON.stringify(f(3)), last(4).at);
console.log([1, 8].map(last).map(hit => hit.at).join());
