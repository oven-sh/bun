// a function calls itself through Reflect.apply in tail position a million times
function step(n: number, acc: number): number {
  if (n === 0) return acc;
  return Reflect.apply(step, undefined, [n - 1, acc + (n & 1)]);
}
function deed(turns: number) {
  return String(step(turns, 0));
}
console.log(deed(3));
for (let i = 0; i < 5; i++) console.log(deed(1000 + i));
console.log(deed(1000000));
