// The recursive Fibonacci function.
function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2) }
console.log("fib", fib(30))
