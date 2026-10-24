// `using` in generators and async functions: the resources live across suspensions, and a generator can be closed early at every point.
const out = globalThis.console ? console.log : print;
let log = [];
const res = name => ({ [Symbol.dispose]() { log.push("d" + name); } });
const thr = name => ({ [Symbol.dispose]() { log.push("d" + name); throw "D" + name; } });
const show = e => e instanceof SuppressedError ? "S(" + show(e.error) + "/" + show(e.suppressed) + ")" : e instanceof Error ? e.name : e === undefined ? "undefined" : typeof e === "object" && e !== null ? ("done" in e ? "{" + show(e.value) + (e.done ? " done}" : "}") : "object") : typeof e === "function" ? "fn" : String(e);
function say(name, f) { log = []; let r; try { r = "-> " + show(f()); } catch (e) { r = "THROWN " + show(e); } out(name + ": " + r + " | " + log.join(" ")); }
const step = (g, how, v) => { try { const r = g[how](v); log.push(how[0] + show(r)); return r; } catch (e) { log.push(how[0] + "!" + show(e)); return { done: true }; } };

function* two(make) { log.push("s"); using a = make("a"); log.push("1"); yield 1; using b = make("b"); log.push("2"); yield 2; log.push("3"); return "end"; }
function* nested(make) { using a = make("a"); yield 1; { using b = make("b"), c = make("c"); yield 2; try { using d = make("d"); yield 3; } finally { log.push("f"); using e = make("e"); yield 4; } } yield 5; }
function* inLoop(make) { for (let i = 0; i < 3; i++) { using a = make("a" + i); yield i; log.push("e" + i); } }
function* inHead(make) { for (using a of [make("1"), make("2"), make("3")]) { yield 1; log.push("e"); } }
function* four(make) { using a = make("a"), b = make("b"), c = make("c"), d = make("d"); yield 1; yield 2; }
function* five(make) { using a = make("a"), b = make("b"), c = make("c"), d = make("d"), e = make("e"); yield 1; yield 2; }
function* delegates(make) { using a = make("o"); yield* two(make); log.push("back"); yield 9; }
function* catches(make) { try { using a = make("a"); yield 1; } catch (e) { log.push("c" + show(e)); using b = make("b"); yield 2; } yield 3; }
const generators = { two, nested, inLoop, inHead, four, five, delegates, catches };
for (const [name, generator] of Object.entries(generators)) for (const [kind, make] of [["good", res], ["throwing", thr]]) {
  say(name + ", " + kind + ", run to its end", () => { const g = generator(make); for (let i = 0; i < 9; i++) if (step(g, "next").done) break; return "end"; });
  for (let steps = 0; steps <= 4; steps++) {
    say(name + ", " + kind + ", return() behind " + steps + " steps", () => { const g = generator(make); for (let i = 0; i < steps; i++) step(g, "next"); step(g, "return", "R"); step(g, "next"); step(g, "return", "again"); return "end"; });
    say(name + ", " + kind + ", throw() behind " + steps + " steps", () => { const g = generator(make); for (let i = 0; i < steps; i++) step(g, "next"); step(g, "throw", "T"); step(g, "next"); return "end"; });
  }
  say(name + ", " + kind + ", a break out of for-of in the second round", () => { let n = 0; for (const v of generator(make)) { log.push("v" + v); if (++n === 2) break; } return "end"; });
  say(name + ", " + kind + ", a throw out of for-of in the first round", () => { for (const v of generator(make)) { log.push("v" + v); throw "B"; } return "end"; });
  say(name + ", " + kind + ", taken apart by a pattern", () => { const [x] = generator(make); return x; });
}
say("two generators of one function, step by step in turn", () => { const g = two(res), h = two(thr); step(g, "next"); step(h, "next"); step(g, "next"); step(h, "return", "R"); step(g, "return", "R"); return "end"; });
say("a disposer that steps the generator it belongs to", () => { let g; function* self() { using a = { [Symbol.dispose]() { log.push("d"); step(g, "next"); } }; yield 1; } g = self(); step(g, "next"); step(g, "return", "R"); return "end"; });
say("a disposer that runs another generator with a `using`", () => { function* outer() { using a = { [Symbol.dispose]() { log.push("d"); for (const v of two(res)) log.push("v" + v); } }; yield 1; } const g = outer(); step(g, "next"); step(g, "return", "R"); return "end"; });
say("a generator that yields in the initializer of a `using`", () => { function* g() { using a = res("a"), b = res(yield 1), c = res("c"); yield 2; } const i = g(); step(i, "next"); step(i, "next", "sent"); step(i, "return", "R"); return "end"; });
say("the same, closed at the yield in the initializer", () => { function* g() { using a = res("a"), b = res(yield 1), c = res("c"); yield 2; } const i = g(); step(i, "next"); step(i, "return", "R"); return "end"; });
say("the same, thrown into at the yield in the initializer", () => { function* g() { using a = thr("a"), b = res(yield 1), c = res("c"); yield 2; } const i = g(); step(i, "next"); step(i, "throw", "T"); return "end"; });

