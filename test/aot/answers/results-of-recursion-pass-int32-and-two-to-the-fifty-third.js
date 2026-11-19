// answers: without-library
// # The result of a function that calls itself is proven from itself. If a sum or a product of such results stayed an int32 or an integer, these would wrap or be exact where a double rounds.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 283 of 283 of 283
// # CHECK-NEXT: exited with 0
// # With no callee copied into its caller every call is a call, of the smallest function too.
// # RUN(CALLED): run-in-shell mechanisms=-Inlining $SHELL
// # CALLED: 283 of 283 of 283
// # CALLED-NEXT: exited with 0
function told(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(n % 1); report(typeof n); }
function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
function factorial(n) { return n < 2 ? 1 : n * factorial(n - 1); }
function doubledTimes(n, turns) { return turns === 0 ? n : doubledTimes(n, turns - 1) * 2; }
function doubled(n) { return n + n; }
function next(n) { return n + 1; }
function squared(n) { return n * n; }
function masked(n) { return (n + n) | 0; }
function depth(n) { return n === 0 ? 0 : 1 + depth(n - 1); }
function ackermann(m, n) { return m === 0 ? n + 1 : n === 0 ? ackermann(m - 1, 1) : ackermann(m - 1, ackermann(m, n - 1)); }
function isEven(n) { return n === 0 ? true : !isOdd(n - 1) === false; }
function isOdd(n) { return n === 0 ? false : !isEven(n - 1) === false; }
function halves(n) { return n < 1 ? n : halves(n / 2) + 1; }
told(fib(20));
told(fib(1));
told(factorial(5));
told(factorial(12));
told(factorial(13));
told(factorial(18));
told(factorial(19));
told(factorial(25));
told(factorial(171));
told(doubledTimes(1, 30));
told(doubledTimes(1, 31));
told(doubledTimes(1, 32));
told(doubledTimes(3, 53));
told(doubledTimes(-1, 31));
told(doubledTimes(-1, 32));
told(doubled(1073741823));
told(doubled(1073741824));
told(doubled(-1073741824));
told(doubled(-1073741825));
told(next(2147483646));
told(next(2147483647));
told(next(9007199254740991));
told(next(9007199254740992));
told(squared(46340));
told(squared(46341));
told(squared(94906267));
told(masked(1073741824));
told(masked(2147483647));
told(depth(1000));
told(ackermann(2, 3));
report(isEven(10));
report(isEven(7));
report(isOdd(7));
told(halves(10));
report("end");
