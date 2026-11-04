// A function is promisified and called at every level on the way up from the end of the stack. Where the stack ends inside the promisified function its promise is rejected: the sizes of the frames decide whether any level is such a place.
const { promisify } = require("node:util");
function nothing() {}
let probes = 0;
function down(level) {
  try {
    return down(level + 1) + 1;
  } catch (error) {
    if (probes++ < 2000)
      try {
        promisify(nothing)().then(nothing, nothing);
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
