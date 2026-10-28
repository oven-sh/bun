import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { generated } from "./generated/run-generated";

const generator = join(import.meta.dir, "generated/own-names-of-what-built-ins-make.ts");
// The generator evaluates each expression once, to learn which names the object has, in a process of its own.
const run = (...passed: string[]) =>
  Bun.spawnSync({
    cmd: [bunExe(), generator, ...passed],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  }).stdout.toString();

generated(
  "every own name of what a built-in makes is read by name in a function without types",
  (JSON.parse(run("--names")) as string[]).map((name, index) => ({
    name,
    isAlwaysRun: name === "event" || name === "exec" || name === "error",
    isOnlyCompiled: true as const,
    flags: index % 2 === 0 ? ["--aot-validate"] : [],
    make: () => ({ file: "main.mjs", text: run("--text", name) }),
  })),
);
