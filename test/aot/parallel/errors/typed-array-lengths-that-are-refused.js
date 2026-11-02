// A typed array of a length that is no index is refused with the constructor's own words, whichever way the construction is compiled.
function describe(make) {
  try {
    return "length " + make().length;
  } catch (error) {
    return error.name + ": " + error.message;
  }
}
const lengths = [-1, -0.5, -1.5, 0, 1.5, NaN, 2 ** 40, 2 ** 53, 2 ** 53 - 1, Infinity, -Infinity, 3];
for (const length of lengths) {
  console.log(String(length), "|", describe(() => new Uint8Array(length)), "|", describe(() => new Float64Array(length)), "|", describe(() => new BigInt64Array(length)));
}
console.log(describe(() => new Uint8Array(-1)), "|", describe(() => new Int32Array(2 ** 40)), "|", describe(() => new Uint16Array(2 ** 53)));
