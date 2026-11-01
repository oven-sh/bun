// Native code may put a property on a class object without asking the object: Error.captureStackTrace(SomeClass) puts `stack` there. A static getter that the class inherits is hidden from then on,
// also for code that has read it a hundred times.
class Parent {
  static get stack() { return "declared"; }
  static get other() { return "declared"; }
}
class Captured extends Parent {}
class Defined extends Parent {}
class Untouched extends Parent {}
function read(which) {
  return which === 0 ? Captured.stack : which === 1 ? Defined.other : Untouched.stack;
}
function count(which) {
  let declared = 0;
  for (let i = 0; i < 100; i++) if (read(which) === "declared") declared++;
  return declared;
}
console.log("before", count(0), count(1), count(2));
Error.captureStackTrace(Captured);
Object.defineProperty(Defined, "other", { value: "own" });
console.log("after", count(0), count(1), count(2), typeof Captured.stack, Object.hasOwn(Captured, "stack"), Object.hasOwn(Untouched, "stack"));
