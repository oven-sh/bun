import { expect } from "bun:test";
import { bunExe } from "harness";
import { run } from "./harness/run";
import { separatePrograms } from "./harness/separate-programs";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { test } from "./supported";

// node:process, bun and node:module mirror an object, and a member whose value Bun's own JavaScript makes is made when somebody first reads it. A file that exports such a
// member again (`export { $ } from "bun"`, `export * from "node:process"`) hands it to whoever reads the file's namespace: a star import, import(), require(), a list of its names.
// No code of the program reads the member there, and once the build kept what code reads: the executable ended with "Bun.$ was left out of the executable".
// A static named import of the same name, or `Bun.$` written anywhere, keeps the member, so each road is alone in its program.
// The battery: ./reach-battery/families/namespaces-of-native-modules-are-listed.ts.

const helpers: Record<string, string> = {
  "shell.mjs": `export { $ } from "bun";\nexport const quiet = true;\n`,
  "renamed-shell.mjs": `export { $ as sh } from "bun";\n`,
  "shell-of-a-second-file.mjs": `export * from "./shell.mjs";\n`,
  "database.mjs": `export { sql, SQL } from "bun";\n`,
  "peek.mjs": `export { peek } from "bun";\n`,
  "later.mjs": `export { nextTick } from "node:process";\n`,
  "all-of-process.mjs": `export * from "node:process";\n`,
  "all-of-module.mjs": `export * from "node:module";\n`,
  "all-of-bun.mjs": `export * from "bun";\n`,
  "all-of-buffer.mjs": `export * from "node:buffer";\n`,
};

const roads: [title: string, entry: string, text: string][] = [
  [
    "export { $ }, read off a star import",
    "shell-off-a-star.mjs",
    `import * as utils from "./shell.mjs";\nconsole.log(typeof utils.$, utils.quiet);\n`,
  ],
  [
    "export { $ }, taken out of an awaited import()",
    "shell-out-of-an-import.mjs",
    `const { $, quiet } = await import("./shell.mjs");\nconsole.log(typeof $, quiet);\n`,
  ],
  [
    "export { $ as sh }, read off what require() answers",
    "shell-off-a-require.mjs",
    `const utils = require("./renamed-shell.mjs");\nconsole.log(typeof utils.sh);\n`,
  ],
  [
    "export { $ } behind a star of a second file, in a list of the names",
    "shell-in-a-list.mjs",
    `import * as utils from "./shell-of-a-second-file.mjs";\nconsole.log(Object.keys(utils).sort().join());\n`,
  ],
  [
    "export { sql, SQL }, taken out of an awaited import()",
    "database-out-of-an-import.mjs",
    `const { SQL } = await import("./database.mjs");\nconsole.log(typeof SQL);\n`,
  ],
  [
    "export { peek }, called off a star import",
    "peek-off-a-star.mjs",
    `import * as R from "./peek.mjs";\nconsole.log(R.peek(Promise.resolve(7)));\n`,
  ],
  [
    "export { nextTick }, read off a star import",
    "later-off-a-star.mjs",
    `import * as later from "./later.mjs";\nconsole.log(typeof later.nextTick);\n`,
  ],
  [
    'export * from "node:process", in a list of the names',
    "process-in-a-list.mjs",
    `const held = await import("./all-of-process.mjs");\nconsole.log(Object.keys(held).length > 3);\n`,
  ],
  [
    'export * from "node:module", in a list of the names',
    "module-in-a-list.mjs",
    `const held = await import("./all-of-module.mjs");\nconsole.log(Object.keys(held).length > 3);\n`,
  ],
  [
    'export * from "bun", in a spread',
    "bun-in-a-spread.mjs",
    `import * as held from "./all-of-bun.mjs";\nconsole.log(Object.keys({ ...held }).length > 3);\n`,
  ],
  [
    'export * from "node:buffer", a member called off a pattern',
    "buffer-off-a-pattern.mjs",
    `import * as held from "./all-of-buffer.mjs";\nconst { Buffer: B } = held;\nconsole.log(B.from("a").toString("hex"));\n`,
  ],
];

const programs = separatePrograms(
  "aot-native-names-exported-again",
  { ...helpers, ...Object.fromEntries(roads.map(([, entry, text]) => [entry, text])) },
  roads.map(([, entry]) => entry),
  withoutDebugInformation,
);

test.concurrent.each(roads)("%s", async (_, entry) => {
  const plain = await run([bunExe(), entry], programs.folder);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({
    stdout: expect.stringMatching(/\S/),
    exitCode: 0,
  });
  const compiled = await programs.start(entry);
  // The first line of what an executable that stops writes says what was left out.
  expect({
    stdout: compiled.stdout,
    stopped: compiled.exitCode ? compiled.stderr.split("\n")[0] : "",
    exitCode: compiled.exitCode,
  }).toEqual({ stdout: plain.stdout, stopped: "", exitCode: 0 });
});
