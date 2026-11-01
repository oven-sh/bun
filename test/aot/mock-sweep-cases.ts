// For ./mock-sweep-<part>.test.ts. To write mock-sweep.known.txt anew the first file asks all projects and the others none.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "./harness/default-timeout";
import { mockSweep } from "./harness/mock-sweep";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const rewrite = !!process.env.BUN_AOT_REWRITE_MOCK_SWEEP;
const whole = rewrite || !!process.env.BUN_AOT_WHOLE_MOCK_SWEEP;
const projects = [...mockSweep()].filter((_, index) => whole || index % 5 === 0);
const ways = whole ? ["one", "two"] : ["one"];

const list = join(import.meta.dir, "mock-sweep.known.txt");
const lines = readFileSync(list, "utf8").split("\n");
const known = new Map(lines.filter(line => /^[a-z]/.test(line)).map(line => line.split(": ") as [string, string]));
const wavering = new Set(lines.filter(line => line.startsWith("~ ")).map(line => line.slice(2)));
const found = new Map<string, string[]>();

const env = { ...bunEnv, NO_COLOR: "1" };
const twoLayers = { ...env, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" };
const oneThread = { ...env, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };

async function printed(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  const { stdout, exitCode } = await run(cmd, cwd, env);
  return [...stdout.split("\n").filter(line => line.startsWith("| ")), `exit ${exitCode}`].join("\n");
}

export function sweepMocks(part: number, parts: number) {
  const mine = projects.filter((_, index) => (rewrite ? part === 1 : index % parts === part - 1));
  if (mine.length === 0) return;
  describe.concurrent("a mock laid on a module is seen as in a plain run", () => {
    test.each(mine)(
      "%s",
      async (name, files) => {
        using dir = tempDir("mock-sweep", files);
        const cwd = String(dir);
        const plain = new Set<string>();
        for (let i = 0; i < 3; i++) plain.add(await printed([bunExe(), "test", "."], cwd, i < 2 ? env : oneThread));
        const differs: string[] = [];
        for (const way of ways) {
          const compiled = await printed([bunExe(), "test", "--aot", "."], cwd, way === "one" ? env : twoLayers);
          if (!plain.has(compiled)) differs.push(way);
        }
        found.set(name, differs);
        if (rewrite || wavering.has(name)) return;
        expect(differs).toEqual((known.get(name) ?? "").split(" ").filter(way => ways.includes(way)));
      },
      300_000,
    );
  });

  afterAll(() => {
    if (!rewrite) return;
    const kept = lines.filter(line => line.startsWith("#") || line.startsWith("~ "));
    const named = [...found].filter(([name, differs]) => differs.length && !wavering.has(name));
    writeFileSync(
      list,
      [...kept, ...named.map(([name, differs]) => `${name}: ${differs.join(" ")}`).sort(), ""].join("\n"),
    );
  });
}
