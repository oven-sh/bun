// A loop at the top level of a module, the way a first benchmark is written: a callback over a short list.
// COUNT: operations <= 20
// COUNT: arrivals <= 10
// COUNT: cells <= 20
// COUNT: branches <= 28200
const turns = Number(process.argv[2] ?? 1000);
const values = [3, 1, 4, 1, 5, 9, 2, 6];
let sum = 0;
for (let i = 0; i < turns; i++) {
  sum = (sum + values.map(value => value * (i & 7)).reduce((a, b) => a + b, 0)) | 0;
}
console.log(sum);
