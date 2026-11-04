// A local array of small integers that is filled before it is read and indexed inside its length. Its reads are operands of sums and results, so nothing asks whether an element is there.
function histogram(bytes: number[]): number {
  const counts = new Array(256);
  counts.fill(0);
  for (let i = 0; i < bytes.length; i++) {
    const k = bytes[i] & 255;
    counts[k] = (counts[k] + 1) & 255;
  }
  return counts[7] * 1000 + counts[8] * 10 + counts[9];
}

const n = process.argv.length & 1;
const bytes = [n + 7, n + 7, n + 9, n + 263, n + 8];
let total = 0;
for (let k = 0; k < 20000; k++) total = (total + histogram(bytes)) | 0;
console.log(total + " " + histogram([]) + " " + histogram([7, 7.5, -249, 1e10]));
