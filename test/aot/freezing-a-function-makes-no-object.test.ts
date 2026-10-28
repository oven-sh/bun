import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.mjs": `
    import { heapStats } from "bun:jsc";
    const count = 3000;
    const made = [];
    for (let i = 0; i < count; i++) made.push(function (x) { return x + i; });
    const plainObjects = () => { Bun.gc(true); return heapStats().objectTypeCounts.Object ?? 0; };
    const before = plainObjects();
    for (const f of made) Object.freeze(f);
    const madeByFreezing = plainObjects() - before;
    console.log(made.every(Object.isFrozen), madeByFreezing < count / 10 ? "few" : madeByFreezing);
    const prototypes = made.map(f => f.prototype);
    console.log(prototypes.every((prototype, i) => prototype.constructor === made[i]), plainObjects() - before >= count, made[5](1));
  `,
};

// Object.freeze() of a closure takes one structure transition. Property by property it would ask for the descriptor of `prototype`, and that read makes the object.
test("freezing a function that nothing has touched does not make its prototype object", async () => {
  using dir = tempDir("aot-freezing-a-function", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  expect(await run([executable], String(dir))).toEqual({ stdout: "true few\ntrue true 6\n", stderr: "", exitCode: 0 });
});
