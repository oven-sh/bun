import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { afterAll } from "./default-timeout";
import { all, differences, filesOf, printed, type Sequence } from "./mock-sequence-files";
import { run } from "./run";

export { all, filesOf };

const list = join(import.meta.dir, "..", "mock-sequences.known.txt");
const rewrite = !!process.env.BUN_AOT_REWRITE_MOCK_SEQUENCES;
const known = readFileSync(list, "utf8").split("\n");
const withoutName = (line: string) => line.replace(/^(\S+) /, "");
const idOf = (line: string) => withoutName(line).split(" ")[1];
const isEntry = (line: string) => !!line && !/^[#~]/.test(line);
const keyOf = (line: string) => line.split(" | ")[0].replace(/ (loud|SILENT)$/, "");
const wavers = new Set(known.filter(line => line.startsWith("~ ")).map(line => line.replace(/^~ \S+ /, "")));
const isSteady = (line: string) => !wavers.has(keyOf(line));
const seen: string[] = [];
const asked = new Set<string>();

function judge(way: string, ids: string[], differing: string[]) {
  const found = differing.filter(isSteady);
  seen.push(...found);
  for (const id of ids) asked.add(`${way} ${id}`);
  if (rewrite) return;
  const mine = (line: string) => isEntry(line) && withoutName(line).startsWith(way + " ") && ids.includes(idOf(line));
  expect(found.sort()).toEqual(known.filter(mine).map(withoutName).sort());
}

const env = { ...bunEnv, NO_COLOR: "1", BUN_OPTIONS: "--no-install", BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };

async function runOf(cwd: string, ids: string[], ...flags: string[]) {
  const isOneRealm = flags.includes("--no-isolate");
  const { stdout, stderr, exitCode } = await run(
    [
      bunExe(),
      "test",
      ...flags,
      ...ids.flatMap(id => (isOneRealm ? [id, `${id}.test.next`] : [id]).map(name => `./test/${name}.test.js`)),
    ],
    cwd,
    {
      ...env,
    },
  );
  return { lines: printed(stdout, stderr, exitCode, ids), stderr };
}

// The company of the others in one build changes what these say.
const alone = [
  "async+one+unmock.cjs.required",
  "one+async+two.cjs.required",
  "one+rejects-over+one.cjs.late",
  "rejects-over+bare+over.cjs.late",
];
type Way = "one" | "alone";
type Case = { way: Way; title: string; group: Sequence[]; flags: string[] };

// A run costs about the same whatever it holds, so a way is one run wherever the sequences leave one another alone.
const cases: Case[] = [
  { way: "one", title: "as one program", group: all, flags: ["--isolate"] },
  ...all
    .filter(({ id }) => alone.includes(id))
    .map(sequence => ({ way: "alone" as const, title: "alone", group: [sequence], flags: [] })),
];

/**
 * Three mock events in a row on one module. After each, what import(), require(), a user that is loaded late and a user that
 * was linked at the top see. The ways: `one`: as one program, a realm a file; `alone`: one sequence, one program.
 * mock-sequences.known.txt holds every line that differs from a plain run: a line that is cured, one that changes and a new one
 * all fail.
 * BUN_AOT_REWRITE_MOCK_SEQUENCES=1 writes the lines of what ran anew and keeps their names.
 */
export function mockSequences(...ways: Way[]) {
  for (const { way, title, group, flags } of cases.filter(({ way }) => ways.includes(way))) {
    const ids = group.map(sequence => sequence.id);
    test(`${title}: ${ids.length > 6 ? `${ids.length} from ${ids[0]}` : ids.join(" ")}`, async () => {
      const files = Object.assign({ "package.json": `{ "type": "module" }` }, ...group.map(sequence => filesOf(sequence, 0)));
      using dir = tempDir("aot-mock-sequences", files);
      const plain = await runOf(String(dir), ids, ...flags);
      const compiled = await runOf(String(dir), ids, "--aot", ...flags);
      expect(compiled.stderr).toContain("AOT test run | one program");
      judge(way, ids, differences(plain.lines, compiled.lines, way));
    }, 270_000);
  }
  afterAll(() => {
    if (!rewrite) return;
    const now = readFileSync(list, "utf8").split("\n");
    const names = new Map(now.filter(isEntry).map(line => [keyOf(withoutName(line)), line.split(" ")[0]]));
    const kept = now.filter(line => isEntry(line) && !asked.has(withoutName(line).split(" ", 2).join(" ")));
    const mine = seen.map(line => `${names.get(keyOf(line)) ?? "?"} ${line}`);
    const byKey = (a: string, b: string) => (withoutName(a) < withoutName(b) ? -1 : 1);
    writeFileSync(list, [...now.filter(line => /^[#~]/.test(line)), ...[...kept, ...mine].sort(byKey), ""].join("\n"));
  });
}
