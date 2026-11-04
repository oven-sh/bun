// Each turn of a loop has a scope of its own and hands a callback over it to a function that only calls it; on the third turn a closure over that scope is kept in an object and called when the loop has ended.
const kept: { read?: () => number } = {};
function each(list: number[], use: (x: number) => void) {
  for (let k = 0; k < list.length; k++) use(list[k]);
}
function deed(n: number): string {
  let total = 0;
  for (let i = 0; i < n; i++) {
    each([1, 2], x => {
      total += x * i;
    });
    if (i === 2) kept.read = () => i * 100 + total;
  }
  return String(total) + " " + String(kept.read ? kept.read() : "none");
}
console.log(deed(2));
console.log(deed(5));
for (let turn = 0; turn < 300; turn++) deed(2);
console.log(String(kept.read!()));
console.log(deed(6));
