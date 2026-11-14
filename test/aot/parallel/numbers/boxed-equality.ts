const lists: any[][] = [
  [0, 1, 2, 3, -1, 7, 1, 0],
  [0.5, 1.5, 1, 2, -0, 0, 3.25, 1],
  [NaN, 1, NaN, 0, -0, 0, 1, 2],
  [1, undefined, 3, 0, undefined, 6, 7, 1],
  [1, , 3, , 0, 6, , 1],
  [2147483648, 4294967295, 1, -2147483649, 9007199254740993, 1e300, 1, 0],
];
function row(a: number[], b: number[]): string {
  let out = "";
  const compare = (i: number, j: number): number => {
    if (a[i] !== b[j]) return a[i] - b[j];
    return 0;
  };
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) out += (a[i] === b[j] ? 1 : 0) + (compare(i, j) < 0 ? "<" : "");
  return out;
}
for (const a of lists) for (const b of lists) console.log(row(a, b));
