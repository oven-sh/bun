// Error.captureStackTrace defines `stack` on its operand by a store of native code.
const plain = {};
Error.captureStackTrace(plain);
console.log(typeof plain.stack);
const either = process.argv.length > 99 ? {} : Array.prototype;
try {
  Error.captureStackTrace(either);
} catch (error) {
  console.log("threw", error.name);
}
console.log("stack" in Array.prototype, typeof [].stack);
Error.stackTraceLimit = 1;
function lines() {
  return new Error("x").stack.split("\n").length;
}
console.log(lines());
