import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "path";
import { generated } from "./generated/run-generated";

const generator = join(import.meta.dir, "generated/members-of-what-built-ins-make.ts");
// The generator makes each call once, to learn which names the object answers to, in a process of its own.
const run = (...passed: string[]) =>
  Bun.spawnSync({
    cmd: [bunExe(), generator, ...passed],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  }).stdout.toString();

const everyRun =
  /^(Bun-serve-(Bun)?Request|Request-prototype-headers-Headers|URL-prototype-searchParams|Bun-file|fetch|Bun-spawnSync)/;
// `process.emit` may be replaced, so the table has it as a property that is called and not as a function.
const notValidatedToday = /^EventEmitter-prototype-emit-/;

generated(
  "every name that what a built-in of Bun makes answers to is read by name in a function without types",
  // The calls name commands and paths of POSIX.
  (isWindows ? [] : (JSON.parse(run("--names")) as string[])).flatMap((name, index) => {
    const program = {
      name,
      isAlwaysRun: everyRun.test(name),
      isOnlyCompiled: true as const,
      flags: index % 2 === 0 && !notValidatedToday.test(name) ? ["--aot-validate"] : [],
      make: () => ({ file: "main.mjs", text: run("--text", name) }),
    };
    if (!notValidatedToday.test(name)) return [program];
    const failsToday =
      "a build with --aot-validate finds no row for the function, and so none for the `_events` it defines";
    return [program, { ...program, name: `${name}-validated`, flags: ["--aot-validate"], failsToday }];
  }),
);
