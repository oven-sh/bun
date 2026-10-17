import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "./run-programs";

describe.skipIf(!!unsupported)("compile/aot/--aot-explain=joins", () => {
  const folders: string[] = [];
  afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));

  test("says for every map().join() whether it is fused, and why not", () =>
    slot(async () => {
      const folder = String(tempDir("aot-explain-joins", {}));
      folders.push(folder);
      cpSync(join(import.meta.dir, "explain-joins", "views.ts"), join(folder, "views.ts"));
      const build = await spawned([bunExe(), "build", "--compile", "--aot", "--aot-explain=joins", "--outfile", "app", "views.ts"], folder, bunEnv);
      built(build);
      const compiled = await spawned([join(folder, "app")], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      const plain = await spawned([bunExe(), "run", "views.ts"], folder, bunEnv);
      expect(told(compiled)).toEqual(told(plain));
      const lines = (build.stdout + build.stderr).split("\n").flatMap(line => {
        const found = /joins: .*views\.ts:(\d+): map\(\)\.join\(\) (.*)$/.exec(line);
        return found ? [found[1] + ": " + found[2]] : [];
      });
      expect(lines.sort((a, b) => parseInt(a) - parseInt(b))).toEqual([
        "10: is fused into one loop",
        "11: is fused into one loop",
        "13: is not fused: a piece and the separator are only known to be 2 characters long, and it takes 24 for the fused form to allocate less",
        "14: is not fused: the joined string is used for something other than concatenation",
        "15: is not fused: the callback may return something other than a string",
        "16: is not fused: the separator is not a string literal",
        "17: is not fused: join() is not passed exactly one argument",
        "18: is not fused: map() is not passed exactly one argument",
        "20: is not fused: other code runs between map() and join(), or they are inside try",
        "22: is not fused: which function the callback is cannot be told at build time",
        "24: is not fused: other code runs between map() and join(), or they are inside try",
      ]);
    }), 600_000);
});
