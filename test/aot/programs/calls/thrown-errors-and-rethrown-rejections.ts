// `throw new SomeError("text")` caught in another function, and a rejection thrown again by each `await` on its way up: the same error object, message and stack as in plain Bun.
const collect: (sync: boolean) => void = (globalThis as any).gc ?? (globalThis as any).Bun?.gc ?? (() => undefined);
const tick = Promise.resolve();
Error.stackTraceLimit = 10;
function names(error: unknown): string {
  const frames: string[] = [];
  for (const line of ((error as Error).stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?[^()]*?:(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@.*?:(\d+):(\d+)$/.exec(line);
    if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : frame[2] ?? "") + ":" + frame[3] + ":" + frame[4]);
  }
  return frames.join(" | ");
}
function plain(): number {
  throw new Error("plain");
}
function range(): number {
  throw new RangeError("range");
}
function type(): number {
  throw new TypeError("type");
}
function syntax(): number {
  throw new SyntaxError("syntax");
}
function reference(): number {
  throw new ReferenceError("reference");
}
function evalError(): number {
  throw new EvalError("eval");
}
function uri(): number {
  throw new URIError("uri");
}
function empty(): number {
  throw new Error("");
}
function noMessage(): number {
  throw new Error();
}
function computed(n: number): number {
  throw new Error("computed " + n);
}
function withCause(): number {
  throw new Error("outer", { cause: new Error("inner") });
}
function down(depth: number, thrower: () => number): number {
  return depth ? down(depth - 1, thrower) + 1 : thrower() + 1;
}
for (const thrower of [plain, range, type, syntax, reference, evalError, uri, empty, noMessage, () => computed(3) + 1, withCause]) {
  for (const depth of [0, 2, 12]) {
    try {
      down(depth, thrower);
    } catch (error) {
      const e = error as Error;
      console.log([e.name, JSON.stringify(e.message), e instanceof Error, Object.prototype.toString.call(e), Object.hasOwn(e, "message"), Object.hasOwn(e, "cause"), e.cause instanceof Error, names(e)].join(" ; "));
    }
  }
}

function sameFunction(flag: boolean): string {
  try {
    if (flag) throw new RangeError("here");
    return "nothing";
  } catch (error) {
    return names(error);
  }
}
console.log(sameFunction(true), sameFunction(false));

function throughFinally(log: string[]): number {
  try {
    return down(1, type) + 1;
  } finally {
    log.push("finally");
  }
}
{
  const log: string[] = [];
  try {
    throughFinally(log);
  } catch (error) {
    console.log(log.join(), names(error));
  }
}

async function rejects(depth: number): Promise<number> {
  if (depth) return (await rejects(depth - 1)) + 1;
  await tick;
  throw new RangeError("rejected");
}
async function rejectsAtOnce(depth: number): Promise<number> {
  if (depth) return (await rejectsAtOnce(depth - 1)) + 1;
  throw new TypeError("rejected at once");
}
async function catchesAndThrowsAgain(depth: number, seen: unknown[]): Promise<number> {
  try {
    if (depth) return (await catchesAndThrowsAgain(depth - 1, seen)) + 1;
    await tick;
    throw new Error("again");
  } catch (error) {
    seen.push(error);
    throw error;
  }
}
async function awaitsRejectedPromise(reason: unknown): Promise<unknown> {
  try {
    await Promise.reject(reason);
  } catch (error) {
    return error;
  }
}
async function awaitsThenable(): Promise<unknown> {
  try {
    await { then(_resolve: (value: number) => void, reject: (reason: unknown) => void) { reject("from a thenable"); } };
  } catch (error) {
    return error;
  }
}
async function main(): Promise<void> {
  for (const depth of [0, 1, 5, 12]) {
    for (const start of [rejects, rejectsAtOnce]) {
      try {
        await start(depth);
      } catch (error) {
        console.log(start.name + " " + depth + ": " + names(error));
      }
    }
  }
  const seen: unknown[] = [];
  try {
    await catchesAndThrowsAgain(3, seen);
  } catch (error) {
    console.log("again: " + seen.length + " " + seen.every(each => each === error) + " " + names(error));
  }
  for (const reason of [undefined, null, 0, "", "text", { a: 1 }]) console.log("rejected promise: " + JSON.stringify(await awaitsRejectedPromise(reason)));
  console.log(await awaitsThenable());
  let count = 0;
  for (let i = 0; i < 5000; i++) {
    try {
      await rejects(i % 4);
    } catch (error) {
      if ((error as Error).message === "rejected") count++;
    }
    if (i % 1000 === 0) collect(true);
  }
  console.log("many rejections: " + count);
}
main();
