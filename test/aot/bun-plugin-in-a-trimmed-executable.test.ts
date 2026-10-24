import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned, unsupported } from "./run-programs";

type Completeness = "Complete" | "Incomplete";

const registerPlugin = `Bun.plugin({
  name: "late",
  setup(build) {
    build.onResolve({ filter: /^late:/ }, args => ({ path: args.path, namespace: "late" }));
    build.onLoad({ filter: /.*/, namespace: "late" }, () => ({ contents: "export const value: string = [1, 2, 3].map(n => n * 2).join();", loader: "ts" }));
  },
});
`;
const programs: Record<string, { source: string; completeness: Completeness; untrimmed: string; trimmed: string }> = {
  "Bun.plugin alone: the plugin is registered, like in the untrimmed executable": {
    source: `let answer;\ntry {\n${registerPlugin}answer = "registered";\n} catch (error) {\n  answer = error.name + " " + error.code;\n}\nconsole.log("answer:", answer);\n`,
    completeness: "Incomplete",
    untrimmed: "answer: registered",
    trimmed: "answer: registered",
  },
  "Bun.plugin with import() of a computed specifier: the plugin loads the module": {
    source: `${registerPlugin}const { value } = await import(["late", "module"].join(":"));\nconsole.log("answer:", value);\n`,
    completeness: "Incomplete",
    untrimmed: "answer: 2,4,6",
    trimmed: "answer: 2,4,6",
  },
};

const env = { ...bunEnv, NO_COLOR: "1" };

function findCompleteness(report: string): Completeness | undefined {
  if (/^aot: trim: blocked by /m.test(report)) return "Incomplete";
  return /^aot: trim: the compiler can see every API this program uses$/m.test(report) ? "Complete" : undefined;
}

(canTrim && !unsupported && !isWindows ? describe.concurrent : describe.skip)(
  "Bun.plugin in a trimmed executable",
  () => {
    for (const [name, { source, completeness, untrimmed, trimmed }] of Object.entries(programs)) {
      test(
        name,
        () =>
          slot(async () => {
            using dir = tempDir("bun-plugin", { "program.mjs": source });
            const folder = String(dir);
            const found: Record<string, unknown> = {};
            for (const [kind, flags] of [
              ["untrimmed", []],
              ["trimmed", ["--trim"]],
            ] as const) {
              const build = await spawned(
                [bunExe(), "build", "--compile", "--aot", "--explain=trim", ...flags, "program.mjs", "--outfile", kind],
                folder,
                env,
              );
              built(build);
              const ran = await spawned([join(folder, kind)], folder, env);
              found[kind] = {
                completeness: findCompleteness(build.stderr),
                answer: ran.stdout.trim(),
                exitCode: ran.exitCode,
              };
            }
            expect(found).toEqual({
              untrimmed: { completeness, answer: untrimmed, exitCode: 0 },
              trimmed: { completeness, answer: trimmed, exitCode: 0 },
            });
          }),
        600_000,
      );
    }

    test(
      "code that onLoad yields, in an executable whose transpiler was taken out by force: an error that the program catches",
      () =>
        slot(async () => {
          const source = `${registerPlugin}let answer;\ntry {\n  answer = (await import(["late", "module"].join(":"))).value;\n} catch (error) {\n  answer = error.name + " " + error.code;\n}\nconsole.log("answer:", answer);\n`;
          using dir = tempDir("bun-plugin", { "program.mjs": source });
          const folder = String(dir);
          built(
            await spawned(
              [
                bunExe(),
                "build",
                "--compile",
                "--aot",
                "--trim",
                "--trim-without",
                "RuntimeTranspiler",
                "program.mjs",
                "--outfile",
                "forced",
              ],
              folder,
              env,
            ),
          );
          const ran = await spawned([join(folder, "forced")], folder, env);
          expect({ stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
            stdout: "answer: Error ERR_FEATURE_REMOVED\n",
            exitCode: 0,
            signal: null,
          });
        }),
      600_000,
    );
  },
);
