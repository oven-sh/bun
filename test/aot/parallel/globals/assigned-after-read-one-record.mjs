// An assignment after the value was read, in a build that has a record for one global name alone.
// Flags: --aot-limit=MaxGlobalBindings:1
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
globalThis.counter = 1;
function read() { return counter; }
function total(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += counter;
  return sum;
}
attempt(read);
attempt(read);
attempt(() => total(100));
globalThis.counter = 2;
attempt(read);
attempt(() => total(100));
counter = 3;
attempt(read);
attempt(() => globalThis.counter);
Reflect.set(globalThis, "counter", 4);
attempt(read);
Object.defineProperty(globalThis, "counter", { value: 5 });
attempt(read);
opaque(globalThis).counter = 6;
attempt(read);
globalThis[decoded("counter")] = 7;
attempt(read);
attempt(() => total(100));
console.log(told.join("\n"));
