const at = JSON.parse("0");
const held = [];
function lay(value) {
  const into = held[at];
  for (let i = 0; i < 12; i++) into[i] = value;
}
function fill(holders, value) {
  held[0] = holders[0];
  lay(value);
  return holders[0];
}
const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
const said = [];
for (const value of [7, 1.5, -1.5, 300, -300, 2 ** 31, 2 ** 32 + 5, NaN, Infinity, -0, "12", "x", undefined, null, true, { valueOf: () => 9 }]) {
  for (const kind of kinds) {
    for (const length of [8, 6, 4, 0]) {
      const filled = fill([new kind(length)], value);
      said.push(`${kind.name} ${length} ${Array.from(filled, each => (Object.is(each, -0) ? "-0" : String(each))).join()}`);
    }
  }
}
said.push(Array.from(fill([Buffer.alloc(4)], 258)).join());
for (const kind of [BigInt64Array, BigUint64Array]) {
  said.push(Array.from(fill([new kind(4)], -1n), String).join());
  try {
    fill([new kind(4)], 1);
    said.push("no error");
  } catch (error) {
    said.push(error.constructor.name);
  }
}
try {
  fill([new Int32Array(4)], 1n);
  said.push("no error");
} catch (error) {
  said.push(error.constructor.name);
}
said.push(fill([new Int16Array(3)], "12").join());
console.log(
  said.join(`
`),
);
