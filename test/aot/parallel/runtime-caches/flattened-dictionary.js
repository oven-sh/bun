// What the caches answer for a dictionary holds when it is flattened, whether the dictionary is the receiver or a prototype: nothing is filed under a structure whose offsets a flattening moves, which a validating run checks at every
// flattening. A dictionary, a flattened one and one that was flattened before are answered by the caches like any other object.
// Flags: --aot-heat=none --aot-validate
// Env: JSC_aotCountsPath=/dev/null
const counts = typeof aotRuntimeCounters === "function";   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function counter(name) { if (!counts) return 0; for (const line of aotRuntimeCounters().split("\n")) { const [count, counted] = line.split("\t"); if (counted === name) return Number(count); } throw new Error("no counter " + name); }
function expectBetween(what, value, low, high) { if (counts && !(value >= low && value <= high)) throw new Error(what + ": " + value + " is not in " + low + ".." + high); }
function calls(...names) { let sum = 0; if (counts) for (const name of names) sum += aotOperationCount("operationAOT" + name); return sum; }
function entries() { return calls("GetByIdAndCache", "PutByIdAndCache", "InByIdAndCache", "FillSiteCache", "GetByValGeneric", "InByValGeneric"); }
// Eight accesses a trip.
function say(what, o, n, most) {
  const before = entries();
  const result = use(o, n);
  expectBetween("entries, " + what, entries() - before, 0, most);
  console.log(what + ": " + result);
}

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
say("dictionary by size", big, trips, 16);
{
  console.log("keys: " + Object.keys(big).length);
}
say("flattened by Object.keys", big, trips, 4);

const holes = Object.create(null);
fill(holes, 0, 600);
drop(holes, 0, 580);
say("dictionary by deletion", holes, trips, 20);
fill(holes, 600, 620);
say("names added after flattening", holes, trips, 12);

const parent = Object.create(null);
fill(parent, 0, 600);
drop(parent, 0, 580);
const child = Object.create(parent);
say("dictionary as a prototype", child, trips, 12);
delete parent["k595"];
say("name deleted from the flattened prototype", child, trips, 4);

{
  const before = entries();
  const results = [];
  for (let i = 0; i < 200; i++) {
    holes["x" + i] = i;
    delete holes["x" + (i - 1)];
    results.push(use(holes, fewTrips));
  }
  expectBetween("entries in 3200 accesses to an object flattened before, between 200 additions and 200 deletions", entries() - before, 0, 70);
  console.log("flattened before: " + results.join(" "));
}
{
  const small = Object.create(null);
  for (const i of [590, 595, 599]) small["k" + i] = i;
  say("never a dictionary", small, trips, 10);
}
