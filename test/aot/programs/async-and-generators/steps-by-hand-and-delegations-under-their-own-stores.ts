// An await goes on under the AsyncLocalStorage store that it was reached under, so whoever steps a shared async generator by `await generator.next()` keeps its own store,
// whichever store the generator is resumed under. A loop and `yield*` go on under the store that is active where their step is finished.
import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage<string>();
const lines: string[] = [];
async function* reads(name: string, count: number): AsyncGenerator<string> {
  for (let i = 0; i < count; i++) { await null; yield name + " " + i + " made under " + storage.getStore(); }
}
async function loop(name: string, source: AsyncIterable<string>): Promise<string> {
  for await (const value of source) lines.push(name + " under " + storage.getStore() + ": " + value);
  return name + " ends under " + storage.getStore();
}
async function byHand(name: string, source: AsyncGenerator<string>, awaitsFirst: boolean): Promise<string> {
  if (awaitsFirst) await null;
  for (let step = await source.next(); !step.done; step = await source.next()) lines.push(name + " under " + storage.getStore() + ": " + step.value);
  return name + " ends under " + storage.getStore();
}
async function* delegates(source: AsyncIterable<string>): AsyncGenerator<string> { yield* source; lines.push("delegator ends under " + storage.getStore()); }
async function* stepsByHand(name: string, source: AsyncGenerator<string>): AsyncGenerator<string> {
  for (let step = await source.next(); !step.done; step = await source.next()) yield name + " under " + storage.getStore() + ": " + step.value;
}
for (const awaitsFirst of [false, true]) {
  const shared = reads("by hand " + awaitsFirst, 5);
  lines.push(...(await Promise.all([storage.run("one", () => loop("a", shared)), storage.run("two", () => byHand("b", shared, awaitsFirst))])));
}
for (const awaitsFirst of [false, true]) {
  const shared = reads("both by hand " + awaitsFirst, 5);
  lines.push(...(await Promise.all([storage.run("one", () => byHand("a", shared, awaitsFirst)), storage.run("two", () => byHand("b", shared, awaitsFirst))])));
}
{
  const shared = reads("delegated", 5);
  lines.push(...(await Promise.all([storage.run("one", () => loop("a", delegates(shared))), storage.run("two", () => loop("b", delegates(shared)))])));
}
{
  const shared = reads("delegated, by hand", 5);
  lines.push(...(await Promise.all([storage.run("one", () => byHand("a", delegates(shared), false)), storage.run("two", () => byHand("b", delegates(shared), true))])));
}
{
  const shared = reads("by hand in a generator", 5);
  lines.push(...(await Promise.all([storage.run("one", () => loop("a", stepsByHand("p", shared))), storage.run("two", () => byHand("b", stepsByHand("q", shared), false))])));
}
{
  // Outside of every store, beside a loop under one.
  const shared = reads("outside", 4);
  lines.push(...(await Promise.all([storage.run("one", () => loop("a", shared)), byHand("b", shared, false), byHand("c", shared, true)])));
}
{
  // What is sent in arrives, and the steps of one function stand in their order.
  async function* echoes(): AsyncGenerator<string, void, string> { let got = "nothing"; for (let i = 0; i < 3; i++) got = yield "got " + got + " under " + storage.getStore(); }
  const shared = echoes();
  lines.push(await storage.run("one", async () => { const first = await shared.next("lost"); const second = await shared.next("x"); return first.value + " | " + second.value + " | " + storage.getStore(); }));
  lines.push(await storage.run("two", async () => { const third = await shared.next("y"); const last = await shared.next("z"); return third.value + " | " + last.done + " | " + storage.getStore(); }));
}
console.log(lines.join("\n"));
