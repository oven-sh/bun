// `bun run` prints part of the code that never runs. A declaration that must stay keeps the `if` around it, and with it the
// test of that `if`. Each row of the two tables is a program of one file and says what `bun run` does with it. This test
// holds plain Bun to the answers of both tables, and `bun check --aot` to what it reports for a literal in such a test.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawned } from "../harness/commands";
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

// Loads the files one by one and says how each load ends. A `.cjs` file is required: imported, a file without a sign of
// CommonJS runs as a module.
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

const reportedIn = (stdout: string) =>
  new Set([...stdout.matchAll(/^(\w+\.\w+)\(\d+,\d+\): error TS100307: /gm)].map(match => match[1]));

const branches = rowsOf("never-run-branches.txt");

// A row that says `missed` is an `if` that plain Bun keeps and that the model of the compiler takes for gone.
test("never-run-branches.txt: plain Bun keeps the `if` where the table says", async () => {
  expect(branches.length).toBeGreaterThan(100);
  using dir = tempDir("aot-never-run-branches", programOf(branches, "ReferenceError", "kept", "dropped"));
  const { stdout, exitCode } = await spawned([bunExe(), "main.cjs"], String(dir), bunEnv);
  const said = branches.map(row => `${row.line} ${row.answer === "dropped" ? "dropped" : "kept"}`);
  expect({ said: stdout.trimEnd().split("\n"), exitCode }).toEqual({ said, exitCode: 0 });
});

const literals = rowsOf("never-run-literals.txt");
// A row that says `missed` is a file that plain Bun refuses and that a build does not report yet.
const programsOf = (answer: string) => literals.filter(row => row.answer === answer).map(row => row.program);

test("never-run-literals.txt: plain Bun refuses the files that the table says", async () => {
  expect(literals.length).toBeGreaterThan(50);
  using dir = tempDir("aot-never-run-literals", programOf(literals, "SyntaxError", "refused", "loads"));
  const { stdout, exitCode } = await spawned([bunExe(), "main.cjs"], String(dir), bunEnv);
  const said = literals.map(row => `${row.line} ${row.answer === "loads" ? "loads" : "refused"}`);
  expect({ said: stdout.trimEnd().split("\n"), exitCode }).toEqual({ said, exitCode: 0 });
});

test("never-run-literals.txt: a build reports the files that the table says", async () => {
  using dir = tempDir("aot-never-run-literals", programOf(literals, "SyntaxError", "refused", "loads"));
  const check = [bunExe(), "check", "--aot", "--no-pretty", "main.cjs"];
  const { stdout, exitCode } = await spawned(check, String(dir), bunEnv);
  const reported = reportedIn(stdout);
  expect({
    refused: literals.filter(row => reported.has(row.file)).map(row => row.program),
    exitCode,
  }).toEqual({ refused: programsOf("refused"), exitCode: 1 });
});

// What can stand in a branch that never runs, and keep it or not.
const declared = [
  "",
  "var v;",
  "let v;",
  "class K {}",
  "function k() {}",
  "async function k() {}",
  "function* k() {}",
  'function k() {} eval("");',
  "switch (0) {}",
  "with (x) {}",
  "for (var i = 0; i < 1; i++) {}",
  "try {} catch { var v; }",
];
// Where the literal stands beside it: `K` is what is declared, `L` the literal.
const places = [
  "if (L) {} else { K }",
  "if (L) { x(); } else { K }",
  "if (L) {} else K",
  "if (!L) { K }",
  "if (L || x()) {} else { K }",
  "if (false) { K L; }",
  "if (false) { K x(L); }",
  "if (false) { K var w = L; }",
  "if (false) { K if (L) {} }",
  "if (false) { K [L]; }",
  "if (false) { K x() || L; }",
  "return 1; { K L; }",
  "return 1; { K var w = L; }",
  "return 1; { K if (L) {} }",
  "return 1; { K x(), L; }",
  "return 1; K L;",
  "K L;",
  "K if (L) {}",
];
const around = [
  ["var x = function () {}; x.y = 0; ", ""],
  ["function g(x) { ", " }"],
  ['function g(x) { "use strict"; ', " }"],
  ["const g = async x => { ", " };"],
];

function crossed() {
  const files: Record<string, string> = {};
  for (const [before, behind] of around)
    for (const place of places)
      for (const declares of declared) {
        // Strict code has no `with`, and a file runs what stands at its level.
        if (declares.startsWith("with") && before.includes("use strict")) continue;
        if (!behind && /^(K |return)/.test(place)) continue;
        // Only a statement list takes every declaration.
        if (place.endsWith("else K") && !/^(var|switch|with|for|try|function k\(\) \{\}$)/.test(declares)) continue;
        const text = before + place.replace("K", declares).replace("L", "/a**/") + behind;
        files[`c${Object.keys(files).length}.cjs`] = text.replace(/\s+/g, " ") + "\n";
      }
  const loads = Object.keys(files).map(file => `  ["${file}", () => require("./${file}")],`);
  files["main.cjs"] = `for (const [file, load] of [
${loads.join("\n")}
]) {
  let answer = "loads";
  try {
    load();
  } catch (error) {
    answer = error instanceof SyntaxError ? "refused" : String(error);
  }
  console.log(file + " " + answer);
}
`;
  return files;
}

test("a build reports no regexp literal in a file that plain Bun loads", async () => {
  const files = crossed();
  using dir = tempDir("aot-never-run-crossed", files);
  const cwd = String(dir);
  const [plain, checked] = await Promise.all([
    spawned([bunExe(), "main.cjs"], cwd, bunEnv),
    spawned([bunExe(), "check", "--aot", "--no-pretty", "main.cjs"], cwd, bunEnv),
  ]);
  const said = plain.stdout
    .trimEnd()
    .split("\n")
    .map(line => line.split(" "));
  const reported = reportedIn(checked.stdout);
  const answered = (answer: string) => said.filter(([, given]) => given === answer).map(([file]) => file);
  const [loaded, refused] = [answered("loads"), answered("refused")];
  expect(loaded.length + refused.length).toBe(Object.keys(files).length - 1);
  expect(loaded.length).toBeGreaterThan(300);
  expect(refused.filter(file => reported.has(file)).length).toBeGreaterThan(50);
  expect(loaded.filter(file => reported.has(file)).map(file => files[file].trim())).toEqual([]);
});
