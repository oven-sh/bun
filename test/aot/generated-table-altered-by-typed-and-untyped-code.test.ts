// What altering a typed object does depends on the object and on the alteration, never on who alters it: typed code, an untyped file, a package or evaluated text.
// AOT_GENERATED, AOT_GENERATED_FLAGS and AOT_GENERATED_KEEP are those of ./generated/run-generated.ts, AOT_GENERATED_ALONE that of ./generated/case-files.ts. In the folder that is kept, answers.tsv holds one row for each program.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "path";
import {
  classesOf,
  programs,
  toTable,
  type Answers,
  type Program,
} from "./generated/altered-by-typed-and-untyped-code";
import { spread } from "./generated/case-files";
import { moreFlags } from "./generated/run-generated";
import { inShareOfList, wanted as programsWanted, slot, spawned, unsupported, withoutCoreDump } from "./run-programs";

// A text was stored where a number is declared. The typed read that comes afterwards may throw a TypeError.
const mayBeRefused = /^\S+ store-text/;

const wanted = process.env.AOT_GENERATED ?? "";
const all = programs();
const names = all.map(({ name }) => name);
// Each program is a build and the first start of a new executable, which a Mac signs and checks: 200 programs took CI's five minutes there, 320 take Linux two.
const inEveryRun = new Set(spread(names, Number(process.env.AOT_GENERATED_ALONE ?? (isMacOS ? 100 : 320))));
const chosen = all
  .filter(({ name }) => (wanted === "all" ? true : wanted ? name.includes(wanted) : inEveryRun.has(name)))
  // A debug or ASAN build of Bun is many times slower.
  .filter(({ name }, index) => wanted || programsWanted !== "quick" || inShareOfList(`table altered ${name}`, index));
const rows: Answers[] = [];

const printed = (stdout: string) => stdout.trim().split("\n").join(" // ");
const errors = (stderr: string) => stderr.split("\n").filter(line => /rror|AOT/.test(line));

async function answersOf({ made, operation, who, files }: Program): Promise<Answers> {
  using dir = tempDir("aot-altered", files);
  const root = String(dir);
  const executable = join(root, isWindows ? "program.exe" : "program");
  const plain = await spawned([bunExe(), "run", "main.ts"], root, bunEnv);
  const build = await spawned(
    [bunExe(), "build", "--compile", "--aot", ...moreFlags, "main.ts", "--outfile", executable],
    root,
    bunEnv,
  );
  const run = build.exitCode === 0 ? await spawned(withoutCoreDump([executable]), root, bunEnv) : undefined;
  return {
    made,
    operation,
    who,
    plain:
      plain.exitCode === 0
        ? printed(plain.stdout)
        : `exit ${plain.exitCode}: ${errors(plain.stderr).join(" ").slice(0, 120)}`,
    compiled: !run
      ? `BUILD: ${(errors(build.stderr)[0] ?? build.stderr).slice(0, 150)}`
      : run.exitCode === 0
        ? printed(run.stdout)
        : `exit ${run.exitCode ?? run.signal}: ${errors(run.stderr).join(" ").slice(0, 120)}`,
  };
}

function departs({ made, operation, plain, compiled }: Answers) {
  const isRefusalAllowed = mayBeRefused.test(`${made} ${operation}`);
  const [ours, theirs] = [compiled, plain].map(answers => answers.split(/ \/\/ | \| /));
  return (
    ours.length !== theirs.length ||
    ours.some((part, i) => part !== theirs[i] && !(isRefusalAllowed && part === "read threw TypeError"))
  );
}

describe.concurrent("compile/aot/generated/a typed object is altered by typed and by untyped code", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  if (chosen.length === 0) test.skip("no program selected", () => {});
  for (const [group, members] of Map.groupBy(chosen, ({ made, operation }) => `${made} ${operation}`)) {
    test(`${group}, by ${members.map(({ who }) => who).join(", ")}`, async () => {
      const answers = await Promise.all(members.map(program => slot(() => answersOf(program))));
      rows.push(...answers);
      expect(answers.filter(departs)).toEqual([]);
      if (new Set(answers.map(row => row.plain)).size === 1)
        expect(new Set(answers.map(row => row.compiled)).size).toBe(1);
    }, 600_000);
  }
  afterAll(() => {
    const kept = process.env.AOT_GENERATED_KEEP;
    if (kept) {
      mkdirSync(kept, { recursive: true });
      const at = (row: Answers) => names.indexOf(`${row.made} ${row.operation} ${row.who}`);
      writeFileSync(join(kept, "answers.tsv"), toTable(rows.sort((a, b) => at(a) - at(b))));
    }
    if (wanted || rows.some(departs)) console.log(classesOf(rows));
  });
});
