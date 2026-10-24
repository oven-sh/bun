// A compiler may not do worse for knowing more. Each switch here only takes knowledge away: one result of the flow analysis, or the types of the program.
// Every program under ./more-knowledge and ./witnesses is built with everything and once without each, and no access or call may be of a better class in the
// build that knows less (./sites-that-got-worse.ts says what a class is). A pair that has such sites today is listed as a todo, with how many.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type BuildReport, readBuildReport } from "../harness/build-report";
import { buildFlags, compileCommand, withoutFlowResult, withReport } from "../harness/flags";
import { registry } from "../harness/registry";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { describe, test } from "../supported";
import { compareReports, describeChange } from "./sites-that-got-worse";

const folders = ["more-knowledge", "witnesses"];
const programs = folders.flatMap(folder =>
  readdirSync(join(import.meta.dir, folder))
    .filter(name => /\.(ts|js)$/.test(name) && !name.endsWith(".d.ts"))
    .map(name => join(folder, name)),
);

// `${program} ${switch}`: how many sites are better without the knowledge today.
const today: Record<string, number> = {
  "more-knowledge/a-literal-spreads-a-record-of-a-declared-type.ts --aot-disable=flow:Initialization": 1,
  "witnesses/a-class-below-a-function-that-nobody-has-constructed.js --aot-disable=flow:ClassBases": 4,
  "witnesses/a-literal-with-getters-is-made-often.ts --aot-disable=flow:ExecutionCounts": 1,
  "witnesses/a-literal-with-getters-is-read-often.ts --aot-disable=flow:CalleeSets": 2,
  "witnesses/a-literal-with-getters-is-read-often.ts --aot-disable=flow:Initialization": 2,
  "witnesses/a-literal-with-getters-is-read-often.ts --aot-disable=flow:ExecutionCounts": 5,
  "witnesses/an-async-generator-is-stepped-by-hand-under-a-store.ts --aot-disable=flow:CalleeSets": 2,
  "witnesses/an-object-that-once-had-a-getter-is-spread.ts --aot-disable=flow:NarrowedTypes": 1,
  "witnesses/an-object-that-once-had-a-getter-is-spread.ts --aot-disable=flow:Initialization": 1,
  "witnesses/array-methods-on-an-array-that-is-handed-in.ts --aot-erase-types": 2,
  "witnesses/fresh-objects-are-given-prototypes.ts --aot-disable=flow:ProvenLayoutSets": 1,
  "witnesses/fresh-objects-are-given-prototypes.ts --aot-disable=flow:NarrowedTypes": 1,
};
// No program builds without this result today.
const doesNotBuild = new Set(["--aot-disable=flow:ReachedFunctions"]);

// TODO: hundreds of builds do not end within the time that CI gives a file on four processors.
const skipped = isDebug || isASAN || isCI ? "hundreds of builds" : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/more-knowledge-costs-no-site.test.ts: ${skipped}`);

describe.skipIf(!!skipped).each(programs)("compile/aot/perf/more-knowledge/%s", program => {
  const folder = String(tempDir("aot-more-knowledge", {}));
  const reports = new Map<string, Promise<BuildReport>>();

  function reportOf(flag: string | undefined) {
    const name = flag ?? "everything";
    let report = reports.get(name);
    if (!report) {
      report = (async () => {
        const path = join(folder, `${name.replace(/\W+/g, "-")}.json`);
        const cmd = [
          bunExe(),
          ...compileCommand,
          ...withoutDebugInformation(),
          ...withReport(path, "sites"),
          ...(flag ? [flag] : []),
        ];
        built(
          await spawned(
            [...cmd, join(import.meta.dir, program), "--outfile", join(folder, "main")],
            import.meta.dir,
            bunEnv,
          ),
        );
        return readBuildReport(path);
      })();
      reports.set(name, report);
    }
    return report;
  }

  const switches = [buildFlags.eraseTypes, ...registry().flowResults.map(withoutFlowResult)];
  for (const flag of switches) {
    const known = today[`${program} ${flag}`] || doesNotBuild.has(flag);
    (known ? test.todo : test)(
      `no site is better under ${flag}`,
      async () => {
        const { worse } = compareReports(await reportOf(flag), await reportOf(undefined));
        expect(worse.map(describeChange)).toEqual([]);
      },
      300_000,
    );
  }
});
