// One dividend under two divisors that a loop does not change, as keys and as numbers.
function keys(list: number[], x: number, n: number, m: number): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum = sum * 3 + list[(x + i) % n] * 10 + list[(x + i) % m] + list[(x + i) % n];
  return sum % 1000003;
}
function numbers(n: number, m: number): number {
  let sum = 0;
  for (let i = 0; i < 30; i++) sum = (sum * 5 + (i % n) * 7 + (i % m) + (i % n)) % 1000003;
  return sum;
}
const list: number[] = [];
for (let i = 0; i < 40; i++) list.push((i * 7) % 23);
const said: string[] = [];
for (const [x, n, m] of [[0, 5, 7], [3, 7, 5], [10, 40, 3], [1, 1, 2], [2, 6, 6], [5, 0, 3], [5, 3, 0], [4, 2.5, 3], [7, -4, 4], [7, 2 ** 31, 9]]) said.push(keys(list, x, n, m) + " " + numbers(n, m));
console.log(said.join("\n"));
