// One splice for every 32 elements, three places behind the head.
// Sizes: 150000 600000 2400000
// Passes: 1
// Grows: linear
const size = Number(process.env.SIZE ?? 150000),
  passes = Number(process.env.PASSES ?? 1);
function once(): string {
  const list: number[] = [];
  for (let i = 0; i < size; i++) list.push(i + 0.5);
  for (let i = 0; i < size / 32; i++) list.splice(3, 0, i + 0.25);
  return [list.length, list[0], list[3]].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
