// Packages that each load files of their own by a name put together at run time, as packages of plugins, locales and
// codecs do. Any such load may answer with any file that the build has found, and the files are found a package a round,
// so every read of a member off a load sees as many versions of that set as there are packages. A read asks which of its
// receivers lie below an accessor that nobody knows. Asked of each receiver by itself that left readers behind for each:
// reads times files. The program below needs about a tenth of the bound when receivers that lie below one prototype are
// asked together, and four times the bound when they are not.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { readBuildReport } from "./harness/build-report";
import { unsupported } from "./harness/compiler";
import { withReport } from "./harness/flags";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";
import { describe, test } from "./listed";

const packages = 300;
const filesOfPackage = 2;

const files: Record<string, string> = {
  "package.json": `{ "name": "loads-by-name", "version": "1.0.0" }\n`,
  "main.js": `const first = require("pkg0");\nconsole.log(first.total());\n`,
};
for (let p = 0; p < packages; p++) {
  const folder = `node_modules/pkg${p}`;
  files[`${folder}/package.json`] = `{ "name": "pkg${p}", "version": "1.0.0", "main": "index.js" }\n`;
  files[`${folder}/index.js`] = [
    p + 1 < packages ? `const next = require("pkg${p + 1}");` : `const next = { total: () => 0 };`,
    `const names = [${Array.from({ length: filesOfPackage }, (_, i) => `"./lib/a${i}.js"`).join(", ")}];`,
    `exports.load = function (name) { return require("./lib/" + name); };`,
    `exports.total = function () { let sum = next.total(); for (let i = 0; i < ${filesOfPackage}; i++) sum += exports.load("a" + i + ".js").value; return sum + names.length; };`,
    ``,
  ].join("\n");
  for (let i = 0; i < filesOfPackage; i++)
    files[`${folder}/lib/a${i}.js`] =
      `exports.value = ${(p % 7) + i};\nexports.describe = function () { return "pkg${p} a${i} " + exports.value; };\n`;
}

describe.skipIf(!!unsupported)("files loaded by name that are read at many places", () => {
  const { folder, build } = sharedBuilds("files-loaded-by-name-that-are-read-at-many-places", files);

  test("leave few readers and print what plain Bun prints", async () => {
    const report = join(folder, "report.json");
    const built = await build("main.js", "--aot", ...withReport(report, "summary"));
    expect(readBuildReport(report).statistics.FlowReaders).toBeLessThan(200000);
    const printedBy = async (cmd: string[]) => {
      const { stdout, exitCode } = await run(cmd, folder, bunEnv);
      return { stdout, exitCode };
    };
    expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), "main.js"]));
  });
});
