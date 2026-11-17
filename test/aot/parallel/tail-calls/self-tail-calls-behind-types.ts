// A call of the function itself in tail position, behind type syntax, beside calls without it.
function nonNull(n: number, a: number): number {
  if (n === 0) return a;
  if (n % 2 === 1) return nonNull(n - 1, a);
  return nonNull(n - 1, a + 1)!;
}
function satisfied(n: number, a: number): number {
  if (n === 0) return a;
  if (n % 2 === 1) return satisfied(n - 1, a);
  return satisfied(n - 1, a + 1) satisfies number;
}
function counter(n: number, a: number): number {
  if (a === 0) return n;
  if (a % 2 === 1) return counter(n + 1, a - 1)!;
  return counter(n, a - 1)!;
}
function counterBehind(n: number, a: number): number {
  if (n === 0) return a;
  if (n > 50) return counterBehind(n - 1, a + 1);
  return counterBehind(n - 1, a)! satisfies number;
}
function swapped(n: number, a: number, b: number): number {
  if (n === 0) return a * 1000 + b;
  if (n % 3 === 0) return swapped(n - 1, b, a)!;
  if (n % 3 === 1) return swapped(n - 1, a, b + 1);
  return swapped(n - 1, a + 1, b) as number;
}
function nested(n: number, a: number): number {
  if (n === 0) return a;
  return n % 2 === 1 ? nested(n - 1, a) : (Number(n), (n > 3 ? nested(n - 1, a + 1)! : nested(n - 1, a + 2) satisfies number)!);
}
function defaulted(n: number, a: number, b: number = 7): number {
  if (n === 0) return a + b;
  if (n % 2 === 1) return defaulted(n - 1, a, b);
  return defaulted(n - 1, a + 1)!;
}
function logical(n: number, a: number): number {
  if (n === 0) return a;
  if (n % 2 === 1) return logical(n - 1, a);
  return (n && logical(n - 1, a + 1)!)!;
}
function instantiated<T>(n: number, a: T[]): T[] {
  if (n === 0) return a;
  if (n % 2 === 1) return instantiated(n - 1, a);
  return instantiated<T>(n - 1, a.concat(a[0]!))! satisfies T[];
}
const arrow = (n: number, a: number): number => (n === 0 ? a : n % 2 === 1 ? arrow(n - 1, a) : arrow(n - 1, a + 1)!);
const wide = (n: number, a: number | string): number | string =>
  n === 0 ? a : n % 2 === 1 ? wide(n - 1, a) : (wide(n - 1, `${a}.`)! satisfies number | string);
for (const n of [0, 1, 2, 6, 7, 100]) {
  console.log(n, nonNull(n, 0), satisfied(n, 0), counter(0, n), counterBehind(n, 0), swapped(n, 1, 2), nested(n, 0));
  console.log(defaulted(n, 0, 1), logical(n, 0), instantiated(n, [1]).length, arrow(n, 0), String(wide(n, 5)).length);
}
function omitted(n: number, k: number, a: number = 5): number {
  if (n === 0) return a + k;
  if (n > 100) return omitted(n - 1, k, a + 1);
  return omitted(n - 1, k)!;
}
function omittedOrGiven(n: number, k: number, a: number = 5): number {
  if (n === 0) return a + k;
  if (n % 3 === 0) return omittedOrGiven(n - 1, k, a + 1);
  if (n % 3 === 1) return omittedOrGiven(n - 1, k + 1, undefined)!;
  return omittedOrGiven(n - 1, k) satisfies number;
}
function fewer(n: number, a?: number, b?: string): string {
  if (n === 0) return `${a} ${b}`;
  if (n > 100) return fewer(n - 1, 1, b);
  return (fewer as (n: number, a?: number) => string)(n - 1, a)!;
}
console.log(omitted(2, 1, 9), omitted(0, 1, 9), omitted(0, 1), omittedOrGiven(7, 1, 2), omittedOrGiven(6, 1), fewer(2, 1, "b"), fewer(0, 1, "b"));
export {};
