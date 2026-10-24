// Flattening a dictionary invalidates the answers cached under its structure, whether the dictionary is the receiver or a prototype, and no object is flattened twice.
// COUNTER: SiteCachesClearedByFlattening >= 1
// COUNTER: SiteCachesClearedByFlattening <= 40
const counts = typeof aotRuntimeCounters === "function";   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function counter(name) { if (!counts) return 0; for (const line of aotRuntimeCounters().split("\n")) { const [count, counted] = line.split("\t"); if (counted === name) return Number(count); } throw new Error("no counter " + name); }
function expectBetween(what, value, low, high) { if (counts && !(value >= low && value <= high)) throw new Error(what + ": " + value + " is not in " + low + ".." + high); }
function cleared() { return counter("SiteCachesClearedByFlattening"); }

const names = JSON.parse('["k595","k590"]');
const [trips, fewTrips] = JSON.parse("[50, 2]");

function fill(o, from, to) {
  for (let i = from; i < to; i++) o["k" + i] = i;
}
function drop(o, from, to) {
  for (let i = from; i < to; i++) delete o["k" + i];
}
function use(o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (o.k590 ?? -1) + (o.k595 ?? -1) + (o.k599 ?? -1);
    o.k599 = (o.k599 ?? -1) + 1;
    sum += ("k595" in o ? 1000 : 0) + (names[0] in o ? 2000 : 0);
    sum += o[names[1]] ?? -1;
  }
  return sum;
}

const big = Object.create(null);
fill(big, 0, 600);
console.log("dictionary by size: " + use(big, trips));
{
  const before = cleared();
  const keyCount = Object.keys(big).length;
  expectBetween("sites cleared", cleared() - before, 1, 10);
  console.log("keys: " + keyCount);
}
console.log("flattened by Object.keys: " + use(big, trips));

const holes = Object.create(null);
fill(holes, 0, 600);
drop(holes, 0, 580);
console.log("dictionary by deletion: " + use(holes, trips));
fill(holes, 600, 620);
console.log("names added after flattening: " + use(holes, trips));

const parent = Object.create(null);
fill(parent, 0, 600);
drop(parent, 0, 580);
const child = Object.create(parent);
console.log("dictionary as a prototype: " + use(child, trips));
delete parent["k595"];
console.log("name deleted from the flattened prototype: " + use(child, trips));

{
  const before = cleared();
  const results = [];
  for (let i = 0; i < 200; i++) {
    holes["x" + i] = i;
    delete holes["x" + (i - 1)];
    results.push(use(holes, fewTrips));
  }
  expectBetween("sites cleared for an object flattened before", cleared() - before, 0, 0);
  console.log("flattened before: " + results.join(" "));
}
{
  const small = Object.create(null);
  for (const i of [590, 595, 599]) small["k" + i] = i;
  const before = cleared();
  const result = use(small, trips);
  expectBetween("sites cleared for an object that was never a dictionary", cleared() - before, 0, 0);
  console.log("never a dictionary: " + result);
}
