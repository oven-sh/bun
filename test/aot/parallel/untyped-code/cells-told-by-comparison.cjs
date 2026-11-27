// STATISTIC: CellsToldByComparison >= 1
// Values that hold no number are cells where they lie above undefined: null, undefined, both booleans and holes are told apart from objects, strings, symbols and BigInts.
"use strict";
class Link { constructor(value, next) { this.value = value; this.next = next; this.other = undefined; this.mark = null; } }
function build(n) {
  let list = null;
  for (let i = 0; i < n; i++) { const link = new Link("v" + i, list); if (i % 3 === 0) link.other = list; if (i % 4 === 1) link.other = null; list = link; }
  return list;
}
function walk(list) {
  let seen = 0, others = 0, nulls = 0, undefineds = 0;
  for (let link = list; link; link = link.next) {
    seen++;
    if (link.other) others += link.other.value.length;
    else if (link.other === null) nulls++;
    else undefineds++;
    if (link.other !== undefined && link.other !== null) others++;
    link.mark = link.next ?? link;
  }
  return [seen, others, nulls, undefineds, list.mark === list.next].join();
}
console.log(walk(build(10)), walk(build(101)));
function state(flag) { return flag === 0 ? null : flag === 1 ? undefined : flag === 2 ? true : flag === 3 ? false : new Link("s", null); }
function kinds(n) {
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const held = state(i % 5);
    if (held === null) counts[0]++;
    else if (held === undefined) counts[1]++;
    else if (held === true) counts[2]++;
    else if (held === false) counts[3]++;
    else if (held.value === "s") counts[4]++;
    if (!held === (typeof held === "object" && held !== null)) counts[4] += 1000;
  }
  return counts.join();
}
console.log(kinds(5), kinds(52));
const table = [];
for (let i = 0; i < 12; i++) if (i % 3) table[i] = new Link("t" + i, null);
let found = "";
for (let i = 0; i < 14; i++) { const held = table[i]; found += held ? held.value : held === undefined ? "-" : "?"; found += held?.next === null ? "n" : "."; }
console.log(found);
function texts(list) { let s = ""; for (const held of list) s += held == null ? "0" : held === true ? "T" : held === false ? "F" : typeof held === "string" ? held : typeof held; return s; }
console.log(texts([null, undefined, true, false, "", "x", Symbol.iterator, 1n, {}]));
