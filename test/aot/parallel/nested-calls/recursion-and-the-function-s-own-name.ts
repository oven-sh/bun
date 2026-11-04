function outer(n: number) {
  const seen: unknown[] = [];
  return fact(n) + ":" + fib(n) + ":" + (seen[0] === seen[1]) + ":" + seen.length;
  function fact(k: number): number { return k <= 1 ? 1 : k * fact(k - 1); }
  function fib(k: number): number { if (k === 2) seen.push(fib); return k < 2 ? k : fib(k - 1) + fib(k - 2); }
}
console.log(outer(5), outer(6));
