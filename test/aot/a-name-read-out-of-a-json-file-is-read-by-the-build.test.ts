import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const nameOfExecutable = isWindows ? "executable.exe" : "executable";

// `require(require("./package.json").main)`: the name of the file is a text in a file of data that the build reads anyway.
// One executable. Each form is a file in a folder of its own, with its own file of data and its own files to load, so none brings along what another asks for.
// The sources are moved away before the executable runs.
const forms: Record<string, [extension: string, imports: string, load: string]> = {
  "require().plugin": ["cjs", "", `require(require("./config.json").plugin)`],
  "nested": ["cjs", "", `require(require("./config.json").nested.main)`],
  "in a list": ["cjs", "", `require(require("./config.json").list[0])`],
  "held in a const": ["cjs", `const config = require("./config.json");`, `require(config.plugin)`],
  "a pattern": ["cjs", `const { plugin } = require("./config.json");`, `require(plugin)`],
  "in a function": [
    "cjs",
    "",
    `(function () { const config = require("./config.json"); return require(config.plugin); })()`,
  ],
  "in a method": ["cjs", "", `new (class { load() { return require(require("./config.json").plugin); } })().load()`],
  "in a field": ["cjs", "", `new (class { loaded = require(require("./config.json").plugin); })().loaded`],
  "put together with more": ["cjs", "", `require("./parts/" + require("./config.json").short + ".js")`],
  "import { plugin }": ["mjs", `import { plugin } from "./config.json";`, `await import(plugin)`],
  "import config": ["mjs", `import config from "./config.json";`, `await import(config.plugin)`],
  "import config, nested": ["mjs", `import config from "./config.json";`, `await import(config.nested.main)`],
  "import * as": ["mjs", `import * as config from "./config.json";`, `await import(config.plugin)`],
  "import * as, .default": ["mjs", `import * as config from "./config.json";`, `await import(config.default.plugin)`],
  "with { type: 'json' }": [
    "mjs",
    `import config from "./config.json" with { type: "json" };`,
    `await import(config.plugin)`,
  ],
  "import config, require()": ["mjs", `import config from "./config.json";`, `require(config.plugin)`],
  // The value is another when the program runs: the call asks for what is there then.
  "changed before it is read": [
    "cjs",
    `require("./config.json").plugin = "./parts/three.js";`,
    `require(require("./config.json").plugin)`,
  ],
};

const names = Object.keys(forms);
const files: Record<string, string> = {
  "site/main.mjs": names.map((name, index) => `await import("./form${index}/main.${forms[name][0]}");\n`).join(""),
};
names.forEach((name, index) => {
  const [extension, imports, load] = forms[name];
  files[`site/form${index}/main.${extension}`] = `${imports}
let seen;
try {
  const loaded = ${load};
  seen = loaded.name ?? loaded.default?.name;
} catch (error) {
  seen = error.code ?? error.name;
}
console.log(${JSON.stringify(name + ":")}, seen);
// It is in the executable by a constant name.
if (process.argv.length > 9) require("./parts/three.js");
`;
  files[`site/form${index}/config.json`] =
    `{ "plugin": "./parts/two.js", "short": "two", "nested": { "main": "./parts/two.js" }, "list": ["./parts/two.js"] }`;
  files[`site/form${index}/parts/two.js`] = `exports.name = "two";`;
  files[`site/form${index}/parts/three.js`] = `exports.name = "three";`;
});

let ran: Promise<{ plain: string[]; compiled: string[] }> | undefined;
const bothRuns = () =>
  (ran ??= (async () => {
    using dir = tempDir("aot-name-out-of-json", files);
    const site = join(String(dir), "site");
    const executable = join(String(dir), nameOfExecutable);
    const run = async (cmd: string[]) => {
      await using proc = Bun.spawn({ cmd, cwd: site, env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const plain = await run([bunExe(), "main.mjs"]);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const built = await run([bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable]);
    expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    renameSync(site, join(String(dir), "moved-away"));
    mkdirSync(site);
    const compiled = await run([executable]);
    expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return { plain: plain.stdout.split("\n"), compiled: compiled.stdout.split("\n") };
  })());

test.each(names)(
  "%s",
  async name => {
    const { plain, compiled } = await bothRuns();
    const said = (lines: string[]) => lines.filter(line => line.startsWith(name + ": "));
    expect(said(plain)).toEqual([expect.stringMatching(/: (two|three)$/)]);
    expect(said(compiled)).toEqual(said(plain));
  },
  600_000,
);
