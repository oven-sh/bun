// A build script may write files while it bundles. What the type checker reads of them is what is there when the bundle is through.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./with-compiler";

async function runCommand(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function tsconfig() {
  return JSON.stringify({
    compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", types: [] },
    include: ["src", "tests"],
  });
}

test("a file outside the bundle that the build script writes while it bundles counts as it is then", async () => {
  using dir = tempDir("aot-outside-the-bundle", {
    "tsconfig.json": tsconfig(),
    "tests/written-late.ts": `export const nothing = 0;\n`,
    "src/asset.d.ts": `declare module "*.asset" {\n  const path: string;\n  export default path;\n}\n`,
    "src/late.asset": `late\n`,
    "src/main.ts": `import late from "./late.asset";\nconsole.log(typeof late, typeof fromWrittenLate);\n`,
    "build.ts": `
      import { writeFileSync } from "node:fs";
      const result = await Bun.build({
        entrypoints: [import.meta.dir + "/src/main.ts"],
        compile: { aot: true, outfile: import.meta.dir + "/out" },
        plugins: [
          {
            name: "writes late",
            setup(build) {
              build.onLoad({ filter: /\\.asset$/ }, async () => {
                // Nothing tells a plugin when a checker that reads while the bundle runs has read the file. The wait gives it the time.
                await Bun.sleep(500);
                writeFileSync(import.meta.dir + "/tests/written-late.ts", "declare global {\\n  var fromWrittenLate: number | undefined;\\n}\\nexport {};\\n");
                return { contents: "late", loader: "file" };
              });
            },
          },
        ],
      });
      if (!result.success) {
        console.error(result.logs.join("\\n"));
        process.exit(1);
      }
    `,
  });
  const { stderr: buildErrors, exitCode: buildExitCode } = await runCommand([bunExe(), "build.ts"], String(dir));
  expect(buildErrors).not.toContain("Cannot find name");
  expect(buildExitCode).toBe(0);
  const { stdout, exitCode } = await runCommand([join(String(dir), "out")], String(dir));
  expect({ stdout, exitCode }).toEqual({ stdout: "string undefined\n", exitCode: 0 });
});

async function buildWithLateWrites(files: Record<string, string>, written: Record<string, string>) {
  using dir = tempDir("aot-outside-the-bundle", {
    "tsconfig.json": tsconfig(),
    "src/asset.d.ts": `declare module "*.asset" {\n  const path: string;\n  export default path;\n}\n`,
    "src/late.asset": `late\n`,
    ...files,
    "written.json": JSON.stringify(written),
    "build.ts": `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { dirname } from "node:path";
      import written from "./written.json";
      const result = await Bun.build({
        entrypoints: [import.meta.dir + "/src/main.ts"],
        compile: { aot: true, outfile: import.meta.dir + "/out" },
        plugins: [
          {
            name: "writes late",
            setup(build) {
              build.onLoad({ filter: /\\.asset$/ }, async () => {
                // Nothing tells a plugin when a checker that reads while the bundle runs has read the file. The wait gives it the time.
                await Bun.sleep(500);
                for (const [path, text] of Object.entries(written)) {
                  mkdirSync(dirname(import.meta.dir + "/" + path), { recursive: true });
                  writeFileSync(import.meta.dir + "/" + path, text);
                }
                return { contents: "late", loader: "file" };
              });
            },
          },
        ],
      });
      if (!result.success) {
        console.error(result.logs.join("\\n"));
        process.exit(1);
      }
    `,
  });
  const { stderr: buildErrors, exitCode: buildExitCode } = await runCommand([bunExe(), "build.ts"], String(dir));
  if (buildExitCode !== 0) return { buildErrors, buildExitCode, stdout: "", exitCode: -1 };
  const { stdout, exitCode } = await runCommand([join(String(dir), "out")], String(dir));
  return { buildErrors, buildExitCode, stdout, exitCode };
}

test("type-only file rewritten during bundling is re-read", async () => {
  const result = await buildWithLateWrites(
    {
      "src/shapes.ts": `export type Shape = { width: number };\n`,
      "src/main.ts": `import late from "./late.asset";\nimport type { Shape } from "./shapes";\nconst shape: Shape = { width: 2, name: "wide" };\nconsole.log(typeof late, shape.width, shape.name);\n`,
    },
    { "src/shapes.ts": `export type Shape = { width: number; name: string };\n` },
  );
  expect(result.buildErrors).not.toContain("does not exist in type");
  expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: "string 2 wide\n", exitCode: 0 });
});

test("type-only file that loses a member during bundling fails the build", async () => {
  const result = await buildWithLateWrites(
    {
      "src/shapes.ts": `export type Shape = { width: number; name: string };\n`,
      "src/main.ts": `import late from "./late.asset";\nimport type { Shape } from "./shapes";\nconst shape: Shape = { width: 2, name: "wide" };\nconsole.log(typeof late, shape.width, shape.name);\n`,
    },
    { "src/shapes.ts": `export type Shape = { width: number };\n` },
  );
  expect(result.buildErrors).toContain("does not exist in type");
  expect(result.buildExitCode).not.toBe(0);
});

test("type-only file added to a cached directory during bundling is resolved", async () => {
  const result = await buildWithLateWrites(
    {
      "src/generated/first.ts": `export type First = { first: number };\n`,
      "src/main.ts": `import late from "./late.asset";\nimport type { First } from "./generated/first";\nimport type { Second } from "./generated/second";\nconst first: First = { first: 1 };\nconst second: Second = { second: "two" };\nconsole.log(typeof late, first.first, second.second);\n`,
    },
    { "src/generated/second.ts": `export type Second = { second: string };\n` },
  );
  expect(result.buildErrors).not.toContain("Cannot find module");
  expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: "string 1 two\n", exitCode: 0 });
});
