// `await f()` against process.nextTick, setImmediate, timers and queueMicrotask, with AsyncLocalStorage contexts, and what is reported as an unhandled rejection.
import { AsyncLocalStorage } from "node:async_hooks";
const log: string[] = [];
const storage = new AsyncLocalStorage<string>();
const settled = Promise.resolve(0);

async function quick(n: number): Promise<number> {
  return n * 3;
}
async function once(n: number): Promise<number> {
  const value = await quick(n);
  process.nextTick(() => log.push("tick from once " + n + " in " + storage.getStore()));
  return value + 1;
}
async function fails(n: number): Promise<number> {
  if (n > 0) throw new Error("fails " + n);
  return n;
}
async function failsLater(n: number): Promise<number> {
  await settled;
  if (n > 0) throw new Error("fails later " + n);
  return n;
}
async function readsStore(name: string): Promise<string> {
  const before = storage.getStore();
  await settled;
  return name + ": " + before + " then " + storage.getStore();
}
async function entersStore(name: string): Promise<string> {
  const inside = await storage.run(name, async () => {
    const first = await readsStore(name + " inside");
    return first + " | " + storage.getStore();
  });
  return inside + " | outside " + storage.getStore();
}
async function leavesStore(): Promise<string> {
  storage.enterWith("entered by the callee");
  await settled;
  return "callee has " + storage.getStore();
}
async function runner(name: string): Promise<void> {
  log.push(name + " begins in " + storage.getStore());
  for (let i = 0; i < 3; i++) {
    const value = await once(i);
    log.push(name + " step " + i + " = " + value + " in " + storage.getStore());
    if (i === 1) {
      queueMicrotask(() => log.push(name + " microtask in " + storage.getStore()));
      process.nextTick(() => log.push(name + " tick in " + storage.getStore()));
    }
  }
  await new Promise<void>(resolve => setImmediate(resolve));
  log.push(name + " after setImmediate " + (await quick(7)) + " in " + storage.getStore());
  await new Promise<void>(resolve => setTimeout(resolve, 1));
  log.push(name + " after a timer " + (await once(9)) + " in " + storage.getStore());
  log.push(await entersStore(name));
  log.push(name + ": " + (await leavesStore()) + ", caller has " + storage.getStore());
}

process.on("unhandledRejection", reason => {
  log.push("unhandled: " + (reason as Error).message);
});
process.on("rejectionHandled", () => {
  log.push("handled late");
});

async function main(): Promise<void> {
  process.nextTick(() => log.push("the first tick"));
  setImmediate(() => log.push("immediate"));
  const a = storage.run("A", () => runner("a"));
  const b = storage.run("B", () => runner("b"));
  log.push("main goes on");
  await Promise.all([a, b]);
  try { await fails(1); } catch (error) { log.push("caught " + (error as Error).message); }
  try { await failsLater(2); } catch (error) { log.push("caught " + (error as Error).message); }
  void fails(3);
  void failsLater(4);
  log.push("after " + (await fails(0)) + " " + (await failsLater(0)));
  await new Promise<void>(resolve => setTimeout(resolve, 5));
  const late = fails(5);
  await new Promise<void>(resolve => setTimeout(resolve, 5));
  try { await late; } catch (error) { log.push("caught late " + (error as Error).message); }
  await new Promise<void>(resolve => setTimeout(resolve, 5));
}
main().then(() => console.log(log.join("\n")));
