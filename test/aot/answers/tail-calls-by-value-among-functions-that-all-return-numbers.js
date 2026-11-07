// answers: without-library
// # Every function here returns a number, and still none of them may return it raw: an entry by value returns a boxed value, and a function that leaves by a jump into one returns what that one returns. So does whoever jumps to such a function. The rings are 300,000 calls deep.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 55 of 55 of 55
// # CHECK-NEXT: exited with 0
// # With no callee copied into its caller every call is a call, of the smallest function too.
// # RUN(CALLED): run-in-shell mechanisms=-Inlining $SHELL
// # CALLED: 55 of 55 of 55
// # CALLED-NEXT: exited with 0
function told(n) { report(n); report(n + 1); report(n * 2); report(n === n); report("" + n); report(typeof n); }
function bounce(n, total, next, other) { return n === 0 ? total * 1 : next(n - 1, total + 1, other, next); }
function hop(n, total, next, other) { return n === 0 ? total * 1 : next(n - 1, total + 2, other, next); }
function enter(n) { return bounce(n, 0, hop, bounce); }
function outer(n) { return enter(n); }
function viaDirect(n, total, back, other) { return n === 0 ? total * 1 : viaValue(n - 1, total + 1, other, back); }
function viaOther(n, total, back, other) { return n === 0 ? total * 1 : viaValue(n - 1, total + 0.5, other, back); }
function viaValue(n, total, back, other) { return back(n, total, back, other); }
function added(n) { return outer(n) + 1; }
told(bounce(3, 0, hop, bounce));
told(bounce(300000, 0, hop, bounce));
told(hop(300001, 0, hop, bounce));
told(enter(300000));
told(outer(300000));
told(added(300000));
told(viaDirect(3, 0, viaDirect, viaOther));
told(viaDirect(300000, 0, viaDirect, viaOther));
told(viaOther(300001, 0, viaDirect, viaOther));
report("end");
