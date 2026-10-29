// Native code and the GC see an assignment by name.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
const told = [];
function attempt(action) {
  try {
    told.push(String(action()));
  } catch (error) {
    told.push(error instanceof TypeError ? error.name : error.name + ": " + error.message);
  }
}
globalThis.tally = 0;
function bump() { tally = tally + 1; }
for (let round = 0; round < 1000; round++) bump();
attempt(() => tally);
attempt(() => globalThis.tally);
attempt(() => Reflect.get(globalThis, "tally"));
attempt(() => JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "tally")));
attempt(() => Object.keys(globalThis).includes("tally"));

globalThis.kept = null;
function keep(value) { kept = value; }
function readKept() { return kept; }
const ring = new Array(64);
keep({ n: -1, list: [] });
Bun.gc(true);
for (let round = 0; round < 200; round++) {
  keep({ n: round, list: [round, round + 1] });
  for (let index = 0; index < 5000; index++) ring[index & 63] = { index, list: [index] };
  if (readKept().n !== round || readKept().list[1] !== round + 1) told.push("lost in round " + round);
}
Bun.gc(true);
attempt(() => readKept().n + " " + readKept().list.join() + " " + ring[63].index);
console.log(told.join("\n"));
