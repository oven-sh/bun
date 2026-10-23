import { describe as describeAnywhere, expect, test as testAnywhere } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeVerdict,
  formatArrivals,
  joinArrivals,
  Layouts,
  parseArrival,
  parseCounts,
  verdictOf,
  type ArrivalReport,
  type ArrivalSite,
  type ReportedLayout,
} from "../../src/aot/report/tools/arrivals";
import { compileCommand, runtimeEnvironment, withReport } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const tool = join(import.meta.dir, "../../src/aot/report/tools/arrivals.ts");
const env = { ...bunEnv, NO_COLOR: "1" };

function layout(id: number, name: string, fields: string[], rest: Partial<ReportedLayout> = {}): ReportedLayout {
  return { id, name, kind: "record", base: null, isDerived: false, position: null, fields, optional: [], ...rest };
}

function site(number: number, rest: Partial<ArrivalSite> = {}): ArrivalSite {
  return {
    number,
    file: "main.js",
    line: 2,
    column: 15,
    offset: 30,
    function: 1,
    operation: "PropGet",
    kind: "read",
    level: "guarded",
    cause: "unknown-object",
    expected: [1],
    stamp: "open",
    ...rest,
  };
}

describeAnywhere("the verdict on an arrival", () => {
  const manyNames = Array.from({ length: 14 }, (_, index) => "f" + index);
  const layouts = new Layouts([
    layout(1, "Pair", ["a", "b"]),
    layout(2, "", ["b", "a"]),
    layout(3, "", ["a", "b"]),
    layout(4, "Options", ["a", "b", "c"], { optional: ["c"] }),
    layout(5, "", ["a", "b", "d"]),
    layout(6, "Base", ["x"], { kind: "instance" }),
    layout(7, "Derived", ["x", "y"], { kind: "instance", base: 6 }),
    layout(8, "", ["a", "b", "late"], { base: 1, isDerived: true }),
    layout(9, "", ["x", "y", "late"], { kind: "instance", base: 7, isDerived: true }),
    layout(10, "", ["q"]),
    layout(11, "", ["a"]),
    layout(12, "Wide", manyNames),
    layout(13, "", []),
  ]);

  const cases: [what: string, expected: number[], verdict: string][] = [
    ["layout:1", [1], "expected"],
    ["layout:1+changed", [1], "left its shape"],
    ["layout:2", [1], "same fields, other order than L1 Pair"],
    ["layout:2+changed", [1], "same fields, other order than L1 Pair"],
    ["layout:3", [1], "same fields, same order as L1 Pair"],
    ["layout:1", [4], "L4 Options without optional c"],
    ["layout:5", [1], "L1 Pair plus d"],
    ["layout:7", [6], "below L6 Base by class"],
    ["layout:8", [1], "L1 Pair plus late"],
    ["layout:9", [6], "below L6 Base by class"],
    ["layout:9", [7], "L7 Derived plus late"],
    ["layout:10", [1], "unrelated"],
    ["layout:6", [7], "unrelated"],
    ["layout:5", [13], "unrelated"],
    ["layout:99", [1], "unrelated"],
    ["object{a,b}", [1], "foreign object with the fields of L1 Pair"],
    ["object{b,a}", [1], "foreign object with the fields of L1 Pair"],
    ["object{a,b}dict", [1], "foreign object with the fields of L1 Pair"],
    ["object{a,b}", [4], "foreign object with the fields of L4 Options"],
    ["object{a,b,z}", [1], "foreign object with the fields of L1 Pair"],
    ["object{a}", [1], "unrelated"],
    ["object{z}", [1], "unrelated"],
    ["object{}", [1], "unrelated"],
    [`object{${manyNames.slice(0, 12).join()},..}`, [12], "foreign object with the fields of L12 Wide"],
    [`object{${manyNames.slice(0, 11).join()},z,..}`, [12], "unrelated"],
    ["class:Map", [1], "unrelated"],
    ["function:12", [1], "unrelated"],
    ["function:native", [1], "unrelated"],
    ["string", [1], "unrelated"],
    ["undefined", [1], "unrelated"],
    ["layout:1", [], "nothing expected"],
    ["object{a,b}", [], "nothing expected"],
    ["string", [], "nothing expected"],
    ["layout:2", [10, 5, 1], "same fields, other order than L1 Pair"],
    ["layout:1", [4, 3], "same fields, same order as L3"],
    ["layout:5", [11, 1], "L1 Pair plus d"],
    ["object{a,b}", [4, 1], "foreign object with the fields of L1 Pair"],
  ];

  testAnywhere.each(cases)("%s where %j is expected: %s", (what, expected, verdict) => {
    expect(describeVerdict(verdictOf(parseArrival(what), expected, layouts), layouts)).toBe(verdict);
  });

  testAnywhere("an expected layout at a site without a fast arm", () => {
    const withoutFastArm = (what: string) => verdictOf(parseArrival(what), [1], layouts, false).kind;
    expect(withoutFastArm("layout:1")).toBe("expected, no fast arm");
    expect(withoutFastArm("layout:1+changed")).toBe("expected, no fast arm");
    expect(withoutFastArm("layout:2")).toBe("same fields, other order");
    expect(withoutFastArm("object{a,b}")).toBe("foreign object");
  });
});

