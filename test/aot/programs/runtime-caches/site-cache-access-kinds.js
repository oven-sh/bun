// Each kind of access by name has a site of its own: own, inherited and absent values, getters, stores that add, replace and fail. A site cache fills on its first lookup-table hit, backs off at a site with two structures, never caches a getter, and is invalidated when a prototype changes.
// COUNTER: SiteCacheRefill >= 7
// COUNTER: SiteCacheRefill <= 44
const counts = typeof aotRuntimeCounters === "function";   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function counter(name) { if (!counts) return 0; for (const line of aotRuntimeCounters().split("\n")) { const [count, counted] = line.split("\t"); if (counted === name) return Number(count); } throw new Error("no counter " + name); }
function calls(...names) { let sum = 0; if (counts) for (const name of names) sum += aotOperationCount("operationAOT" + name); return sum; }
function expectBetween(label, value, low, high) { if (counts && !(value >= low && value <= high)) throw new Error(label + ": " + value + " is not in " + low + ".." + high); }
const trips = JSON.parse("10000");
const key = JSON.parse('"shared"');

let refillsBefore = counter("SiteCacheRefill");
function say(label, answer, maxRefills) {
  const refills = counter("SiteCacheRefill");
  expectBetween(label, refills - refillsBefore, 0, maxRefills);
  refillsBefore = refills;
  console.log(label + ": " + answer);
}

function shape(prototype, ownNames, value) {
  const o = Object.create(prototype);
  for (let i = 0; i < ownNames; i++) o["own" + i] = i;
  if (value !== undefined) o[key] = value;
  return o;
}

function readOneStructure(o, n) { let sum = 0; for (let i = 0; i < n; i++) sum += o.shared; return sum; }
function readTwoStructures(a, b, n) { let sum = 0; for (let i = 0; i < n; i++) sum += (i & 1 ? b : a).shared; return sum; }
function readOwnGetter(o, n) { let sum = 0; for (let i = 0; i < n; i++) sum += o.shared; return sum; }
function readInheritedGetter(o, n) { let sum = 0; for (let i = 0; i < n; i++) sum += o.shared; return sum; }
function readInherited(o, n) { let sum = 0; for (let i = 0; i < n; i++) sum += o.shared; return sum; }
function readAbsent(o, n) { let sum = 0; for (let i = 0; i < n; i++) { const value = o.shared; sum += value === undefined ? 1 : value; } return sum; }
function addToFreshObjects(prototype, n) { let sum = 0; for (let i = 0; i < n; i++) { const o = Object.create(prototype); o.added = i; sum += o.added; } return sum; }
function replaceInOneObject(o, n) { let sum = 0; for (let i = 0; i < n; i++) { o.shared = i; sum += o.shared; } return sum; }
function storeToReadOnly(o, n) { let thrown = 0; for (let i = 0; i < n; i++) { try { o.shared = i; } catch (error) { if (error instanceof TypeError) thrown++; } } return thrown + " " + o.shared; }

say("one structure", readOneStructure(shape(null, 1, 7), trips), 4);
say("two structures", readTwoStructures(shape(null, 1, 1), shape(null, 2, 100), trips), 40);

let reads = 0;
const withGetter = Object.defineProperty(shape(null, 1), key, { get() { return ++reads; }, configurable: true });
say("own getter", readOwnGetter(withGetter, trips), 0);
say("inherited getter", readInheritedGetter(shape(withGetter, 2), trips), 0);

const base = shape(null, 1);
say("add to fresh objects", addToFreshObjects(base, trips), 4);
say("replace in one object", replaceInOneObject(shape(base, 1, 0), trips), 4);
say("store to a read-only property", storeToReadOnly(Object.freeze(shape(base, 1, 9)), trips / 100), 4);

const far = shape(null, 1, 3);
const near = shape(far, 1);
const child = shape(near, 2);
say("inherited value", readInherited(child, trips), 4);
near[key] = 5;
say("shadowed by a nearer prototype", readInherited(child, trips), 4);
delete near[key];
say("shadowing property deleted", readInherited(child, trips), 4);
Object.setPrototypeOf(near, shape(null, 3, 11));
say("prototype of the prototype replaced", readInherited(child, trips), 4);

const root = shape(null, 1);
const leaf = shape(root, 1);
say("absent", readAbsent(leaf, trips), 4);
root[key] = 2;
say("added to the prototype", readAbsent(leaf, trips), 4);

let stored = 0;
Object.defineProperty(base, "added", { get() { return 1; }, set(value) { stored += value; }, configurable: true });
say("setter added to the prototype", addToFreshObjects(base, trips) + " " + stored, 4);

expectBetween("fills of all sites", calls("FillSiteCache"), 6, 600);
