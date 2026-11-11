// "An absolute path that doesn't exist yet, such as /etc/app/config.json, is looked up when the program runs" (docs/compiler/compatibility.mdx). The host's require looks it up, and that is a function of Bun's library:
// a program that uses nothing else of the module loader must hold it all the same.
//
// Each program is built alone, in a folder of its own whose path is spelled into it: were the file there at the build, the build would read it as data.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const programs: Record<string, [name: string, text: string, printed: string]> = {
  "at the top of a CommonJS file": [
    "main.cjs",
    `const fs = require("node:fs");
fs.writeFileSync("FOLDER/late.json", JSON.stringify({ port: 8080 }));
console.log(require("FOLDER/late.json").port);
fs.rmSync("FOLDER/late.json");
`,
    "8080",
  ],
  "by the require of an ES module": [
    "main.mjs",
    `import fs from "node:fs";
fs.writeFileSync("FOLDER/late.json", JSON.stringify({ port: 8080 }));
console.log(import.meta.require("FOLDER/late.json").port);
fs.rmSync("FOLDER/late.json");
`,
    "8080",
  ],
  "the file is still missing when the program runs": [
    "main.cjs",
    `try {
  require("FOLDER/late.json");
} catch (error) {
  console.log(error.name, error.code, String(error.message).includes("late.json"));
}
`,
    "ResolveMessage MODULE_NOT_FOUND true",
  ],
};

describe("the host looks a written path up that the build did not find", () => {
  test.each(Object.entries(programs))(
    "%s",
    async (_, [name, text, printed]) => {
      using dir = tempDir("aot-written-path-missing-at-the-build", {});
      const directory = String(dir);
      await Bun.write(join(directory, name), text.replaceAll("FOLDER", directory.replaceAll("\\", "/")));
      const plain = await run([bunExe(), name], directory, bunEnv);
      const executable = join(directory, isWindows ? "program.exe" : "program");
      const built = await run([bunExe(), "build", "--compile", "--aot", name, "--outfile", executable], directory);
      expect(built.exitCode).toBe(0);
      const compiled = await run([executable], directory, bunEnv);
      expect([plain.stdout.trim(), plain.exitCode]).toEqual([printed, 0]);
      expect([compiled.stdout.trim(), compiled.exitCode]).toEqual([printed, 0]);
    },
    240_000,
  );
});
