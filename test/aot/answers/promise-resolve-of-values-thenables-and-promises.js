// answers: with-library
// # Promise.resolve makes a new promise for a value, asks a thenable, and hands back a promise whose constructor is the receiver. An await of a promise that was made and fulfilled on the spot takes as many turns as ever. If a promise with a `then` or a `constructor` of its own were taken for its value, or one promise stood for two, these would differ
// # wrapFor goes through `call`, which is written in the library: closed, the stand-in would answer undefined, and the read of `taken` off that would end the program, so the engine's own function runs
// # f1 = note, f2 = Other, f3 = tick, f4 = wrapNumber, f10 = awaitsAtOnce
// # LIBRARY: own
// # RUN(FORM): walk f4 mechanisms=all
// # FORM-LABEL: code f4:Body
// # FORM: FulfillFreshPromise
// # RUN(DROPPED): walk f10:CoroutineBody mechanisms=all
// # DROPPED-NOT: = NewPromise
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 44 of 44 of 44
// # CHECK-NEXT: exited with 0
const log = [];
function note(text) { log[log.length] = text; }
function Other(executor) { executor(value => { this.taken = value; }, () => { }); }
async function tick(name, turns) { for (let i = 0; i < turns; i++) { note(name + " " + i); await undefined; } }
function wrapNumber() { return Promise.resolve(1); }
function wrapNothing() { return Promise.resolve(); }
function wrapRecord(n) { return Promise.resolve({ x: n }); }
function wrapAny(value) { return Promise.resolve(value); }
function wrapTwice() { const first = Promise.resolve(2); return Promise.resolve(first) === first; }
function wrapFor(constructor, value) { return Promise.resolve.call(constructor, value); }
async function awaitsAtOnce(name) { const value = await Promise.resolve(3); note(name + " " + value); return value; }
async function awaitsLater(name) { const made = Promise.resolve(4); note(name + " made"); const value = await made; note(name + " " + value); return value; }
async function awaitsNamed(name) { const made = Promise.resolve(5); made.then = resolve => { note(name + " then of its own"); resolve("its own"); }; return await made; }
async function awaitsOther(name) { const made = Promise.resolve(6); made.constructor = Other; const value = await made; note(name + " " + value); return value; }
async function awaitsInLoop(name, turns) { let sum = 0; for (let i = 0; i < turns; i++) { sum += await Promise.resolve(i); note(name + " " + sum); } return sum; }
async function returns(name) { note(name + " returns"); return Promise.resolve(7); }
function follow(name, made) { made.then(value => { note(name + " settled " + (typeof value === "object" ? JSON.stringify(value) : value)); }, error => { note(name + " failed " + error); }); }
const ticks = tick("t", 9);
follow("number", wrapNumber());
follow("nothing", wrapNothing());
follow("record", wrapRecord(1));
follow("thenable", wrapAny({ then(resolve) { note("then is asked"); resolve("from then"); } }));
follow("promise", wrapAny(wrapNumber()));
follow("rejected", wrapAny(Promise.reject("no")));
follow("at once", awaitsAtOnce("a"));
follow("later", awaitsLater("b"));
follow("named", awaitsNamed("c"));
follow("other", awaitsOther("d"));
follow("loop", awaitsInLoop("e", 3));
follow("returned", returns("f"));
note("behind the calls");
report(wrapNumber() === wrapNumber());
report(wrapNumber() instanceof Promise);
report(wrapTwice());
const kept = wrapNumber();
report(wrapAny(kept) === kept);
report(wrapFor(Other, kept) === kept);
report(wrapFor(Other, kept).taken === kept);
report(wrapFor(Other, 8).taken);
report(wrapFor(Other, 8) instanceof Other);
try { wrapFor(undefined, 1); report("no throw"); } catch (error) { report(error instanceof TypeError); }
report(await wrapNumber());
report(await wrapNothing());
report((await wrapRecord(2)).x);
await ticks;
for (let i = 0; i < log.length; i++) { report(log[i]); }
report("end");
