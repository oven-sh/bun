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

const names = ["core", "select", "testing", "app"];
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
  "packages/core/src/index.ts": `export function useMemo<Value>(make: () => Value, dependencies: ReadonlyArray<unknown>): Value {
  return dependencies.length >= 0 ? make() : make();
}
export type Prompt<Value, Config> = (config: Config) => Promise<Value>;
export function createPrompt<Value, Config>(view: (config: Config, done: (value: Value) => void) => string): Prompt<Value, Config> {
  return (config: Config) => new Promise<Value>(resolve => void view(config, resolve));
}
export class Separator {
  readonly type = "separator";
  static isSeparator(choice: unknown): choice is Separator {
    return choice instanceof Separator;
  }
}
`,
  "packages/select/src/index.ts": `import { createPrompt, useMemo, Separator } from "@workspace/core";
type Choice<Value> = { value: Value; name: string; disabled: boolean };
function isSelectable<Value>(item: Choice<Value> | Separator): item is Choice<Value> {
  return !Separator.isSeparator(item) && !item.disabled;
}
function normalize<Value>(choices: ReadonlyArray<Value | Separator>): Array<Choice<Value> | Separator> {
  return choices.map(choice => (Separator.isSeparator(choice) ? choice : { value: choice, name: String(choice), disabled: false }));
}
export default createPrompt(<const Value>(config: { choices: ReadonlyArray<Value | Separator>; default?: Value }, done: (value: Value) => void) => {
  const items = useMemo(() => normalize(config.choices), [config.choices]);
  const index = useMemo(() => {
    if (!("default" in config)) return -1;
    return items.findIndex(item => isSelectable(item) && item.value === config.default);
  }, [config.default, items]);
  const chosen = items[index < 0 ? 0 : index];
  if (chosen && isSelectable(chosen)) done(chosen.value);
  return String(index);
});
`,
  "packages/select/test/select.test.ts": `import { expect, test } from "bun:test";
import select from "../src/index.ts";
test("select", async () => {
  expect(await select({ choices: ["a", "b"], default: "b" })).toBe("b");
});
`,
  "packages/testing/src/index.ts": `import type { Prompt } from "@workspace/core";
export const wrapped: string[] = [];
export function wrapPrompt<Value, Config>(prompt: Prompt<Value, Config> | { default: Prompt<Value, Config> }): Prompt<Value, Config> {
  const call: Prompt<Value, Config> = typeof prompt === "function" ? prompt : prompt.default;
  return (config: Config): Promise<Value> => call(config);
}
function mock(name: string, factory: (importOriginal: <Module>() => Promise<Module>) => Promise<object>): void {
  wrapped.push(name + factory.length);
}
mock("@workspace/select", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/select")>();
  return { ...actual, default: wrapPrompt(actual.default) };
});
`,
  "packages/app/src/index.ts": `export {};\n`,
  "packages/app/app.test.ts": `import { expect, test } from "bun:test";
import { wrapped } from "@workspace/testing";
test("app", () => {
  expect(wrapped).toEqual(["@workspace/select1"]);
});
`,
};

test("a dependency that imports a file of the application leaves that file's check as it is without the dependency", async () => {
  using dir = tempDir("dependency-imports-own-file", workspace);
  mkdirSync(join(String(dir), "node_modules", "@workspace"), { recursive: true });
  for (const name of names)
    symlinkSync(join(String(dir), "packages", name), join(String(dir), "node_modules", "@workspace", name), "dir");
  const alone = await run(String(dir), "test", "--aot", "./packages/select/test/select.test.ts");
  expect({ errors: errors(alone.said), passed: passed(alone.said) }).toEqual({ errors: [], passed: ["select"] });
  const together = await run(
    String(dir),
    "test",
    "--aot",
    "./packages/app/app.test.ts",
    "./packages/select/test/select.test.ts",
  );
  expect({ errors: errors(together.said), passed: passed(together.said) }).toEqual({
    errors: [],
    passed: ["app", "select"],
  });
}, 60_000);
