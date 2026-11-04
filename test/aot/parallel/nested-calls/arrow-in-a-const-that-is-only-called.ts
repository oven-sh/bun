function outer(a: number, b: number) {
  let n = 0;
  const add = (x: number): number => { n++; return x + a; };
  const twice = (x: number): number => add(add(x)) + b;
  return twice(1) + ":" + add(2) + ":" + n;
}
console.log(outer(10, 100), outer(1, 2));
