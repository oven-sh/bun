import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const nameOfExecutable = isWindows ? "executable.exe" : "executable";

// `require(require("./package.json").main)`: the name of the file is a text in a file of data that the build reads anyway.
// Each form stands alone in its program, and the sources are moved away before the executable runs.
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

test.concurrent.each(Object.entries(forms))(
  "%s",
  async (_, [extension, imports, load]) => {
    const entry = `main.${extension}`;
    using dir = tempDir("aot-name-out-of-json", {
      [`site/${entry}`]: `${imports}
let seen;
try {
  const loaded = ${load};
  seen = loaded.name ?? loaded.default?.name;
} catch (error) {
  seen = error.code ?? error.name;
}
console.log(seen);
// It is in the executable by a constant name.
if (process.argv.length > 9) require("./parts/three.js");
`,
      "site/config.json": `{ "plugin": "./parts/two.js", "short": "two", "nested": { "main": "./parts/two.js" }, "list": ["./parts/two.js"] }`,
      "site/parts/two.js": `exports.name = "two";`,
      "site/parts/three.js": `exports.name = "three";`,
    });
    const site = join(String(dir), "site");
    const executable = join(String(dir), nameOfExecutable);
    const run = async (cmd: string[]) => {
      await using proc = Bun.spawn({ cmd, cwd: site, env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const expected = await run([bunExe(), entry]);
    expect(expected.stdout).toMatch(/^(two|three)\n$/);
    const built = await run([bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", executable]);
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
