// Buffer: toString, slices, reads of numbers; TextDecoder on windows.
// Sizes: 1000 4000 16000
// Passes: 110
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const decoder = new TextDecoder();
function textAt(buffer: Buffer, at: number): number {
  return (
    buffer.toString("latin1", at, at + 5).length +
    decoder.decode(buffer.subarray(at, at + 4)).length +
    (buffer.readUInt16LE(at) % 7) +
    buffer.indexOf(10, at) -
    at
  );
}
function once(): string {
  const buffer = Buffer.from("alpha,beta,gamma,delta\n".repeat(size));
  let sum = 0;
  for (let at = 0; at + 23 <= buffer.length; at += 23) sum += textAt(buffer, at);
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
