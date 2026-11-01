import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

test("a test file with JSX where react is not installed fails as in plain bun test", async () => {
  using dir = tempDir("aot-jsx-without-react", {
    "package.json": `{ "name": "jsx-without-react" }`,
    "a.test.tsx": `import { test } from "bun:test";\nconst made = <div>1</div>;\ntest("t", () => {});\n`,
  });
  const seenWith = async (...flags: string[]) => {
    const { stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    return {
      said: stderr.split("\n").filter(line => /^error: |^ *\d+ (pass|fail|error)s?$|panic/.test(line)),
      exitCode,
    };
  };
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain.exitCode).toBe(1);
  expect(plain.said.join("\n")).toContain("react/jsx-dev-runtime");
  expect(compiled).toEqual(plain);
}, 60_000);