describeAnywhere("the join of a report and the counts of a run", () => {
  const report: ArrivalReport = {
    functions: [{ name: "main" }, { name: "read" }],
    arrivalSites: [
      site(3),
      site(8),
      site(9, { level: "unknown", expected: [], stamp: "none" }),
      site(12, {
        file: "node:fs",
        line: 0,
        column: 0,
        offset: 77,
        function: null,
        operation: "PropSet",
        kind: "store",
        stamp: "complete",
      }),
      site(13),
    ],
    layouts: [
      layout(1, "Pair", ["a", "b"], { position: { file: "main.js", line: 5, column: 10 } }),
      layout(2, "", ["b", "a"]),
    ],
  };
  const counts = [
    "12\tcounter:PropertyCacheMiss",
    "3\toperation:operationAOTGetById",
    "7\tbranch:4",
    "150\tarrival:8\tlayout:2",
    "50\tarrival:3\tlayout:2",
    "60\tarrival:3\tobject{a,b}",
    "1500\tarrival:9\tstring",
    "200\tarrival:12\tclass:Stats",
    "6\tarrival:40\tnumber",
    "40\tarrival:3\tobject{a,b}\r",
    "",
  ].join("\n");

  const printed = `2,000 arrivals by name at 3 sites

#1  main.js:2:15  PropGet  read  unknown  in read
    1,500 by name, 75.0% of all. cause unknown-object, stamp none, site 9
    expected nothing
    arrived
      1,500  100.0%  string  nothing expected

#2  main.js:2:15  PropGet  read  guarded  in read
    300 by name, 15.0% of all. cause unknown-object, stamp open, sites 3 8
    expected
      L1 Pair {a, b}  main.js:5:10
    arrived
      200   66.7%  L2 {b, a}    same fields, other order than L1 Pair
      100   33.3%  object{a,b}  foreign object with the fields of L1 Pair

#3  node:fs:+77  PropSet  store  guarded
    200 by name, 10.0% of all. cause unknown-object, stamp complete, site 12
    expected
      L1 Pair {a, b}  main.js:5:10
    arrived
      200  100.0%  class:Stats  unrelated

Verdicts over all sites
  1,500   75.0%  nothing expected
    200   10.0%  same fields, other order
    200   10.0%  unrelated
    100    5.0%  foreign object
      0    0.0%  expected
      0    0.0%  expected, no fast arm
      0    0.0%  left its shape
      0    0.0%  below by class
      0    0.0%  same fields, same order
      0    0.0%  without optional
      0    0.0%  plus

6 arrivals at 1 site outside the report: the counts and the report are from different builds
`;

  testAnywhere("only arrival lines are read, and two lines of one site and receiver are added up", () => {
    expect(parseCounts(counts)).toEqual([
      { site: 8, what: "layout:2", count: 150 },
      { site: 3, what: "layout:2", count: 50 },
      { site: 3, what: "object{a,b}", count: 100 },
      { site: 9, what: "string", count: 1500 },
      { site: 12, what: "class:Stats", count: 200 },
      { site: 40, what: "number", count: 6 },
    ]);
  });

  testAnywhere("the copies of one place that expect the same are one site, the heaviest site is first", () => {
    const joined = joinArrivals(report, parseCounts(counts));
    expect(joined.sites.map(({ site, numbers, count }) => ({ first: site.number, numbers, count }))).toEqual([
      { first: 9, numbers: [9], count: 1500 },
      { first: 3, numbers: [3, 8], count: 300 },
      { first: 12, numbers: [12], count: 200 },
    ]);
    expect(joined).toMatchObject({ count: 2000, unlistedNumbers: [40], unlistedCount: 6 });
    expect(joined.verdicts.reduce((sum, verdict) => sum + verdict.count, 0)).toBe(joined.count);
  });

  testAnywhere("the text", () => {
    const joined = joinArrivals(report, parseCounts(counts));
    expect(formatArrivals(joined, 100)).toBe(printed);

    const shortened = formatArrivals(joined, 1);
    expect(shortened).toContain("\n2 more sites not shown (--top)\n");
    expect(shortened).not.toContain("#2");
    expect(shortened.slice(shortened.indexOf("Verdicts"))).toBe(printed.slice(printed.indexOf("Verdicts")));
  });

  testAnywhere("the tool needs a report and counts", async () => {
    const ran = await spawned([bunExe(), tool, "report.json"], import.meta.dir, env);
    expect(ran).toMatchObject({ stdout: "", exitCode: 1 });
    expect(ran.stderr).toStartWith("usage: bun src/aot/report/tools/arrivals.ts <report.json> <counts.txt> [--top");
  });
});

