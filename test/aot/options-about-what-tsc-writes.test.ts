import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const options = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  types: [] as string[],
  strict: true,
};

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) => [...new Set([...said.matchAll(/\berror:? (TS\d+)/g)].map(match => match[1]))].sort();

const files = (more: object) => ({
  "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, ...more } }),
  "one.test.ts": `import { expect, test } from "bun:test";\nconst one: number = 1;\ntest("one", () => {\n  expect(one).toBe(1);\n});\n`,
});

test.each([
  ["TS5051", { inlineSources: true }],
  ["TS5051", { sourceRoot: "./src" }],
  ["TS5069", { mapRoot: "./maps" }],
  ["TS5069", { declarationDir: "./types" }],
  ["TS5053", { sourceMap: true, inlineSourceMap: true }],
  ["TS5023", { importsNotUsedAsValues: "error" }],
  ["TS5023", { preserveValueImports: true }],
])(
  "%s for %j is about what tsc writes: it stops bun check and not a run under --aot",
  async (code, more) => {
    using dir = tempDir("options-about-what-tsc-writes", files(more));
    const [plain, tested, checked] = await Promise.all([
      run(String(dir), "check"),
      run(String(dir), "test", "--aot"),
      run(String(dir), "check", "--aot", "one.test.ts"),
    ]);
    expect(errors(plain.said)).toContain(code);
    expect({ errors: errors(tested.said), passed: passed(tested.said) }).toEqual({ errors: [], passed: ["one"] });
    expect({ errors: errors(checked.said), exitCode: checked.exitCode }).toEqual({ errors: [], exitCode: 0 });
    await Bun.write(`${dir}/wrong.ts`, `export const wrong: number = "text";\n`);
    const wrong = await run(String(dir), "check", "--aot", "wrong.ts");
    expect({ errors: errors(wrong.said), exitCode: wrong.exitCode }).toEqual({ errors: ["TS2322"], exitCode: 1 });
  },
  60_000,
);

test.each([
  ["TS5023", { noSuchOption: true }],
  ["TS5053", { lib: ["ESNext"], noLib: true }],
])(
  "%s for %j is not: it stops a run under --aot too",
  async (code, more) => {
    using dir = tempDir("options-about-what-tsc-writes", files(more));
    const tested = await run(String(dir), "test", "--aot");
    expect(errors(tested.said)).toContain(code);
    expect(passed(tested.said)).toEqual([]);
  },
  60_000,
);
