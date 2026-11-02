// An async function that throws behind an await, with no handler of its own, rejects its promise: with the same value, at the same moment among the other jobs, whoever threw.
const collect: (sync: boolean) => void = (globalThis as any).gc ?? (globalThis as any).Bun?.gc ?? (() => undefined);
const log: string[] = [];
const anything: any = { json: JSON, nothing: null };
const tick = Promise.resolve(1);
const sentinel = { name: "sentinel" };
function told(value: unknown): string {
  if (value instanceof TypeError && !value.message.startsWith("another")) return "a TypeError of the engine";
  return value instanceof Error ? value.name + ": " + value.message.slice(0, 24) : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
function raise(value: unknown): never {
  throw value;
}
function raiseDeeper(depth: number, value: unknown): number {
  return depth ? raiseDeeper(depth - 1, value) + 1 : raise(value);
}
async function throwsStatement(): Promise<number> {
  await tick;
  throw sentinel;
}
async function throwsNewError(): Promise<number> {
  await tick;
  throw new RangeError("made behind an await");
}
async function throwsUndefined(): Promise<number> {
  await tick;
  throw undefined;
}
async function calleeThrows(): Promise<number> {
  await tick;
  return raiseDeeper(3, sentinel) + 1;
}
async function hostThrows(): Promise<number> {
  await tick;
  return anything.json.parse("{").length;
}
async function engineThrows(): Promise<number> {
  await tick;
  return anything.nothing.length;
}
async function throwsBehindTwoAwaits(): Promise<number> {
  const first = await tick;
  const second = await tick;
  return raise(first + second);
}
async function throwsInLoop(): Promise<number> {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    sum += await tick;
    if (i === 3) raise("in round " + i + " with " + sum);
  }
  return sum;
}
async function cleansUp(): Promise<number> {
  try {
    await tick;
    return raise(sentinel);
  } finally {
    log.push("cleaned up");
  }
}
async function cleansUpAndWaits(): Promise<number> {
  try {
    await tick;
    return raise(sentinel);
  } finally {
    await tick;
    log.push("cleaned up behind an await");
  }
}
async function catchesAndThrowsAnother(): Promise<number> {
  try {
    await tick;
    return raise(sentinel);
  } catch (error) {
    throw new TypeError("another, for " + told(error));
  }
}
async function awaitsRejection(): Promise<number> {
  return (await Promise.reject(sentinel)) + 1;
}
async function awaitsOneThatThrows(): Promise<number> {
  return (await throwsStatement()) + 1;
}
const arrow = async (): Promise<number> => {
  await tick;
  return raise("from an arrow function");
};
class Holder {
  value = "from a method";
  async method(): Promise<number> {
    await tick;
    return raise(this.value);
  }
  static async ofClass(): Promise<number> {
    await tick;
    return raise("from a static method");
  }
}
async function throwsBeforeAwait(): Promise<number> {
  raise("before any await");
  return await tick;
}
const all: Array<[string, () => Promise<number>]> = [
  ["statement", throwsStatement], ["new error", throwsNewError], ["undefined", throwsUndefined], ["callee", calleeThrows], ["host", hostThrows], ["engine", engineThrows],
  ["two awaits", throwsBehindTwoAwaits], ["loop", throwsInLoop], ["finally", cleansUp], ["finally that waits", cleansUpAndWaits], ["catch and throw", catchesAndThrowsAnother],
  ["awaits a rejection", awaitsRejection], ["awaits one that throws", awaitsOneThatThrows], ["arrow", arrow], ["method", () => new Holder().method()], ["static", Holder.ofClass], ["before", throwsBeforeAwait],
];
async function main(): Promise<void> {
  for (const [name, start] of all) {
    log.length = 0;
    try {
      console.log(name + " returned " + (await start()));
    } catch (error) {
      console.log(name + ": " + told(error) + (error === sentinel ? " (the same object)" : "") + (log.length ? " ; " + log.join() : ""));
    }
  }
  for (const [name, start] of all) {
    const order: string[] = [];
    const started = start();
    started.then(() => order.push("fulfilled"), () => order.push("rejected"));
    let other = Promise.resolve();
    for (let i = 0; i < 8; i++) other = other.then(() => { order.push(String(i)); });
    await other;
    console.log(name + ": " + order.join(" "));
  }
  const settled = await Promise.allSettled(all.map(([, start]) => start()));
  console.log(settled.map(result => result.status === "rejected" ? told(result.reason) : "fulfilled").join(" | "));
  console.log(told(await Promise.race([throwsStatement(), new Promise(() => undefined)]).catch(error => error)));
  let count = 0;
  for (let i = 0; i < 6000; i++) {
    try {
      await all[i % all.length]![1]();
    } catch (error) {
      count++;
    }
    if (i % 1500 === 0) collect(true);
  }
  console.log(count);
}
main();
