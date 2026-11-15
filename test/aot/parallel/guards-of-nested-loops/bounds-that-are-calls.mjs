// A function whose loop takes its bound from a call is copied into a loop of a body with more blocks than its own.
const isDone = process.argv.length > 90;
const held = new Map([[0, new String("3")], [1, 4], [2, { valueOf: () => 2 }]]);
function countTo(key) { let n = 0; while (n < held.get(key)) n++; return n; }
function countHalves(key) { let n = 0; for (; n * 0.5 < held.get(key); ) n++; return n; }
function countNested(key) { let n = 0; for (let i = 0; i < held.get(key); i++) { for (let k = 0; k < held.get(key); k++) n += k; } return n; }
let branches = 0;
if (process.argv.length > 91) branches += 1;
if (process.argv.length > 92) branches += 2;
if (process.argv.length > 93) branches += 4;
if (isDone) console.log("never");
if (!isDone) {
  for (let turn = 0; turn < 9; turn++) { countTo(0, 1); }
  for (let turn = 0; turn < 9; turn++) { countHalves(turn % 3); }
  let sum = 0;
  for (let turn = 0; turn < 9; turn++) { sum += countNested(turn % 3); held.set(1, turn); }
  console.log(sum, branches);
}
function run(list, out) {
  for (let i = 0; i < list.length; i++) {
    if (list[i] > 2) out[i] = countTo(list[i] % 3);
    else if (list[i] < 0) out[i] = countHalves(-list[i] % 3);
    else out[i] = list[i];
  }
  return out;
}
console.log(countTo(0), run([1, 3, 4, -1, 5, 0], []).join(), run([6, -2, 2], [0, 0, 0]).join());
