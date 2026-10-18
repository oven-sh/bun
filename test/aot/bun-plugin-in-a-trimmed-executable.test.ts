import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, unsupported } from "./run-programs";

const registers = `Bun.plugin({
  name: "late",
  setup(build) {
    build.onResolve({ filter: /^late:/ }, args => ({ path: args.path, namespace: "late" }));
    build.onLoad({ filter: /.*/, namespace: "late" }, () => ({ contents: "export const value: string = [1, 2, 3].map(n => n * 2).join();", loader: "ts" }));
  },
});
`;
const programs = {
  "named alone, the world is closed and the call throws an Error that the program catches": {
    source: `let answer;\ntry {\n${registers}answer = "registered";\n} catch (error) {\n  answer = error.name + " " + error.code;\n}\nconsole.log("answer:", answer);\n`,
    world: "closed",
    whole: "answer: registered",
    trimmed: "answer: Error ERR_FEATURE_REMOVED",
  },
  "beside an import() of a computed name, the world is open and the plugin works as in the whole executable": {
    source: `${registers}const { value } = await import(["late", "module"].join(":"));\nconsole.log("answer:", value);\n`,
    world: "open",
    whole: "answer: 2,4,6",
    trimmed: "answer: 2,4,6",
  },
};

async function run(cmd: string[], cwd: string) {
  await using child = Bun.spawn({ cmd, cwd, env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe", timeout: 90_000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

using probe = tempDir("bun-plugin-probe", { "hello.ts": "console.log(1);" });
const probed = Bun.spawnSync({ cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"], cwd: String(probe), env: bunEnv, stderr: "pipe" });

(probed.exitCode !== 0 || unsupported || isWindows ? describe.skip : describe.concurrent)("Bun.plugin in a trimmed executable", () => {
  for (const [name, { source, world, whole, trimmed }] of Object.entries(programs)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("bun-plugin", { "program.mjs": source });
          const found: Record<string, unknown> = {};
          for (const [kind, flags] of [["whole", []], ["trimmed", ["--compile-trim-runtime"]]] as const) {
            const build = await run([bunExe(), "build", "--compile", "--aot", "--aot-explain=runtime-use", ...flags, "program.mjs", "--outfile", kind], String(dir));
            expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
            const ran = await run([join(String(dir), kind)], String(dir));
            found[kind] = { world: /^aot: runtime use: (closed|open)\b/m.exec(build.stderr)?.[1], answer: ran.stdout.trim(), exitCode: ran.exitCode };
          }
          expect(found).toEqual({ whole: { world, answer: whole, exitCode: 0 }, trimmed: { world, answer: trimmed, exitCode: 0 } });
        }),
      600_000,
    );
  }
});
