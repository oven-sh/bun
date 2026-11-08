// `bun test --aot` checks the files as a build does, then runs them from their sources: a mock replaces what it replaces under `bun test`.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const modules = {
  "a.ts": `
    export const LIMIT = 5;
    export function add(n: number): number { return n + 1; }
    export function twice(n: number): number { return add(n) * 2; }
    export class Shape { name(): string { return "real"; } static make(): Shape { return new Shape(); } }
    export enum Color { Red = "red" }
  `,
  "user.ts": `
    import { LIMIT, add, twice, Shape, Color } from "./a";
    const kept = add;
    class Square extends Shape {}
    export const all = (): string =>
      [LIMIT, LIMIT === 5, add(1), add(...[1]), kept(1), twice(1), new Shape().name(), new Square().name(), Shape.make().name(), Color.Red].join();
  `,
};
const header = `import { mock, spyOn, test } from "bun:test";\n`;
const lay = `mock.module("./a", () => ({ LIMIT: 6, add: (n: number) => n + 100, twice: (n: number) => n, Shape: class { name() { return "mocked"; } static make() { return new this(); } }, Color: { Red: "mocked red" } }));\n`;

const cases: Record<string, Record<string, string>> = {
  "before the tests": {
    "main.test.ts": `${header}import { all } from "./user";\n${lay}test("case", () => { console.log(all()); });\n`,
  },
  "inside a test": {
    "main.test.ts": `${header}import { all } from "./user";\ntest("case", () => { console.log(all()); ${lay} console.log(all()); });\n`,
  },
  "as spies, which are lifted": {
    "main.test.ts": `${header}import { all } from "./user";\nimport * as a from "./a";
      test("case", () => {
        const spy = spyOn(a, "add").mockImplementation((n: number) => n + 100);
        console.log(all(), spy.mock.calls.length);
        mock.restore();
        console.log(all());
      });\n`,
  },
  "in a preload": {
    "pre.ts": `import { mock } from "bun:test";\n${lay}`,
    "flags.txt": "--preload ./pre.ts",
    "main.test.ts": `${header}import { all } from "./user";\ntest("case", () => { console.log(all()); });\n`,
  },
  "ahead of the import": {
    "main.test.ts": `${header}${lay}test("case", async () => { const { all } = await import("./user"); console.log(all()); });\n`,
  },
  "in the first of two files": {
    "main.test.ts": `${header}import { all } from "./user";\ntest("first", () => { ${lay} console.log(all()); });\n`,
    "second.test.ts": `${header}import { all } from "./user";\ntest("second", () => { console.log(all()); });\n`,
    "flags.txt": "./second.test.ts",
  },
};

async function printed(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  const noise = /^bun test v|^Ran \d+ tests? across/;
  const lines = (stdout + "\n" + stderr)
    .split("\n")
    .map(line => line.replace(/ \[\d+(\.\d+)?m?s\]$/, ""))
    .filter(line => line !== "" && !noise.test(line));
  return { lines, exitCode };
}

test.concurrent.each(Object.keys(cases))(
  "bun test --aot prints what bun test prints where a mock is laid %s",
  async name => {
    const { "flags.txt": flags, ...files } = cases[name];
    using dir = tempDir("mocked-exports", { ...modules, ...files });
    const rest = [...(flags ? flags.split(" ") : []), "./main.test.ts"];
    const plain = await printed(String(dir), ["test", ...rest]);
    expect({ isMocked: /mocked|101/.test(plain.lines.join()), exitCode: plain.exitCode }).toEqual({
      isMocked: true,
      exitCode: 0,
    });
    expect(await printed(String(dir), ["test", "--aot", ...rest])).toEqual(plain);
  },
  120_000,
);
