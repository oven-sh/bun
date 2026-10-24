// A loop over the result of a generator function written beside it, left in every way a loop can be left, while the generator holds handlers of its own.
const log = [];
const say = (...a) => { log.push(a.join(" ")); };
function* plain(n) { for (let i = 0; i < n; i++) yield i; return "end"; }
function* withFinally(n) { try { for (let i = 0; i < n; i++) yield i; } finally { say("finally"); } }
function* withCatch(n) { for (let i = 0; i < n; i++) { try { yield i; } catch (e) { say("generator caught", e); } } }
function* withCatchAndFinally(n) { try { try { for (let i = 0; i < n; i++) yield i; } catch (e) { say("generator caught", e); yield -1; } } finally { say("outer finally"); } }
function* finallyThrows(n) { try { for (let i = 0; i < n; i++) yield i; } finally { say("finally throws"); throw "from finally"; } }
function* finallyYields(n) { try { for (let i = 0; i < n; i++) yield i; } finally { say("finally yields"); yield 99; say("behind the yield"); } }
function* finallyReturns(n) { try { for (let i = 0; i < n; i++) yield i; } finally { say("finally returns"); return 7; } }
function* readsSent(n) { for (let i = 0; i < n; i++) { const r = yield i; say("sent", r); } }
function* nestedFinally(n) { try { try { for (let i = 0; i < n; i++) yield i; } finally { say("inner"); } } finally { say("outer"); } }
function* throwsItself(n) { for (let i = 0; i < n; i++) { if (i === 2) throw "from generator"; yield i; } }
function* lazy(n) { say("started", n); yield n; }
function* usesArguments() { for (let i = 0; i < arguments.length; i++) yield arguments[i]; }
function* defaults(a = say("default") || 2) { yield a; }
function* delegates(n) { yield* withFinally(n); say("behind delegate"); }
function* inner(n) { for (const x of withFinally(n)) yield x * 2; }
const all = { plain, withFinally, withCatch, withCatchAndFinally, finallyThrows, finallyYields, finallyReturns, readsSent, nestedFinally, throwsItself, delegates, inner };

