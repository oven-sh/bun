const at = JSON.parse("0");
const held = [];
function lay(value) {
  const into = held[at];
  for (let i = 0; i < 12; i++) into[i] = value;
}
const said = [];
for (const kind of [Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Uint8Array, Float32Array, Float64Array]) {
  for (const value of [7, -1.5, 300.25, "12", "x", undefined, null, true, { valueOf: () => 9 }, NaN, 2 ** 40 + 3]) {
    const buffer = new ArrayBuffer(128);
    const all = new Uint8Array(buffer).fill(0xee);
    held[0] = new kind(buffer, 32, 3);
    lay(value);
    said.push(`${kind.name} ${String(value)} ${held[0].join()} ${all.slice(24, 32).join("")} ${all.slice(32 + 3 * kind.BYTES_PER_ELEMENT, 32 + 6 * kind.BYTES_PER_ELEMENT + 8).join("")}`);
  }
}
console.log(
  said.join(`
`),
);
