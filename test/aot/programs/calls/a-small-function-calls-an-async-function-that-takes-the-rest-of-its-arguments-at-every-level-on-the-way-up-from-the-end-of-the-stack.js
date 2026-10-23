// A function with a frame of one word calls an async function that takes the rest of its arguments where the stack has no room for its body, and returns to its own caller.
const assert = require("node:assert");
process.on("unhandledRejection", () => {});
function nothing() {}
let probes = 0;
let strange = 0;

function inASmallFunction() {
  assert.rejects(nothing);
  return 1;
}

function down(level) {
  try {
    return down(level + 1) + 1;
  } catch (error) {
    if (probes++ < 2000)
      try {
        if (inASmallFunction() !== 1) strange++;
      } catch {}
    throw error;
  }
}

try {
  down(0);
} catch (error) {
  console.log(error instanceof RangeError);
}
await new Promise(resolve => setTimeout(resolve, 20));
console.log(strange, "end");
