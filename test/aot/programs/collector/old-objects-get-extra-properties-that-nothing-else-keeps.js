// An object that has lived through a collection gets properties that its layout does not have, under keys and names that come again and again, so that the stubs add them.
// What is stored is young and nothing else keeps it: a young collection finds it only if the old object, and the old cell of its extra properties, are remembered.
import { edenGC, fullGC } from "bun:jsc";

const shelf = globalThis;
const shelfKey = process.env.SHELF || "shelf";
function hide(x) { shelf[shelfKey] = x; return shelf[shelfKey]; }

class Plain { constructor(a) { this.a = a; } }
class Wide { constructor(a) { this.a = a; this.b = a + 1; this.c = "c" + a; } }
function make(i) { return i & 1 ? new Wide(i) : new Plain(i); }

function addUnderKey(o, k, v) { o[k] = v; }
function addFirstName(o, v) { o.firstLate = v; }
function addSecondName(o, v) { o.secondLate = v; }
function valueFor(k, i) { return k % 3 === 0 ? { k, i } : k % 3 === 1 ? "v" + k + "-" + i : [k, i]; }
function isValueFor(v, k, i) { return k % 3 === 0 ? v.k === k && v.i === i : k % 3 === 1 ? v === "v" + k + "-" + i : v.length === 2 && v[0] === k && v[1] === i; }
// Takes the room of whatever the collection has let go.
let sink = 0;
function fill(n) {
  for (let i = 0; i < n; i++) sink += [i, "g" + i, { i, j: i, k: i }, { a: i }, [i, i, i, i]].length;
}

const count = 1024;
const batch = 64;
const keys = [];
for (let k = 0; k < 12; k++) keys.push((process.env.PREFIX || "key") + k);

const byKey = [];
const byName = [];
for (let i = 0; i < count; i++) {
  byKey.push(make(i));
  byName.push(hide(make(i)));
}
fullGC();
fullGC();

let wrong = 0;
// One key after the other: the cell of the extra properties is made for an old object, grows old itself, takes more, and gets storage outside that grows.
for (let k = 0; k < keys.length; k++) {
  for (let first = 0; first < count; first += batch) {
    for (let i = first; i < first + batch; i++) addUnderKey(byKey[i], keys[k], valueFor(k, i));
    edenGC();
    fill(200);
    for (let i = first; i < first + batch; i++) if (!isValueFor(byKey[i][keys[k]], k, i)) wrong++;
  }
  if (k % 2 === 1) fullGC();
}
for (let first = 0; first < count; first += batch) {
  for (let i = first; i < first + batch; i++) addFirstName(byName[i], valueFor(0, i));
  edenGC();
  fill(200);
  for (let i = first; i < first + batch; i++) if (!isValueFor(byName[i].firstLate, 0, i)) wrong++;
}
fullGC();
for (let first = 0; first < count; first += batch) {
  for (let i = first; i < first + batch; i++) addSecondName(byName[i], valueFor(1, i));
  edenGC();
  fill(200);
  for (let i = first; i < first + batch; i++) if (!isValueFor(byName[i].secondLate, 1, i)) wrong++;
}
fullGC();
for (let i = 0; i < count; i++) {
  for (let k = 0; k < keys.length; k++) if (!isValueFor(byKey[i][keys[k]], k, i)) wrong++;
  if (byKey[i].a !== i || byName[i].a !== i || !isValueFor(byName[i].firstLate, 0, i) || !isValueFor(byName[i].secondLate, 1, i)) wrong++;
}
console.log("wrong:", wrong, Object.keys(byKey[0]).join(), Object.keys(byKey[1]).join(), Object.keys(byName[1]).join());
