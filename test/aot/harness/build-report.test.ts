import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "../run-programs";
import { describe, test } from "../supported";
import {
  addAccessCounts,
  addLevelCounts,
  emptyAccessCounts,
  emptyLevelCounts,
  positionKey,
  readBuildReport,
  type AccessCounts,
  type AccessSite,
  type LevelCounts,
} from "./build-report";
import { compileCommand, withReport, type ReportDetail } from "./flags";
import { registry } from "./registry";

const readOfParsedValue = "  return value.port;";
const parse = `const parsed = JSON.parse(process.argv[2] ?? '{"port":3000}');`;
const source = `class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
function portOf(value: any) {
${readOfParsedValue}
}
function createCounter() {
  let count = 0;
  return () => ++count;
}
const points: Point[] = [];
for (let i = 0; i < 3; i++) points.push(new Point(i, i + 1));
let sum = 0;
for (const point of points) sum += point.x + point.y;
${parse}
const port = portOf(parsed);
const next = createCounter();
next();
console.log(sum, port, next());
`;
const lineOf = (text: string) => source.split("\n").indexOf(text) + 1;
const buildLimit = 300_000;

async function writeReport(folder: string, name: string, detail: ReportDetail) {
  const path = join(folder, name + ".json");
  const command = [bunExe(), ...compileCommand, ...withReport(path, detail), "main.ts", "--outfile", isWindows ? "app.exe" : "app"];
  built(await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" }));
  return path;
}

const sumLevelCounts = (counts: LevelCounts[]) => counts.reduce(addLevelCounts, emptyLevelCounts());
const sumAccessCounts = (counts: AccessCounts[]) => counts.reduce(addAccessCounts, emptyAccessCounts());
const isCall = ({ kind }: AccessSite) => kind === "call" || kind === "construct";

function countByLevel(sites: AccessSite[]) {
  const counts = emptyLevelCounts();
  for (const { level } of sites) counts[level]++;
  return counts;
}

function countAccessSites(sites: AccessSite[]) {
  const counts = emptyAccessCounts();
  for (const { level, cost } of sites) {
    counts[cost === "testsReceiver" || cost === "testsSlot" ? "tested" : cost]++;
    if (cost === "testsSlot") counts.testedSlotOnly++;
    if (level === "proven") counts.provenWithoutAnyTest++;
  }
  return counts;
}

function withReportOf(detail: ReportDetail, check: (report: ReturnType<typeof readBuildReport>) => void) {
  return () =>
    slot(async () => {
      using dir = tempDir("aot-build-report", { "main.ts": source });
      check(readBuildReport(await writeReport(String(dir), "report", detail)));
    });
}

describe.concurrent("the build report", () => {
  test(
    "detail summary has every member, and null for functions and sites",
    withReportOf("summary", report => {
      expect(Object.keys(report)).toEqual([
        "schemaHash",
        "buildId",
        "summary",
        "statistics",
        "limits",
        "losses",
        "passes",
        "stages",
        "retainedFeatures",
        "unseenCode",
        "functions",
        "accessSites",
        "allocationSites",
        "typeTestSites",
        "arrivalSites",
        "layouts",
      ]);
      const { functions, accessSites, allocationSites, typeTestSites, arrivalSites, layouts, retainedFeatures } = report as typeof report & { arrivalSites: unknown; layouts: unknown };
      expect({ functions, accessSites, allocationSites, typeTestSites, arrivalSites, layouts, retainedFeatures }).toEqual({
        functions: null,
        accessSites: null,
        allocationSites: null,
        typeTestSites: null,
        arrivalSites: null,
        layouts: null,
        retainedFeatures: null,
      });
      expect(report.schemaHash).toBe(registry().schemaHash);
    }),
    buildLimit,
  );

  test(
    "detail functions: the functions of the program add up to the summary",
    withReportOf("functions", report => {
      const functions = report.functions!;
      const own = functions.filter(record => !record.isInDependency);
      expect(own).not.toEqual([]);
      expect(sumAccessCounts(own.map(record => record.accesses))).toEqual(report.summary.accesses);
      expect(sumLevelCounts(own.map(record => record.calls))).toEqual(report.summary.calls);
      const operations = new Set(registry().operations);
      expect([...new Set(functions.flatMap(record => Object.keys(record.operations)))].filter(name => !operations.has(name))).toEqual([]);
      expect(functions.filter(record => record.line > record.endLine)).toEqual([]);
      expect(report.accessSites).toBeNull();
    }),
    buildLimit,
  );

  test(
    "detail sites: the access sites add up to the summary, and each below proven has a loss",
    withReportOf("sites", ({ summary, losses, accessSites }) => {
      const sites = accessSites!;
      expect(countAccessSites(sites.filter(site => !isCall(site)))).toEqual(sumAccessCounts([summary.accesses, summary.dependencyAccesses]));
      expect(countByLevel(sites.filter(isCall))).toEqual(summary.calls);
      expect(sites.filter(site => site.loss !== null && !(site.loss >= 0 && site.loss < losses.length))).toEqual([]);
      expect(sites.filter(site => (site.level === "proven") !== (site.loss === null))).toEqual([]);
      expect(new Set(sites.map(site => `${positionKey(site)} ${site.kind}`)).size).toBe(sites.length);
    }),
    buildLimit,
  );

  test(
    "statistics, limits and loss reasons are those of the registry",
    withReportOf("summary", report => {
      const { statistics, limits, lossReasons } = registry();
      expect(Object.keys(report.statistics)).toEqual(statistics);
      expect(report.limits.map(({ name, value }) => ({ name, value }))).toEqual(limits.map(({ name, value }) => ({ name, value })));
      expect([...new Set(report.losses.map(loss => loss.reason))].filter(reason => !lossReasons.includes(reason))).toEqual([]);
    }),
    buildLimit,
  );

  test(
    "the loss of a read of parsed data names the call that parsed it",
    withReportOf("sites", ({ losses, accessSites }) => {
      const reads = accessSites!.filter(site => site.file === "main.ts" && site.line === lineOf(readOfParsedValue) && site.kind === "read");
      expect(reads).toEqual([expect.objectContaining({ level: expect.stringMatching(/^(unknown|guarded)$/), loss: expect.any(Number) })]);
      expect(losses[reads[0]!.loss!]!.witness).toMatchObject({ file: "main.ts", line: lineOf(parse) });
    }),
    buildLimit,
  );

  test(
    "two builds of one program write the same report but for the times",
    () =>
      slot(async () => {
        using dir = tempDir("aot-build-report-twice", { "main.ts": source });
        // How often the checker is asked is work done, as a time is: each thread keeps the answers that it has got, so the sum follows from which files fall to which thread.
        const withoutTimes = (path: string) => JSON.parse(readFileSync(path, "utf8"), (key, value) => (key.endsWith("anoseconds") || key === "CheckerQueries" ? undefined : value));
        const first = await writeReport(String(dir), "first", "sites");
        const second = await writeReport(String(dir), "second", "sites");
        expect(Object.keys(readBuildReport(first).statistics).filter(name => name.endsWith("Nanoseconds"))).not.toEqual([]);
        expect(withoutTimes(second)).toEqual(withoutTimes(first));
      }),
    buildLimit,
  );
});
