// `bun <file>` reports a legacy octal number (010, 08) or escape ("\1", "\8") in code that its parser reads as strict:
// under a "use strict" directive, in a class, and in a file with an import, an export or a top-level await.
// The build refuses the same files, and names each one.
// parallel/language/legacy-octal-numbers-and-escapes-of-sloppy-code has the files that both take.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { basename, join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

const strict: Record<string, string> = {
  "directive.cjs": `"use strict";\nconsole.log("never printed", 010);\n`,
  "directive-of-a-function.cjs": `console.log("never printed");\nfunction f() {\n  "use strict";\n  return "\\101";\n}\n`,
  "string-before-the-directive.cjs": `console.log("never printed");\nfunction f() {\n  "\\1";\n  "use strict";\n}\n`,
  "class.cjs": `console.log("never printed");\nclass A {\n  field = 08;\n}\n`,
  "class-heritage.js": `console.log("never printed");\nmodule.exports = class extends (010, Object) {};\n`,
  "import.js": `import { sep } from "node:path";\nconsole.log("never printed", sep, "\\8");\n`,
  "export.mjs": `console.log("never printed", 09.5);\nexport {};\n`,
  "top-level-await.js": `console.log("never printed", "\\377");\nawait 0;\n`,
  "behind-a-comment.js": `"use strict";\n/** @type {number} */\nconst typed = 010;\nconsole.log("never printed", typed);\n`,
  "bin/strict-tool": `"use strict";\nconsole.log("never printed", -010);\n`,
};

test("a legacy octal number or escape is an early error in strict code", async () => {
  using dir = tempDir("aot-legacy-octal-strict", { ...strict, "main.cjs": `console.log("never printed");\n` });
  const cwd = String(dir);
  const names = Object.keys(strict);
  const plain = await Promise.all(names.map(name => run([bunExe(), `./${name}`], cwd, env)));
  expect(
    plain.map(({ stdout, stderr, exitCode }) => ({
      stdout,
      reported: /^error: Legacy octal /m.test(stderr),
      exitCode,
    })),
  ).toEqual(names.map(() => ({ stdout: "", reported: true, exitCode: 1 })));
  const executable = join(cwd, isWindows ? "app.exe" : "app");
  const entries = names.map(name => `./${name}`);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", ...entries, "--outfile", executable],
    cwd,
    env,
  );
  const errors = built.stderr.match(/^error\b.*/gm) ?? [];
  expect(errors.filter(error => !/^error: TS(1121|1487|1488|1489): /.test(error))).toEqual([]);
  const located = [...built.stderr.matchAll(/^\s+at (.+):\d+:\d+$/gm)].map(match => basename(match[1]));
  expect({
    located: [...new Set(located)].sort(),
    exitCode: built.exitCode,
    executable: await Bun.file(executable).exists(),
  }).toEqual({
    located: names.map(name => basename(name)).sort(),
    exitCode: 1,
    executable: false,
  });
});
