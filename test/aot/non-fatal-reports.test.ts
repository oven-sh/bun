import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(files: Record<string, string>) {
  using dir = tempDir("aot-reports", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--debug-aot", "main.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("an unused @ts-expect-error is a warning", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.ts": `// @ts-expect-error nothing is wrong on the next line\nconst n: number = 1;\nconsole.log(n);\n`,
  });
  expect(stderr).toContain("TS2578");
  expect({ stdout, exitCode }).toEqual({ stdout: "1\n", exitCode: 0 });
});

// TODO: the build goes on and the program prints what it should; the warning is not said.
test.todo("an error inside an installed package's declaration file is a warning", async () => {
  const { stdout, stderr, exitCode } = await run({
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler" } }),
    "node_modules/broken/package.json": JSON.stringify({ name: "broken", version: "1.0.0", main: "index.js", types: "index.d.ts" }),
    "node_modules/broken/index.js": `exports.one = () => 1;\n`,
    "node_modules/broken/index.d.ts": `import type { Missing } from "not-installed";\nexport function one(): number;\nexport function other(): Missing;\n`,
    "main.ts": `import { one } from "broken";\nconsole.log(one());\n`,
  });
  expect(stderr).toContain("TS2307");
  expect({ stdout, exitCode }).toEqual({ stdout: "1\n", exitCode: 0 });
});

test(`types: ["bun-types"] without the package installed is a warning`, async () => {
  const { stdout, stderr, exitCode } = await run({
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, types: ["bun-types"] } }),
    "main.ts": `console.log(typeof Bun.version);\n`,
  });
  expect(stderr).toContain("TS2688");
  expect({ stdout, exitCode }).toEqual({ stdout: "string\n", exitCode: 0 });
});

// TODO: as above: the text that names the remedy is not said.
test.todo(`@types/bun installed but excluded by "types" is a warning`, async () => {
  const { stdout, stderr, exitCode } = await run({
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, types: ["bun-types"] } }),
    "main.ts": `console.log(typeof Bun.version);\n`,
    "node_modules/@types/bun/package.json": JSON.stringify({ name: "@types/bun", version: "1.0.0", types: "index.d.ts" }),
    "node_modules/@types/bun/index.d.ts": `export {};\n`,
  });
  expect(stderr).toContain("TS2688");
  expect(stderr).toContain(`"types": ["bun"]`);
  expect({ stdout, exitCode }).toEqual({ stdout: "string\n", exitCode: 0 });
});

test("a type error in the program's own code still stops the build", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.ts": `const n: number = "one";\nconsole.log(n);\n`,
  });
  expect(stderr).toContain("TS2322");
  expect(stdout).toBe("");
  expect(exitCode).not.toBe(0);
});
