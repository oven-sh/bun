// STATISTIC: ArrayLiteralsWithOwnStorage >= 10
// An array literal of constants shares its elements with every other array of the same literal until the first store. A literal that the program stores into has elements of its own from the start.
const show = v => (Array.isArray(v) ? "[" + Array.from(v, (e, i) => (i in v ? show(e) : "_")).join() + "]" : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v));
const line = (...all) => console.log(all.map(show).join(" "));

function add(a, b) {
  a[0] = (a[0] + b[0]) * 0.5;
  a[1] = (a[1] + b[1]) * 0.5;
  a[2] = (a[2] + b[2]) * 0.5;
}
function sums(n) {
  const a = [1.5, 2.5, 3.5], b = [0.5, 0.25, 0.125];
  for (let i = 0; i < n; i++) add(a, b);
  return [a, b];
}
line(sums(0), sums(1), sums(40), sums(0));

// The literal is evaluated anew: what an earlier array has stored is not in it.
function fresh() {
  return [1, 2.5, 3, 4.5];
}
function double(n) {
  const l = fresh();
  for (let i = 0; i < n; i++) l[i & 3] = l[i & 3] * 2;
  return l;
}
line(double(9), fresh(), double(1), fresh(), double(0));

// Two names of one array, read and stored into by turns.
function twoNames(n) {
  const l = [0.5, 1.5, 2.5, 3.5], other = n & 1 ? l : [9.5, 8.5, 7.5, 6.5];
  let s = other[0];
  for (let i = 0; i < n; i++) {
    l[i & 3] = l[i & 3] + other[(i + 1) & 3];
    s += other[i & 3];
  }
  return [l, other, s + other[0]];
}
line(twoNames(0), twoNames(1), twoNames(6), twoNames(7));

// Arrays in fields, variables, captured: one literal, several holders.
class Holder {
  list = [1.5, 2.5, 3.5];
  step(n) {
    for (let i = 0; i < n; i++) this.list[i % 3] = this.list[(i + 1) % 3] + 0.25;
    return this.list;
  }
}
const one = new Holder(), two = new Holder();
line(one.step(5), two.list, two.step(1), one.list, new Holder().list);
const table = [0.5, 0.25];
function grow(n) {
  for (let i = 0; i < n; i++) table[i & 1] = table[i & 1] + i;
  return table.slice();
}
line(grow(3), grow(0), table);
function captured() {
  const l = [1.5, 2.5];
  return { step: i => void (l[i & 1] = l[(i + 1) & 1] * 2), get: () => l };
}
const c = captured(), d = captured();
for (let i = 0; i < 5; i++) c.step(i);
line(c.get(), d.get());

// Kinds that do not stay: fractions into integers, strings into numbers, holes, NaN, -0, past the end.
function kinds(store, n) {
  const l = [1, 2, 3, 4];
  for (let i = 0; i < n; i++) l[i] = store(i, l[i & 3]);
  return l;
}
line(kinds(i => i * 0.5, 4), kinds((i, e) => e + "x", 3), kinds(() => NaN, 2), kinds(() => -0, 2), kinds(i => i, 7), kinds(() => undefined, 1), kinds((i, e) => e, 4));
function holes(n) {
  const l = [1.5, , 3.5];
  for (let i = 0; i < n; i++) l[i] = l[i] + 1;
  return l;
}
line(holes(0), holes(3), holes(0));
function frozen(n) {
  const l = n > 2 ? Object.freeze([1.5, 2.5, 3.5]) : [1.5, 2.5, 3.5];
  for (let i = 0; i < n; i++) l[i % 3] = 0.5;
  return l;
}
line(frozen(2), frozen(3), frozen(1));

// Nested loops, and loops that store in no iteration.
function nested(n) {
  const l = [0.5, 1.5, 2.5, 3.5];
  let s = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < 4; i++) l[i] = l[i] + j * 0.5;
    s += l[j & 3];
  }
  return [l, s];
}
line(nested(0), nested(1), nested(5));
function seldom(n) {
  const l = [0.5, 1.5, 2.5];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i === 7) l[i % 3] = 10.5;
    s += l[i % 3];
  }
  return [l, s];
}
line(seldom(3), seldom(9));

// Private and static fields, captured variables, records, a literal evaluated in each iteration.
class Private {
  #list = [1.5, 2.5, 3.5];
  step(n) {
    for (let i = 0; i < n; i++) this.#list[i % 3] = this.#list[(i + 1) % 3] * 2;
    return this.#list;
  }
}
const p = new Private(), q = new Private();
line(p.step(4), q.step(1), p.step(0), new Private().step(0));
class Static {
  static list = [1, 2, 3, 4];
  static step(n) {
    for (let i = 0; i < n; i++) Static.list[i & 3] = (Static.list[(i + 1) & 3] + i) | 0;
    return Static.list;
  }
}
line(Static.step(0).slice(), Static.step(5).slice(), Static.step(1));
const makeCounter = () => {
  const counts = [0, 1, 2, 3];
  return { add: i => ++counts[i & 3], all: () => counts };
};
const first = makeCounter(), second = makeCounter();
for (let i = 0; i < 9; i++) first.add(i);
line(first.all(), second.all(), makeCounter().all());
const record = () => ({ list: ["a", 1, null, true], n: 0 });
function storeInto(o, n) {
  for (let i = 0; i < n; i++) o.list[i & 3] = i;
  return o.list;
}
const r1 = record(), r2 = record();
line(storeInto(r1, 3), r2.list, storeInto(r2, 9), r1.list, record().list);
function eachIteration(n) {
  const all = [];
  for (let i = 0; i < n; i++) {
    const l = [1.5, 2, 3.5, 4];
    l[i & 3] = i;
    all.push(l);
  }
  return all;
}
line(...eachIteration(6));
function pushed(n) {
  const l = [1, 2, 3];
  for (let i = 0; i < n; i++) l.push(i * 0.5);
  return l;
}
line(pushed(0), pushed(3), pushed(0));
const long = { list: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] };
function storeLong(n) {
  for (let i = 0; i < n; i++) long.list[i] = long.list[i] * 0.5;
  return long.list;
}
line(storeLong(0).slice(), storeLong(5));
