// A table of two thousand entries, each made by a call of one small function, as a generated table of messages is written. One argument of each call
// is a member of an enum whose module imports the table's module back, so each read of it is tested, and in hot code each test that fails leaves for
// the generic version with every entry made so far. The body has two million block parameters then, and nearly each of them holds one of four thousand
// objects. The escape analysis kept a row of a bit for each object for each of them: over two gigabytes, where the build aborted.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { totalmem } from "os";
import { join } from "path";
import { compileCommand, withThreads } from "./harness/flags";
import { withoutDebugInformation } from "./run-programs";
import { test } from "./supported";

const entries = 2130;
const categories = ["Warning", "Error", "Suggestion", "Message"];

const files = {
  "category.ts": `import { table } from "./table";
export enum Category { Warning, Error, Suggestion, Message }
export interface Entry { code: number; category: Category; key: string; message: string; unnecessary?: {}; elided?: boolean; deprecated?: {} }
export function categoryName(entry: { category: Category }): string { return Category[entry.category].toLowerCase(); }
export function first(): Entry { return table.m0; }
`,
  "table.ts": `import { Category, Entry } from "./category";
function entry(code: number, category: Category, key: string, message: string, unnecessary?: {}, elided?: boolean, deprecated?: {}): Entry {
  return { code, category, key, message, unnecessary, elided, deprecated };
}
export const table = {
${Array.from({ length: entries }, (_, index) => `  m${index}: entry(${index}, Category.${categories[index % 4]}, "k${index}", "message ${index}") as Entry,\n`).join("")}};
`,
  "main.ts": `import { table } from "./table";
import { categoryName, first } from "./category";
let sum = 0;
for (const key of Object.keys(table)) sum += (table as Record<string, { code: number }>)[key].code;
console.log(sum, table.m7.message, categoryName(table.m5), first().key, Object.keys(table).length);
`,
};

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}

// The back end takes most of a minute and 7 GB for a body of that size. A debug or ASAN build takes many times that.
const hasTooLittleMemory = totalmem() < 12 * 1024 ** 3;
if (hasTooLittleMemory)
  console.error(
    "SKIPPED: test/aot/a-table-of-new-objects-in-hot-code-builds.test.ts: the build takes 7 GB, and this machine has less than 12 GB",
  );

test.skipIf(isDebug || isASAN || hasTooLittleMemory)(
  "a table of new objects whose entries all stay live builds where every function is hot",
  async () => {
    using folder = tempDir("aot-table-of-new-objects", files);
    const cwd = String(folder);
    const executable = join(cwd, "program");
    const built = await run(
      [
        bunExe(),
        ...compileCommand,
        withThreads(1),
        "--aot-heat=everything-is-hot",
        ...withoutDebugInformation(),
        "main.ts",
        "--outfile",
        executable,
      ],
      cwd,
    );
    expect({
      stderr: built.exitCode === 0 ? "" : built.stderr.slice(-2000),
      exitCode: built.exitCode,
      signal: built.signal,
    }).toEqual({ stderr: "", exitCode: 0, signal: null });
    const plain = await run([bunExe(), "main.ts"], cwd);
    const compiled = await run([executable], cwd);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    expect(plain.stdout).toBe(`${(entries * (entries - 1)) / 2} message 7 error k0 ${entries}\n`);
  },
  600_000,
);
