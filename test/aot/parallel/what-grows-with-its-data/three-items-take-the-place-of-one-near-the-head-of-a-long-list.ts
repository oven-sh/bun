// One splice for every 32 elements, two places behind the head, with more arguments than the call has a form of its own for.
// Sizes: 150000 600000 2400000
// Passes: 1
// Grows: linear
const size = Number(process.env.SIZE ?? 150000),
  passes = Number(process.env.PASSES ?? 1);
function once(): string {
  const list: any[] = [];
  for (let i = 0; i < size; i++) list.push(i);
  let taken = 0;
  for (let i = 0; i < size / 32; i++) taken += list.splice(2, 1, -1, -2, -3).length;
  return [list.length, list[0], list[2], taken].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
