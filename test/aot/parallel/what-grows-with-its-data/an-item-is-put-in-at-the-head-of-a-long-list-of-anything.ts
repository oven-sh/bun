// One splice for every 32 elements, at the head. The list comes out of data: the call is not typed.
// Sizes: 150000 600000 2400000
// Passes: 1
// Grows: linear
const size = Number(process.env.SIZE ?? 150000),
  passes = Number(process.env.PASSES ?? 1);
function once(): string {
  const list: any = JSON.parse('["a", 1, null]');
  for (let i = 0; i < size; i++) list.push(i & 1 ? i : "t");
  for (let i = 0; i < size / 32; i++) list.splice(0, 0, i);
  return [list.length, list[0], list[1]].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
