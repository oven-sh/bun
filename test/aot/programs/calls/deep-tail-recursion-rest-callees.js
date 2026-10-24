// A million calls deep through tail calls of a value that is, as expected, a closure of one function, which takes its arguments as a list: a rest parameter, `arguments`. In functions with loops and without.
function attempt(name, f) { try { console.log(name + ": " + f()); } catch (e) { console.log(name + ": " + e.constructor.name); } }
const N = 1_000_000;
function rest(n, f, ...more) { return n === 0 ? more.length : f(n - 1, f, 1, 2); }
attempt("a rest parameter", () => rest(N, rest));
function all(n, f) { return n === 0 ? arguments.length : f(n - 1, f); }
attempt("arguments", () => all(N, all));
function restBehindLoop(n, f, ...more) { let sum = 0; for (let i = 0; i < more.length; i++) sum += more[i]; return n === 0 ? sum : f(n - 1, f, 1, 2); }
attempt("a rest parameter, behind a loop", () => restBehindLoop(N, restBehindLoop));
function allBehindLoop(n, f) { let sum = 0; for (let i = 2; i < arguments.length; i++) sum += arguments[i]; return n === 0 ? sum : f(n - 1, f, 3, 4); }
attempt("arguments, behind a loop", () => allBehindLoop(N, allBehindLoop));
function restInLoop(n, f, ...more) { for (let i = 0; i < 2; i++) { if (n === 0) return more.length; if (i === 1) return f(n - 1, f, 1, 2, 3); } }
attempt("a rest parameter, in a loop", () => restInLoop(N, restInLoop));
const holder = { step(n, ...more) { let sum = 0; for (const x of more) sum += x; return n === 0 ? sum : this.step(n - 1, 5, 6); } };
attempt("a method with a rest parameter, behind a loop", () => holder.step(N));
function other(n, f, ...more) { return n === 0 ? "other " + more.length : f(n - 1, f, 1); }
attempt("not the closure that is expected", () => restBehindLoop(3, other) + " " + rest(3, other));
// Called in a loop.
function restCalledInLoop(n, f, ...more) { return n === 0 ? more.length : f(n - 1, f, 1, 2); }
function allCalledInLoop(n, f) { return n === 0 ? arguments.length : f(n - 1, f); }
for (let k = 0; k < 2; k++) {
  let said;
  try { said = restCalledInLoop(N, restCalledInLoop) + " " + allCalledInLoop(N, allCalledInLoop); } catch (e) { said = e.constructor.name; }
  console.log("called in a loop: " + said);
}
