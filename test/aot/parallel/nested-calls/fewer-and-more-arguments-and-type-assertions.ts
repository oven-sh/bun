function outer() {
  const f = ((a?: number, b: number = 5, ...rest: number[]) => [a, b, rest.length].join("/")) as (...xs: number[]) => string;
  const g = (<T,>(x: T): T => x) satisfies <T>(x: T) => T;
  return [f(), f(1), f(1, 2), f(1, 2, 3, 4), (f as (...xs: number[]) => string)(9), g("s")].join(" ");
}
console.log(outer());
