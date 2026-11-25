// The birth runs no other code: what is known of other objects is still true behind it, whatever is given.
function across(box: { n: number }, list: number[], x: any) {
  const before = box.n + list[0]!;
  const made = new Array(x);
  return before + box.n + list[0]! + made.length;
}
let total = 0;
const box = { n: 5 }, list = [7, 8];
const odd = { valueOf() { box.n = 1000; list[0] = 1000; return 1; } };
for (let turn = 0; turn < 200; turn++) total += across(box, list, turn % 3 === 0 ? odd : turn % 3 === 1 ? turn & 3 : "t");
console.log(total, box.n, list[0]);
