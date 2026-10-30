// The first entry point of an executable that holds the cases of ../minifying-first-saves-no-code.ts as further entry points. Each runs in a Worker, one after the other, and a line with
// AOT_MARK stands behind what each has printed.
import { readFileSync, writeSync } from "node:fs";

const mark = process.env.AOT_MARK;
for (const program of JSON.parse(readFileSync(process.env.AOT_TASKS, "utf8"))) {
  const worker = new Worker(new URL(program, import.meta.url));
  worker.addEventListener("error", event => writeSync(1, `error: ${event.message}\n`));
  const exitCode = await new Promise(resolve => worker.addEventListener("close", event => resolve(event.code)));
  writeSync(1, `\n${mark} ${exitCode}\n`);
}
