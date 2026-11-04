import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// `mock.module(import.meta.resolve("./dep"), factory)`: the key is the file's URL without its extension, and `bun test` decides by what each importer writes: "../dep" gets the
// mock, "../dep.ts" in the same run the real module. A compiled run decides by the module: both spellings get the same. What is right today, one spelling a run, is
// fixed-runs/open/mock-under-a-file-url.
const lays = (folder: string, after: string) => `import { mock, test } from "bun:test";
test("${folder}", async () => {
  mock.module(import.meta.resolve("./dep"), () => ({ name: "mocked" }));
  console.log("SEEN ${folder}", await (await import("./src/uses-dep")).seen());
  ${after}
});
`;
const imports = (name: string) => `import { name } from "${name}";\nexport const seen = () => name;\n`;
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "two-importers/dep.ts": `export const name = "real";\n`,
  "two-importers/a.test.ts": lays(
    "two-importers",
    `console.log("SEEN two-importers", (await import("./src/other")).seen());`,
  ),
  "two-importers/src/uses-dep.ts": imports("../dep"),
  "two-importers/src/other.ts": imports("../dep.ts"),
  "one-importer/dep.ts": `export const name = "real";\n`,
  "one-importer/a.test.ts": lays("one-importer", ""),
  "one-importer/src/uses-dep.ts": `export const seen = async () => (await import("../dep")).name + " " + (await import("../dep.ts")).name;\n`,
};

async function seenWith(...flags: string[]) {
  using dir = tempDir("aot-mock-file-url", files);
  const testFiles = ["./one-importer/a.test.ts", "./two-importers/a.test.ts"];
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags, ...testFiles], String(dir), bunEnv);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}
let runs: Promise<Awaited<ReturnType<typeof seenWith>>[]> | undefined;
const both = () => (runs ??= Promise.all([seenWith(), seenWith("--aot")]));
const of = (folder: string, { seen }: Awaited<ReturnType<typeof seenWith>>) =>
  seen.filter(line => line.startsWith(`SEEN ${folder} `));

test("whoever leaves the extension out gets the mock", async () => {
  const [plain, compiled] = await both();
  expect(plain).toEqual({
    seen: ["SEEN one-importer mocked real", "SEEN two-importers mocked", "SEEN two-importers real"],
    exitCode: 0,
  });
  expect(of("two-importers", compiled)[0]).toBe("SEEN two-importers mocked");
  expect(compiled.exitCode).toBe(0);
});

// TODO(bun): when one of these passes, its `failing` goes.
test.failing.each(["two-importers", "one-importer"])(
  "the other spelling of the file is left alone: %s",
  async folder => {
    const [plain, compiled] = await both();
    expect(of(folder, compiled)).toEqual(of(folder, plain));
  },
);
