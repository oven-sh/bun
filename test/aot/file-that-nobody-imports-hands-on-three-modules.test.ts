import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const project = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "bundler", noEmit: true, strict: true },
    include: ["*.ts"],
  }),
  "a.ts": `export const a: number = 1;\n`,
  "b.ts": `export const b: number = 2;\n`,
  "c.ts": `export const c: number = 3;\n`,
  "nobody-imports-this.ts": `export * from "./a";\nexport * from "./b";\nexport * from "./c";\n`,
  "main.ts": `import { a } from "./a";\nimport { b } from "./b";\nimport { c } from "./c";\nconsole.log(a + b + c);\n`,
};

async function run(cwd: string, ...cmd: string[]) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test("a file of the project that nobody imports may hand on everything of three modules", async () => {
  using dir = tempDir("aot-three-export-stars", project);
  const executable = join(String(dir), "program");
  const built = await run(String(dir), bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable);
  expect({ stderr: built.stderr, exitCode: built.exitCode, signalCode: built.signalCode }).toEqual({
    stderr: expect.not.stringContaining("panic"),
    exitCode: 0,
    signalCode: null,
  });
  expect(await run(String(dir), executable)).toEqual({ stdout: "6\n", stderr: "", exitCode: 0, signalCode: null });
}, 120_000);
