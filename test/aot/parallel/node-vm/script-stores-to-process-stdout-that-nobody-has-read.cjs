// A script of node:vm stores to process.stdout and process.stderr before anybody has read them. The stores are refused like any store to a built-in object, and the streams are made at the first read.
const vm = require("node:vm");
const say = (label, run) => {
  let seen;
  try {
    seen = String(run());
  } catch (error) {
    seen = "throws " + error.name + ": " + error.message;
  }
  console.log(label, "|", seen);
};
say("a store", () => vm.runInThisContext("process.stdout = 5"));
say("Reflect.set", () => vm.runInThisContext("Reflect.set(process, 'stderr', 5)"));
say("stdout", () => typeof process.stdout.write);
say("stderr", () => typeof process.stderr.write);
/* Output:
a store | throws TypeError: Cannot assign to process.stdout because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Reflect.set | false
stdout | function
stderr | function
*/
