// A function is promisified and called at every level on the way up from the end of the stack.
const { promisify } = require("node:util");
function nothing() {}
let probes = 0;
function down(level) {
  try {
    return down(level + 1) + 1;
  } catch (error) {
    if (probes++ < 2000)
      try {
        promisify(nothing)();
      } catch {}
    throw error;
  }
}
try {
  down(0);
} catch (error) {
  console.log(error instanceof RangeError);
}
console.log("end");
