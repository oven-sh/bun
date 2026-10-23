import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { unsupported } from "./run-programs";

async function run(cmd: string[], cwd: string) {
  await using child = Bun.spawn({
    cmd,
    cwd,
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

const files = {
  "only.d.ts": `export declare const x: number;\ndeclare module "*.wasm" {\n  const bytes: Uint8Array;\n  export default bytes;\n}\n`,
  "main.ts": `import "./only.d.ts";\nconsole.log("main ran");\n`,
};
const projects = [
  ["without a tsconfig.json", {}],
  ["under a tsconfig.json", { "tsconfig.json": `{ "compilerOptions": { "strict": true } }` }],
] as const;

test.skipIf(unsupported)(
  "a declaration file that a program imports is an empty module",
  async () => {
    using dir = tempDir("aot-declaration-file", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    expect(
      await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], String(dir)),
    ).toMatchObject({ exitCode: 0 });
    expect(await run([executable], String(dir))).toEqual({ stdout: "main ran\n", stderr: "", exitCode: 0 });
  },
  240_000,
);

test.skipIf(unsupported).each(projects)(
  "a declaration file as the entry point makes an executable that does nothing, as plain Bun does, %s",
  async (_, project) => {
    using dir = tempDir("aot-declaration-file", { ...files, ...project });
    expect(await run([bunExe(), "run", "only.d.ts"], String(dir))).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    const executable = join(String(dir), "only" + (isWindows ? ".exe" : ""));
    expect(
      await run([bunExe(), "build", "--compile", "--aot", "only.d.ts", "--outfile", executable], String(dir)),
    ).toMatchObject({ exitCode: 0 });
    expect(await run([executable], String(dir))).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
  240_000,
);
