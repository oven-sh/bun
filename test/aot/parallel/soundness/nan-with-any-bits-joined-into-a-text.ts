const words = new Uint32Array(2), doubles = new Float64Array(words.buffer);
const halfWords = new Uint32Array(1), floats = new Float32Array(halfWords.buffer);

function name(k: number): string {
  return k > 0 ? name(k - 1) + "x" : "";
}

function describeSums(v: Float64Array, k: number): string {
  let text = "";
  for (let i = 0; i < v.length; i++) {
    const x = v[i] + v[i];
    text = name(k) + " " + (x !== x) + " " + name(k + 1) + " " + name(k + 2) + " " + String(x);
  }
  return text;
}

function describeElements(v: Float64Array, k: number): string {
  let text = "";
  for (let i = 0; i < v.length; i++) text = name(k) + " " + v[i] + " " + name(k + 1) + " " + -v[i] + " " + name(k + 2) + " " + Math.abs(v[i]) + " " + Math.max(v[i], 1);
  return text;
}

function describeFloats(v: Float32Array, k: number): string {
  let text = "";
  for (let i = 0; i < v.length; i++) text = name(k) + " " + v[i] + " " + name(k + 1) + " " + (v[i] * 2) + " " + name(k + 2) + `${v[i] - 1}`;
  return text;
}

const pairs = [
  [0x7ff80000, 0], [0xfff80000, 0], [0x7ff00000, 1], [0xfff00000, 1], [0x7ff80000, 1], [0xfffe0000, 42], [0xfffe0000, 0], [0xfffe0000, 2], [0xfffe0000, 6], [0xfffe0000, 7], [0xfffe0000, 10],
  [0xffff0000, 7], [0xffffffff, 0xffffffff], [0x7fffffff, 0xffffffff], [0xfffc0000, 2], [0xfffd0000, 0], [0xfffdffff, 0xffffffff], [0x7ffa0000, 0], [0x7ffb0000, 0], [0x7ffc0000, 0], [0x7ffa0000, 1],
  [0xfffe1234, 0x56789abc], [0xffff8000, 0], [0x7ff00000, 0], [0xfff00000, 0], [0x3ff80000, 0],
];
const depth = process.argv.length > 100 ? 3 : 1;
for (const [high, low] of pairs) {
  words[0] = low;
  words[1] = high;
  console.log(high.toString(16), low.toString(16), "|", describeSums(doubles, depth), "|", describeElements(doubles, depth));
}
for (const bits of [0x7fc00000, 0xffc00000, 0x7f800001, 0xff800001, 0xffffffff, 0x7fffffff, 0xfff00000, 0xffe00000, 0x7f800000, 0x3fc00000]) {
  halfWords[0] = bits;
  console.log(bits.toString(16), "|", describeFloats(floats, depth));
}
