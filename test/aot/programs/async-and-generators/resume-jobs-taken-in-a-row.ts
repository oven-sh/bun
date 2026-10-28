// A thousand async functions wait for one promise. Once it is settled the jobs that resume them lie in the queue one behind the other and run in that order, and whatever lies between them keeps
// its place: a then() handler, a queueMicrotask() callback, functions that wait for a rejected promise, bodies of async generators. With an AsyncLocalStorage in use every function goes on in
// its own context. A Worker that does nothing but resume async functions for ever can be terminated. This file is the only entry point of the build, so it is also that of each Worker.
import { AsyncLocalStorage } from "node:async_hooks";

type Events = (number | string)[];
const settled = Promise.resolve();
const lines: string[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function afterTimer(): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}
// Numbers that follow each other are written as a range.
function summarize(events: Events): string {
  const parts: string[] = [];
  for (let i = 0; i < events.length; ) {
    const first = events[i];
    if (typeof first === "string") {
      parts.push(first);
      i++;
      continue;
    }
    let last = first;
    while (++i < events.length && events[i] === last + 1) last++;
    parts.push(first === last ? String(first) : first + ".." + last);
  }
  return parts.join(", ");
}
function checksum(events: Events): number {
  let sum = 7;
  for (const event of events) {
    const text = String(event);
    for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) % 1000000007;
    sum = (sum * 31 + 10) % 1000000007;
  }
  return sum;
}
function outcomes(results: PromiseSettledResult<unknown>[]): string {
  let fulfilled = 0;
  let rejected = 0;
  let sum = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      fulfilled++;
      if (typeof result.value === "number") sum += result.value;
    } else rejected++;
  }
  return fulfilled + " fulfilled with " + sum + " in all, " + rejected + " rejected";
}

type Waiter = (id: number, gate: Promise<number>, seen: Events, later: Events) => Promise<number>;

async function awaitsOnce(n: number): Promise<number> {
  await settled;
  return n;
}
async function returnsAtOnce(id: number, gate: Promise<number>, seen: Events): Promise<number> {
  const value = await gate;
  seen.push(id);
  return value;
}
async function awaitsANumberNext(id: number, gate: Promise<number>, seen: Events, later: Events): Promise<number> {
  const value = await gate;
  seen.push(id);
  later.push(await id);
  return value;
}
async function awaitsACallNext(id: number, gate: Promise<number>, seen: Events, later: Events): Promise<number> {
  const value = await gate;
  seen.push(id);
  later.push(await awaitsOnce(id));
  return value;
}
async function throwsNext(id: number, gate: Promise<number>, seen: Events): Promise<number> {
  await gate;
  seen.push(id);
  throw new RangeError("thrown by " + id);
}
async function queuesAJobNext(id: number, gate: Promise<number>, seen: Events, later: Events): Promise<number> {
  const value = await gate;
  seen.push(id);
  queueMicrotask(() => later.push("job of " + id));
  return value;
}
async function awaitsThePromiseTwice(id: number, gate: Promise<number>, seen: Events, later: Events): Promise<number> {
  const a = id + 1, b = id * 2, c = "c" + id, d = [id], e = { id }, f = id / 2;
  const value = (await gate) + (await gate);
  seen.push(id);
  if (a + b + c.length + d[0] + e.id + f < 0) later.push("never");
  return value / 2;
}
async function* yieldsNext(id: number, gate: Promise<number>, seen: Events): AsyncGenerator<number, void, unknown> {
  const value = await gate;
  seen.push(id);
  yield value;
}
class Member {
  constructor(readonly bonus: number) {}
  async wait(id: number, gate: Promise<number>, seen: Events): Promise<number> {
    const value = await gate;
    seen.push(id);
    return value + this.bonus;
  }
}
const member = new Member(0);
const waiters: Waiter[] = [
  returnsAtOnce,
  awaitsANumberNext,
  awaitsACallNext,
  throwsNext,
  queuesAJobNext,
  (id, gate, seen) => yieldsNext(id, gate, seen).next().then(result => (result.done ? -1 : result.value)),
  (id, gate, seen) => member.wait(id, gate, seen),
  async (id, gate, seen) => {
    seen.push((await gate) > 0 ? id : -id);
    return 0;
  },
];
async function catches(id: number, gate: Promise<number>, seen: Events): Promise<number> {
  try {
    return await gate;
  } catch (error) {
    seen.push(id + " caught " + (error as Error).message);
    return 0;
  }
}
async function cleansUp(id: number, gate: Promise<number>, seen: Events): Promise<number> {
  try {
    return await gate;
  } finally {
    seen.push(id + " cleans up");
  }
}

async function inARow(label: string, wait: Waiter, count: number): Promise<void> {
  const seen: Events = [];
  const later: Events = [];
  const gate = deferred<number>();
  const all: Promise<number>[] = [];
  for (let id = 0; id < count; id++) all.push(wait(id, gate.promise, seen, later));
  await afterTimer();
  gate.resolve(1);
  seen.push("settled");
  const results = await Promise.allSettled(all);
  lines.push(label + ": " + summarize(seen) + "; " + outcomes(results) + "; later " + later.length + ", checksum " + checksum(later));
}

async function rejectedInARow(count: number): Promise<void> {
  const seen: Events = [];
  const gate = deferred<number>();
  const all: Promise<number>[] = [];
  for (let id = 0; id < count; id++) all.push((id % 3 === 0 ? catches : id % 3 === 1 ? cleansUp : returnsAtOnce)(id, gate.promise, seen));
  await afterTimer();
  gate.reject(new RangeError("no"));
  const results = await Promise.allSettled(all);
  lines.push("a rejected promise: " + seen.length + " events, checksum " + checksum(seen) + ", begins " + seen.slice(0, 4).join(", ") + "; " + outcomes(results));
}

