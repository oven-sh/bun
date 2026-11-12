// Typed arrays: a walk, subarray, slice and set over short windows.
// Sizes: 1000 4000 16000
// Passes: 62
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function windowAt(view: Uint8Array, at: number): number {
  const part = view.subarray(at, at + 16),
    copy = view.slice(at, at + 4);
  part.set(copy, 8);
  return part[9]! + copy.length;
}
function once(): string {
  const bytes = new Uint8Array(size * 32),
    floats = new Float64Array(size * 4);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
  for (let i = 0; i < floats.length; i++) floats[i] = i / 2;
  let sum = 0;
  for (let at = 0; at + 16 <= bytes.length; at += 16) sum += windowAt(bytes, at);
  let total = 0;
  for (const x of floats) total += x;
  return [sum, total].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
