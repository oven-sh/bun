import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// docs/compiler/compatibility.mdx, "Dynamic imports". The compiled files call the timers that the build saw, so a module that the build didn't see may not replace them.
const said = `error => "THREW " + error.message.split(" because ")[0]`;
const loads = `
  for (const name of ["timers", "trace"]) console.log(name + ":", require(process.cwd() + "/disk/" + name + ".cjs"));
  setTimeout(() => console.log("the timer of the compiled file ran"), 1);`;
const files = {
  "disk/timers.cjs": `
    const { mock } = require("node:test");
    try {
      mock.timers.enable({ apis: ["setTimeout"] });
      let hits = 0;
      setTimeout(() => hits++, 1000);
      mock.timers.tick(1000);
      mock.timers.reset();
      module.exports = "mocked, hits " + hits;
    } catch (error) { module.exports = (${said})(error); }`,
  "disk/trace.cjs": `
    try {
      const tracing = require("node:trace_events").createTracing({ categories: ["node.perf"] });
      tracing.enable();
      tracing.disable();
      module.exports = "enabled and disabled";
    } catch (error) { module.exports = (${said})(error); }`,
  "names-neither.cjs": loads,
  "names-both.cjs": `require("node:test"); require("node:trace_events");` + loads,
};
const asPlain = ["timers: mocked, hits 1", "trace: enabled and disabled", "the timer of the compiled file ran"];

test.concurrent.each([
  [
    "names-neither.cjs",
    ["timers: THREW Cannot assign to setTimeout", "trace: THREW Cannot assign to setTimeout", asPlain[2]],
  ],
  ["names-both.cjs", asPlain],
])(
  "%s",
  async (entry, expected) => {
    using dir = tempDir("aot-library-module-loaded-by-code-from-disk", files);
    const cwd = String(dir);
    const printedBy = async (cmd: string[]) => (await run(cmd, cwd, bunEnv)).stdout.split("\n").filter(Boolean);
    expect(await printedBy([bunExe(), "run", entry])).toEqual(asPlain);
    const executable = join(cwd, "program");
    const build = [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-allow-code-from-disk",
      entry,
      "--outfile",
      executable,
    ];
    expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
    expect(await printedBy([executable])).toEqual(expected);
  },
  240_000,
);
