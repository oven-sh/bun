// Preloaded into one of Bun's own test files: every `bun test` that the file starts gets `--aot`, and a byte in the file AOT_CHILDREN_STARTED counts it.
import { appendFileSync } from "node:fs";

type Options = { cmd: string[]; timeout?: number };

function underAot<Start extends (...args: any[]) => any>(start: Start): Start {
  return function (this: unknown, first: string[] | Options, second?: Omit<Options, "cmd">) {
    const options: Options = Array.isArray(first) ? { ...second, cmd: first } : { ...first };
    const cmd = [...options.cmd];
    if (cmd[0] !== process.execPath || cmd[1] !== "test") return start.call(this, first, second);
    cmd.splice(2, 0, "--aot");
    appendFileSync(process.env.AOT_CHILDREN_STARTED!, ".");
    // A file that ends a hung child after seconds gives it the time of a plain run.
    const timeout = options.timeout && Math.max(options.timeout, 120_000);
    return start.call(this, { ...options, cmd, timeout });
  } as Start;
}

Bun.spawn = underAot(Bun.spawn);
Bun.spawnSync = underAot(Bun.spawnSync);
