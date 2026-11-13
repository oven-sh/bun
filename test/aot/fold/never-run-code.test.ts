// `bun run` prints part of the code that never runs. A declaration that must stay keeps the `if` around it, and with it the
// test of that `if`, which then runs. Each row of the two tables is a program of one file and says what `bun run` does with
// it. This test holds plain Bun and compiled code to the answers: a build that takes the `if` for gone leaves its test out.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "../harness/commands";
import { compileCommand, withThreads } from "../harness/flags";
import { test } from "../supported";

type Row = { line: number; answer: string; file: string; program: string };

function rowsOf(table: string): Row[] {
  const rows: Row[] = [];
  readFileSync(join(import.meta.dir, table), "utf8")
    .split("\n")
    .forEach((text, index) => {
      if (!text || text.startsWith("#")) return;
      const [answer, extension, program] = text.split("\t");
      rows.push({ line: index + 1, answer, file: `row${index + 1}.${extension}`, program });
    });
  return rows;
}

// TypeScript has more to say of a name in its dead zone than the language.
const textOf = (row: Row) => (row.file.endsWith("ts") ? "// @ts-nocheck\n" : "") + row.program + "\n";

// Loads the files one by one and says how each load ends. A `.cjs` file is required: imported, a file without a sign of CommonJS
// runs as a module.
function programOf(rows: Row[], thrown: string, whereThrown: string, otherwise: string) {
  const loadOf = (row: Row) => (row.file.endsWith(".cjs") ? `require("./${row.file}")` : `import("./${row.file}")`);
  const loads = rows.map(row => `    [${row.line}, () => ${loadOf(row)}],`).join("\n");
  return {
    "empty.mjs": "export {};\n",
    ...Object.fromEntries(rows.map(row => [row.file, textOf(row)])),
    "main.cjs": `(async () => {
  for (const [line, load] of [
${loads}
  ]) {
    let answer = "${otherwise}";
    try {
      await load();
    } catch (error) {
      answer = error instanceof ${thrown} ? "${whereThrown}" : String(error);
    }
    console.log(line + " " + answer);
  }
})();
`,
  };
}

const said = (rows: Row[]) => rows.map(row => `${row.line} ${row.answer}`);

const branches = rowsOf("never-run-branches.txt");

test("never-run-branches.txt: plain Bun keeps the `if` where the table says", async () => {
  expect(branches.length).toBeGreaterThan(80);
  using dir = tempDir("aot-never-run-branches", programOf(branches, "ReferenceError", "kept", "dropped"));
  const { stdout, exitCode } = await spawned([bunExe(), "main.cjs"], String(dir), bunEnv);
  expect({ said: stdout.trimEnd().split("\n"), exitCode }).toEqual({ said: said(branches), exitCode: 0 });
});

test("never-run-branches.txt: compiled code runs the test of each `if` that stays", async () => {
  using dir = tempDir("aot-never-run-branches", programOf(branches, "ReferenceError", "kept", "dropped"));
  const cwd = String(dir);
  // On one thread: on several, a Bun with assertions at times ends the build of these files in the link flow of the engine.
  const build = [bunExe(), ...compileCommand, withThreads(1), "main.cjs", "--outfile", join(cwd, "main")];
  built(await spawned(build, cwd, bunEnv));
  const { stdout, exitCode } = await spawned([join(cwd, "main")], cwd, bunEnv);
  expect({ said: stdout.trimEnd().split("\n"), exitCode }).toEqual({ said: said(branches), exitCode: 0 });
});

const literals = rowsOf("never-run-literals.txt");

test("never-run-literals.txt: plain Bun refuses the files that the table says", async () => {
  expect(literals.length).toBeGreaterThan(60);
  using dir = tempDir("aot-never-run-literals", programOf(literals, "SyntaxError", "refused", "loads"));
  const { stdout, exitCode } = await spawned([bunExe(), "main.cjs"], String(dir), bunEnv);
  expect({ said: stdout.trimEnd().split("\n"), exitCode }).toEqual({ said: said(literals), exitCode: 0 });
});

test("never-run-literals.txt: a build refuses the same files", async () => {
  using dir = tempDir("aot-never-run-literals", programOf(literals, "SyntaxError", "refused", "loads"));
  const check = [bunExe(), "check", "--aot", "--no-pretty", "main.cjs"];
  const { stdout, exitCode } = await spawned(check, String(dir), bunEnv);
  const reported = new Set([...stdout.matchAll(/^(row\d+\.\w+)\(\d+,\d+\): error TS100307: /gm)].map(match => match[1]));
  expect({
    refused: literals.filter(row => reported.has(row.file)).map(row => `${row.line} ${row.program}`),
    exitCode,
  }).toEqual({
    refused: literals.filter(row => row.answer === "refused").map(row => `${row.line} ${row.program}`),
    exitCode: 1,
  });
});
