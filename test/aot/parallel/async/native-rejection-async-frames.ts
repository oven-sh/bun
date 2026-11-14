// An error that native code creates to reject a promise has no call stack: its frames are the async functions that await the promise.
import { promises } from "node:fs";
const missing = "/nonexistent-path/does-not-exist.txt";
Error.stackTraceLimit = 10;
function names(error: unknown): string {
  const frames: string[] = [];
  for (const line of ((error as Error).stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?([^()]*?):(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@(.*?):(\d+):(\d+)$/.exec(line);
    if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : frame[2] ?? "") + ":" + (frame[3] === "native" ? frame[3] : frame[4] + ":" + frame[5]));
  }
  return frames.join(" | ");
}
function describe(error: unknown): string {
  const { code, message } = error as NodeJS.ErrnoException;
  return (code ?? message) + ": " + (names(error) || "no frames");
}

type Source = "node:fs" | "Bun.file";
function read(source: Source): Promise<unknown> {
  return source === "node:fs" ? promises.readFile(missing) : Bun.file(missing).text();
}
async function innermost(source: Source): Promise<unknown> {
  if (source === "node:fs") return await promises.readFile(missing);
  return await Bun.file(missing).text();
}
async function middle(source: Source): Promise<unknown> {
  const result = await innermost(source);
  return result;
}
async function outermost(source: Source): Promise<unknown> {
  return await middle(source);
}
async function returnsPromise(source: Source): Promise<unknown> {
  return read(source);
}
async function awaitsReturnedPromise(source: Source): Promise<unknown> {
  return await returnsPromise(source);
}
function caughtByHandler(source: Source): Promise<unknown> {
  return new Promise(resolve => void read(source).catch(resolve));
}
async function rejectsWithOwnError(): Promise<unknown> {
  return await Promise.reject(new Error("own stack"));
}
async function readsFailingStream(): Promise<unknown> {
  const error = new Error("own stack through a stream");
  const stream = new ReadableStream({ start: controller => void setTimeout(() => controller.error(error), 0) });
  return await stream.getReader().read();
}
async function rejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "fulfilled";
  } catch (error) {
    return describe(error);
  }
}

async function main(): Promise<void> {
  for (const source of ["node:fs", "Bun.file"] as const) {
    console.log(source + " awaited: " + (await rejection(() => outermost(source))));
    console.log(source + " returned: " + (await rejection(() => awaitsReturnedPromise(source))));
    for (const limit of [0, 1, 2]) {
      Error.stackTraceLimit = limit;
      console.log(source + " limit " + limit + ": " + (await rejection(() => outermost(source))));
    }
    Error.stackTraceLimit = 10;
    console.log(source + " catch handler only: " + describe(await caughtByHandler(source)));
  }
  console.log(await rejection(rejectsWithOwnError));
  console.log(await rejection(readsFailingStream));
}
main();
