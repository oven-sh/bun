// STATISTIC: MapEntryIndicesCached >= 18
// has(k), get(k) and set(k, v) under one key find it once: what runs between them may move, drop or replace the entry.
"use strict";
function counted(m, list) {
  for (const k of list) {
    if (m.has(k)) m.set(k, m.get(k) + 1);
    else m.set(k, 1);
  }
  return m;
}
function replaced(m, list, value) {
  for (const k of list) {
    if (m.has(k)) m.set(k, value);
  }
  return m;
}
function dropped(m, list) {
  let turns = 0;
  for (const k of list) {
    if (m.has(k)) m.set(k, (m.delete(k), turns++));
    else m.set(k, -turns);
  }
  return m;
}
function cleared(m, list) {
  for (const k of list) {
    if (m.has(k)) {
      const old = m.get(k);
      if (old > 2) m.clear();
      m.set(k, old * 2);
    } else m.set(k, 1.5);
  }
  return m;
}
function grown(m, list) {
  for (const k of list) {
    if (m.has(k)) {
      for (let i = 0; i < 20; i++) m.set("grown" + k + i, i);
      m.set(k, m.get(k) + 0.5);
    } else m.set(k, 2147483647);
  }
  return m;
}
const running = { valueOf() { running.map.delete(running.key); running.map.set("ran", 1); return 5; } };
function ran(m, list) {
  running.map = m;
  for (const k of list) {
    running.key = k;
    if (m.has(k)) m.set(k, m.get(k) + running);
    else m.set(k, 3);
  }
  return m;
}
function lost(m, list) {
  for (const k of list) {
    if (m.has(k)) {
      if (!m.get(k)) m.set(k, undefined);
      else m.set(k, null);
    } else m.set(k, 0);
  }
  return m;
}
function stored(m, list) {
  let sum = 0;
  for (const k of list) {
    if (m.has(k)) { const o = m.get(k); m.set(k, { n: o.n + 1 }); sum += m.get(k).n; }
    else m.set(k, { n: 1 });
  }
  return sum;
}
function both(a, b, list) {
  for (const k of list) {
    if (a.has(k)) { b.set(k, a.get(k)); a.set(k, (b.get(k) ?? 0) + 1); }
    else a.set(k, 7);
  }
  return a.size + b.size;
}
const show = m => [...m].map(([k, v]) => (typeof k === "symbol" ? "symbol" : typeof k === "object" && k ? "object" : Object.is(k, -0) ? "-0" : String(k)) + "=" + (Object.is(v, -0) ? "-0" : String(v))).join(" ");
const object = {}, other = () => 1;
const lists = [[1, 2, 1, 3, 1, 2], ["a", "b", "a", "c", "b", "a"], [NaN, 0, -0, NaN, 0], [object, other, object, null, undefined, null], [1.5, "1.5", 1.5, 2n, 2n, 1e300, 1e300], Array.from({ length: 60 }, (_, k) => (k * 37) % 23), [2147483647, -2147483648, 2147483647, 4294967296, 4294967296]];
for (const list of lists) {
  console.log(show(counted(new Map(), list)), "|", show(counted(new Map([[list[0], "t"], [list[1], 2147483647]]), list)));
  console.log(show(replaced(new Map([[list[0], 1], [list[2], 0.5]]), list, -0)), "|", show(replaced(counted(new Map(), list), list, object)));
  console.log(show(dropped(new Map(), list)), "|", show(cleared(new Map(), list)));
  console.log(grown(new Map(), list).size, show(ran(new Map(), list)), "|", show(lost(new Map(), list)));
  console.log(stored(new Map(), list), both(new Map(), new Map(), list));
}
// A subclass, and a map with a method of its own.
class Noting extends Map { set(k, v) { noted.push(k); return super.set(k, v); } has(k) { return k !== 2 && super.has(k); } }
const noted = [];
console.log(show(counted(new Noting(), [1, 2, 1, 2, 3])), noted.join());
const own = new Map([[1, 1]]);
own.set = function (k, v) { noted.push("own" + k + v); return Map.prototype.set.call(this, k, v + 1); };
console.log(show(counted(own, [1, 1, 2])), noted.join());
// An iteration sees the values that are stored while it runs.
const walked = counted(new Map(), [1, 2, 3]);
let seen = "";
for (const [k, v] of walked) {
  if (walked.has(k)) walked.set(k, walked.get(k) + 10);
  if (walked.has(k + 1)) walked.set(k + 1, walked.get(k + 1) * 2);
  seen += k + ":" + v + ":" + walked.get(k) + " ";
}
console.log(seen, show(walked));
