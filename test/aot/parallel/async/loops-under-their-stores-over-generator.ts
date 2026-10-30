// Several loops, each under an AsyncLocalStorage store of its own, step one async generator or one wrapped iterator. A loop goes on under the store that is active where its step is finished,
// from its first step on: whether or not the function of the loop has been suspended before makes no difference. (Node gives each loop its own store back.)
import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage<string>();
const lines: string[] = [];
async function* reads(name: string, count: number): AsyncGenerator<string> {
  for (let i = 0; i < count; i++) { await null; yield name + " " + i + " made under " + storage.getStore(); }
}
async function loop(name: string, source: AsyncIterable<string>): Promise<string> {
  for await (const value of source) lines.push(name + " under " + storage.getStore() + ": " + value);
  await null;
  return name + " ends under " + storage.getStore();
}
async function loopBehindAnAwait(name: string, source: AsyncIterable<string>): Promise<string> {
  await null;
  for await (const value of source) lines.push(name + " under " + storage.getStore() + ": " + value);
  return name + " ends under " + storage.getStore();
}
async function* passesOn(name: string, source: AsyncIterable<string>): AsyncGenerator<string> {
  for await (const value of source) yield name + " under " + storage.getStore() + ": " + value;
}
{
  const shared = storage.run("maker", () => reads("two", 4));
  lines.push(...(await Promise.all([storage.run("one", () => loop("a", shared)), storage.run("two", () => loop("b", shared))])));
}
{
  const shared = reads("three", 7);
  lines.push(...(await Promise.all([storage.run("one", () => loop("a", shared)), storage.run("two", () => loop("b", shared)), storage.run("three", () => loop("c", shared))])));
}
{
  const shared = reads("behind an await", 5);
  lines.push(...(await Promise.all([storage.run("one", () => loopBehindAnAwait("a", shared)), storage.run("two", () => loop("b", shared)), storage.run("three", () => loopBehindAnAwait("c", shared))])));
}
{
  const shared = reads("through generators", 4);
  lines.push(...(await Promise.all([storage.run("one", () => loop("a", passesOn("p", shared))), storage.run("two", () => loop("b", passesOn("q", shared)))])));
}
{
  // The generator is done when the second loop comes.
  const shared = reads("done", 1);
  lines.push(await storage.run("one", () => loop("a", shared)));
  lines.push(await storage.run("two", () => loop("b", shared)));
}
async function overAList(name: string, list: Iterable<string | Promise<string>>): Promise<string> {
  for await (const value of list) lines.push(name + " under " + storage.getStore() + ": " + value);
  return name + " ends under " + storage.getStore();
}
function* sync(): Generator<string> { yield "x under " + storage.getStore(); yield "y under " + storage.getStore(); yield "z under " + storage.getStore(); }
{
  lines.push(...(await Promise.all([storage.run("one", () => overAList("a", ["l", Promise.resolve("m")])), storage.run("two", () => overAList("b", ["n", Promise.resolve("o")]))])));
  const shared = sync();
  lines.push(...(await Promise.all([storage.run("one", () => overAList("a", shared)), storage.run("two", () => overAList("b", shared))])));
}
{
  // By hand beside a loop.
  const shared = reads("by hand", 4);
  const looped = storage.run("one", () => loop("a", shared));
  const stepped = storage.run("two", async () => { const step = await shared.next(); return "by hand under " + storage.getStore() + ": " + step.value; });
  lines.push(await stepped, await looped);
}
console.log(lines.join("\n"));
