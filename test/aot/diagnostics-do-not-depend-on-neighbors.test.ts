import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const shared = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  noEmit: true,
  types: [] as string[],
  strict: true,
};
const config = (more: object = {}, rest: object = {}) =>
  JSON.stringify({ compilerOptions: { ...shared, ...more }, ...rest });

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
// `bun check` writes `file(line,column): error TS1: ..`, a build `error: TS1: ..` and under it `at <folder>/file:line:column`.
const errors = (said: string) =>
  [
    ...[...said.matchAll(/^(\S+)\((\d+),\d+\): error (TS\d+)/gm)].map(match => `${match[1]}:${match[2]} ${match[3]}`),
    ...[
      ...said.matchAll(
        /^error: (TS\d+):.*\n +at .*diagnostics-do-not-depend-on-neighbors[^\\/]*[\\/](.+):(\d+):\d+$/gm,
      ),
    ].map(match => `${match[2].replaceAll("\\", "/")}:${match[3]} ${match[1]}`),
  ].sort();

async function aloneAndTogether(cwd: string, files: string[]) {
  const alone = await Promise.all(files.map(file => run(cwd, "test", "--aot", `./${file}`)));
  const together = await run(cwd, "test", "--aot", ...files.map(file => `./${file}`));
  const checked = await Promise.all(files.map(file => run(cwd, "check", "--aot", file)));
  return {
    alone: {
      errors: [...new Set(alone.flatMap(one => errors(one.said)))].sort(),
      passed: alone.flatMap(one => passed(one.said)).sort(),
    },
    together: { errors: errors(together.said), passed: passed(together.said) },
    checked: [...new Set(checked.flatMap(one => errors(one.said)))].sort(),
  };
}

const variables = {
  "src/index.ts": `export { read } from "./context";\nexport type { Variables } from "./context";\n`,
  "src/context.ts": `export interface Variables {}\nconst store: object = { nonce: "n" };\nexport function read<Key extends keyof Variables>(key: Key): Variables[Key] | undefined {\n  return (store as Variables)[key];\n}\n`,
  "src/middleware/nonce/index.ts": `export const name = "nonce";\ndeclare module "../.." {\n  interface Variables {\n    nonce?: string;\n  }\n}\n`,
  "src/middleware/nonce/index.test.ts": `import { expect, test } from "bun:test";\nimport { name } from ".";\nimport { read } from "../../context";\ndeclare module "../.." {\n  interface Variables {\n    other?: string;\n  }\n}\ntest("augments", () => {\n  expect(name).toBe("nonce");\n  expect(read("nonce")).toBe("n");\n  expect(read("other")).toBeUndefined();\n});\n`,
  "src/imports-it.test.ts": `import { expect, test } from "bun:test";\nimport { read } from ".";\ntest("imports", () => {\n  expect(typeof read).toBe("function");\n});\n`,
};

test("a module that is only named by `declare module` is found without a neighbor that imports it", async () => {
  using dir = tempDir("diagnostics-do-not-depend-on-neighbors", {
    "tsconfig.json": config({}, { include: ["src"] }),
    ...variables,
  });
  const { alone, together, checked } = await aloneAndTogether(String(dir), [
    "src/middleware/nonce/index.test.ts",
    "src/imports-it.test.ts",
  ]);
  expect(alone).toEqual({ errors: [], passed: ["augments", "imports"] });
  expect(together).toEqual(alone);
  expect(checked).toEqual([]);
}, 120_000);

