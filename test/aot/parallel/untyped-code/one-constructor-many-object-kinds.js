// One constructor at the root of many: every kind of object that inherits from it comes to the same stores with a shape of its own, as every stream and every server comes to EventEmitter.
// What the objects have, also once something stands in the way for one kind alone. Only the jsc shell can count. Elsewhere the program checks the answers alone.
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
// Env: JSC_aotCountsPath=/dev/null
const countsSoFar = () => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named.
function callsIn(counts, ...besides) {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !besides.includes(name)) sum += Number(calls);
  }
  return sum;
}
// These make the text that is printed, list the names for it and keep it in a set; a cell where the allocator has none at hand is the work of the run time.
const owed = ["operationAOTConcat", "operationAOTOwnPropertyKeys", "operationAOTSetAdd", "operationAOTStackStringBuilderAppend", "operationAOTStackStringBuilderFinish", "operationAOTValueAdd", "operationAOTAllocateSlow"];
// So do these: show() reads three names and each key of twelve kinds of objects, and the run time looks each up until it is remembered. Each is owed at most so often.
const owedAtMost = { operationAOTGetByIdAndCache: 33, operationAOTGetByValGeneric: 67 };
// The calls of one operation in such a text.
const callsOf = (counts, name) => callsIn(counts) - callsIn(counts, name);
// Those of them that were called more often than that between two such texts.
const calledTooOften = (before, after) => Object.keys(owedAtMost).filter(name => callsOf(after, name) - callsOf(before, name) > owedAtMost[name]);
function Root(limit) {
  this.events = null;
  this.eventsCount = 0;
  this.maxListeners = limit;
  this.captures = false;
}
Root.prototype.show = function () { return this.constructor.name + ": " + Object.keys(this).map(key => key + "=" + this[key]).join(); };
const kinds = [];
for (let i = 0; i < 12; i++) {
  const Kind = { ["Kind" + i]: function (limit) { if (i & 1) this.early = i; Root.call(this, limit); this.late = i; } }["Kind" + i];
  Object.setPrototypeOf(Kind.prototype, Root.prototype);
  kinds.push(Kind);
}
const said = new Set();
const before = countsSoFar();
for (let turn = 0; turn < 2000; turn++) {
  for (const Kind of kinds) said.add(new Kind(10).show());
}
const after = countsSoFar();
const inRunTime = callsIn(after, ...owed, ...Object.keys(owedAtMost)) - callsIn(before, ...owed, ...Object.keys(owedAtMost));
const tooOften = calledTooOften(before, after);
console.log([...said].join("\n"));
console.log(inRunTime <= 200 && !tooOften.length ? "the run time stored for at most 200 of them" : "the run time stored for " + inRunTime + " of them, and too often called: " + tooOften.join());

const log = [];
function define(object, name, descriptor) { Object.defineProperty(object, name, descriptor); }
function remove(object, name) { delete object[name]; }
const parentOfThird = Object.getPrototypeOf(new kinds[3](0));
const parentOfAll = Object.getPrototypeOf(parentOfThird);
const names = ["max" + "Listeners", "cap" + "tures"];
define(parentOfThird, names[0], { get() { return "by getter"; }, set(value) { log.push("set " + value + " behind " + Object.keys(this).join()); }, configurable: true });
for (const Kind of kinds.slice(2, 5)) console.log(new Kind(11).show());
console.log(log.splice(0).join(" | "));
define(parentOfAll, names[1], { value: "fixed", writable: false, configurable: true });
for (const Kind of kinds.slice(2, 5)) {
  try {
    console.log(new Kind(12).show());
  } catch (error) {
    console.log(error.constructor.name);
  }
}
console.log(log.splice(0).join(" | "));
remove(parentOfAll, names[1]);
remove(parentOfThird, names[0]);
for (let turn = 0; turn < 40; turn++) {
  for (const Kind of kinds) said.add(new Kind(13).show());
}
console.log(said.size, new kinds[3](14).show(), log.length);
const bare = Object.create(null);
Root.call(bare, 15);
console.log(Object.keys(bare).join(), bare.maxListeners);
const filled = { eventsCount: "there", other: 1 };
Root.call(filled, 16);
console.log(Object.keys(filled).join(), filled.eventsCount);
