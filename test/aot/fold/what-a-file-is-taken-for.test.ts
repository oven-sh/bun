// what-a-file-is-taken-for.txt lists programs whose names of CommonJS stand where `bun run` may fold them away, and says what
// `bun run` takes each for: CommonJS or an ES module. src/sema/file_analysis/source_tests/module_format.rs holds the model that a
// build has of `bun run` to the table. This file holds the table to `bun run` itself, and a build to the table: every row is a file
// of its own, and one program requires them all.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../harness/run";
import { test as testOfABuild } from "../supported";

type Row = { line: number; underBunRun: string; inABuild: string; file: string; source: string };

const rows: Row[] = [];
const table = readFileSync(join(import.meta.dir, "what-a-file-is-taken-for.txt"), "utf8");
table.split("\n").forEach((text, index) => {
  if (!text || text.startsWith("#")) return;
  const [underBunRun, inABuild, extension, source] = text.split("\t");
  const line = index + 1;
  rows.push({
    line,
    underBunRun,
    inABuild: inABuild === "=" ? underBunRun : inABuild,
    file: `row${line}.${extension}`,
    source,
  });
});

// `require` answers with the namespace of an ES module, and with `module.exports` of a CommonJS file.
const main = `function ask(line, load) {
  globalThis.a = Object.assign(function () { return 0; }, { [Symbol.iterator]: function* () {} });
  let answer;
  try {
    answer = Object.prototype.toString.call(load()) === "[object Module]" ? "esm" : "cjs";
  } catch (error) {
    answer = "threw " + error.name;
  }
  console.log(line + " " + answer);
}
${rows.map(row => `ask(${row.line}, () => require("./${row.file}"));`).join("\n")}
`;

async function answers(flags: string[]) {
  using dir = tempDir("what-a-file-is-taken-for", {
    "main.cjs": main,
    "node_modules/a/index.js": "module.exports = {};\n",
    ...Object.fromEntries(rows.map(row => [row.file, row.source + "\n"])),
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "run", ...flags, "./main.cjs"], String(dir), bunEnv);
  const answer = new Map([...stdout.matchAll(/^(\d+) (.*)$/gm)].map(said => [said[1], said[2]]));
  return { rows: rows.map(row => `${row.line} ${answer.get(String(row.line))} ${row.source}`), stderr, exitCode };
}

test("the table has rows", () => {
  expect(rows.length).toBeGreaterThan(200);
});

test.concurrent("bun run takes each program for what the table says", async () => {
  expect(await answers([])).toEqual({
    rows: rows.map(row => `${row.line} ${row.underBunRun} ${row.source}`),
    stderr: "",
    exitCode: 0,
  });
});

testOfABuild.concurrent(
  "a build takes each program for what the table says",
  async () => {
    expect(await answers(["--debug-aot"])).toEqual({
      rows: rows.map(row => `${row.line} ${row.inABuild} ${row.source}`),
      stderr: "",
      exitCode: 0,
    });
  },
  240_000,
);

testOfABuild.concurrent("an await behind a member read that bun run folds makes no importer wait", async () => {
  using dir = tempDir("what-a-file-is-taken-for-await", {
    "main.mjs": `import "./waits.mjs";\nconsole.log("after");\n`,
    "waits.mjs": `if ({ b: 0 }.b) await 0;\nqueueMicrotask(() => console.log("micro"));\nconsole.log("main");\n`,
  });
  const underBunRun = await run([bunExe(), "run", "./main.mjs"], String(dir), bunEnv);
  expect(underBunRun).toEqual({ stdout: "main\nafter\nmicro\n", stderr: "", exitCode: 0 });
  expect(await run([bunExe(), "run", "--debug-aot", "./main.mjs"], String(dir), bunEnv)).toEqual(underBunRun);
});
