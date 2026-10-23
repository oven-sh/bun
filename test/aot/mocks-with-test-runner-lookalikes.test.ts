import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const library = {
  "a.ts": `
    export function f(n: number): number { return n + 1; }
    export const arrow = (n: number): number => n + 2;
    export const table = { f, limit: 5 };
  `,
  "user.ts": `
    import { f, arrow, table } from "./a";
    export function all(): string { return [f(1), arrow(1), table.f(1), table.limit].join(); }
  `,
};

const cases: Record<string, Record<string, string>> = {
  "a spy on what require() hands out": {
    ...library,
    "main.test.ts": `
      import { mock, spyOn, test } from "bun:test";
      import { all } from "./user";
      test("case", () => {
        spyOn(require("./a"), "f").mockReturnValue(700);
        console.log("see:", all());
        mock.restore();
        console.log("see:", all());
      });
    `,
  },
  "variables of the program's own that are named like the test runner's": {
    ...library,
    "holds.ts": `
      export function held(): string {
        const mock = { a: 1 };
        const spyOn = [mock];
        const jest = spyOn;
        return JSON.stringify([mock, jest, typeof require, typeof require.resolve]);
      }
    `,
    "main.test.ts": `
      import { mock, test } from "bun:test";
      import { all } from "./user";
      import { held } from "./holds";
      test("case", () => {
        console.log("see:", all(), held());
        mock.module("./a", () => ({ f: (n: number) => n + 100, arrow: (n: number) => n + 200, table: { f: (n: number) => n + 300, limit: 6 } }));
        console.log("see:", all(), held());
      });
    `,
  },
  "the test runner's mock handed on as a value": {
    ...library,
    "main.test.ts": `
      import { mock, test } from "bun:test";
      import { all } from "./user";
      const lay = (how: typeof mock) => how.module("./a", () => ({ f: (n: number) => n + 100, arrow: (n: number) => n + 200, table: { f: (n: number) => n + 300, limit: 6 } }));
      test("case", () => {
        console.log("see:", all());
        lay(mock);
        console.log("see:", all());
      });
    `,
  },
};

async function seen(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode };
}

test.concurrent.each(Object.keys(cases))(
  "bun test --aot prints what bun test prints: %s",
  async name => {
    using dir = tempDir("mocks-with-test-runner-lookalikes", cases[name]);
    const plain = await seen(String(dir), ["test", "./main.test.ts"]);
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBeGreaterThan(0);
    expect(await seen(String(dir), ["test", "--aot", "./main.test.ts"])).toEqual(plain);
  },
  120_000,
);