test("an executable is built of a program that augments a module it does not import", async () => {
  using dir = tempDir("diagnostics-do-not-depend-on-neighbors", {
    "tsconfig.json": config({}, { include: ["src"] }),
    ...variables,
    "src/main.ts": `import { name } from "./middleware/nonce";\nimport { read } from "./context";\nconsole.log(name, read("nonce"));\n`,
  });
  const built = await run(String(dir), "build", "--compile", "--aot", "src/main.ts", "--outfile", "program");
  expect(errors(built.said)).toEqual([]);
  expect(built.exitCode).toBe(0);
  await using proc = Bun.spawn({ cmd: [`${dir}/program`], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect(await proc.stdout.text()).toBe("nonce n\n");
  expect(await proc.exited).toBe(0);
}, 120_000);

test("a module that does not exist is still an error in `declare module`", async () => {
  using dir = tempDir("diagnostics-do-not-depend-on-neighbors", {
    "tsconfig.json": config(),
    "missing.test.ts": `import { expect, test } from "bun:test";\ndeclare module "./nowhere" {\n  interface Variables {\n    other?: string;\n  }\n}\ntest("never runs", () => {\n  expect(1).toBe(1);\n});\n`,
  });
  const { said, exitCode } = await run(String(dir), "test", "--aot");
  expect(errors(said)).toEqual(["missing.test.ts:2 TS2664"]);
  expect(passed(said)).toEqual([]);
  expect(exitCode).toBe(1);
});

const underNode16 = {
  "package.json": JSON.stringify({ name: "under-node16", type: "module" }),
  "tsconfig.json": config({ target: "ES2023", module: "Node16", moduleResolution: "Node16" }),
  "src/value.ts": `export const value: number = 1;\n`,
  "src/folder/index.ts": `export const inFolder: string = "folder";\n`,
};

test("a relative import without an extension is found in an ES module under Node16, as Bun finds it", async () => {
  using dir = tempDir("diagnostics-do-not-depend-on-neighbors", {
    ...underNode16,
    "test/extensionless.test.ts": `import { expect, test } from "bun:test";\nimport { value } from "../src/value";\nimport { inFolder } from "../src/folder";\ntest("extensionless", () => {\n  const doubled: number = value * 2;\n  expect(doubled).toBe(2);\n  expect(inFolder.length).toBe(6);\n});\n`,
    "main.ts": `import { value } from "./src/value";\nimport { inFolder } from "./src/folder";\nconsole.log(value, inFolder);\n`,
  });
  const plain = await run(String(dir), "test");
  expect(passed(plain.said)).toEqual(["extensionless"]);
  const tested = await run(String(dir), "test", "--aot");
  expect(errors(tested.said)).toEqual([]);
  expect(passed(tested.said)).toEqual(["extensionless"]);
  const checked = await run(String(dir), "check", "--aot", "main.ts");
  expect(errors(checked.said)).toEqual([]);
  const built = await run(String(dir), "build", "--compile", "--aot", "main.ts", "--outfile", "program");
  expect(errors(built.said)).toEqual([]);
  expect(built.exitCode).toBe(0);
  await using proc = Bun.spawn({ cmd: [`${dir}/program`], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect(await proc.stdout.text()).toBe("1 folder\n");
}, 120_000);

test("what such an import brings in has its type", async () => {
  using dir = tempDir("diagnostics-do-not-depend-on-neighbors", {
    ...underNode16,
    "test/wrong-use.test.ts": `import { expect, test } from "bun:test";\nimport { value } from "../src/value";\ntest("wrong use", () => {\n  const text: string = value;\n  expect(typeof text).toBe("number");\n});\n`,
  });
  const { said, exitCode } = await run(String(dir), "test", "--aot");
  expect(errors(said)).toEqual(["test/wrong-use.test.ts:4 TS2322"]);
  expect(exitCode).toBe(1);
});

test("a relative import of a file that is not there is still an error under Node16", async () => {
  using dir = tempDir("diagnostics-do-not-depend-on-neighbors", {
    ...underNode16,
    "test/missing.test.ts": `import { expect, test } from "bun:test";\nimport { value } from "../src/nowhere";\ntest("never runs", () => {\n  expect(value).toBe(1);\n});\n`,
  });
  const { said, exitCode } = await run(String(dir), "test", "--aot");
  expect(errors(said)).toEqual(["test/missing.test.ts:2 TS100150"]);
  expect(exitCode).toBe(1);
});

test("bun check without --aot reports the missing extension as tsc does", async () => {
  using dir = tempDir("diagnostics-do-not-depend-on-neighbors", {
    ...underNode16,
    "main.ts": `import { value } from "./src/value";\nconsole.log(value);\n`,
  });
  const { said, exitCode } = await run(String(dir), "check", "main.ts");
  expect(errors(said)).toEqual(["main.ts:1 TS2835"]);
  expect(exitCode).toBe(1);
});
