// Objects whose structures do not fit in a full lookup table are still read and written correctly, and a full collection makes room for new structures.
// COUNTER: LookupTableIsFull >= 1
// COUNTER: LookupTableIsFull <= 30000
const counts = typeof aotRuntimeCounters === "function";   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function counter(name) { if (!counts) return 0; for (const line of aotRuntimeCounters().split("\n")) { const [count, counted] = line.split("\t"); if (counted === name) return Number(count); } throw new Error("no counter " + name); }
function calls(...names) { let sum = 0; if (counts) for (const name of names) sum += aotOperationCount("operationAOT" + name); return sum; }
function expectBetween(what, value, low, high) { if (counts && !(value >= low && value <= high)) throw new Error(what + ": " + value + " is not in " + low + ".." + high); }
function byName() { return calls("GetByIdAndCache", "PutByIdAndCache", "FillSiteCache"); }

const [manyStructures, fewStructures, trips] = JSON.parse("[1000, 16, 50000]");

function make(prefix, count) {
  const objects = [];
  for (let i = 0; i < count; i++) {
    const o = Object.create(null);
    o[prefix + i] = i;
    o.shared = i;
    objects.push(o);
  }
  return objects;
}
function fill() {
  const objects = make("u", manyStructures);
  let sum = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < objects.length; i++) sum += objects[i].shared;
  }
  return sum;
}
function readInTurn(objects, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += objects[i % objects.length].shared;
  return sum;
}

console.log("more structures than fit in the table: " + fill());
expectBetween("the table was full", counter("LookupTableIsFull"), 1, 30000);

fullGC();
{
  const full = counter("LookupTableIsFull");
  const before = byName();
  const sum = readInTurn(make("v", fewStructures), trips);
  expectBetween("entries after the collection", byName() - before, 0, 400);
  expectBetween("after the collection", counter("LookupTableIsFull") - full, 0, 0);
  console.log("new structures after a full collection: " + sum);
}
