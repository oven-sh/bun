// answers: without-library
// # Link's effects of a function are believed by every caller, and no door stands at them. So they lean on no type of a place: a call of what a variable, a field, a list or another call gives is any code, whatever Link lists as its callee.
// # A parameter that is called: any code for the function; its effects given the arguments name the parameter, and the caller adds the effects of the closure that it is SHOWN to hand over (walk/AOTWalkKnownEffects.cpp).
// # A closure that the body itself makes comes through no place: its effects count as before.
// # f3 = byVariable, f4 = byField, f5 = byContents, f6 = byResult, f7 = byParameter, f8 = madeHere, f9 = named
// # RUN(LINK): link functions mechanisms=all
// # LINK: function f3 {{*}}mayCallUnknownCode
// # LINK: function f4 {{*}}mayCallUnknownCode
// # LINK: function f5 {{*}}mayCallUnknownCode
// # LINK: function f6 {{*}}mayCallUnknownCode
// # LINK: function f7 {{*}}mayCallUnknownCode
// # LINK: given-arguments called=[0] {{*}}returns=[mayThrow, mayThrowByRule, mayCollect]
// # LINK: function f8 {{*}}returns=[mayThrow, mayCollect]
// # `quiet` is handed about as a value, so `quiet(n)` reads it out of its variable.
// # LINK: function f9 {{*}}mayCallUnknownCode
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
function quiet(n) { return n + 1; }
let current = quiet;
const holder = { run: quiet, spare: 0 };
const list = [quiet];
function pick() { return quiet; }
function byVariable(n) { return current(n); }
function byField(n) { const run = holder.run; return run(n); }
function byContents(n) { const run = list[0]; return run(n); }
function byResult(n) { return pick()(n); }
function byParameter(handler, n) { return handler(n); }
function madeHere(n) { const add = (m) => m + n; return add(1); }
function named(n) { return quiet(n); }
report(byVariable(1) + byField(2) + byContents(3) + byResult(4) + byParameter(quiet, 5) + madeHere(6) + madeHere(-1) + named(7));
report("end");
