// The stack of an error names the async functions that wait for the one that made it, whether or not they are awaited by name, before and after each of them has suspended.
const settled = Promise.resolve(0);
Error.stackTraceLimit = 12;
function names(error: unknown): string {
  const frames: string[] = [];
  for (const line of ((error as Error).stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?([^()]*?):(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@(.*?):(\d+):(\d+)$/.exec(line);
    if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : frame[2] ?? "") + ":" + (frame[3] === "native" ? frame[3] : frame[4] + ":" + frame[5]));
  }
  return frames.join(" | ");
}

async function makesAtOnce(): Promise<Error> {
  return new Error("at once");
}
async function makesLater(): Promise<Error> {
  await settled;
  return new Error("later");
}
async function throwsAtOnce(): Promise<never> {
  throw new Error("thrown at once");
}
async function throwsLater(): Promise<never> {
  await settled;
  throw new Error("thrown later");
}
async function inner(which: number): Promise<Error> {
  if (which === 0) return await makesAtOnce();
  if (which === 1) return await makesLater();
  try {
    return which === 2 ? await throwsAtOnce() : await throwsLater();
  } catch (error) {
    return error as Error;
  }
}
async function middle(which: number, first: boolean): Promise<Error> {
  if (first) await settled;
  const error = await inner(which);
  return error;
}
async function outer(which: number, first: boolean): Promise<Error> {
  return await middle(which, first);
}
async function keepsThePromise(which: number): Promise<Error> {
  const promise = middle(which, true);
  await settled;
  return await promise;
}
async function throughThen(which: number): Promise<Error> {
  return await middle(which, false).then(error => error);
}
async function throughAll(which: number): Promise<Error> {
  const [error] = await Promise.all([middle(which, true), makesLater()]);
  return error;
}
async function recursive(depth: number): Promise<Error> {
  if (!depth) return await makesLater();
  return await recursive(depth - 1);
}
class Service {
  async load(): Promise<Error> {
    return await this.#read();
  }
  async #read(): Promise<Error> {
    await settled;
    return await Service.parse();
  }
  static async parse(): Promise<Error> {
    await settled;
    return new TypeError("parse");
  }
}
async function rethrown(): Promise<Error> {
  try {
    await uncaughtBelow();
  } catch (error) {
    return error as Error;
  }
  return new Error("not reached");
}
async function uncaughtBelow(): Promise<void> {
  await passesOn();
}
async function passesOn(): Promise<void> {
  await settled;
  await throwsLater();
}

for (let which = 0; which < 4; which++) {
  for (const first of [false, true]) console.log("outer", which, first, names(await outer(which, first)));
  console.log("keepsThePromise", which, names(await keepsThePromise(which)));
  console.log("throughThen", which, names(await throughThen(which)));
  console.log("throughAll", which, names(await throughAll(which)));
}
console.log("recursive", names(await recursive(3)));
console.log("recursive past the limit", names(await recursive(20)));
console.log("service", names(await new Service().load()));
console.log("rethrown", names(await rethrown()));
