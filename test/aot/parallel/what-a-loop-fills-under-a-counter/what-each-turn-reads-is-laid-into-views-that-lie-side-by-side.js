const at = JSON.parse("0");
const held = [];
const givers = [() => held[0], () => held[1]];
function copy() {
  const into = givers[at](),
    from = givers[at + 1]();
  for (let i = 0; i < 12; i++) into[i] = from[i];
}
const sources = [
  [7, -1.5, 300.25, "12", "x", undefined, null, true, { valueOf: () => 9 }, NaN, 2 ** 40 + 3, -0],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5],
  [1, , 3],
  new Float64Array([1.9, -1.9, 256, 65536.5, 2 ** 32 + 1, NaN, Infinity, -Infinity, 0, -0, 1e300, 5]),
  "0123456789ab",
  { 0: 4, 1: "5", length: 2 },
];
const said = [];
for (const kind of [Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Uint8Array, Float32Array, Float64Array]) {
  for (const length of [12, 3, 0]) {
    for (const from of sources) {
      const buffer = new ArrayBuffer(160);
      const all = new Uint8Array(buffer).fill(0xee);
      held[0] = new kind(buffer, 32, length);
      held[1] = from;
      copy();
      said.push(`${kind.name} ${length} ${held[0].join()} ${all.slice(24, 32).join("")} ${all.slice(32 + length * kind.BYTES_PER_ELEMENT).join("")}`);
    }
  }
}
console.log(
  said.join(`
`),
);
