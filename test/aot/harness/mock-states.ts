import { tempDir } from "harness";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The life of the mock of a module under `bun test --aot` is one table: mock-states.table.txt. The run time computes the state of a mock from what it holds
// (Modules::mockState()) and, where its counts are asked for, counts what each door between Bun and the engine does to it:
//   <kind of file> <state> (body <status>) > <door> > <kind of file> <state> (body <status>)
const path = join(import.meta.dir, "..", "mock-states.table.txt");
const table = new Set(
  readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line && !line.startsWith("#"))
    .map(line => line.replace(/^\S+ /, "")),
);

/** Give `env` to a `bun test --aot` child; `stepsThatTableLacks()` reads what it and its own children counted. */
export function countedMockStates() {
  const dir = tempDir("aot-mock-states", {});
  return {
    env: { BUN_JSC_aotCountsPath: join(String(dir), "counts-%p") },
    numberOfProcesses: () => readdirSync(String(dir)).length,
    stepsThatTableLacks() {
      const seen = new Set<string>();
      for (const file of readdirSync(String(dir)))
        for (const line of readFileSync(join(String(dir), file), "utf8").split("\n")) {
          const at = line.indexOf("\tnamed:mock:");
          if (at >= 0) seen.add(line.slice(at + "\tnamed:mock:".length));
        }
      const lacking = [...seen].filter(line => !table.has(line)).sort();
      if (!process.env.BUN_AOT_REWRITE_MOCK_STATES) return { seen: seen.size, lacking };
      for (const line of lacking) table.add(line);
      if (lacking.length) appendFileSync(path, lacking.map(line => `?new ${line}\n`).join(""));
      return { seen: seen.size, lacking: [] };
    },
    [Symbol.dispose]() {
      dir[Symbol.dispose]();
    },
  };
}

export const howToAddSteps = `
test/aot/mock-states.table.txt lacks these steps. No answer of a program is known to be wrong: a landing has changed what a door between Bun and the
engine does to the state of a mock, and the table was not told. Whoever made that change adds its steps:
  BUN_AOT_REWRITE_MOCK_STATES=1 bun test test/aot/mock-states.test.ts
appends them behind \`?new\`. Then give each its mark: \`ok\` where a test against \`bun test\` stands behind the step; \`?\` and a word where it is doubted.
A side that reads NONE OF THEM [..] is what no state of the table is: a fault, or a state that Modules::mockState() has yet to learn.`;