// Async functions and async generators: one row after the other, each with a ticker next to it that shows in which turn of the job queue each thing happens.
const rows = [];
const later = (name, f) => rows.push(async () => {
  log = []; let on = true; const ticker = (async () => { for (let i = 0; on && i < 30; i++) { await undefined; if (on) log.push("." ); } })();
  let r; try { r = "-> " + show(await f()); } catch (e) { r = "THROWN " + show(e); }
  on = false; await ticker; out(name + ": " + r + " | " + log.join(" "));
});
for (const [kind, make] of [["good", res], ["throwing", thr]]) for (const body of ["ends", "throws", "returns", "awaits what rejects"]) {
  const end = async () => { log.push("body"); if (body === "throws") throw "B"; if (body === "awaits what rejects") await Promise.reject("J"); return body === "returns" ? "R" : undefined; };
  later("async, " + kind + ", an await between two, the body " + body, async () => { using a = make("a"); await undefined; log.push("1"); using b = make("b"); await undefined; log.push("2"); return await end(); });
  later("async, " + kind + ", four and awaits, the body " + body, async () => { using a = make("a"), b = make("b"), c = make("c"), d = make("d"); await undefined; await undefined; return await end(); });
  later("async, " + kind + ", five and awaits, the body " + body, async () => { using a = make("a"), b = make("b"), c = make("c"), d = make("d"), e = make("e"); await undefined; await undefined; return await end(); });
  later("async, " + kind + ", in a loop with an await, the body " + body, async () => { for (let i = 0; i < 2; i++) { using a = make("a" + i); await undefined; log.push("e" + i); } return await end(); });
  later("async, " + kind + ", in the head of for-of with an await, the body " + body, async () => { for (using a of [make("1"), make("2")]) { await undefined; log.push("e"); } return await end(); });
  later("async, " + kind + ", an await in an initializer, the body " + body, async () => { using a = make("a"), b = make(await "b"), c = make("c"); return await end(); });
  later("an async arrow, " + kind + ", returned without an await, the body " + body, async () => { using a = make("a"); const p = end(); p.catch(() => {}); return p; });
}
async function* asyncTwo(make) { using a = make("a"); yield 1; await undefined; using b = make("b"); yield 2; return "end"; }
const stepLater = async (g, how, v) => { try { const r = await g[how](v); log.push(how[0] + show(r)); return r; } catch (e) { log.push(how[0] + "!" + show(e)); return { done: true }; } };
for (const [kind, make] of [["good", res], ["throwing", thr]]) {
  for (let steps = 0; steps <= 3; steps++) {
    later("an async generator, " + kind + ", return() behind " + steps + " steps", async () => { const g = asyncTwo(make); for (let i = 0; i < steps; i++) await stepLater(g, "next"); await stepLater(g, "return", "R"); await stepLater(g, "next"); return "end"; });
    later("an async generator, " + kind + ", throw() behind " + steps + " steps", async () => { const g = asyncTwo(make); for (let i = 0; i < steps; i++) await stepLater(g, "next"); await stepLater(g, "throw", "T"); return "end"; });
  }
  later("an async generator, " + kind + ", a break out of for await", async () => { for await (const v of asyncTwo(make)) { log.push("v" + v); break; } return "end"; });
  later("an async generator, " + kind + ", three calls queued at once", async () => { const g = asyncTwo(make); const all = [stepLater(g, "next"), stepLater(g, "return", "R"), stepLater(g, "next")]; await Promise.all(all); return "end"; });
  later("for await (using x of ..), " + kind, async () => { for await (using x of [make("1"), Promise.resolve(make("2"))]) { log.push("b"); await undefined; } return "end"; });
}
(async () => { for (const row of rows) await row(); })();
