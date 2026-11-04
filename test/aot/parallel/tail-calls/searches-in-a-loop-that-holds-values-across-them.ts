// a loop holds a counter, a sum, a fraction and a text across calls of indexOf and includes
function positions(list: unknown[], wanted: unknown[]): string {
  let text = "";
  let sum = 0;
  let scale = 1.5;
  for (let i = 0; i < wanted.length; i++) {
    const at = list.indexOf(wanted[i]);
    const has = list.includes(wanted[i]);
    sum += at * (i + 1);
    scale += at / 4;
    text += at + (has ? "y" : "n");
  }
  return text + ":" + sum + ":" + scale;
}
function deed(list: unknown[], wanted: unknown[]) {
  return positions(list, wanted);
}
console.log(deed([1, 2, 3], [3, 1, 9]));
for (let i = 0; i < 4; i++) console.log(deed([i, i + 1, "a"], ["a", i + 1, i - 1]));
console.log(deed([1.5, NaN, "a", undefined, null], [NaN, undefined, null, "a", 1.5]));
console.log(deed([, 1], [undefined, 1]));
console.log(deed([1, 2, 3], [2]));
