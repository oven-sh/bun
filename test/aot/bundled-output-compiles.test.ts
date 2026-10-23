// What `bun build --target=bun` writes is a program like any other: built with --aot it prints what it prints under `bun run`, and what the sources print.
// The bundle names built-in modules through `var __require = import.meta.require;`.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const programs: Record<string, { entry: string; files: Record<string, string>; prints: string }> = {
  "CommonJS files that require built-in modules": {
    entry: "main.cjs",
    files: {
      "main.cjs": `const { createHash } = require("crypto");\nconst { shout } = require("./shout.cjs");\nconsole.log(shout(createHash("sha1").update("a").digest("hex").slice(0, 8)), require("node:path").basename(__filename).length > 0);\n`,
      "shout.cjs": `const { format } = require("util");\nexports.shout = word => format("%s!", word.toUpperCase());\n`,
    },
    prints: "86F7E437! true\n",
  },
  "an ES module that imports CommonJS which requires late": {
    entry: "main.mjs",
    files: {
      "main.mjs": `import { separator } from "./late.cjs";\nimport { EOL } from "node:os";\nconsole.log(separator().length, EOL.length > 0);\n`,
      "late.cjs": `exports.separator = () => require("path").sep;\n`,
    },
    prints: "1 true\n",
  },
};

describe.concurrent("compile/aot/the output of bun build --target=bun", () => {
  for (const [name, { entry, files, prints }] of Object.entries(programs)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-bundled-output", files);
          const folder = String(dir);
          built(await spawned([bunExe(), "build", "--target=bun", entry, "--outfile", "bundle.js"], folder, bunEnv));
          const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
          built(
            await spawned(
              [bunExe(), "build", "--compile", "--aot", "bundle.js", "--outfile", executable],
              folder,
              bunEnv,
            ),
          );
          const expected = { stdout: prints, exitCode: 0, signal: null };
          for (const command of [[bunExe(), "run", entry], [bunExe(), "run", "bundle.js"], [executable]]) {
            const ran = await spawned(command, folder, {
              ...bunEnv,
              BUN_JSC_crashIfInterpreterIsUsed: command.length === 1 ? "1" : undefined,
            });
            expect({ stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual(expected);
          }
        }),
      600_000,
    );
  }
});
