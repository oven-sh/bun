const isDev = false;
function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}
const R = fib(isDev ? 10 : 5);
console.log(R);
