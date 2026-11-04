import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { eachRow, gap } from "./supported";

// `bun test` moves `jest.mock()` above the imports of a test file and prints each name that those imports bring as a member of its module, `import_dep.holder`. A member that starts a line behind such a name is reported at its `.`, as behind any other member.
const files = (read: string) => ({
  "dep.ts": `export const holder: any = undefined;\n`,
  "mocked.test.ts": `import { jest, test } from "bun:test";
import { holder } from "./dep";
jest.mock("./dep", () => ({ holder: undefined }));
test("where the member is reported", () => {
  try {
    ${read}
  } catch (error) {
    console.log("reported at " + /mocked\\.test\\.ts:(\\d+:\\d+)\\)?$/m.exec((error as Error).stack!)?.[1]);
  }
});
`,
});

eachRow([
  ["on the line of the import", "holder.name;", "6:5"],
  gap("the compiled run names the line of the import, 6:5: its compiler takes the import for a name", [
    "on the line below the import",
    "holder\n      .name;",
    "7:7",
  ]),
] as [string, string, string][])(
  "a member of an import below a mock that is moved up is reported where bun test reports it, %s",
  async (_, read, place) => {
    using dir = tempDir("aot-member-behind-hoisted-mock", files(read));
    const directory = String(dir);
    const plain = await run([bunExe(), "test", "./mocked.test.ts"], directory, bunEnv);
    const compiled = await run([bunExe(), "test", "--aot", "./mocked.test.ts"], directory, bunEnv);
    const reported = (output: string) => output.split("\n").filter(line => line.startsWith("reported at "));
    expect(reported(plain.stdout)).toEqual([`reported at ${place}`]);
    expect(reported(compiled.stdout)).toEqual(reported(plain.stdout));
    expect(compiled.exitCode).toBe(0);
  },
);
