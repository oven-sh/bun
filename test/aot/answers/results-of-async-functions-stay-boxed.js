// answers: without-library
// # What an async function returns goes into its promise, so it is boxed whatever is proven of it. What it calls and awaits may return raw.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 33 of 33 of 33
// # CHECK-NEXT: exited with 0
// # With no callee copied into its caller every call is a call, of the smallest function too.
// # RUN(CALLED): run-in-shell mechanisms=-Inlining $SHELL
// # CALLED: 33 of 33 of 33
// # CALLED-NEXT: exited with 0
function told(n) { report(n); report(n + 1); report(n * 2); report(n === n); report(typeof n); }
function half(n) { return n / 2; }
function isBig(n) { return n > 100; }
async function later(n) { return n * 2; }
async function laterFlag(n) { return n > 2; }
async function laterHalf(n) { return half(n); }
async function sum(a, b) { return (await later(a)) + (await later(b)); }
async function awaitsNumber(n) { return (await half(n)) + 1; }
async function awaitsFlag(n) { return (await isBig(n)) ? 1 : 2; }
report(typeof later(1));
report(typeof laterFlag(1));
told(await later(1.5));
told(await laterFlag(3));
told(await laterHalf(5));
told(await sum(1, 2));
told(await awaitsNumber(5));
told(await awaitsFlag(500));
report("end");
