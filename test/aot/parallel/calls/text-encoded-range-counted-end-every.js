// Text is encoded into a range counted from the end at every level on the way up from the end of the stack.
const encoder = new TextEncoder();
const bytes = new Uint8Array(16);
const strange = [];
let probes = 0;
function written(from) {
  return encoder.encodeInto("ab", bytes.subarray(from)).written;
}
function down(level) {
  try {
    return down(level + 1) + 1;
  } catch (error) {
    if (probes++ < 3000)
      try {
        const count = written(-4);
        if (count !== 2) strange.push(String(count));
      } catch (thrown) {
        if (!(thrown instanceof RangeError)) strange.push(String(thrown));
      }
    throw error;
  }
}
try {
  down(0);
} catch (error) {
  console.log(error instanceof RangeError);
}
console.log(strange.length, strange.slice(0, 3).join());
