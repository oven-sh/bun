// Blocks of plain `using` inside or around blocks with `await using`.
const out = globalThis.console ? console.log : print;
let log = [];
using topPlain = { [Symbol.dispose]() { out("the top of the module: the plain one is disposed of, last"); } };
await using topAwaited = { async [Symbol.asyncDispose]() { out("the top of the module: the awaited one begins"); await undefined; out("the top of the module: the awaited one ends"); } };
const res = name => ({ [Symbol.dispose]() { log.push("d" + name); } });
const thr = name => ({ [Symbol.dispose]() { log.push("d" + name); throw "D" + name; } });
const ares = name => ({ async [Symbol.asyncDispose]() { log.push("a" + name); await undefined; log.push("A" + name); } });
const athr = name => ({ async [Symbol.asyncDispose]() { log.push("a" + name); await undefined; log.push("A" + name); throw "D" + name; } });
const atOnce = name => ({ [Symbol.asyncDispose]() { log.push("a" + name); throw "D" + name; } });
const plainValue = name => ({ [Symbol.asyncDispose]() { log.push("a" + name); return "ignored"; } });
const both = name => ({ [Symbol.dispose]() { log.push("d" + name); }, [Symbol.asyncDispose]() { log.push("a" + name); } });
const thenable = name => ({ [Symbol.asyncDispose]() { log.push("a" + name); return { then(f) { log.push("then" + name); f(); } }; } });
const boom = name => { log.push("i" + name); throw "I" + name; };
const show = e => e instanceof SuppressedError ? "S(" + show(e.error) + "/" + show(e.suppressed) + ")" : e instanceof Error ? e.name : e === undefined ? "undefined" : typeof e === "object" && e !== null ? ("done" in e ? "{" + show(e.value) + (e.done ? " done}" : "}") : "object") : typeof e === "function" ? "fn" : String(e);
async function later(name, f) {
  log = []; let on = true; const ticker = (async () => { for (let i = 0; on && i < 40; i++) { await undefined; if (on) log.push("."); } })();
  let r; try { r = "-> " + show(await f()); } catch (e) { r = "THROWN " + show(e); }
  on = false; await ticker; out(name + ": " + r + " | " + log.join(" "));
}
const makers = { ares, athr, atOnce, plainValue, both, thenable, "a plain one": res, "a plain one that throws": thr };
for (const [kind, make] of Object.entries(makers)) for (const body of ["ends", "throws", "returns"]) {
  const end = () => { log.push("body"); if (body === "throws") throw "B"; return body === "returns" ? "R" : undefined; };
  await later("await using, " + kind + ", the body " + body, async () => { await using a = make("a"); return end(); });
  await later("await using, two of " + kind + ", the body " + body, async () => { await using a = make("a"), b = make("b"); return end(); });
  await later("a plain one and then await using " + kind + " in one block, the body " + body, async () => { using p = res("p"); await using a = make("a"); return end(); });
  await later("await using " + kind + " and then a plain one in one block, the body " + body, async () => { await using a = make("a"); using p = thr("p"); return end(); });
  await later("a block of plain ones in a block with await using " + kind + ", the body " + body, async () => { await using a = make("a"); { using p = res("p"), q = thr("q"); log.push("in"); } return end(); });
  await later("a block with await using " + kind + " in a block of plain ones, the body " + body, async () => { using p = res("p"), q = thr("q"); { await using a = make("a"); log.push("in"); } return end(); });
  await later("for (await using x of ..), " + kind + ", the body " + body, async () => { for (await using x of [make("1"), make("2")]) { log.push("b"); } return end(); });
  await later("for await (await using x of ..), " + kind + ", the body " + body, async () => { for await (await using x of [make("1"), Promise.resolve(make("2"))]) { log.push("b"); } return end(); });
}
for (const value of [null, undefined]) {
  await later("await using " + value + " alone: is there a turn of the queue", async () => { { await using a = value; log.push("body"); } log.push("after"); return "R"; });
  await later("await using " + value + " and a plain one", async () => { { using p = res("p"); await using a = value; log.push("body"); } log.push("after"); return "R"; });
  await later("await using " + value + " and one that is awaited", async () => { { await using a = value, b = ares("b"); log.push("body"); } log.push("after"); return "R"; });
  await later("await using " + value + ", the body throws", async () => { await using a = value; throw "B"; });
}
await later("await using what has no method", async () => { await using p = ares("p"), a = {}; return "R"; });
await later("await using a number", async () => { await using p = ares("p"), a = 7; return "R"; });
await later("await using: asyncDispose is undefined, dispose is there", async () => { await using a = { [Symbol.asyncDispose]: undefined, [Symbol.dispose]() { log.push("d"); } }; return "R"; });
await later("await using: asyncDispose is null, dispose is there", async () => { await using a = { [Symbol.asyncDispose]: null, [Symbol.dispose]() { log.push("d"); } }; return "R"; });
await later("await using: asyncDispose is no function", async () => { await using a = { [Symbol.asyncDispose]: 1, [Symbol.dispose]() { log.push("d"); } }; return "R"; });
await later("await using: a plain dispose that returns a promise that rejects", async () => { await using a = { [Symbol.dispose]() { log.push("d"); const p = Promise.reject("ignored"); p.catch(() => {}); return p; } }; return "R"; });
await later("await using: the methods are read by getters, where it is declared", async () => { await using a = { get [Symbol.asyncDispose]() { log.push("getA"); return undefined; }, get [Symbol.dispose]() { log.push("getD"); return () => log.push("d"); } }; log.push("body"); return "R"; });
await later("await using: the second initializer throws", async () => { await using a = athr("a"), b = boom("b"); return "R"; });
await later("await using: an await in an initializer", async () => { await using a = ares("a"), b = ares(await "b"); return "R"; });
await later("await using: five, every other one plain", async () => { await using a = athr("a"); using b = thr("b"); await using c = athr("c"); using d = thr("d"); await using e = athr("e"); throw "B"; });
await later("await using in a loop with break, continue", async () => { for (let i = 0; i < 4; i++) { await using a = ares(i); if (i === 1) continue; if (i === 2) break; log.push("e" + i); } return "R"; });
await later("await using in a block in a case", async () => { for (let k = 0; k < 2; k++) switch (k) { case 0: { await using a = ares("0"); using p = res("p"); log.push("c0"); } case 1: { using q = res("q"); log.push("c1"); break; } } return "R"; });
await later("await using in try, catch and finally", async () => { try { await using a = athr("a"); throw "B"; } catch (e) { log.push("c" + show(e)); await using b = ares("b"); } finally { await using c = ares("c"); using p = res("p"); log.push("f"); } return "R"; });
async function* awaited(make) { await using a = make("a"); yield 1; using p = res("p"); yield 2; await using b = make("b"); yield 3; }
const step = async (g, how, v) => { try { const r = await g[how](v); log.push(how[0] + show(r)); return r; } catch (e) { log.push(how[0] + "!" + show(e)); return { done: true }; } };
for (const [kind, make] of [["ares", ares], ["athr", athr]]) for (let steps = 0; steps <= 4; steps++) {
  await later("an async generator with both kinds, " + kind + ", return() behind " + steps + " steps", async () => { const g = awaited(make); for (let i = 0; i < steps; i++) await step(g, "next"); await step(g, "return", "R"); await step(g, "next"); return "end"; });
  await later("an async generator with both kinds, " + kind + ", throw() behind " + steps + " steps", async () => { const g = awaited(make); for (let i = 0; i < steps; i++) await step(g, "next"); await step(g, "throw", "T"); return "end"; });
}
await later("two async functions with `using` of both kinds, side by side", async () => { const one = async n => { using p = res("p" + n); await using a = ares(n); await undefined; log.push("b" + n); }; await Promise.all([one(1), one(2)]); return "R"; });
// ROWS ADDED WITH au1. What Symbol.asyncDispose returns is awaited WHATEVER IT IS, null too (compiled code took the method's own null for its word "needs no await"); and the await that a null | undefined owes is DEFERRED: it comes ahead of the next plain `using`, or at the end, and only if nothing was awaited.
const returnsNull = name => ({ [Symbol.asyncDispose]() { log.push("a" + name); return null; } });
const returnsRejected = name => ({ [Symbol.dispose]() { log.push("d" + name); const p = Promise.reject("ignored"); p.catch(() => {}); return p; } });
const returnsThenable = name => ({ [Symbol.dispose]() { log.push("d" + name); return { then(f) { log.push("then" + name); f(); } }; } });
for (const body of ["ends", "throws"]) {
  const end = () => { log.push("body"); if (body === "throws") throw "B"; };
  await later("asyncDispose returns null, the body " + body, async () => { await using a = returnsNull("a"); end(); });
  await later("asyncDispose returns null, twice, the body " + body, async () => { await using a = returnsNull("a"), b = returnsNull("b"); end(); });
  await later("asyncDispose returns null, then a plain one, the body " + body, async () => { using p = res("p"); await using a = returnsNull("a"); end(); });
  await later("a plain dispose under await using returns a promise that rejects, twice, the body " + body, async () => { await using a = returnsRejected("a"), b = returnsRejected("b"); end(); });
  await later("a plain dispose under await using returns a thenable, the body " + body, async () => { await using a = returnsThenable("a"); end(); });
  await later("a plain dispose under await using throws, then one that is awaited, the body " + body, async () => { await using a = ares("a"), b = thr("b"); end(); });
  for (const value of [null, undefined]) {
    await later("one that is awaited, then " + value + " (which is disposed of FIRST), the body " + body, async () => { await using a = ares("a"), b = value; end(); });
    await later("one that throws at once, then " + value + ", the body " + body, async () => { await using a = atOnce("a"), b = value; end(); });
    await later(value + ", then one that throws at once, the body " + body, async () => { await using a = value, b = atOnce("b"); end(); });
    await later("a plain one, then " + value + ": the await comes AHEAD of the plain one, the body " + body, async () => { using p = res("p"); await using a = value; end(); });
    await later("a plain one, " + value + ", a plain one, " + value + ", the body " + body, async () => { using p = res("p"); await using a = value; using q = thr("q"); await using b = value; end(); });
    await later(value + " three times, the body " + body, async () => { await using a = value, b = value, c = value; end(); });
    await later("a plain dispose under await using, then " + value + ", the body " + body, async () => { await using a = res("a"), b = value; end(); });
    await later(value + ", a plain one, one that is awaited, the body " + body, async () => { await using a = value; using p = res("p"); await using b = ares("b"); end(); });
  }
}
out("the last statement of the module");
