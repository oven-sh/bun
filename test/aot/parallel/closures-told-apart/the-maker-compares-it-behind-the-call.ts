function each(list: number[], visit: (x: number) => void) { for (const x of list) visit(x); }
const holder: { f?: (x: number) => void } = {};
function sumOf(list: number[]): string {
  let total = 0;
  const add = (x: number) => { total += x; };
  each(list, add);
  const first = holder.f === add;
  holder.f = add;
  return total + ":" + first + ":" + (holder.f === add);
}
console.log(sumOf([1, 2]), sumOf([3]));
