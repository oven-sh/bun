import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { unsupported } from "./run-programs";

test.skipIf(!!unsupported)(
  "an object literal with an index among its keys still gets its Structure in one step",
  async () => {
    const names = Array.from({ length: 300 }, (_, i) => `name${i}: ${i}`);
    names.splice(150, 0, `"100": "hundred"`);
    using dir = tempDir("aot-literal-with-index-key", {
      "main.js": `
      const { heapStats } = require("bun:jsc");
      function make() { return { ${names.join(", ")} }; }
      heapStats();
      const before = heapStats().objectTypeCounts.Structure;
      const object = make();
      const after = heapStats().objectTypeCounts.Structure;
      console.log(after - before, Object.keys(object).length, object[100], object.name299);
    `,
    });
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited].at(-1)).toBe(0);
    await using run = Bun.spawn({
      cmd: [executable],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [made, keys, hundred, last] = (await run.stdout.text()).trim().split(" ");
    expect(await run.exited).toBe(0);
    expect([keys, hundred, last]).toEqual(["301", "hundred", "299"]);
    expect(Number(made)).toBeLessThan(150);
  },
);
