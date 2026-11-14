// What a program that may start workers says of `import.meta.main` and `require.main` is known once all of it is loaded. No file is parsed
// again for it, and a file that reads other members of `import.meta` isn't folded again either.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";

const env = { ...bunEnv, NO_COLOR: "1" };

const bundled = `var __require = import.meta.require;
var fs = __require("fs"), key = Symbol.for("queue");
function publish(context, queue) { return [typeof context, queue, typeof fs[key]]; }
console.log(publish(global, 1), typeof import.meta.url, eval("1 + 1"));
`;

const worker = `const here = import.meta.main;
if (here) {
  const started = new Worker(import.meta.url);
  started.onmessage = event => { console.log("main", here, "worker", event.data); started.terminate(); };
} else {
  postMessage(import.meta.main);
}
`;

const commonjs = `const other = require("./other.cjs");
console.log(require.main === module, module === require.main, other.isMain, new Function("return 7")());
if (require.main === module) console.log("started");
`;

const other = `exports.isMain = require.main === module;
`;

describe.concurrent.skipIf(!!unsupported)("the main module", () => {
  test.each([
    ["other members of import.meta", "bundled.js", 0],
    ["import.meta.main beside a worker of the same file", "worker.mjs", 1],
    ["require.main beside a function made of text", "commonjs.cjs", 1],
  ])("%s", (_, entry, foldedAgain) =>
    slot(async () => {
      using dir = tempDir("aot-main-module", {
        "bundled.js": bundled,
        "worker.mjs": worker,
        "commonjs.cjs": commonjs,
        "other.cjs": other,
      });
      const folder = String(dir);
      const [plain, built] = await Promise.all([
        spawned([bunExe(), entry], folder, env),
        spawned([bunExe(), "build", "--compile", "--aot", "--outfile", "out/program", entry], folder, {
          ...env,
          BUN_JSC_logAOTPhaseTimes: "1",
        }),
      ]);
      expect({ exitCode: built.exitCode, text: built.stderr }).toMatchObject({ exitCode: 0 });
      const rounds = built.stderr.split("\n").filter(line => line.startsWith("AOT round of Load"));
      const count = (what: RegExp) => rounds.reduce((sum, line) => sum + Number(what.exec(line)?.[1] ?? 0), 0);
      expect(count(/(\d+) loaded again/)).toBe(0);
      expect(count(/(\d+) folded again/)).toBe(foldedAgain);
      const ran = await spawned([join(folder, "out/program")], folder, env);
      expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    }),
  );
});
