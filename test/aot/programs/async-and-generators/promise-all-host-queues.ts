// `Promise.all([f(), g()])` with what only a whole runtime shows: unhandled rejections of calls whose list was never made, microtasks drained while the list is being made, AsyncLocalStorage, process.nextTick.
import { AsyncLocalStorage } from "node:async_hooks";
import { drainMicrotasks } from "bun:jsc";
const log: string[] = [];
const storage = new AsyncLocalStorage<string>();
const settled = Promise.resolve(0);

async function atOnce(n: number): Promise<number> {
  return n;
}
async function later(n: number, turns: number): Promise<number> {
  for (let i = 0; i < turns; i++) await settled;
  log.push("later ends " + n + " in " + storage.getStore());
  return n;
}
async function failsAtOnce(n: number): Promise<number> {
  throw new Error("fails at once " + n);
}
async function failsLater(n: number, turns: number): Promise<number> {
  for (let i = 0; i < turns; i++) await settled;
  throw new Error("fails later " + n);
}
function throwsPlainly(): number {
  throw new Error("thrown while the list is made");
}
function drains(n: number): number {
  log.push("draining " + n);
  drainMicrotasks();
  log.push("drained " + n);
  return n;
}
function pause(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 3));
}

process.on("unhandledRejection", reason => {
  log.push("unhandled: " + (reason as Error).message);
});
process.on("rejectionHandled", () => {
  log.push("handled late");
});

async function attempt(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    log.push(name + " gives " + JSON.stringify(await run()));
  } catch (error) {
    log.push(name + " throws " + (error as Error).message);
  }
  await pause();
}

async function main(): Promise<void> {
  await attempt("two fail", async () => await Promise.all([failsLater(1, 2), failsLater(2, 1), failsAtOnce(3)]));
  await attempt("the list is never made", async () => await Promise.all([failsLater(4, 1), failsAtOnce(5), later(6, 2), throwsPlainly()]));
  await attempt("drained between the calls", async () => await Promise.all([later(7, 1), later(8, 3), drains(9), atOnce(10)]));
  await attempt("a failure drained between the calls", async () => await Promise.all([failsLater(11, 1), drains(12), later(13, 1)]));
  await attempt("drained, then never made", async () => await Promise.all([failsLater(14, 1), later(15, 1), drains(16), throwsPlainly()]));
  await attempt("in a store", () => storage.run("outer", async () => {
    const values = await Promise.all([later(17, 1), storage.run("inner", () => later(18, 2)), atOnce(19)]);
    return [values, storage.getStore()];
  }));
  await attempt("with ticks", async () => {
    process.nextTick(() => log.push("a tick"));
    const values = await Promise.all([later(20, 1), atOnce(21)]);
    process.nextTick(() => log.push("another tick"));
    return values;
  });
}
main().then(() => console.log(log.join("\n")));
