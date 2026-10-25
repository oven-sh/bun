// The first entry point of an executable that holds many programs as further entry points. Each of them begins a program of its own, so it is compiled as it is when it is built alone, and
// here each runs in a Worker, a global of its own. What a Worker prints goes to the streams of the process, so they run one after the other, and a line with AOT_MARK stands behind what
// each has printed. ../programs-as-separate-entry-points.ts builds and starts this file, and starts plain Bun with it for what is expected.
import { readFileSync, writeSync } from "node:fs";

type Task = { program: string; cwd: string; env?: Record<string, string> };
const tasks: Task[] = JSON.parse(readFileSync(process.env.AOT_TASKS!, "utf8"));
const mark = process.env.AOT_MARK!;

for (const { program, cwd, env } of tasks) {
  process.chdir(cwd);
  const worker = new Worker(new URL(program, import.meta.url), { env: { ...process.env, ...env } as Record<string, string> });
  worker.addEventListener("error", event => writeSync(2, `error: ${event.message}\n`));
  const exitCode = await new Promise<number>(resolve => worker.addEventListener("close", event => resolve((event as Event & { code: number }).code)));
  for (const stream of [1, 2]) writeSync(stream, `\n${mark} ${exitCode}\n`);
}
