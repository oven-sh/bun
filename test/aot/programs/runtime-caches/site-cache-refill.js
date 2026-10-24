// An empty site cache fills at its first lookup-table hit, a site cache that keeps seeing other structures is refilled less and less often, and an accessor never enters one.
// COUNTER: SiteCacheRefill >= 100
// COUNTER: SiteCacheRefill <= 5100
const counts = typeof aotRuntimeCounters === "function";   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function counter(name) { if (!counts) return 0; for (const line of aotRuntimeCounters().split("\n")) { const [count, counted] = line.split("\t"); if (counted === name) return Number(count); } throw new Error("no counter " + name); }
function calls(...names) { let sum = 0; if (counts) for (const name of names) sum += aotOperationCount("operationAOT" + name); return sum; }
function expectBetween(label, value, low, high) { if (counts && !(value >= low && value <= high)) throw new Error(label + ": " + value + " is not in " + low + ".." + high); }
function byName() { return calls("GetByIdAndCache", "PutByIdAndCache", "FillSiteCache"); }
function fills() { return calls("FillSiteCache"); }
function refills() { return counter("SiteCacheRefill"); }

const key = JSON.parse('"shared"');
const [tripsA, tripsB, tripsC, tripsD, tripsE] = JSON.parse("[100000, 1000, 1000000, 10000, 2]");
const readFortyTrips = JSON.parse("[1, 9]");

function shape(k) {
  const o = Object.create(null);
  for (let i = 0; i < k; i++) o["own" + i] = i;
  o[key] = k;
  return o;
}
function readA(a, b, n) { let s = 0; for (let i = 0; i < n; i++) s += (i & 1 ? b : a).shared; return s; }
function readB(a, b, n) { let s = 0; for (let i = 0; i < n; i++) s += (i & 1 ? b : a).shared; return s; }
function readC(a, b, n) { let s = 0; for (let i = 0; i < n; i++) s += (i & 1 ? b : a).shared; return s; }
function readD(a, b, n) { let s = 0; for (let i = 0; i < n; i++) s += (i & 1 ? b : a).shared; return s; }
function readForty(o, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared;
    s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared;
    s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared;
    s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared;
    s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared; s += o.shared;
  }
  return s;
}

const a = shape(1);
const b = shape(2);
{
  const before = refills();
  const sum = readA(a, a, tripsA);
  expectBetween("refills with one structure", refills() - before, 0, 0);
  console.log("one structure: " + sum);
}
{
  const before = refills();
  let sum = 0;
  for (const o of [a, b]) sum += readB(o, o, tripsB);
  expectBetween("refills after the structure changed once", refills() - before, 1, 2);
  console.log("one structure, then another: " + sum);
}
{
  const before = refills();
  const sum = readC(a, b, tripsC);
  expectBetween("refills with two structures in turn", refills() - before, 100, 5000);
  console.log("two structures in turn: " + sum);
}
{
  let reads = 0;
  const prototype = Object.create(null);
  Object.defineProperty(prototype, key, { get() { return ++reads; }, configurable: true });
  const o = Object.create(prototype);
  const refillsBefore = refills();
  const fillsBefore = fills();
  const sum = readD(o, o, tripsD);
  expectBetween("fill attempts for an accessor", fills() - fillsBefore, 0, 60);
  expectBetween("refills for an accessor", refills() - refillsBefore, 0, 0);
  console.log("inherited accessor: " + sum);
}
{
  const o = shape(3);
  readA(o, o, tripsE);   // Enters the structure into the lookup table, so that each of the forty sites hits it at its first read.
  for (let pass = 0; pass < readFortyTrips.length; pass++) {
    const n = readFortyTrips[pass];
    const refillsBefore = refills();
    const fillsBefore = fills();
    const entriesBefore = byName();
    const sum = readForty(o, n);
    const entries = byName() - entriesBefore;
    if (pass === 0) expectBetween("fills of empty sites", fills() - fillsBefore, 10, 40);
    else expectBetween("entries for filled sites", entries, 0, 0);
    expectBetween("refills of forty sites", refills() - refillsBefore, 0, 0);
    console.log("forty sites, pass " + pass + ": " + sum);
  }
}
