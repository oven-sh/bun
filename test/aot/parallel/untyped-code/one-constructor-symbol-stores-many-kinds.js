// One constructor at the root of many kinds of objects stores in a row, once under a symbol that is held in a variable which is stored to twice: what the key is has to be looked at each time.
// What the objects have. Only the jsc shell can count. Elsewhere the program checks the answers alone.
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
// These make the text that is printed, list the keys for it and keep it in a set; a cell where the allocator has none at hand is the work of the run time.
const owed = ["operationAOTConcat", "operationAOTOwnPropertyKeys", "operationAOTSetAdd", "operationAOTStackStringBuilderAppend", "operationAOTStackStringBuilderFinish", "operationAOTStringOfAnyValue", "operationAOTAllocateSlow"];
// So do these: show() reads three names and each key of twelve kinds of objects, and the run time looks each up until it is remembered. Each is owed at most so often.
const owedAtMost = { operationAOTGetByIdAndCache: 33, operationAOTGetByValGeneric: 90 };
// The calls of one operation in such a text.
const callsOf = (counts, name) => callsIn(counts) - callsIn(counts, name);
// Those of them that were called more often than that between two such texts.
const calledTooOften = (before, after) => Object.keys(owedAtMost).filter(name => callsOf(after, name) - callsOf(before, name) > owedAtMost[name]);
var kMode = Symbol("first");
if (countsSoFar.length > 5) kMode = Symbol("never");
function Root(limit) {
  this.events = null;
  this.eventsCount = 0;
  this[kMode] = false;
  this.maxListeners = limit;
}
Root.prototype.show = function () { return this.constructor.name + ": " + Reflect.ownKeys(this).map(key => String(key) + "=" + String(this[key])).join(); };
const library = { Root: function Unused() {} };
library.Root = Root;
const kinds = [];
for (let i = 0; i < 12; i++) {
  const Kind = { ["Kind" + i]: function (limit) { if (i & 1) this.early = i; library.Root.call(this, limit); this.late = i; } }["Kind" + i];
  Object.setPrototypeOf(Kind.prototype, Root.prototype);
  kinds.push(Kind);
}
const said = new Set();
const before = countsSoFar();
for (let turn = 0; turn < 2000; turn++) {
  for (const Kind of kinds) said.add(new Kind(10).show());
}
const after = countsSoFar();
const asked = callsIn(after, ...owed, ...Object.keys(owedAtMost)) - callsIn(before, ...owed, ...Object.keys(owedAtMost));
const tooOften = calledTooOften(before, after);
console.log([...said].join("\n"));
console.log(asked <= 400 && !tooOften.length ? "the run time was asked at most 400 times" : "the run time was asked " + asked + " times, and too often called: " + tooOften.join());
kMode = Symbol("second");
console.log(new kinds[0](11).show(), new kinds[1](11).show());
