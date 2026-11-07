// A call with a list lays the list out on the stack, and throws a RangeError where the list finds no room there. Every form of the call takes about as long a list and refuses a longer one:
// a spread, `call` with a spread and `apply`, in tail position and elsewhere, of a callee with a rest parameter, which a direct call hands the list itself, and of a callee that takes nothing.
// A short list that is spread into a rest parameter in tail position gives up the frame.
// The text brings the library's Function.prototype.call and Function.prototype.apply as the front end writes them. The engine's own `call` would lay the list out twice.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function count(...all) { return all.length; }
function nothing() { return "nothing"; }
function listOf(n) { const list = []; for (let i = 0; i < n; i++) list[i] = 1; return list; }
function answers(run, n) { try { return run(listOf(n)) === n; } catch (error) { if (!(error instanceof RangeError)) throw error; return false; } }
function mostOf(run) { let most = 1000, tooMany = 1200000; while (tooMany - most > 20000) { const middle = (most + tooMany) >> 1; if (answers(run, middle)) most = middle; else tooMany = middle; } return most; }
function hands(...all) { if (all[0] === 0) return all.length; all[0]--; return handsToo(...all); }
function handsToo(...all) { if (all[0] === 0) return -all.length; all[0]--; return hands(...all); }
const most = mostOf(list => count(...list));
const nearlyMost = Math.floor(most * 0.9);
report(most < 1100000);
report(answers(list => count.call(null, ...list), nearlyMost));
report(answers(list => count.apply(null, list), nearlyMost));
report(answers(list => count(...list), nearlyMost));
report(answers(list => { const n = count(...list); return n + 0; }, nearlyMost));
report(answers(list => (nothing(...list), list.length), nearlyMost));
report(answers(list => count(...list), 1100000));
report(answers(list => { const n = count(...list); return n + 0; }, 1100000));
report(answers(list => (nothing(...list), list.length), 1100000));
report(answers(list => count.call(null, ...list), 1100000));
report(hands(300000, 1, 2));
report("end");