function toTheEnd_plain() { let s = 0; for (const x of plain(4)) s += x; return s; }
function make(name, g) {
  return {
    toTheEnd() { let s = 0; for (const x of g(4)) s += x; return s; },
    breaks() { let s = 0; for (const x of g(4)) { s += x; if (x === 1) break; } return s; },
    returns() { for (const x of g(4)) { if (x === 1) return "returned " + x; } return "fell out"; },
    throws() { for (const x of g(4)) { if (x === 1) throw "from body"; } return "fell out"; },
    continues() { let s = 0; for (const x of g(4)) { if (x === 1) continue; s += x; } return s; },
    breaksOuter() { let s = 0; outer: for (let k = 0; k < 2; k++) { for (const x of g(4)) { s += x; if (x === 1) break outer; } } return s; },
    continuesOuter() { let s = 0; outer: for (let k = 0; k < 2; k++) { for (const x of g(4)) { s += x; if (x === 1) continue outer; } } return s; },
    catchesInBody() { let s = 0; for (const x of g(4)) { try { if (x === 1) throw "inside"; s += x; } catch (e) { say("body caught", e); } } return s; },
    closures() { const fs = []; for (const x of g(3)) fs.push(() => x); return fs.map(f => f()).join(); },
  };
}
// Written out for each generator, so that each loop stands beside a call of one function.
const forms = {};
forms.plain = { toTheEnd() { let s = 0; for (const x of plain(4)) s += x; return s; }, breaks() { let s = 0; for (const x of plain(4)) { s += x; if (x === 1) break; } return s; }, throws() { for (const x of plain(4)) { if (x === 1) throw "from body"; } } };
forms.withFinally = { toTheEnd() { let s = 0; for (const x of withFinally(4)) s += x; return s; }, breaks() { let s = 0; for (const x of withFinally(4)) { s += x; if (x === 1) break; } return s; }, returns() { for (const x of withFinally(4)) { if (x === 1) return "r" + x; } }, throws() { for (const x of withFinally(4)) { if (x === 1) throw "from body"; } }, outer() { let s = 0; o: for (let k = 0; k < 2; k++) for (const x of withFinally(4)) { s += x; if (x === 1) continue o; } return s; } };
forms.withCatch = { toTheEnd() { let s = 0; for (const x of withCatch(4)) s += x; return s; }, throws() { for (const x of withCatch(4)) { if (x === 1) throw "from body"; } }, calls() { for (const x of withCatch(4)) { if (x === 1) thrower(); } } };
forms.withCatchAndFinally = { throws() { for (const x of withCatchAndFinally(4)) { if (x === 1) throw "from body"; } }, breaks() { for (const x of withCatchAndFinally(4)) { if (x === 1) break; } return "ok"; }, nullRead() { for (const x of withCatchAndFinally(4)) { if (x === 1) nothing().y; } } };
forms.finallyThrows = { toTheEnd() { let s = 0; for (const x of finallyThrows(2)) s += x; return s; }, breaks() { for (const x of finallyThrows(4)) { if (x === 1) break; } return "ok"; }, throws() { for (const x of finallyThrows(4)) { if (x === 1) throw "from body"; } }, returns() { for (const x of finallyThrows(4)) { if (x === 1) return "r"; } } };
forms.finallyYields = { toTheEnd() { let s = 0; for (const x of finallyYields(2)) s += x; return s; }, breaks() { for (const x of finallyYields(4)) { if (x === 1) break; } return "ok"; }, throws() { for (const x of finallyYields(4)) { if (x === 1) throw "from body"; } } };
forms.finallyReturns = { toTheEnd() { let s = 0; for (const x of finallyReturns(2)) s += x; return s; }, breaks() { for (const x of finallyReturns(4)) { if (x === 1) break; } return "ok"; }, throws() { for (const x of finallyReturns(4)) { if (x === 1) throw "from body"; } } };
forms.readsSent = { toTheEnd() { let s = 0; for (const x of readsSent(3)) s += x; return s; } };
forms.nestedFinally = { breaks() { for (const x of nestedFinally(4)) { if (x === 1) break; } return "ok"; }, throws() { for (const x of nestedFinally(4)) { if (x === 1) throw "from body"; } } };
forms.throwsItself = { toTheEnd() { let s = 0; for (const x of throwsItself(4)) s += x; return s; }, caught() { let s = 0; try { for (const x of throwsItself(4)) s += x; } catch (e) { return s + " " + e; } } };
forms.lazy = { order() { for (const x of lazy(say("argument") || 5)) say("body", x); } };
forms.usesArguments = { toTheEnd() { let s = ""; for (const x of usesArguments("a", "b", "c")) s += x; return s; } };
forms.defaults = { toTheEnd() { let s = 0; for (const x of defaults()) s += x; return s; } };
forms.delegates = { breaks() { for (const x of delegates(4)) { if (x === 1) break; } return "ok"; }, toTheEnd() { let s = 0; for (const x of delegates(3)) s += x; return s; } };
forms.inner = { breaks() { for (const x of inner(4)) { if (x === 2) break; } return "ok"; }, throws() { for (const x of inner(4)) { if (x === 2) throw "from body"; } }, toTheEnd() { let s = 0; for (const x of inner(3)) s += x; return s; } };
function thrower() { throw "from callee"; }
function nothing() { return null; }
for (let round = 0; round < 3; round++) {
  for (const g in forms) for (const f in forms[g]) {
    let r; try { r = "-> " + forms[g][f](); } catch (e) { r = "threw " + (e instanceof Error ? e.name : e); }
    say(round, g, f, r);
  }
  for (const g in all) { const m = make(g, all[g]); for (const f in m) { let r; try { r = "-> " + m[f](); } catch (e) { r = "threw " + e; } say(round, "by value", g, f, r); } }
}
console.log(log.join("\n"));
