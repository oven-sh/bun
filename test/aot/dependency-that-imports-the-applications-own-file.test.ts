import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const options = {
  target: "ESNext",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  lib: ["es2023"],
  strict: true,
  allowImportingTsExtensions: true,
  noEmit: true,
  types: [] as string[],
};

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) =>
  [...said.matchAll(/^error: (TS\d+): .*\n\s+at (\S+):(\d+):\d+$/gm)]
    .map(match => `${match[2]}:${match[3]} ${match[1]}`)
    .sort();

const names = ["scales", "ferry", "testing", "app"];
const packages = Object.fromEntries(
  names.flatMap(name => [
    [
      `packages/${name}/package.json`,
      JSON.stringify({
        name: `@workspace/${name}`,
        version: "1.0.0",
        type: "module",
        exports: { ".": "./src/index.ts" },
      }),
    ],
    [`packages/${name}/tsconfig.json`, JSON.stringify({ compilerOptions: options, include: ["src"] })],
  ]),
);

const workspace = {
  ...packages,
  "package.json": JSON.stringify({ name: "workspace", workspaces: ["packages/*"] }),
  "tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["**/*.test.ts"] }),
  "packages/scales/src/index.ts": `export type Weigh<Load, Result> = (loads: ReadonlyArray<Load>, limit: number) => Promise<Result>;
export interface Lot<Load> {
  readonly loads: Load[];
  weight: number;
}
export function weighing<Load, Result>(of: (load: Load) => number, sum: (lots: Array<Lot<Load>>) => Result): Weigh<Load, Result> {
  return async (loads, limit) => {
    const lots: Array<Lot<Load>> = [];
    for (const load of loads) {
      const last = lots.at(-1);
      if (last && last.weight + of(load) <= limit) {
        last.loads.push(load);
        last.weight += of(load);
      } else lots.push({ loads: [load], weight: of(load) });
    }
    return sum(lots);
  };
}
export function heaviest<Load>(lots: Array<Lot<Load>>): Lot<Load> | undefined {
  return lots.reduce<Lot<Load> | undefined>((most, lot) => (most && most.weight >= lot.weight ? most : lot), undefined);
}
`,
  "packages/ferry/src/index.ts": `import { heaviest, weighing } from "@workspace/scales";
type Truck = { name: string; tons: number };
export default weighing((truck: Truck) => truck.tons, lots => {
  const full = heaviest(lots);
  return { trips: lots.length, full: full ? full.loads.map(truck => truck.name).join("+") : "none", last: lots.at(-1)?.weight };
});
`,
  "packages/ferry/test/ferry.test.ts": `import { expect, test } from "bun:test";
import ferry from "../src/index.ts";
test("ferry", async () => {
  const trucks = [3, 4, 9, 2].map(tons => ({ name: "t" + tons, tons }));
  expect(await ferry(trucks, 10)).toEqual({ trips: 3, full: "t9", last: 2 });
  expect((await ferry([], 1)).full).toBe("none");
});
`,
  "packages/testing/src/index.ts": `import type { Weigh } from "@workspace/scales";
export const wrapped: string[] = [];
export function wrapWeighing<Load, Result>(weigh: Weigh<Load, Result> | { default: Weigh<Load, Result> }): Weigh<Load, Result> {
  const call: Weigh<Load, Result> = typeof weigh === "function" ? weigh : weigh.default;
  return (loads, limit): Promise<Result> => call(loads, limit);
}
function mock(name: string, factory: (importOriginal: <Module>() => Promise<Module>) => Promise<object>): void {
  wrapped.push(name + factory.length);
}
mock("@workspace/ferry", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/ferry")>();
  return { ...actual, default: wrapWeighing(actual.default) };
});
`,
  "packages/app/src/index.ts": `export {};\n`,
  "packages/app/app.test.ts": `import { expect, test } from "bun:test";
import { wrapped } from "@workspace/testing";
test("app", () => {
  expect(wrapped).toEqual(["@workspace/ferry1"]);
});
`,
};

test("a dependency that imports a file of the application leaves that file's check as it is without the dependency", async () => {
  using dir = tempDir("dependency-imports-own-file", workspace);
  mkdirSync(join(String(dir), "node_modules", "@workspace"), { recursive: true });
  for (const name of names)
    symlinkSync(join(String(dir), "packages", name), join(String(dir), "node_modules", "@workspace", name), "dir");
  const alone = await run(String(dir), "test", "--aot", "./packages/ferry/test/ferry.test.ts");
  expect({ errors: errors(alone.said), passed: passed(alone.said) }).toEqual({ errors: [], passed: ["ferry"] });
  const together = await run(
    String(dir),
    "test",
    "--aot",
    "./packages/app/app.test.ts",
    "./packages/ferry/test/ferry.test.ts",
  );
  expect({ errors: errors(together.said), passed: passed(together.said) }).toEqual({
    errors: [],
    passed: ["app", "ferry"],
  });
}, 60_000);
