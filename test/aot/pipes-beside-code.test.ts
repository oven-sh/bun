import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";

// Opening a named pipe waits for a writer. A build reads regular files alone where the program only names a file beside its code.
const LIMIT = 60_000;
const head = `const fs = require("node:fs"), path = require("node:path");\n`;

async function build(cwd: string, outfile = "app") {
  const args = [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", outfile];
  const { stderr, exitCode } = await run(args, cwd, bunEnv, LIMIT);
  return { errors: stderr.match(/^error.*$/gm) ?? [], exitCode };
}

const programs: Record<string, [main: string, pipe: string, others?: Record<string, string>]> = {
  "WebAssembly in a string": [`const name = "./x.wasm"; if (process.argv[9]) console.log(name);`, "x.wasm"],
  "WebAssembly that is read": [
    `${head}if (process.argv[9]) new WebAssembly.Module(fs.readFileSync(path.join(__dirname, "x.wasm")));`,
    "x.wasm",
  ],
  "a path to WebAssembly": [
    `${head}const file = path.join(__dirname, "x.wasm"); if (process.argv[9]) console.log(file);`,
    "x.wasm",
  ],
  "the package.json": [
    `${head}if (process.argv[9]) console.log(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));`,
    "package.json",
  ],
  "a file of a package": [
    `console.log(typeof require("box"));`,
    "node_modules/box/x.txt",
    {
      "node_modules/box/package.json": `{ "name": "box" }`,
      "node_modules/box/index.js": `${head}module.exports = () => fs.readFileSync(path.join(__dirname, "x.txt"));`,
    },
  ],
  "a file in a folder of a package": [
    `console.log(typeof require("box"));`,
    "node_modules/box/files/x.txt",
    {
      "node_modules/box/package.json": `{ "name": "box" }`,
      "node_modules/box/files/y.txt": "y",
      "node_modules/box/index.js": `${head}module.exports = name => fs.readFileSync(path.join(__dirname, "files", name));`,
    },
  ],
};

describe.skipIf(isWindows).concurrent("a build doesn't wait for a named pipe that is", () => {
  test.each(Object.keys(programs))(
    "%s",
    async name => {
      const [main, pipe, others = {}] = programs[name];
      using dir = tempDir("aot-pipes", { "main.cjs": `${main}\nconsole.log("end");\n`, ...others });
      mkfifo(join(String(dir), pipe));
      expect(await build(String(dir))).toEqual({ errors: [], exitCode: 0 });
      const { stdout, exitCode } = await run([join(String(dir), "app")], String(dir), bunEnv, LIMIT);
      expect({ ended: stdout.endsWith("end\n"), exitCode }).toEqual({ ended: true, exitCode: 0 });
    },
    2 * LIMIT,
  );

  test(
    "linked to",
    async () => {
      using dir = tempDir("aot-pipes", { "main.cjs": `const name = "./x.wasm";\nconsole.log(name);\n` });
      mkfifo(join(String(dir), "pipe"));
      symlinkSync("pipe", join(String(dir), "x.wasm"));
      expect(await build(String(dir))).toEqual({ errors: [], exitCode: 0 });
    },
    2 * LIMIT,
  );

  test(
    "at its output path",
    async () => {
      using dir = tempDir("aot-pipes", { "main.cjs": `console.log("end");\n` });
      mkfifo(join(String(dir), "app"));
      expect(await build(String(dir))).toEqual({ errors: [], exitCode: 0 });
      const { stdout } = await run([join(String(dir), "app")], String(dir), bunEnv, LIMIT);
      expect(stdout).toBe("end\n");
    },
    2 * LIMIT,
  );
});
