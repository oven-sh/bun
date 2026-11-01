import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  // The nearest configuration is not read in place of the one that is missing: with it a field without a value would not be defined.
  "tsconfig.json": `{ "compilerOptions": { "useDefineForClassFields": false } }`,
  "holder.ts": `export class Holder {
  field?: number;
}
`,
  "main.ts": `import { Holder } from "./holder";
console.log("main sees", Object.keys(new Holder()));
`,
  "one.test.ts": `import { expect, test } from "bun:test";
import { Holder } from "./holder";
test("it runs", () => {
  console.log("the test sees", Object.keys(new Holder()));
  expect(1 + 1).toBe(2);
});
`,
};

const withoutTimes = (text: string) =>
  text.replace(/\[[\d.]+ *m?s\]/g, "[time]").replace(/^bun test v.*$/m, "bun test");

for (const [name, plain, compiled] of [
  ["bun test", ["test"], ["test", "--aot"]],
  ["bun run", ["run"], ["run", "--aot"]],
] as const) {
  test.concurrent(
    `${name} with --tsconfig-override of a missing file`,
    async () => {
      using dir = tempDir("aot-missing-override", files);
      const answerOf = async (command: readonly string[]) => {
        const file = command[0] === "test" ? "one.test.ts" : "main.ts";
        const { stdout, stderr, exitCode } = await run(
          [bunExe(), ...command, "--tsconfig-override", "./missing.json", file],
          String(dir),
          bunEnv,
        );
        return { stdout: withoutTimes(stdout), stderr: withoutTimes(stderr), exitCode };
      };
      const expected = await answerOf(plain);
      expect(expected.exitCode).toBe(0);
      expect(expected.stdout).toContain(`sees [ "field" ]`);
      expect(expected.stderr).toContain("Cannot find tsconfig file");
      expect(await answerOf(compiled)).toEqual(expected);
    },
    120_000,
  );
}
