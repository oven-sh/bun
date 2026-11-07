import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Bun's require() makes a module object for a compiled file at every call. Asked through a requirer that is no file of the program,
// as createRequire() of another path makes one, each of them was listed among that requirer's children, so none was ever collected.
const files: Record<string, string> = {
  "main.ts": `import { heapStats } from "bun:jsc";
import * as nodeModule from "node:module";
const pick = (holder: any, name: string) => holder[name + (process.env.NOBODY_SETS_THIS ?? "")];
const unseen = pick(nodeModule, "createRequire")(import.meta.url);
const elsewhere = nodeModule.createRequire(import.meta.dir + "/sub/none.js");
const roads: Record<string, () => number> = {
  "a createRequire() that the build cannot see": () => unseen("./old.cjs").value(),
  "createRequire() of another path": () => elsewhere("../old.cjs").value(),
  "two files in turns": () => elsewhere("../old.cjs").value() + elsewhere("../other.cjs").value() - 1,
};
for (const [road, take] of Object.entries(roads)) {
  for (let i = 0; i < 200; i++) take();
  Bun.gc(true);
  const before = heapStats().objectTypeCounts.Module ?? 0;
  let sum = 0;
  for (let i = 0; i < 5_000; i++) sum += take();
  Bun.gc(true);
  const kept = (heapStats().objectTypeCounts.Module ?? 0) - before;
  console.log("SEEN", road, sum, kept < 100 ? "keeps nothing" : "keeps module objects");
}
`,
  "a.test.ts": `import { test } from "bun:test";
test("a", async () => {
  await import("./main.ts");
});
`,
  "old.cjs": `exports.value = () => 1;
`,
  "other.cjs": `exports.value = () => 1;
`,
  "package.json": `{ "name": "p", "type": "module" }
`,
};
const seen = (ran: { stdout: string; stderr: string; exitCode: number }) => ({
  lines: ran.stdout.split("\n").filter(line => line.startsWith("SEEN")),
  failed: ran.stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|Error/.test(line)),
  exitCode: ran.exitCode,
});

test.concurrent(
  "a requirer that is no file of the program keeps one object for a file: a test run",
  async () => {
    using dir = tempDir("aot-requirer-of-nobody-in-a-test-run", files);
    const [plain, compiled] = await Promise.all([
      run([bunExe(), "test"], String(dir), bunEnv),
      run([bunExe(), "test", "--aot"], String(dir), bunEnv),
    ]);
    expect(seen(plain).lines.filter(line => line.endsWith("5000 keeps nothing"))).toHaveLength(3);
    expect(seen(compiled)).toEqual(seen(plain));
  },
  120_000,
);

test.concurrent(
  "a requirer that is no file of the program keeps one object for a file: an executable",
  async () => {
    using dir = tempDir("aot-requirer-of-nobody-in-an-executable", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.ts", "old.cjs", "other.cjs", "--outfile", executable],
      String(dir),
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const [plain, compiled] = await Promise.all([
      run([bunExe(), "main.ts"], String(dir), bunEnv),
      run([executable], String(dir), bunEnv),
    ]);
    expect(seen(plain).lines.filter(line => line.endsWith("5000 keeps nothing"))).toHaveLength(3);
    expect(seen(compiled)).toEqual(seen(plain));
  },
  240_000,
);
