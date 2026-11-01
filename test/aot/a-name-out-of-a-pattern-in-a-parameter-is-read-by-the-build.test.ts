import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { test } from "./harness/default-timeout";

const nameOfExecutable = isWindows ? "executable.exe" : "executable";

// `function load({ name }) { return require(name); }`, where every call of `load` is seen: the build reads the name out of what the calls pass.
// Each form stands alone in its program, and the sources are moved away before the executable runs.
const forms: Record<string, string> = {
  "called where it is written": `(({ name }) => require(name))({ name: "./lib/util.js" }).name`,
  "a pattern in a pattern": `(({ options: { name } }) => require(name))({ options: { name: "./lib/util.js" } }).name`,
  "under another name": `(({ name: file }) => require(file))({ name: "./lib/util.js" }).name`,
  "the second parameter": `((first, { name }) => require(name))(1, { name: "./lib/util.js" }).name`,
  "a default of the parameter": `(({ name } = { name: "./lib/util.js" }) => require(name))().name`,
  "the function hands the name back": `require((({ name }) => name)({ name: "./lib/util.js" })).name`,
  "in a field": `new (class { field = (({ name }) => require(name))({ name: "./lib/util.js" }).name; })().field`,
  "in a method": `new (class { method() { return (({ name }) => require(name))({ name: "./lib/util.js" }).name; } })().method()`,
  "import()": `(await (({ name }) => import(name))({ name: "./lib/util.js" })).default.name`,
  // What the program holds when it asks is another name than the one that is written.
  "the name is stored into": `(({ name }) => { name = "./lib/other.js"; return require(name); })({ name: "./lib/util.js" }).name`,
  "the object is changed": `(() => { const options = { name: "./lib/util.js" }; options.name = "./lib/other.js"; return (({ name }) => require(name))(options).name; })()`,
  "a getter": `(({ name }) => require(name))({ get name() { return "./lib/other.js"; } }).name`,
};
const declared: Record<string, string> = {
  "a function with a name": `function load({ name }) { return require(name); }\nconst seen = load({ name: "./lib/util.js" }).name;`,
  "two calls": `function load({ name }) { return require(name); }\nconst seen = load({ name: "./lib/util.js" }).name + " " + load({ name: "./lib/other.js" }).name;`,
};
const programs = [
  ...Object.entries(forms).map(([form, code]) => [form, `const seen = ${code};`]),
  ...Object.entries(declared),
];

test.concurrent.each(programs)(
  "%s",
  async (_, code) => {
    using dir = tempDir("aot-name-out-of-a-pattern", {
      "site/main.cjs": `(async () => {
${code}
console.log(seen);
})().catch(error => console.log(error.code ?? error.name));
// It is in the executable by a constant name.
if (process.argv.length > 9) require("./lib/other.js");
`,
      "site/lib/util.js": `exports.name = "util";`,
      "site/lib/other.js": `exports.name = "other";`,
    });
    const site = join(String(dir), "site");
    const executable = join(String(dir), nameOfExecutable);
    const run = async (cmd: string[]) => {
      await using proc = Bun.spawn({ cmd, cwd: site, env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const expected = await run([bunExe(), "main.cjs"]);
    expect(expected.stdout).toMatch(/^(util|other|util other)\n$/);
    const built = await run([bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", executable]);
    expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    renameSync(site, join(String(dir), "moved-away"));
    mkdirSync(site);
    expect(await run([executable])).toEqual(expected);
  },
  600_000,
);
