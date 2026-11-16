// a function calls itself in tail position a million times
function count(n: number, acc: number): number {
  if (n === 0) return acc;
  return count(n - 1, acc + (n & 3));
}
function deed(turns: number) {
  return String(count(turns, 0));
}
console.log(deed(3));
for (let i = 0; i < 5; i++) console.log(deed(1000 + i));
console.log(deed(1000000));
