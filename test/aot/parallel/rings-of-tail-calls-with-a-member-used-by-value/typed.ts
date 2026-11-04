let work = 0;
function even(n: number): number {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (n === 0) return 1;
  return odd(n - 1);
}
function odd(n: number): number {
  for (let i = 0; i < 2; i++) work = (work ^ i) | 0;
  if (n === 0) return 0;
  return even(n - 1);
}
console.log([3].map(odd).join());
let answer: unknown;
try { answer = even(4000000); } catch (error: any) { answer = error.constructor.name; }
console.log(answer);
