// The global object's storage grows, then becomes a dictionary.
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
globalThis.early = "early";
function readEarly() { return early; }
function storeEarly(value) { early = value; }
function readLate() { return late; }
function storeLate(value) { late = value; }
function readFiller() { return filler399; }
attempt(readEarly);
storeEarly("early, stored once");
attempt(readEarly);
for (let index = 0; index < 400; index++) globalThis["filler" + index] = index;
globalThis.late = "late";
attempt(readEarly);
attempt(readLate);
attempt(readLate);
attempt(readFiller);
for (let index = 400; index < 800; index++) globalThis["filler" + index] = index;
attempt(readEarly);
attempt(readLate);
attempt(readFiller);
storeEarly("early, stored twice");
storeLate("late, stored once");
attempt(readEarly);
attempt(readLate);
for (let index = 0; index < 800; index += 2) delete globalThis["filler" + index];
attempt(readEarly);
attempt(readLate);
attempt(readFiller);
storeEarly("early, stored in a dictionary");
storeLate("late, stored in a dictionary");
attempt(readEarly);
attempt(readLate);
attempt(() => globalThis.early + " / " + globalThis.late);
attempt(() => delete globalThis.filler399);
attempt(readFiller);
console.log(told.join("\n"));
