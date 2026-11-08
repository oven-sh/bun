// A program that loads one of Node's modules and calls one function of it keeps what that function needs, and nothing that only
// a value of any class would need: not the interpreter, not the bundler, not bun:test. The objects that the module reads off its
// native bindings are described, so the compiler knows that no value of an unlisted class is in the program's hands.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const seesEveryAPI = "aot: trim: the compiler can see every API this program uses";
const reports = new Map<string, Promise<string>>();

function reportOn(text: string): Promise<string> {
  let report = reports.get(text);
  if (!report) {
    report = (async () => {
      using dir = tempDir("aot-node-module", { "main.mjs": text + "\n" });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.mjs"],
        cwd: String(dir),
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [said] = await Promise.all([proc.stderr.text(), proc.exited]);
      return said;
    })();
    reports.set(text, report);
  }
  return report;
}

const keptIn = (report: string) => report.split("\n").filter(line => / kept .+: used \(/.test(line));
const keptByClassesNobodyNamed = (report: string) =>
  keptIn(report).filter(line => /used \((Bun\.Transpiler|%Expect%|%BuildArtifact%|bun:test)\)/.test(line));

// The program of oven-sh/bun#48182, and one line of each of the modules that it names. `node:fs` and `node:path` are the measure:
// they read nothing off a value that the table does not describe, and a program that loads one keeps about 80 features.
const mostThatAModuleOfNodeKeeps = 90;
test.concurrent.each([
  `import { createHash } from "node:crypto";\nconsole.log(createHash("sha256").update("x").digest("hex"));`,
  `import { inflateRawSync } from "node:zlib";\nconsole.log(typeof inflateRawSync);`,
  `import { tmpdir } from "node:os";\nconsole.log(typeof tmpdir());`,
  `import { spawnSync } from "node:child_process";\nconsole.log(typeof spawnSync);`,
  `import { inspect } from "node:util";\nconsole.log(typeof inspect);`,
  `import { Transform } from "node:stream";\nconsole.log(typeof Transform);`,
  `import assert from "node:assert";\nassert(true);`,
  `import { readFileSync } from "node:fs";\nconsole.log(typeof readFileSync);`,
  `import { join } from "node:path";\nconsole.log(join("a", "b"));`,
  `const parsed = Bun.JSONC.parse('{ "a": 1 }');\nconsole.log(parsed.a);`,
  `const parsed = Bun.JSON5.parse("{ a: 1 }");\nconsole.log(parsed.a);`,
])(
  "%s",
  async text => {
    const report = await reportOn(text);
    expect(report).toContain(seesEveryAPI);
    expect(keptByClassesNobodyNamed(report)).toEqual([]);
    expect(keptIn(report).length).toBeLessThanOrEqual(mostThatAModuleOfNodeKeeps);
  },
  600_000,
);
