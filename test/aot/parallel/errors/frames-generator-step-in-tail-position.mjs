// Prints the frames of an error that the body of a generator throws, where the step that runs the body is the last thing a function of strict code does: that call takes the frame of the function out of the stack trace.
const frames = error => String(error.stack).split("\n").slice(1, 6).map(line => line.trim().replace(/^at /, "").replace(/\(?[^ (]*\.mjs:/, "(").replace(/^\((\d+:\d+)$/, "($1)")).join(" < ");
function attempt(label, run) { try { run(); console.log(label + ": nothing"); } catch (error) { console.log(label + ": " + frames(error)); } }
function* throwsAtOnce() { throw new Error("thrown"); }
function* throwsLater() { yield 1; throw new Error("thrown"); }
function* passesOn() { yield* throwsAtOnce(); }
async function* throwsAsync() { throw new Error("thrown"); }
const hide = value => [value, 0][Number(process.argv.length > 100)];
function madeHere() { return throwsAtOnce().next(); }
function madeHereKept() { const step = throwsAtOnce().next(); return step; }
function madeHereSecond() { const it = throwsLater(); it.next(); return it.next(); }
function handedIn(it) { return it.next(); }
function handedInWithValue(it) { return it.next(1); }
function handedInHidden(it) { return hide(it).next(); }
function throwsInto(it) { return it.throw(new Error("sent")); }
function returnsInto(it) { return it.return(1); }
function delegated() { return passesOn().next(); }
function byCall(it) { return it.next.call(it); }
function conditional(it) { return it ? it.next() : 0; }
function logical(it) { return it && it.next(); }
function inTry(it) { try { return it.next(); } finally { hide(0); } }
const arrow = it => it.next();
const holder = { method(it) { return it.next(); } };
class Wrapper { constructor(it) { this.it = it; } next() { return this.it.next(); } [Symbol.iterator]() { return this; } }
function spreads(it) { return [...new Wrapper(it)]; }
function loops(it) { for (const value of new Wrapper(it)) hide(value); }
attempt("madeHere", () => { madeHere(); });
attempt("madeHereKept", () => { madeHereKept(); });
attempt("madeHereSecond", () => { madeHereSecond(); });
attempt("handedIn", () => { handedIn(throwsAtOnce()); });
attempt("handedInWithValue", () => { handedInWithValue(throwsAtOnce()); });
attempt("handedInHidden", () => { handedInHidden(throwsAtOnce()); });
attempt("throwsInto", () => { throwsInto(throwsLater()); });
attempt("throwsInto started", () => { const it = throwsLater(); it.next(); throwsInto(it); });
attempt("returnsInto", () => { returnsInto(throwsLater()); });
attempt("delegated", () => { delegated(); });
attempt("byCall", () => { byCall(throwsAtOnce()); });
attempt("conditional", () => { conditional(throwsAtOnce()); });
attempt("logical", () => { logical(throwsAtOnce()); });
attempt("inTry", () => { inTry(throwsAtOnce()); });
attempt("arrow", () => { arrow(throwsAtOnce()); });
attempt("method", () => { holder.method(throwsAtOnce()); });
attempt("wrapper", () => { new Wrapper(throwsAtOnce()).next(); });
attempt("spreads", () => { spreads(throwsAtOnce()); });
attempt("loops", () => { loops(throwsAtOnce()); });
for (let round = 0; round < 3; round++) attempt("again " + round, () => { handedIn(round & 1 ? throwsAtOnce() : throwsLater()); handedIn(throwsAtOnce()); });
await throwsAsync().next().catch(error => console.log("async: " + frames(error)));
function asyncTail(it) { return it.next(); }
await asyncTail(throwsAsync()).catch(error => console.log("async tail: " + frames(error)));