const rounds = 1000;
const read = "  return pair.a;";
// Flow follows what make() returns into read(), and it loses what JSON.parse makes. The literal {b, a} has the layout of
// {a, b}, and so has the object without `a`, whose slot is empty: the guard of the read passes all three. The parsed
// object has no layout, so it alone is read by name.
const source = `function make(a, b) {
  return { a, b };
}
function read(pair) {
${read}
}
const ordered = make(1, 2);
const emptied = make(1, 2);
delete emptied.a;
const swapped = JSON.parse("0", () => ({ b: 4, a: 3 }));
const parsed = JSON.parse(process.argv[2] ?? '{"a":5,"b":6}');
const pairs = [ordered, emptied, swapped, parsed];
let total = 0;
for (let round = 0; round < ${rounds}; round++) {
  for (const pair of pairs) total += read(pair) ?? 0;
}
console.log(total);
`;
const lineOfRead = source.split("\n").indexOf(read) + 1;

async function buildAndRun(folder: string, flags: string[]) {
  const report = join(folder, "report.json");
  const counts = join(folder, "counts.txt");
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const allFlags = [...flags, ...withReport(report, "sites")];
  built(await spawned([bunExe(), ...compileCommand, ...allFlags, "main.js", "--outfile", executable], folder, env));
  const ran = await spawned([executable], folder, { ...env, [runtimeEnvironment.countsPath]: counts });
  expect(ran).toMatchObject({ stdout: `${9 * rounds}\n`, exitCode: 0, signal: null });
  return { report, counts };
}

describe.concurrent("the arrivals report", () => {
  test(
    "of {a, b}, {b, a}, an object without `a` and a parsed object at one read, only the parsed one arrives by name",
    () =>
      slot(async () => {
        using dir = tempDir("aot-arrivals-report", { "main.js": source });
        const paths = await buildAndRun(String(dir), ["--aot-count-arrivals"]);
        const report: ArrivalReport = JSON.parse(readFileSync(paths.report, "utf8"));
        const joined = joinArrivals(report, parseCounts(readFileSync(paths.counts, "utf8")));
        const isListed = (id: number) => joined.layouts.get(id) !== undefined;

        const numbers = report.arrivalSites!.map(({ number }) => number);
        expect(numbers.filter((number, index) => index > 0 && number <= numbers[index - 1])).toEqual([]);
        expect(report.arrivalSites!.flatMap(({ expected }) => expected).filter(id => !isListed(id))).toEqual([]);
        expect(joined.unlistedNumbers).toEqual([]);
        const everyArrival = joined.sites.flatMap(({ arrivals }) => arrivals.map(({ arrival }) => arrival));
        expect(everyArrival.filter(arrival => arrival.kind === "layout" && !isListed(arrival.layout))).toEqual([]);

        const arrivals = joined.sites
          .filter(({ site }) => site.file === "main.js" && site.line === lineOfRead && site.kind === "read")
          .flatMap(({ arrivals }) => arrivals);
        const fieldsOf = (id: number) => `{${joined.layouts.get(id)!.fields.join()}}`;
        const verdictsOn = (receiver: string) => {
          const countByVerdict: Record<string, number> = {};
          for (const { what, arrival, count, verdict } of arrivals) {
            if ((arrival.kind === "layout" ? fieldsOf(arrival.layout) : what) !== receiver) continue;
            const text = verdict.layout === null ? verdict.kind : `${verdict.kind}: ${fieldsOf(verdict.layout)}`;
            countByVerdict[text] = (countByVerdict[text] ?? 0) + count;
          }
          return countByVerdict;
        };
        expect(verdictsOn("object{a,b}")).toEqual({ "foreign object: {a,b}": rounds });
        expect(arrivals.map(({ what }) => what)).toEqual(["object{a,b}"]);

        const printed = await spawned([bunExe(), tool, paths.report, paths.counts], String(dir), env);
        expect(printed).toMatchObject({ stdout: formatArrivals(joined, 100), stderr: "", exitCode: 0 });
        expect(printed.stdout).toMatch(/  foreign object with the fields of L\d+/);
      }),
    300_000,
  );

  test(
    "a build that doesn't count lists no site, and its run counts no arrival",
    () =>
      slot(async () => {
        using dir = tempDir("aot-arrivals-report-off", { "main.js": source });
        const paths = await buildAndRun(String(dir), []);
        const { arrivalSites, layouts }: ArrivalReport = JSON.parse(readFileSync(paths.report, "utf8"));
        expect({ arrivalSites, layouts }).toEqual({ arrivalSites: [], layouts: [] });
        expect(parseCounts(readFileSync(paths.counts, "utf8"))).toEqual([]);

        const printed = await spawned([bunExe(), tool, paths.report, paths.counts], String(dir), env);
        expect(printed).toMatchObject({ stdout: "", exitCode: 1 });
        expect(printed.stderr).toStartWith(`error: ${paths.report} lists no arrival sites\n`);
      }),
    300_000,
  );
});
