// DataView at a place.
// Sizes: 1000 4000 16000
// Passes: 200
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function read(view: DataView, at: number): number {
  return (view.getInt32(at, true) & 255) + (Math.floor(view.getFloat64(at + 8)) % 5) + view.getUint8(at + 1);
}
function once(): string {
  const view = new DataView(new ArrayBuffer(size * 64));
  for (let at = 0; at < view.byteLength; at += 16) {
    view.setInt32(at, at, true);
    view.setFloat64(at + 8, at / 3);
  }
  let sum = 0;
  for (let at = 0; at < view.byteLength; at += 16) sum += read(view, at);
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
