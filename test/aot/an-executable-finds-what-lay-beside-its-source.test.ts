// `__dirname` and `__filename` hold the folder of the build, as with `bun build --compile`. Where that folder is on the machine, a program finds there what `bun build --compile` finds.
// Where it is not, on the machine that the executable is shipped to, what the executable holds answers under those paths: its modules, and what --asset embedded.
import { expect } from "bun:test";
import { afterAll } from "./harness/declare";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { beforeAll, describe, test } from "./supported";

const program = `const fs = require("node:fs"), path = require("node:path");
const show = async (what, answer) => {
  let value;
  try {
    value = await answer();
  } catch (error) {
    value = "throws " + (error.code ?? error.name);
  }
  console.log(what + ":", value);
};
const page = path.join(__dirname, "public", "index.html");
(async () => {
  await show("__dirname", () => path.basename(__dirname));
  await show("__filename", () => path.relative(__dirname, __filename));
  await show("readFileSync", () => fs.readFileSync(page, "utf8").trim());
  await show("promises.readFile", async () => (await fs.promises.readFile(page, "utf8")).trim());
  await show("existsSync", () => [fs.existsSync(page), fs.existsSync(path.dirname(page)), fs.existsSync(__filename)].join());
  await show("statSync", () => [fs.statSync(page).isFile(), fs.statSync(page).size, fs.statSync(path.dirname(page)).isDirectory()].join());
  await show("accessSync", () => fs.accessSync(page, fs.constants.R_OK) ?? "ok");
  await show("readdirSync", () => fs.readdirSync(path.dirname(page)).sort().join());
  await show("readdirSync, recursive", () => fs.readdirSync(path.dirname(page), { recursive: true }).map(name => name.replaceAll("\\\\", "/")).sort().join());
  await show("openSync and readSync", () => {
    const descriptor = fs.openSync(page, "r");
    const bytes = Buffer.alloc(8);
    fs.readSync(descriptor, bytes, 0, 8, 0);
    fs.closeSync(descriptor);
    return bytes.toString();
  });
  await show("createReadStream", () => new Promise((resolve, reject) => {
    let text = "";
    fs.createReadStream(page, "utf8").on("data", part => (text += part)).on("end", () => resolve(text.trim())).on("error", reject);
  }));
  await show("Bun.file", async () => [(await Bun.file(page).text()).trim(), Bun.file(page).size, await Bun.file(page).exists()].join());
  await show("Bun.Glob", () => [...new Bun.Glob("**/*.txt").scanSync({ cwd: path.dirname(page) })].map(name => name.replaceAll("\\\\", "/")).join());
  await show("files of a folder, listed and required", () => fs.readdirSync(path.join(__dirname, "commands")).sort().map(file => require(path.join(__dirname, "commands", file))).join());
  await show("require.resolve, then require", () => require(require.resolve("./commands/a.cjs")));
  await show("createRequire(__filename)", () => require("node:module").createRequire(__filename)("./commands/b.cjs"));
  await show("a Worker", () => new Promise((resolve, reject) => {
    new (require("node:worker_threads").Worker)(path.join(__dirname, "worker.cjs")).on("message", resolve).on("error", reject);
  }));
  await show("a file that nobody embedded", () => fs.readFileSync(path.join(__dirname, "beside", "plain.txt"), "utf8").trim());
  await show("process.chdir(__dirname)", () => (process.chdir(__dirname), fs.readFileSync("public/index.html", "utf8").trim()));
})();
`;

describe("compile/aot/an executable finds what lay beside its source", () => {
  const root = String(tempDir("aot-beside-its-source", {}));
  const source = join(root, "the-folder-of-the-build");
  const away = join(root, "moved-away");
  const elsewhere = join(root, "elsewhere");
  const executable = (name: string) => join(elsewhere, isWindows ? name + ".exe" : name);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  beforeAll(async () => {
    for (const folder of ["public/sub", "commands", "beside"]) mkdirSync(join(source, folder), { recursive: true });
    mkdirSync(elsewhere);
    writeFileSync(join(source, "public", "index.html"), "embedded page\n");
    writeFileSync(join(source, "public", "sub", "deep.txt"), "deep\n");
    writeFileSync(join(source, "beside", "plain.txt"), "not embedded\n");
    writeFileSync(join(source, "commands", "a.cjs"), `module.exports = "command a";\n`);
    writeFileSync(join(source, "commands", "b.cjs"), `module.exports = "command b";\n`);
    writeFileSync(
      join(source, "worker.cjs"),
      `require("node:worker_threads").parentPort.postMessage("the worker ran");\n`,
    );
    writeFileSync(join(source, "server.cjs"), program);
    const files = ["./server.cjs", "--asset", "./public"];
    const builds = [
      [bunExe(), ...compileCommand, ...withoutDebugInformation(), ...files, "--outfile", executable("compiled")],
      [bunExe(), "build", "--compile", ...files, "--outfile", executable("bundled")],
    ];
    for (const build of await Promise.all(builds.map(build => spawned(build, source, bunEnv)))) built(build);
  }, 300_000);

  const linesOf = async (name: string) => {
    const run = await spawned([executable(name)], elsewhere, bunEnv);
    expect({ stderr: run.stderr, exitCode: run.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return run.stdout.trim().split("\n");
  };

  test("where it was built it prints what `bun build --compile` prints", async () => {
    const [compiled, bundled] = await Promise.all([linesOf("compiled"), linesOf("bundled")]);
    expect(compiled).toEqual(bundled);
    expect(compiled).toContain("__dirname: the-folder-of-the-build");
    expect(compiled).toContain("a file that nobody embedded: not embedded");
    expect(compiled.filter(line => line.includes("throws"))).toEqual([]);
  });

  test("where the folder of the build is gone it finds what it holds", async () => {
    const before = await linesOf("compiled");
    renameSync(source, away);
    try {
      const shipped = await linesOf("compiled");
      expect(shipped).toEqual(
        before.map(line =>
          line.startsWith("a file that nobody embedded:") ? "a file that nobody embedded: throws ENOENT" : line,
        ),
      );
    } finally {
      renameSync(away, source);
    }
  });

  test("it holds the folder of the build, which the program names", () => {
    expect(readFileSync(executable("compiled")).includes("the-folder-of-the-build")).toBe(true);
  });
});
