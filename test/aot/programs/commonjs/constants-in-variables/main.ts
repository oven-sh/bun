// A library in the style of ES5 keeps its constants in `var`s at the head of a function. One that nothing else stores to, and that no read finds before its declaration has run, is its value wherever it is read. Every way to find it earlier, or to store to it, keeps it a variable.
// IR= 0 hasFlag GetEnvironmentField
// IR= 0 isArgumentsTag GetEnvironmentField
// IR= 1 seenEarly GetEnvironmentField
// IR= 1 storedLater GetEnvironmentField
import * as library from "./library.cjs";
for (const name of Object.keys(library).sort()) {
  if (name === "default") continue;
  const f = (library as any)[name];
  console.log(name, typeof f === "function" ? JSON.stringify([f(3), f("[object Arguments]"), f(undefined)]) : JSON.stringify(f));
}