async function withOthersBetween(label: string): Promise<void> {
  const seen: Events = [];
  const later: Events = [];
  const first = deferred<number>();
  const failing = deferred<number>();
  const second = deferred<number>();
  const all: Promise<number>[] = [];
  let id = 0;
  const add = (count: number, gate: Promise<number>): void => {
    for (let i = 0; i < count; i++, id++) all.push(waiters[id % waiters.length](id, gate, seen, later));
  };
  add(250, first.promise);
  first.promise.then(() => {
    seen.push("a then handler");
  });
  add(250, first.promise);
  first.promise.then(() => {
    seen.push("a then handler that queues a job");
    queueMicrotask(() => later.push("job of the then handler"));
  });
  add(3, first.promise);
  all.push(catches(1000, failing.promise, seen), cleansUp(1001, failing.promise, seen), returnsAtOnce(1002, failing.promise, seen), catches(1003, failing.promise, seen));
  add(250, second.promise);
  void second.promise.finally(() => {
    seen.push("a finally handler");
  });
  add(247, second.promise);
  await afterTimer();
  first.resolve(1);
  queueMicrotask(() => seen.push("a microtask"));
  failing.reject(new RangeError("no"));
  queueMicrotask(() => seen.push("another microtask"));
  second.resolve(2);
  settled.then(() => seen.push("a then handler on a settled promise"));
  const results = await Promise.allSettled(all);
  lines.push(label + ": " + summarize(seen));
  lines.push("  " + outcomes(results) + "; later " + later.length + ", checksum " + checksum(later) + ", begins " + later.slice(0, 12).join(", "));
}

async function inContexts(storage: AsyncLocalStorage<string>, outside: string): Promise<void> {
  const seen: string[] = [];
  const gate = deferred<number>();
  async function waitsInItsContext(id: number): Promise<void> {
    await gate.promise;
    seen.push(id + " " + storage.getStore());
    await id;
    seen.push(id + " again " + storage.getStore());
    await awaitsOnce(id);
    seen.push(id + " at last " + storage.getStore());
  }
  const all: Promise<void>[] = [];
  for (let id = 0; id < 1000; id++) all.push(id % 4 === 3 ? waitsInItsContext(id) : storage.run("context " + (id % 4), () => waitsInItsContext(id)));
  await afterTimer();
  storage.run("the context of the resolver", () => gate.resolve(1));
  await Promise.all(all);
  let right = 0;
  for (const line of seen) {
    const id = parseInt(line, 10);
    if (line.endsWith(" " + (id % 4 === 3 ? outside : "context " + (id % 4)))) right++;
  }
  lines.push("contexts: " + right + " of " + seen.length + " in their own, checksum " + checksum(seen) + ", begins " + seen.slice(0, 5).join(", ") + ", here " + storage.getStore());
}

async function awaitsForEver(n: number): Promise<never> {
  for (;;) await n;
}
async function waitsInRoundsForEver(): Promise<never> {
  for (;;) {
    const seen: Events = [];
    const gate = deferred<number>();
    const all: Promise<number>[] = [];
    for (let id = 0; id < 100; id++) all.push(returnsAtOnce(id, gate.promise, seen));
    gate.resolve(1);
    await Promise.all(all);
  }
}
async function descends(depth: number): Promise<number> {
  await settled;
  return depth ? 1 + (await descends(depth - 1)) : 0;
}
async function unwindsForEver(): Promise<never> {
  for (;;) await descends(500);
}
function resumeForEver(kind: string): void {
  postMessage("resuming");
  if (kind === "awaits of numbers") {
    for (let i = 0; i < 8; i++) void awaitsForEver(i);
  } else if (kind === "waiters of one promise") void waitsInRoundsForEver();
  else void unwindsForEver();
}
async function terminateWhileResuming(kind: string): Promise<void> {
  const worker = new Worker("./resume-jobs-taken-in-a-row.ts", { argv: [kind] });
  const closed = new Promise<void>(resolve => {
    worker.addEventListener("close", () => resolve());
  });
  const message = await new Promise<string>(resolve => {
    worker.onmessage = (event: MessageEvent) => resolve(event.data);
  });
  await afterTimer();
  worker.terminate();
  await closed;
  lines.push(kind + ": " + message + ", terminated");
}

async function withoutContexts(title: string): Promise<void> {
  lines.push(title);
  await inARow("functions that return at once", returnsAtOnce, 1000);
  await inARow("functions that await a number next", awaitsANumberNext, 1000);
  await inARow("functions that await a call next", awaitsACallNext, 1000);
  await inARow("functions that throw next", throwsNext, 1000);
  await inARow("functions that await the promise twice", awaitsThePromiseTwice, 1000);
  await inARow("every kind in turn", (id, gate, seen, later) => waiters[id % waiters.length](id, gate, seen, later), 1000);
  await inARow("one function", returnsAtOnce, 1);
  await inARow("two functions", returnsAtOnce, 2);
  await rejectedInARow(1000);
  await withOthersBetween("with others between");
}

if (Bun.isMainThread) {
  await withoutContexts("== before any AsyncLocalStorage");
  lines.push("== with an AsyncLocalStorage");
  const storage = new AsyncLocalStorage<string>();
  await inContexts(storage, "undefined");
  await storage.run("around", () => inContexts(storage, "around"));
  await withoutContexts("== after it");
  lines.push("== workers");
  await terminateWhileResuming("awaits of numbers");
  await terminateWhileResuming("waiters of one promise");
  await terminateWhileResuming("chains that unwind");
  await inARow("the main thread goes on", returnsAtOnce, 1000);
  console.log(lines.join("\n"));
} else {
  resumeForEver(process.argv[2]);
}
