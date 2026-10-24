// Knowing more never adds code. An optimization that a fact makes possible replaces the code that did without the fact: it does
// not stand beside it.
//
// Each folder of ./knowing-more-adds-no-code holds one small program twice. less.ts and more.ts do the same and print the same, and
// differ only in how much the compiler is told: a parameter is `any` or has its type, a field is `unknown` or a number, a function
// is handed out or every caller of it is seen. The code of the program's own functions, in all their versions, is no larger in the
// build that knows more.
//
// Where it is larger the test says in which roles the bytes stand.
//
// The pairs that are larger today stand in ./knowing-more-adds-no-code/known-today.ts with their numbers and are todo.
//
//   AOT_KNOWING_MORE=<text>    only the pairs whose name contains the text
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { knownToday } from "./knowing-more-adds-no-code/known-today";
import { built, slot, spawned, told } from "./run-programs";
import { describe, test } from "./supported";

// Another register, or a displacement of another width, in code that is otherwise the same. A function whose callers are seen may also
// be hotter than one that is handed out: the back end then spends some bytes more on the very same operations (20 in every-caller-is-seen).
const mostCodeBytesAdded = 32;

const folderOfPairs = join(import.meta.dir, "knowing-more-adds-no-code");
const pairs = readdirSync(folderOfPairs, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

const besideProgram = {
  "globals.d.ts": `declare const console: { log(...values: unknown[]): void };\ndeclare const process: { argv: string[] };\n`,
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      lib: ["ESNext"],
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      noEmit: true,
      strict: true,
    },
  }),
};

async function measure(pair: string, side: "less" | "more") {
  using dir = tempDir("aot-knowing-more", {
    ...besideProgram,
    "program.ts": readFileSync(join(folderOfPairs, pair, side + ".ts"), "utf8"),
  });
  const folder = String(dir);
  const report = join(folder, "report.json");
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const flags = ["--aot-report=" + report, "--aot-report-detail=sites"];
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", ...flags, "./program.ts", "--outfile", executable],
      folder,
      bunEnv,
    ),
  );
  const { functions } = JSON.parse(readFileSync(report, "utf8")) as {
    functions: { file: string; role: string; codeBytes: number }[];
  };
  const byRole: Record<string, number> = {};
  for (const { file, role, codeBytes } of functions)
    if (file.endsWith("program.ts")) byRole[role] = (byRole[role] ?? 0) + codeBytes;
  return {
    output: told(await spawned([executable], folder, bunEnv)),
    codeBytes: Object.values(byRole).reduce((sum, bytes) => sum + bytes, 0),
    byRole,
  };
}

type Measured = Awaited<ReturnType<typeof measure>>;

const moved = (name: string, from: number, to: number) => `${name} ${from} -> ${to}`;

function addedByKnowingMore(less: Measured, more: Measured) {
  if (more.codeBytes <= less.codeBytes + mostCodeBytesAdded) return [];
  const found = [moved("bytes of code of the program", less.codeBytes, more.codeBytes)];
  for (const role of Object.keys({ ...less.byRole, ...more.byRole }).sort())
    if ((more.byRole[role] ?? 0) > (less.byRole[role] ?? 0))
      found.push(moved(role, less.byRole[role] ?? 0, more.byRole[role] ?? 0));
  return found;
}

const only = process.env.AOT_KNOWING_MORE;

describe.concurrent("compile/aot/knowing more adds no code", () => {
  for (const pair of pairs.filter(name => !only || name.includes(only))) {
    const isKnown = pair in knownToday;
    (isKnown ? test.todo : test)(
      isKnown ? `${pair} (${knownToday[pair]})` : pair,
      async () => {
        const [less, more] = await Promise.all([slot(() => measure(pair, "less")), slot(() => measure(pair, "more"))]);
        expect(more.output).toEqual(less.output);
        expect(addedByKnowingMore(less, more)).toEqual([]);
      },
      600_000,
    );
  }
});
