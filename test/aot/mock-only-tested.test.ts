// `mock.module`, `vi.mock` or `jest.mock` that goes somewhere as a value may mock any module, so the build takes every module of the run for one that may be mocked:
// three quarters of a server's functions are then compiled otherwise than in an executable. Where the member is only tested, `typeof mock.module === "function"`, the function goes nowhere.
// The build's own log says how many modules may be mocked.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { buildEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const uses: [name: string, names: string, statement: string, mocks: "no module" | "every module"][] = [
  ["typeof mock.module", "mock", `console.log(typeof mock.module);`, "no module"],
  ["mock.module compared", "mock", `console.log(mock.module === undefined);`, "no module"],
  ["vi.mock in a condition", "vi", `if (vi.mock) console.log("there");`, "no module"],
  ["jest.doMock negated", "jest", `console.log(!jest.doMock);`, "no module"],
  ["mock.module in a variable", "mock", `const kept = mock.module; console.log(typeof kept);`, "every module"],
  ["vi.mock handed on", "vi", `console.log([vi.mock].length);`, "every module"],
  [
    "a member under a key that is computed",
    "mock",
    `console.log(typeof mock["mod" + "ule".slice(0)]);`,
    "every module",
  ],
];

for (const [name, names, statement, mocks] of uses) {
  test.concurrent(`${name}: ${mocks} may be mocked`, async () => {
    using dir = tempDir("mock-only-tested", {
      "package.json": `{}`,
      "other.ts": `export const mark: number = 1;`,
      "a.test.ts": `import { test, ${names} } from "bun:test";\nimport { mark } from "./other.ts";\ntest("t", () => { ${statement} console.log("SEEN", mark); });\n`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), {
      ...bunEnv,
      [buildEnvironment.logsPhaseTimes]: "1",
    });
    const counts = [...stderr.matchAll(/modules that may be mocked (\d+)/g)].map(match => Number(match[1]));
    expect(counts.length).toBeGreaterThan(0);
    expect({
      mocks: Math.max(...counts) === 0 ? "no module" : "every module",
      seen: stdout.includes("SEEN 1"),
      exitCode,
    }).toEqual({ mocks, seen: true, exitCode: 0 });
  });
}
