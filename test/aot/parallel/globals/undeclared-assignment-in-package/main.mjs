// An undeclared assignment in a CommonJS package.
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
import leaky from "leaky";
function read() { return leakedCount; }
attempt(read);
attempt(leaky.bump);
attempt(read);
attempt(() => globalThis.leakedCount);
attempt(() => JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "leakedCount")));
attempt(leaky.forget);
attempt(leaky.kind);
attempt(read);
attempt(leaky.bump);
attempt(leaky.start);
attempt(read);
attempt(leaky.bump);
console.log(told.join("\n"));
