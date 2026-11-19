// answers: with-library
// # `yield v` of an async generator awaits v: a thenable is asked, a rejection is thrown where the yield stands, under its handler, and each step ends in its turn. If the one suspension that stands for the await and the yield lost a turn or a handler, the log against the ticks would differ. Loops alone step here: what next(), throw() and return() by hand do at such a yield stands in async-generator-yields-whatever-arrives.ir and in programs/async-generators-yield/
// # f1 = note, f3 = tick, f4 = values
// # RUN(FORM): walk f4:CoroutineBody mechanisms=all
// # FORM-LABEL: code f4:CoroutineBody
// # FORM: = AsyncGeneratorYield
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 32 of 32 of 32
// # CHECK-NEXT: exited with 0
const log = [];
function note(text) { log[log.length] = text; }
async function tick(name, turns) { for (let i = 0; i < turns; i++) { note(name + " " + i); await undefined; } }
async function* values(name) { note(name + " starts"); const first = yield 1; note(name + " got " + first); const second = yield { x: 2 }; note(name + " got " + second); return "over"; }
async function* thenables(name) { yield { then(resolve) { note(name + " then"); resolve("from then"); } }; yield Promise.resolve("from a promise"); }
async function* rejections(name) { try { yield Promise.reject("rejected"); note(name + " not here"); } catch (error) { note(name + " caught " + error); yield "goes on"; } }
async function* unguarded(name) { yield name + " first"; yield Promise.reject(name + " rejected"); note(name + " not here"); }
async function* guarded(name) { try { yield "first"; yield "second"; } finally { note(name + " cleans up"); } }
async function* inLoop(name, turns) { for (let i = 0; i < turns; i++) yield i * 2; }
function show(value) { return typeof value === "object" ? "x " + value.x : String(value); }
async function consume(name, made) { for await (const value of made) note(name + " got " + show(value)); note(name + " is through"); }
async function failing(name, made) { try { for await (const value of made) note(name + " got " + show(value)); note(name + " no throw"); } catch (error) { note(name + " failed " + error); } }
async function left(name, made) { for await (const value of made) { note(name + " leaves at " + value); break; } note(name + " behind the loop"); }
async function summed(name, made) { let sum = 0; for await (const value of made) sum += value; note(name + " sum " + sum); }
const ticks = tick("t", 12);
const all = [consume("a", values("a")), consume("b", thenables("b")), consume("c", rejections("c")), failing("d", unguarded("d")), left("e", guarded("e")), summed("f", inLoop("f", 4))];
for (let i = 0; i < all.length; i++) { await all[i]; }
await ticks;
for (let i = 0; i < log.length; i++) { report(log[i]); }
report("end");
