import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "./harness/default-timeout";

const nameOfExecutable = isWindows ? "executable.exe" : "executable";

// The file was passed to the build as another entry point, and the program comes by its path without `__dirname`.
// The forms are one program. None of them says `require.resolve()` or `__dirname`: one of those in it and the build writes its root directory down.
const forms: Record<string, string> = {
  "process.cwd() + ..": `require(process.cwd() + up + "/" + lib + "/a.js").name`,
  "path.resolve(..)": `require(path.resolve(up.slice(1), lib, "a.js")).name`,
  "path.join(process.cwd(), ..)": `require(path.join(process.cwd(), up, lib, "a.js")).name`,
  "without the extension": `require(path.resolve(up.slice(1), lib, "a")).name`,
  "a folder with index.js": `require(path.resolve(up.slice(1), lib, "folder")).name`,
  "import() of such a path": `(await import(path.resolve(up.slice(1), lib, "m.mjs"))).name`,
  "import() of a file URL of it": `(await import(require("url").pathToFileURL(path.resolve(up.slice(1), lib, "m.mjs")).href)).name`,
  "the same object as by a relative name": `require(path.resolve(up.slice(1), lib, "a.js")) === require("./" + lib + "/a.js")`,
  "a JSON file that is an entry point": `require(path.resolve(up.slice(1), lib, "data.json")).name`,
  "in a method": `new (class { load() { return require(path.resolve(up.slice(1), lib, "a.js")).name; } })().load()`,
  "in a field": `new (class { name = require(path.resolve(up.slice(1), lib, "a.js")).name; })().name`,
  "what is not there": `require(path.resolve(up.slice(1), lib, "nothing.js")).name`,
};

let ran: Promise<Record<"plain" | "inPlace" | "withoutSources" | "shipped", string[]>> | undefined;
const allRuns = () =>
  (ran ??= (async () => {
    using dir = tempDir("aot-absolute-path-at-run-time", {
      "site/main.cjs": `const path = require("path"); const lib = process.env.LIB ?? "lib"; const up = process.env.UP ?? "";
(async () => {
${Object.entries(forms)
  .map(
    ([name, code]) =>
      `  try { console.log(${JSON.stringify(name + ":")}, ${code}); } catch (e) { console.log(${JSON.stringify(name + ":")}, e.code ?? e.name); }`,
  )
  .join("\n")}
})();`,
      "site/lib/a.js": `exports.name = "a";`,
      "site/lib/m.mjs": `export const name = "m";`,
      "site/lib/folder/index.js": `exports.name = "index";`,
      "site/lib/data.json": `{ "name": "data" }`,
    });
    const site = join(String(dir), "site");
    const executable = join(String(dir), nameOfExecutable);
    const run = async (cmd: string[], cwd: string) => {
      await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const linesOf = async (cmd: string[], cwd: string) => {
      const { stdout, stderr, exitCode } = await run(cmd, cwd);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return stdout.split("\n");
    };
    const plain = await linesOf([bunExe(), "main.cjs"], site);

    const files = ["./main.cjs", "./lib/a.js", "./lib/m.mjs", "./lib/folder/index.js", "./lib/data.json"];
    const built = await run([bunExe(), "build", "--compile", "--aot", ...files, "--outfile", executable], site);
    // The build warns of the names that it cannot follow.
    expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });

    // The working directory of the run stands for the one of the build.
    const inPlace = await linesOf([executable], site);
    // The sources are gone.
    rmSync(join(site, "lib"), { recursive: true });
    rmSync(join(site, "main.cjs"));
    const withoutSources = await linesOf([executable], site);
    // Shipped.
    mkdirSync(join(String(dir), "other", "place"), { recursive: true });
    copyFileSync(executable, join(String(dir), "other", nameOfExecutable));
    const shipped = await linesOf([join(String(dir), "other", nameOfExecutable)], join(String(dir), "other", "place"));
    return { plain, inPlace, withoutSources, shipped };
  })());

test.each(Object.keys(forms))(
  "%s",
  async name => {
    const { plain, ...compiled } = await allRuns();
    const said = (lines: string[]) => lines.filter(line => line.startsWith(name + ": "));
    expect(said(plain).length).toBe(1);
    expect(Object.values(compiled).map(said)).toEqual([said(plain), said(plain), said(plain)]);
  },
  600_000,
);
