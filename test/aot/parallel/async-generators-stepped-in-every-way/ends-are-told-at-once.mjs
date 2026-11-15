// The step that ends an async generator: what it answers, in which order beside other jobs, who is asked behind it, and that a generator that has ended stays so.
import { AsyncLocalStorage } from "node:async_hooks";
const out = [], als = new AsyncLocalStorage();
const log = text => out.push(text);
const soon = async n => { await null; return n; };
async function* none() {}
async function* some(n) { for (let i = 0; i < n; i++) yield i; }
async function* answers(n) { yield n; return soon("answer" + n); }
async function* leaves(n) { try { yield n; return "left"; } finally { log("finally" + n); await null; } }
async function* fails(n) { yield n; throw new Error("failed" + n); }
async function* relays(make, n) { const given = yield* make(n); log("given " + given); return "relayed"; }
async function* nests(depth) { if (depth) for await (const v of nests(depth - 1)) yield v; for await (const v of some(2)) yield v + depth; }
async function walk(label, it) { for await (const v of it) log(label + v); log(label + "end"); }
async function byHand(it) { const seen = []; for (let r; !(r = await it.next()).done;) seen.push(r.value); const last = await it.next(); return seen.join() + " " + last.value + last.done; }

for (let turn = 0; turn < 2; turn++) {
  await walk("n", none());
  await walk("s", some(3));
  await walk("l", leaves(turn));
  try { await walk("f", fails(turn)); } catch (e) { log(e.message); }
  await walk("r", relays(some, 2));
  await walk("a", relays(answers, turn));
  log(await byHand(some(3)));
  log(await byHand(answers(turn)));
  let total = 0;
  for await (const v of nests(5)) total += v;
  log("total " + total);
}
const it = answers(7);
log(JSON.stringify(await Promise.all([it.next(), it.next(), it.next(), it.return("x"), it.next()])));
const marks = [];
async function ticks(name, count) { for (let i = 0; i < count; i++) { await null; marks.push(name + i); } }
async function counts(name, make) { let n = 0; for (let i = 0; i < 4; i++) { for await (const v of make(1)) n += v + 1; marks.push(name + n); } }
await Promise.all([ticks("t", 12), counts("x", some), counts("y", n => relays(some, n)), ticks("u", 6)]);
log(marks.join(" "));
await als.run("outer", async () => {
  for await (const v of some(2)) log(als.getStore() + v);
  await als.run("inner", async () => { for await (const v of nests(1)) log(als.getStore() + v); });
  log(als.getStore());
});
let opened = 0;
for (let i = 0; i < 2000; i++) for await (const v of some(i & 3)) opened += v + 1;
log("opened " + opened);
for (const line of out) console.log(line);
