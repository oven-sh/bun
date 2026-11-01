// Fibonacci pair overflows int32: compiled answers as plain.
function fib(n) {
  let a = 0,
    b = 1;
  while (n-- > 0) {
    [a, b] = [b, a + b];
  }
  return a;
}
console.log(fib(46), fib(47), fib(48), fib(78), fib(79));
