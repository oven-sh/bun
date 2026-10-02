// Writes ../lint-command-rows.json and ../lint-parse-grammar.test.ts.draft: the rows as a test through `bun --lint`,
// for the day the command calls the lint parse (NEEDS.md N2 and N3). Every expectation is a prediction from tsc.
// usage: node lint-command.mjs     (reads ../rows.facts.json)
import { readFileSync, writeFileSync } from "node:fs";
import { familyOf } from "./families.mjs";
const here = new URL("..", import.meta.url).pathname;
const rows = JSON.parse(readFileSync(here + "rows.facts.json", "utf8"));
const EXT = { ts: "ts", tsx: "tsx", js: "js", deco: "ts" };
const lineColumn = (text, offset) => {
  const before = text.slice(0, offset).split("\n");
  return [before.length, before[before.length - 1].length + 1];
};
const seen = new Set();
const groups = new Map();
for (const r of rows) {
  const key = r.loader + "\0" + r.src;
  if (seen.has(key)) continue;
  seen.add(key);
  const family = familyOf(r);
  const group = family + (r.loader === "deco" ? "+decorators" : "");
  if (!groups.has(group)) groups.set(group, { family, decorators: r.loader === "deco", files: [] });
  const g = groups.get(group);
  const name = `r${String(r.i).padStart(3, "0")}.${EXT[r.loader]}`;
  let expect = null;
  if (r.reject) {
    const [line, column] = lineColumn(r.src, r.reject.start);
    expect = `${name}(${line},${column}): error TS${r.reject.code}: ${r.reject.text}`;
  }
  g.files.push({ name, text: r.src, expect });
}
const list = [...groups].map(([group, g]) => ({ group, ...g }));
writeFileSync(here + "lint-command-rows.json", JSON.stringify(list, null, 1));
const test = `import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import groups from "./lint-parse-grammar.rows.json";

// DRAFT, not run. It belongs in test/bundler/transpiler/lint-parse-grammar.test.ts, with lint-command-rows.json beside it as
// lint-parse-grammar.rows.json, once \`git grep -n parse_for_lint -- src/runtime/cli/lint_command.rs\` finds the call of the lint parse.
// Each group is the sources of one change of the grammar, one file for each source. A file without \`expect\` is TypeScript
// that tsc 6.0.2 parses: the command reports no syntax error in it. \`expect\` is the first diagnostic of tsc for a source
// that it rejects. Both are predictions: compare the first run with the rows of src/js_parser/parse/grammar_rows_tests.rs.
// A group with "+decorators" needs a tsconfig.json with experimentalDecorators, if the command reads one.

const lintEnv = { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1" };

test.concurrent.each(groups.map(group => [group.group, group] as const))("bun --lint reads %s as tsc does", async (_, group) => {
  const files: Record<string, string> = {};
  for (const file of group.files) files[file.name] = file.text;
  if (group.decorators) files["tsconfig.json"] = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
  using dir = tempDir("lint-parse-grammar", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--lint", ...group.files.map(file => file.name)],
    env: lintEnv,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const syntaxErrors = stderr.split("\\n").filter(line => /: error (TS1\\d{3}|syntax):/.test(line));
  const expected = group.files.filter(file => file.expect !== null).map(file => file.expect);
  expect(stdout).toBe("");
  expect(syntaxErrors).toEqual(expected);
  expect(exitCode).toBe(expected.length > 0 ? 2 : 0);
});
`;
writeFileSync(here + "lint-parse-grammar.test.ts.draft", test);
console.log(`lint-command-rows.json: ${list.length} groups, ${list.reduce((n, g) => n + g.files.length, 0)} files, ${list.reduce((n, g) => n + g.files.filter(f => f.expect).length, 0)} with an expected diagnostic`);
