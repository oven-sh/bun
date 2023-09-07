function fib(n = 0, a = 1n, b = 0n) {

  if (n <= 0) {
    return b;
  }

  return fib(n - 1, a + b, a);

}

console.log('fib 10_000', fib(10_000));
