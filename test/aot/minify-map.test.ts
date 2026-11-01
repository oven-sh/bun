// `bun build --compile --aot --minify` shortens the names of functions, classes and variables and the paths of the sources, as a build
// without --aot does. With --sourcemap=external it writes <outfile>.map, which holds what each token stands for and is not part of the
// executable. With that file alone, what the executable prints is turned back into what the executable built without --minify prints.
import { expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { afterAll, describe, test } from "./harness/declare";

const sources = {
  "entryOfTheTest.ts": `
import { RepositoryOfTheTest } from "./folderOfTheTest/classOfTheTest";
const lookUpTwiceInTheTest = (id: number): string => new RepositoryOfTheTest().findRecord(id) + new RepositoryOfTheTest().findRecord(-id);
function report(run: () => unknown): void {
  try {
    run();
  } catch (e) {
    console.log((e as Error).stack);
  }
}
report(() => lookUpTwiceInTheTest(1));
report(() => readsLimitOfTheTest());
function readsLimitOfTheTest(): number {
  return limitOfTheTest + 1;
}
const limitOfTheTest = 5;
report(() => new RepositoryOfTheTest().checkedRecord(JSON.parse('{"identifier":"not a number"}')));
`,
  "folderOfTheTest/classOfTheTest.ts": `
export interface RecordOfTheTest {
  identifier: number;
}
function refuseInTheTest(id: number): never {
  throw new RangeError("bad id " + id);
}
export class RepositoryOfTheTest {
  lastAnswer: string | undefined = undefined;
  #timesAskedInTheTest = 0;
  #countInTheTest(): number {
    if (this.#timesAskedInTheTest > 100) refuseInTheTest(this.#timesAskedInTheTest);
    return ++this.#timesAskedInTheTest;
  }
  findRecord(id: number): string {
    this.#countInTheTest();
    if (id < 0) refuseInTheTest(id);
    return "record " + id;
  }
  checkedRecord(record: RecordOfTheTest): number {
    return record.identifier;
  }
}
`,
};

describe.skipIf(!!unsupported)("compile/aot/minify-map", () => {
  const folder = String(tempDir("aot-minify-map", sources));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  async function build(name: string, flags: string[]) {
    const executable = join(folder, isWindows ? `${name}.exe` : name);
    built(
      await spawned(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--no-compile-function-source",
          ...flags,
          "./entryOfTheTest.ts",
          "--outfile",
          executable,
        ],
        folder,
        bunEnv,
      ),
    );
    const run = await spawned([executable], folder, bunEnv);
    const bytes = readFileSync(executable).toString("latin1");
    rmSync(executable);
    expect(run.exitCode).toBe(0);
    return { executable, printed: run.stdout, bytes };
  }

  test("--keep-names keeps them", async () => {
    await slot(async () => {
      const whole = await build("whole-again", []);
      const kept = await build("kept", ["--minify", "--keep-names"]);
      expect(kept.printed).toBe(whole.printed);
    });
  }, 600_000);
});
