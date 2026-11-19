// The same names hold numbers, texts and nothing.
// Sizes: 16000 64000 256000
// Passes: 8
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function join(a, b) {
  return a == null ? b : b == null ? a : a + b;
}
function pick(i) {
  return i % 4 === 0 ? i : i % 4 === 1 ? "t" + (i & 7) : i % 4 === 2 ? null : undefined;
}
function once() {
  let text = 0,
    number = 0;
  for (let i = 1; i < size * 6; i++) {
    const got = join(pick(i - 1), pick(i));
    if (typeof got === "string") text += got.length;
    else if (typeof got === "number") number += got & 7;
  }
  return [text, number].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
