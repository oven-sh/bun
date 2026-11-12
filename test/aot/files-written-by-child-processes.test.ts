import { describe, expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

// The executable holds a data file that a package reads. A process that the program starts writes the file on the disk.
const ways = [
  "await Bun.$`cp ${fresh} ${target}`;",
  "await Bun.$`cp -r ${path.dirname(fresh)}/. ${path.dirname(target)}`;",
  "await Bun.$`cp -p ${fresh} ${target}`;",
  "await Bun.$`cat ${fresh} | tee ${target}`.quiet();",
  'Bun.spawnSync(["cp", fresh, target]);',
  'Bun.spawnSync(["cp", fresh, "data.txt"], { cwd: path.dirname(target) });',
  'await Bun.spawn(["cp", fresh, target]).exited;',
  'require("node:child_process").execSync(`cp ${fresh} ${target}`);',
  'require("node:child_process").execFileSync("cp", [fresh, target]);',
];
const program = `const fs = require("node:fs"), path = require("node:path");
const reader = require("reader");
const ways = [
${ways.map(way => `  async (fresh, target) => { ${way} },`).join("\n")}
];
(async () => {
  const { dir, read } = await import("reader");
  const target = path.join(reader.dir, "data.txt"), fresh = path.join(__dirname, "fresh/data.txt");
  const at = path.join(dir, "data.txt");
  console.log("before", read(), reader.read());
  Bun.spawnSync(["true"]);
  console.log("behind another process", read(), fs.readFileSync(at, "utf8"));
  await ways[Number(process.argv[2])](fresh, target);
  console.log("behind", read(), reader.read(), fs.readFileSync(at, "utf8"), fs.statSync(at).size, await Bun.file(at).text());
  fs.writeFileSync(target, "third");
  console.log("behind a write", read(), reader.read());
  fs.rmSync(target);
  try { console.log("behind a removal", read()); } catch (error) { console.log("behind a removal", error.code); }
})();
`;

const reader = {
  "node_modules/reader/package.json": `{"name":"reader","version":"1.0.0","exports":{"import":"./reader.mjs","require":"./reader.cjs"}}`,
  "node_modules/reader/reader.mjs": `import fs from "node:fs";\nimport path from "node:path";\nexport const dir = import.meta.dirname;\nexport const read = () => fs.readFileSync(path.join(import.meta.dirname, "data.txt"), "utf8");\n`,
  "node_modules/reader/reader.cjs": `const fs = require("node:fs"), path = require("node:path");\nexports.dir = __dirname;\nexports.read = () => fs.readFileSync(path.join(__dirname, "data.txt"), "utf8");\n`,
  "node_modules/reader/data.txt": "old",
};

describe.skipIf(unsupported || isWindows)("a file that a child process writes", () => {
  test("is read by every path", async () => {
    await slot(async () => {
      using dir = tempDir("files-written-by-child-processes", {
        ...reader,
        "fresh/data.txt": "new content",
        "main.cjs": program,
      });
      const executable = join(String(dir), "main");
      const data = join(String(dir), "node_modules/reader/data.txt");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
        String(dir),
      );
      expect(built.exitCode, built.stderr).toBe(0);
      for (let way = 0; way < ways.length; way++) {
        await Bun.write(data, "old");
        const plain = await run([bunExe(), "--no-install", "main.cjs", String(way)], String(dir));
        await Bun.write(data, "old");
        const compiled = await run([executable, String(way)], String(dir));
        expect({ way: ways[way], stdout: compiled.stdout }).toEqual({ way: ways[way], stdout: plain.stdout });
      }
    });
  });

  test("is no library", async () => {
    await slot(async () => {
      using dir = tempDir("libraries-written-by-child-processes", {
        ...reader,
        "fresh.txt": "new content",
        "main.mjs": `import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dir, read } from "reader";
const old = createRequire(import.meta.url)("reader"), name = dir + "/" + process.argv[2], target = old.dir + "/data.txt";
const opened = () => { try { process.dlopen({ exports: {} }, name); } catch ({ message }) { return message.includes(target) ? "disk" : message.includes(".bun-") ? "executable" : message; } };
console.log(read(), opened());
Bun.spawnSync(["cp", process.cwd() + "/fresh.txt", target]);
console.log(read(), (await import(name)).default, opened());
writeFileSync(target, "third");
console.log(read(), opened());
`,
      });
      const executable = join(String(dir), "main");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
        String(dir),
      );
      expect(built.exitCode, built.stderr).toBe(0);
      const { stdout } = await run([executable, "data.txt"], String(dir));
      expect(stdout).toBe("old executable\nnew content new content executable\nthird disk\n");
    });
  });

  test("is not read where nothing has written it since the build", async () => {
    await slot(async () => {
      using dir = tempDir("files-edited-behind-the-build", {
        ...reader,
        "main.mjs": `import { read } from "reader";\nBun.spawnSync(["true"]);\nconsole.log(read());\n`,
      });
      const executable = join(String(dir), "main");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
        String(dir),
      );
      expect(built.exitCode, built.stderr).toBe(0);
      await Bun.write(join(String(dir), "node_modules/reader/data.txt"), "edited");
      expect((await run([executable], String(dir))).stdout).toBe("old\n");
    });
  });
});
