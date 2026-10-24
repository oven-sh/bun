// AsyncLocalStorage: jobs that follow one another have captured different stores, and each runs under its own. Nothing of a job's store is left behind it.
import { AsyncLocalStorage } from "node:async_hooks";

const lines: string[] = [];
function log(line: string) { lines.push(line); }
const macrotask = () => new Promise<void>(resolve => setTimeout(resolve, 1));
let storage!: AsyncLocalStorage<string>;
const here = () => String(storage?.getStore());

async function waits(name: string, count: number) {
  for (let i = 0; i < count; i++) { await null; log(name + " behind await " + i + " under " + here()); }
  return name;
}
async function* yields(name: string, count: number): AsyncGenerator<string> {
  for (let i = 0; i < count; i++) { await null; yield name + " yields " + i + " under " + here(); }
}
async function consumes(name: string, count: number) {
  for await (const value of yields(name, count)) log(value + ", seen under " + here());
}

log("== the first store is made in the middle of a drain");
{
  const before = [waits("a", 3), consumes("b", 2)];
  Promise.resolve().then(() => {
    storage = new AsyncLocalStorage<string>();
    storage.run("first", () => {
      before.push(waits("c", 3), consumes("d", 2));
      Promise.resolve().then(() => log("a handler under " + here()));
      queueMicrotask(() => log("a queued function under " + here()));
    });
    log("behind run: " + here());
  });
  Promise.resolve().then(() => log("the next handler under " + here()));
  await Promise.all(before);
  log("behind all: " + here());
  await macrotask();
  log("in a timer's turn: " + here());
}

log("== side by side");
{
  async function request(name: string) {
    log(name + " starts under " + here());
    await waits(name + ".w", 2);
    await consumes(name + ".c", 2);
    await Promise.resolve().then(() => log(name + " handler under " + here())).then(() => log(name + " link under " + here()));
    await new Promise<void>(resolve => queueMicrotask(() => { log(name + " queued under " + here()); resolve(); }));
    await Promise.reject(new Error(name)).catch(() => log(name + " catch under " + here()));
    try { await Promise.reject(new Error(name)); } catch { log(name + " caught under " + here()); }
    return name + " ends under " + here();
  }
  const all = [storage.run("one", request, "r1"), request("r0"), storage.run("two", request, "r2"), storage.run("one", request, "r3")];
  for (const line of await Promise.all(all)) log(line);
  log("behind all: " + here());
}

log("== what a job leaves does not outlive it");
{
  Promise.resolve().then(() => { storage.enterWith("left by a handler"); log("entered: " + here()); });
  Promise.resolve().then(() => log("the next handler: " + here()));
  queueMicrotask(() => log("the next queued function: " + here()));
  (async () => { await null; log("a coroutine: " + here()); storage.enterWith("left by a coroutine"); await null; log("the same coroutine: " + here()); })();
  (async () => { await null; await null; await null; log("another coroutine: " + here()); })();
  await macrotask();
  log("in a timer's turn: " + here());
}

log("== a store is captured where the reaction is made, not where the promise settles");
{
  let settle!: (value: string) => void;
  const promise = new Promise<string>(resolve => { settle = resolve; });
  storage.run("maker", () => { promise.then(() => log("then under " + here())); (async () => { await promise; log("await under " + here()); })(); });
  promise.then(() => log("then under " + here()));
  storage.run("settler", () => settle("x"));
  await macrotask();
}

log("== nested and left");
{
  await storage.run("outer", async () => {
    await null;
    log("outer: " + here());
    await storage.run("inner", async () => { await null; log("inner: " + here()); await waits("n", 1); });
    log("outer again: " + here());
    storage.exit(() => { log("outside: " + here()); Promise.resolve().then(() => log("a handler made outside: " + here())); });
    await null;
    log("outer at the end: " + here());
  });
  log("behind: " + here());
}

log("== many");
{
  let wrong = 0;
  async function one(id: string) {
    for (let i = 0; i < 3; i++) { await null; if (here() !== id) wrong++; }
    for await (const value of yields(id, 2)) if (!value.endsWith("under " + id) || here() !== id) wrong++;
    await Promise.resolve().then(() => { if (here() !== id) wrong++; });
  }
  const all: Promise<void>[] = [];
  for (let i = 0; i < 2000; i++) all.push(storage.run("s" + (i % 7), one, "s" + (i % 7)));
  await Promise.all(all);
  log("wrong " + wrong);
}
console.log(lines.join("\n"));
