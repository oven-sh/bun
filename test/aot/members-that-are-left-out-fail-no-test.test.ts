// A member that a type calls optional may be left out. Code that compares such a member, asks whether it is truthy, replaces it by a default or hands it on
// reckons with `undefined`, so no test that the compiler put in front of that code may turn `undefined` away: behind a failed test the rest of the call runs in general code.
// The counts are exact: no clock and no machine decides them.
import { expect } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCounted,
  parseCounts,
  run,
  tabulate,
  testsAddedByTheCompiler,
  withoutCollections,
  type CountedBuild,
} from "./harness/counted-run";
import { runtimeEnvironment } from "./harness/flags";
import { beforeAll, describe, test } from "./supported";

const program = join(import.meta.dir, "perf", "equivalent-forms", "optional-members.ts");
const forms = [
  "compared with what was kept",
  "compared with each other",
  "compared loosely",
  "asked whether truthy",
  "replaced where missing",
  "destructured with defaults",
  "arguments with defaults",
  "handed on to built-in functions",
  "switched on",
  "stored and returned",
];

describe("compile/aot/members-that-are-left-out-fail-no-test", () => {
  const folder = String(tempDir("aot-members-left-out", {}));
  let build: CountedBuild;
  beforeAll(async () => {
    build = await buildCounted(folder, program);
  }, 600_000);

  async function counted(loop: string, rounds: number) {
    const counts = `${build.executable}.${rounds}.counts`;
    const env = { ...bunEnv, ...withoutCollections, [runtimeEnvironment.countsPath]: counts };
    const ran = await run([build.executable, loop, String(rounds)], folder, env);
    expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return parseCounts(readFileSync(counts, "utf8"));
  }

  test.each(forms.flatMap(form => [`given members ${form}`, `omitted members ${form}`]))(
    "%s",
    async loop => {
      const [few, rounds] = [400, 4000];
      const work = tabulate(build, await counted(loop, few), await counted(loop, few + rounds), rounds, few);
      const failed = [...work.tests, ...work.uneven].filter(
        each => each.owner === "program" && testsAddedByTheCompiler.has(each.kind) && each.failed > 0,
      );
      expect(failed.map(({ kind, position, functions, failed }) => ({ kind, position, functions, failed }))).toEqual(
        [],
      );
    },
    300_000,
  );
});
