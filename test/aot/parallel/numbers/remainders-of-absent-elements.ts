// The remainder of a sum with an element: a list without holes has no element past its end, and the sum with undefined is NaN.
const lines: string[] = [];
function masked(list: number[], n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + list[(i * 7) & 15]!) % 1000003;
  return sum;
}
function upToLength(list: number[], n: number): number {
  let sum = 0;
  for (let i = 0; i <= n; i++) sum = (sum + list[i]!) % 1000003;
  return sum;
}
function fromEnd(list: number[], n: number): number {
  let sum = 0;
  for (let i = n - 1; i >= 0; i--) sum = (sum * 31 + list[i]! + 1) % 10007;
  return sum;
}
function underKeys(list: number[], keys: number[], n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum - list[keys[i]!]!) % 97;
  return sum;
}
function beside(list: number[], n: number): number {
  let sum = 1;
  for (let i = 0; i < list.length; i++) sum = (sum * 3 + list[i + n]! + list[i]!) % 97;
  return sum;
}
const list = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const keys = [0, 3, 9, 4, 1, 12];
const base = process.argv.length > 100 ? 1 : 0;
for (let turn = 0; turn < 3; turn++) {
  for (let n = base; n < 14; n++) {
    lines.push([masked(list, n), upToLength(list, n), fromEnd(list, n), underKeys(list, keys, Math.min(n, 7)), beside(list, n >> 2)].join(" "));
  }
}
console.log(lines.join("\n"));
