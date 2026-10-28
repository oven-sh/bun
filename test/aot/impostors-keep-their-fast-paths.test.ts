import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { buildEnvironment, compileCommand, withReport } from "./harness/flags";
import { run } from "./harness/run";
import {
  countTurn,
  functionsOf,
  operationsOf,
  operationsOfTurn,
  readReport,
  sitesOf,
  type Report,
  type Turn,
} from "./impostors-keep-their-fast-paths/look";
import { projects, type Row } from "./impostors-keep-their-fast-paths/rows";
import { whyInstructionsCannotBeCounted, type CompiledFunction } from "./instruction-counts/count-instructions";
import { built, withoutDebugInformation } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const slack = 1.5;
const instructionsOfBlockRefills = 500;

interface Built {
  executable: string;
  report: Report;
  functions: CompiledFunction[];
  names: string[];
  folder: string;
}

interface Seen {
  turn: Turn | Error | undefined;
  calls: string[] | Error;
}

const atOnce = Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism());

async function runCases(project: Built, rows: Row[], countsInstructions: boolean): Promise<Map<string, Seen>> {
  const seen = new Map<string, Seen>();
  const waiting = rows.map((row, index) => ({ row, index }));
  const caught = <T>(work: Promise<T>) => work.catch(error => error as Error);
  const worker = async () => {
    for (let next = waiting.shift(); next; next = waiting.shift()) {
      seen.set(next.row.case, {
        turn: countsInstructions
          ? await caught(countTurn(bunExe(), project.executable, project.functions, next.row.case, bunEnv))
          : undefined,
        calls: await caught(
          operationsOfTurn(project.executable, next.row.case, join(project.folder, `counts-${next.index}`), bunEnv),
        ),
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, rows.length) }, worker));
  return seen;
}

async function build(folder: string, entry: string, withoutProjectFile: boolean, into: string): Promise<Built> {
  const executable = join(into, "main" + (isWindows ? ".exe" : ""));
  const reportPath = join(into, "report.json");
  const mapPath = join(into, "main.map");
  let cwd = join(import.meta.dir, "impostors-keep-their-fast-paths", folder);
  if (withoutProjectFile) {
    cpSync(cwd, join(into, "sources"), { recursive: true });
    cwd = join(into, "sources");
    rmSync(join(cwd, "tsconfig.json"));
  }
  built(
    await run(
      [
        bunExe(),
        ...compileCommand,
        ...withReport(reportPath, "sites"),
        ...withoutDebugInformation(),
        entry,
        "--outfile",
        executable,
      ],
      cwd,
      {
        ...bunEnv,
        [buildEnvironment.mapFilePath]: mapPath,
      },
    ),
  );
  const names = await run([executable, "names"], cwd, bunEnv);
  expect({ stderr: names.stderr, exitCode: names.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return {
    executable,
    report: readReport(reportPath),
    functions: functionsOf(readFileSync(mapPath, "utf8")),
    names: names.stdout.split("\n").filter(Boolean),
    folder: into,
  };
}

const levels = ["unknown", "guarded", "proven"];
const rankOf = (site: string) => levels.indexOf(site.slice(site.lastIndexOf(" ") + 1));
const kindOf = (site: string) => site.slice(0, site.lastIndexOf(" "));

function isNoWorseSite(seen: string | undefined, recorded: string) {
  return seen !== undefined && kindOf(seen) === kindOf(recorded) && rankOf(seen) >= rankOf(recorded);
}

function callsOf(lines: string[]) {
  return new Map(
    lines.map(line => [line.slice(0, line.lastIndexOf(" ")), Number(line.slice(line.lastIndexOf(" ") + 1))]),
  );
}

const isWhereRowsWereTaken = process.platform === "linux" && process.arch === "x64" && !isASAN && !isDebug;
if (!isWhereRowsWereTaken)
  console.error(
    "SKIPPED: test/aot/impostors-keep-their-fast-paths: its rows are those of a release build on Linux x64",
  );
const whyNotCounted = isWhereRowsWereTaken ? await whyInstructionsCannotBeCounted() : "not the platform of the rows";

for (const { folder, entry, withoutProjectFile = false, rows } of projects) {
  describe.skipIf(!isWhereRowsWereTaken)(
    `compile/aot/impostors-keep-their-fast-paths/${folder}${withoutProjectFile ? " without a tsconfig.json" : ""}`,
    () => {
      let dir: ReturnType<typeof tempDir> | undefined;
      afterAll(() => dir?.[Symbol.dispose]());
      let project: Built;
      let seen: Map<string, Seen>;
      beforeAll(async () => {
        dir = tempDir(`aot-fast-paths-${folder}`, {});
        project = await build(folder, entry, withoutProjectFile, String(dir));
        seen = await runCases(
          project,
          rows.filter(row => !row.notYet),
          !whyNotCounted,
        );
      }, 1_800_000);

      test("every case has a row", () => {
        expect(rows.map(row => row.case).sort()).toEqual([...project.names].sort());
      });

      for (const row of rows) {
        const title = `${row.evidence}: ${row.case}`;
        if (row.statistics) {
          test(`${title}: what the build counted`, () => {
            const counted = Object.fromEntries(
              Object.keys(row.statistics!).map(name => [name, project.report.statistics[name] ?? 0]),
            );
            const isKept = Object.entries(row.statistics!).every(([name, least]) => counted[name] >= least);
            expect({ counted, isKept }).toEqual({ counted, isKept: true });
          });
        }
        if (row.notYet) {
          test.todo(`${title} (${row.notYet})`);
          continue;
        }

        test.skipIf(!!whyNotCounted)(`${title}: the instructions of a turn`, () => {
          const turn = seen.get(row.case)!.turn;
          if (!turn || turn instanceof Error) throw turn;
          const isKept =
            turn.compiled <= row.compiled * slack &&
            turn.outside <= row.outside * slack + instructionsOfBlockRefills &&
            turn.stubs.every(stub => row.stubs.includes(stub));
          const recorded = { compiled: row.compiled, outside: row.outside, stubs: row.stubs };
          expect({ turn, recorded, isKept }).toEqual({ turn, recorded, isKept: true });
        });

        test(`${title}: the operations of the run time that a turn calls`, () => {
          const calls = seen.get(row.case)!.calls;
          if (calls instanceof Error) throw calls;
          const recorded = callsOf(row.calls);
          const isKept = [...callsOf(calls)].every(([operation, count]) => count <= (recorded.get(operation) ?? 0));
          expect({ calls, recorded: row.calls, isKept }).toEqual({ calls, recorded: row.calls, isKept: true });
        });

        test(`${title}: the report`, () => {
          const sites = sitesOf(project.report, row.functions);
          const operations = operationsOf(project.report, row.functions);
          const isKept =
            sites.length === row.sites.length &&
            row.sites.every((recorded, index) => isNoWorseSite(sites[index], recorded));
          const missing = row.operations.filter(operation => !operations[operation]);
          expect({ sites, recorded: row.sites, isKept, missing }).toEqual({
            sites,
            recorded: row.sites,
            isKept: true,
            missing: [],
          });
        });
      }
    },
  );
}
