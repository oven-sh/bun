// Code may be nested as deep as it likes: the compiler takes it or says in one error that it is nested too deeply. Every stage walks the tree by
// recursion, each with frames of its own size, so each kind of syntax finds another stage's end first.
//
//   AOT_NESTED=calls bun test test/aot/code-nested-in-itself.test.ts     the forms whose name contains the text
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { forms } from "../../code-nested-in-itself/forms";
import { slot, spawned } from "../../harness/commands";
import { describe, test } from "../../supported";

const wanted = process.env.AOT_NESTED ?? "";
// No form has more than two levels of the compiler's count in one of its own.
const alwaysCompiled = 900;
const depths = [alwaysCompiled, 1_900, 4_096, 9_000];
const saysTooDeep = ["TS100060", "TS100301"];

describe.concurrent("code nested in itself", () => {
  for (const form of forms.filter(form => form.name.includes(wanted))) {
    test(`${form.name}, ${form.extension}`, async () => {
      for (const depth of depths) {
        await slot(async () => {
          const name = `main.${form.extension}`;
          using dir = tempDir("aot-nested", { [name]: form.text(depth) });
          const env = { ...bunEnv, NO_COLOR: "1" };
          const { stdout, stderr, exitCode, signal } = await spawned(
            [bunExe(), "check", "--aot", "--no-pretty", name],
            String(dir),
            env,
          );
          const output = stdout + stderr;
          const codes = [...output.matchAll(/error (TS\d+)/g)].map(match => match[1]);
          const refusals = codes.filter(code => saysTooDeep.includes(code));
          expect({
            depth,
            signal,
            exitCode: exitCode === 0 || (exitCode === 1 && codes.length > 0) ? "0, or 1 with errors" : exitCode,
            blamesTheCompiler: /internal compiler error[^\n]*|panic[^\n]*|This is a bug in Bun/.exec(output)?.[0],
            refusals: depth === alwaysCompiled || refusals.length > 1 ? refusals : [],
          }).toEqual({
            depth,
            signal: null,
            exitCode: "0, or 1 with errors",
            blamesTheCompiler: undefined,
            refusals: [],
          });
        });
      }
    }, 240_000);
  }
});
