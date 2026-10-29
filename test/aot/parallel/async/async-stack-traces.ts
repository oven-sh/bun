// The stack of an error made after an await names the async functions that wait for the one that made it, up to Error.stackTraceLimit.
const collect: (sync: boolean) => void = (globalThis as any).gc ?? (globalThis as any).Bun?.gc ?? (() => undefined);
const tick = Promise.resolve();
Error.stackTraceLimit = 10;
function names(error: unknown): string {
  const frames: string[] = [];
  for (const line of ((error as Error).stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?([^()]*?):(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@(.*?):(\d+):(\d+)$/.exec(line);
    if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : frame[2] ?? "") + ":" + (frame[3] === "native" ? frame[3] : frame[4] + ":" + frame[5]));
  }
  return frames.join(" | ");
}

async function leaf(): Promise<Error> {
  await tick;
  return new Error("leaf");
}
async function chain(depth: number): Promise<Error> {
  if (depth) return await chain(depth - 1);
  return await leaf();
}
async function first(): Promise<Error> {
  const error = await second();
  return error;
}
async function second(): Promise<Error> {
  await tick;
  const error = await third(1);
  await tick;
  return error;
}
async function third(times: number): Promise<Error> {
  for (let i = 0; i < times; i++) await tick;
  return new RangeError("third");
}
class Service {
  async load(): Promise<Error> {
    return await this.#fetch();
  }
  async #fetch(): Promise<Error> {
    await tick;
    return await Service.parse();
  }
  static async parse(): Promise<Error> {
    await tick;
    return new TypeError("parse");
  }
}
async function throughAll(): Promise<Error> {
  const [error] = await Promise.all([leaf(), tick]);
  return error;
}
async function throughRace(): Promise<Error> {
  return await Promise.race([leaf()]);
}
async function throughAllSettled(): Promise<Error> {
  const [result] = await Promise.allSettled([leaf()]);
  return result.status === "fulfilled" ? result.value : new Error("rejected");
}
async function throughAny(): Promise<Error> {
  return await Promise.any([leaf()]);
}
async function notAwaited(): Promise<Error> {
  const pending = leaf();
  await tick;
  return await pending;
}
async function thrower(depth: number): Promise<never> {
  if (depth) return await thrower(depth - 1);
  await tick;
  throw new Error("thrown");
}
async function catches(): Promise<Error> {
  try {
    return await thrower(2);
  } catch (error) {
    return error as Error;
  }
}
async function inFinally(): Promise<Error> {
  try {
    await tick;
  } finally {
    await tick;
    return await leaf();
  }
}
async function* generated(): AsyncGenerator<Error> {
  await tick;
  yield await leaf();
  yield new Error("in the generator");
}
async function overGenerator(): Promise<Error[]> {
  const errors: Error[] = [];
  for await (const error of generated()) errors.push(error);
  return errors;
}
async function captured(): Promise<{ stack?: string }> {
  await tick;
  const holder: { stack?: string } = {};
  Error.captureStackTrace(holder);
  return holder;
}
async function capturedBelow(): Promise<{ stack?: string }> {
  return await captured();
}

async function main(): Promise<void> {
  for (const depth of [0, 1, 3, 8, 9, 10, 11, 30]) console.log("chain " + depth + ": " + names(await chain(depth)));
  console.log("first: " + names(await first()));
  console.log("methods: " + names(await new Service().load()));
  console.log("all: " + names(await throughAll()));
  console.log("race: " + names(await throughRace()));
  console.log("allSettled: " + names(await throughAllSettled()));
  console.log("any: " + names(await throughAny()));
  console.log("not awaited at once: " + names(await notAwaited()));
  console.log("caught: " + names(await catches()));
  console.log("finally: " + names(await inFinally()));
  for (const error of await overGenerator()) console.log("generator: " + names(error));
  console.log("captureStackTrace: " + names((await capturedBelow()) as Error));
  for (const limit of [0, 1, 2, 5, 20, 100]) {
    Error.stackTraceLimit = limit;
    console.log("limit " + limit + ": " + names(await chain(6)));
  }
  Error.stackTraceLimit = 10;
  const kept: Error[] = [];
  for (let i = 0; i < 300; i++) kept.push(await chain(i % 5));
  collect(true);
  console.log("read later: " + names(kept[4]) + " || " + names(kept[295]));
}
main();
