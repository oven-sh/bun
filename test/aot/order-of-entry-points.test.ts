import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const options = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  typeRoots: [join(import.meta.dir, "..", "..", "packages")],
  types: ["bun-types"],
  strict: true,
  composite: true,
  outDir: "lib",
  rootDir: "src",
};
const config = JSON.stringify({ compilerOptions: options, include: ["src"] });

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
// `bun test --aot` reports as the build does, `bun check --aot` as tsc does.
const errorsOfBuild = (said: string) =>
  [...said.matchAll(/^error: (TS\d+):.*\n\s+at (\S+):(\d+):\d+$/gm)]
    .map(match => `${match[2].replaceAll("\\", "/").replace(/^.*\/(?=packages\/)/, "")}:${match[3]} ${match[1]}`)
    .sort();
const errorsOfCheck = (said: string) =>
  [...said.matchAll(/^(\S+)\((\d+),\d+\): error (TS\d+)/gm)]
    .map(match => `${match[1].replaceAll("\\", "/")}:${match[2]} ${match[3]}`)
    .sort();

const right = "packages/right/src/right.test.ts";
const wrong = "packages/wrong/src/wrong.test.ts";

const workspace = (wrongTest: string) => ({
  "package.json": JSON.stringify({ name: "workspace", workspaces: ["packages/*"] }),
  "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "packages/wrong" }] }),
  "packages/right/package.json": JSON.stringify({
    name: "@workspace/right",
    version: "1.0.0",
    main: "lib/index.js",
    types: "lib/index.d.ts",
  }),
  "packages/right/tsconfig.json": config,
  "packages/right/src/index.ts": `export interface Rule {\n  level: number;\n}\n`,
  [right]: `import { expect, test } from "bun:test";\nimport type { Rule } from "./index";\nconst rule: Rule = { level: 2 };\ntest("right", () => {\n  expect(rule.level).toBe(2);\n});\n`,
  "packages/wrong/package.json": JSON.stringify({ name: "@workspace/wrong", version: "1.0.0" }),
  "packages/wrong/tsconfig.json": config,
  [wrong]: wrongTest,
});

test.each([
  [
    "a type error",
    `import { expect, test } from "bun:test";\nconst level: number = "one";\ntest("wrong", () => {\n  expect(String(level)).toBe("one");\n});\n`,
    "TS2322",
  ],
  [
    "an import of a package that is not built and that no tsconfig.json references",
    `import { expect, test } from "bun:test";\nimport type { Rule } from "@workspace/right";\nconst rule: Rule = { level: 1 };\ntest("wrong", () => {\n  expect(rule.level).toBe(1);\n});\n`,
    "TS2307",
  ],
])(
  "a test file with %s is refused whichever test file comes first",
  async (_, wrongTest, code) => {
    using dir = tempDir("order-of-entry-points", workspace(wrongTest));
    mkdirSync(join(String(dir), "node_modules", "@workspace"), { recursive: true });
    symlinkSync(
      join(String(dir), "packages", "right"),
      join(String(dir), "node_modules", "@workspace", "right"),
      "dir",
    );
    for (const files of [[wrong], [wrong, right], [right, wrong]]) {
      const tested = await run(String(dir), "test", "--aot", ...files.map(file => `./${file}`));
      expect({
        files,
        errors: errorsOfBuild(tested.said),
        hasRunRefusedFile: passed(tested.said).includes("wrong"),
        exitCode: tested.exitCode,
      }).toEqual({ files, errors: [`${wrong}:2 ${code}`], hasRunRefusedFile: false, exitCode: 1 });
      const checked = await run(String(dir), "check", "--aot", ...files);
      expect({ files, errors: errorsOfCheck(checked.said), exitCode: checked.exitCode }).toEqual({
        files,
        errors: [`${wrong}:2 ${code}`],
        exitCode: 1,
      });
    }
  },
  120_000,
);
