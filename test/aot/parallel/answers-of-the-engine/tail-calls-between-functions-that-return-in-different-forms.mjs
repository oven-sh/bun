// Whoever is jumped to returns in place of the caller, so a jump needs one form on both sides: an int32 is no double, and neither is a boxed value. The rings are 300,000 calls deep: each call in them has to stay a jump, by value too.
// With no callee copied into its caller every call is a call, of the smallest function too.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function told(n) { report(n); report(n + 1); report(n * 2); report(n === n); report("" + n); report(typeof n); }
function small(n) { return n | 0; }
function wide(n) { return n > 0 ? small(n) : 0.5; }
function loose(n) { return n > 1 ? wide(n) : undefined; }
function flag(n) { return n > 2 ? loose(n) : true; }
function isSmall(n) { return n < 10; }
function flagOrWide(n) { return n > 3 ? isSmall(n) : wide(n); }
function narrow(n) { return small(n); }
function narrower(n) { return narrow(n); }
function countDown(n, total) { return n === 0 ? total : countDown(n - 1, total + n); }
function isEvenDeep(n) { return n === 0 ? true : isOddDeep(n - 1); }
function isOddDeep(n) { return n === 0 ? false : isEvenDeep(n - 1); }
function ping(n, total) { return n === 0 ? total : pong(n - 1, total + 0.5); }
function pong(n, total) { return n === 0 ? total | 0 : ping(n - 1, total + 1); }
function through(f, n) { return f(n); }
function bounce(n, total, next) { return n === 0 ? total : next(n - 1, total + 1, bounce); }
function hop(n, total, next) { return n === 0 ? total : next(n - 1, total + 2, hop); }
function viaDirect(n, total) { return n === 0 ? total : viaValue(n - 1, total + 1, viaDirect); }
function viaValue(n, total, back) { return back(n, total); }
function continued(n, k) { return n === 0 ? k(0) : continued(n - 1, k); }
function plusOne(n) { return n + 1; }
function steps(n, k) { return n === 0 ? k(0) : steps(n - 1, function (v) { return k(v + 1); }); }
function itself(v) { return v; }
told(small(7.5));
told(wide(7.5));
told(wide(-1));
told(loose(7.5));
told(loose(1));
told(flag(7.5));
told(flag(2));
told(flagOrWide(5));
told(flagOrWide(50));
told(flagOrWide(2.5));
told(flagOrWide(-2.5));
told(narrower(4294967299.5));
told(countDown(10, 0));
told(countDown(300000, 0));
report(isEvenDeep(300000));
report(isEvenDeep(300001));
told(ping(300000, 0));
told(ping(300001, 0));
told(through(small, 3.5));
told(through(wide, -3.5));
told(through(isSmall, 3.5));
told(through(loose, 0));
told(bounce(300000, 0, bounce));
told(bounce(300000, 0, hop));
told(viaDirect(300000, 0));
told(continued(300000, plusOne));
told(steps(1000, itself));
report("end");
