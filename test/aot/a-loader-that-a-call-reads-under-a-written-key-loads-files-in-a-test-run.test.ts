// A test run stays in its compiled files unless one of them may run other code, and it tells by what the files mention.
// `Reflect.get(Bun, "ModuleGraph")` mentions the class as `Bun.ModuleGraph` does. It once did not, and the graph refused a file
// that the test had just written. Each way is a run of its own: beside another, a way that opens the run would hide the others.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { isHardened } from "./hardened";
import { run } from "./harness/run";
import { test as testWhereSupported } from "./supported";

// A hardened Bun runs only what was compiled.
const test = testWhereSupported.skipIf(isHardened);

const ways = [
  `Bun.ModuleGraph`,
  `Reflect.get(Bun, "ModuleGraph")`,
  `Reflect.get(Bun, "Module" + "Graph")`,
  `Reflect.get(Bun, "ModuleGraph", {})`,
  `Object.getOwnPropertyDescriptor(Bun, "ModuleGraph").value`,
  `Reflect.getOwnPropertyDescriptor(Bun, "ModuleGraph").value`,
  `Reflect.get(Bun as any, "ModuleGraph")`,
  `(Bun as any)["Module" + "Graph"]`,
  `(() => { const key = "ModuleGraph"; return (Bun as any)[key]; })()`,
  `(() => { const { ["Module" + "Graph"]: found } = Bun as any; return found; })()`,
];

test.concurrent.each(ways)("%s", async way => {
  using dir = tempDir("a-loader-read-under-a-written-key", {
    "tsconfig.json": "{}",
    "a.test.ts": `import { test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("a guest", async () => {
  const guest = join(mkdtempSync(join(tmpdir(), "guest-")), "guest.mjs");
  writeFileSync(guest, "export const answer = 6 * 7;");
  const Graph: any = ${way};
  console.log("SAID", (await new Graph({}).import(guest)).answer);
});
`,
  });
  const directory = String(dir);
  for (const flags of [[], ["--aot"]]) {
    const ran = await run([bunExe(), "test", ...flags, "./a.test.ts"], directory, { ...bunEnv, BUN_TMPDIR: directory });
    expect({
      flags,
      said: (ran.stdout + "\n" + ran.stderr).split("\n").filter(line => line.startsWith("SAID")),
    }).toEqual({
      flags,
      said: ["SAID 42"],
    });
  }
});
