// `bun build --compile --aot` takes --aot-validate, --aot-check=<names> and --aot-testing=<names>. Bun.build takes the same words as compile.aotValidate, compile.aotCheck and
// compile.aotTesting, so a program that is built with plugins can be built under the checks too.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { withoutCoreDump, withoutCrashReport } from "./harness/commands";
import { run } from "./harness/run";
import { test } from "./supported";

// --aot-testing=ProveEverything plants a false proof: the compiler takes every declared type for proven, and the program hands over a string for a number.
const files = {
  "program.ts": `function twice(value: number): number {
  return value * 2;
}
const values: unknown[] = [1, "two", 3];
console.log(values.map(value => twice(value as number)).join());
`,
  "build.ts": `const members = JSON.parse(process.argv[2]);
try {
  await Bun.build({
    entrypoints: ["./program.ts"],
    compile: { outfile: "./by-call", aot: true, ...members } as any,
    plugins: [
      {
        name: "hands the file on",
        setup(build) {
          build.onLoad({ filter: /program\\.ts$/ }, async ({ path }) => ({ contents: await Bun.file(path).text(), loader: "ts" }));
        },
      },
    ],
  });
} catch (error) {
  console.log((error as Error).message);
}
`,
};
const buildByCall = (cwd: string, members: object) => run([bunExe(), "build.ts", JSON.stringify(members)], cwd);

async function stopOf(cwd: string, name: string) {
  const { stdout, stderr, exitCode } = await run(withoutCoreDump([join(cwd, name)]), cwd, {
    ...bunEnv,
    ...withoutCrashReport,
  });
  return { stdout, report: /^AOT validation: .*$/m.exec(stderr)?.[0], exitCode };
}

test("a validating build by Bun.build with a plugin stops where the command line's stops", async () => {
  using folder = tempDir("aot-validate-by-call", files);
  const cwd = String(folder);
  const flags = ["--aot-validate", "--aot-check=verify-each-stage", "--aot-testing=ProveEverything"];
  const byCommand = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, "program.ts", "--outfile", "by-command"],
    cwd,
  );
  expect(byCommand.stderr).not.toContain("error:");
  const byCall = await buildByCall(cwd, {
    aotValidate: true,
    aotCheck: "verify-each-stage",
    aotTesting: ["ProveEverything"],
  });
  expect({ stdout: byCall.stdout, stderr: byCall.stderr }).toEqual({ stdout: "", stderr: "" });

  const stop = await stopOf(cwd, "by-command");
  expect(stop.report).toMatch(/^AOT validation: AssumedType f\d+ v\d+ string$/);
  expect(await stopOf(cwd, "by-call")).toEqual(stop);
}, 240_000);

test.each([
  [{ aotCheck: "nonsense" }, "compile.aotCheck"],
  [{ aotTesting: ["ProveEverything", "Nonsense"] }, "compile.aotTesting"],
  [{ aotCheck: 1 }, 'The "compile.aotCheck" property must be of type string or array of strings'],
  [{ aot: false, aotValidate: true }, "compile.aotValidate requires compile.aot: true"],
])("Bun.build rejects %j under its own spelling", async (members, spelling) => {
  using folder = tempDir("aot-validate-by-call", files);
  expect((await buildByCall(String(folder), members)).stdout).toContain(spelling);
});
