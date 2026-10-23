import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

async function build(files: Record<string, string>) {
  const dir = tempDir("aot-no-tsconfig", files);
  const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
  const { stderr: said, exitCode: built } = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile],
    String(dir),
  );
  if (built) return { dir, said, built, stdout: "" };
  await using ran = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  return { dir, said, built, stdout: await ran.stdout.text() };
}
const files = {
  "lib.cts": `export class A { v = 1 }\nexport const n = 2;\n`,
  "main.ts": `import { A, n } from "./lib.cts";\ndeclare const console: { log(...values: unknown[]): void };\nconsole.log(new A().v, n);\n`,
};

test("without a tsconfig.json a .cts file may export in the ordinary way", async () => {
  const { dir, said, built, stdout } = await build(files);
  using _ = dir;
  expect({ said: built ? said : "", built, stdout }).toEqual({ said: "", built: 0, stdout: "1 2\n" });
}, 120_000);

test("a tsconfig.json that asks for verbatimModuleSyntax is obeyed", async () => {
  const { dir, said, built } = await build({
    ...files,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        verbatimModuleSyntax: true,
        module: "preserve",
        allowImportingTsExtensions: true,
        noEmit: true,
      },
    }),
  });
  using _ = dir;
  expect(said).toContain("TS1287");
  expect(built).not.toBe(0);
}, 120_000);
