// `require(new Map([["two", "./parts/two.js"]]).get(key))`, `require((class { static file = "./parts/two.js"; }).file)`: the name of the file is
// no constant, and the build did not follow it: the executable held no such file and said MODULE_NOT_FOUND where `bun run` loads it. An object that
// is written where it is asked is in nobody else's hands, so what it holds is what is written.
// Each form has an executable of its own: beside another form that names the folder, the file would be there anyway.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const followed = {
  "a static field": `require((class { static file = "./parts/two.js"; }).file)`,
  "a field": `require(new (class { name = "./parts/two.js"; })().name)`,
  "a field beside a method and another field": `require(new (class { first = 1; name = "./parts/two.js"; other() { return this.first; } })().name)`,
  "a Map by a constant key": `require(new Map([["one", "./parts/one.js"], ["two", "./parts/two.js"]]).get("two"))`,
  "a Map, the later of two entries": `require(new Map([["two", "./parts/one.js"], ["two", "./parts/two.js"]]).get("two"))`,
  "a Map by a key that the run makes": `require(new Map([["two", "./parts/two.js"]]).get(process.argv[2] ?? "two"))`,
};
// Code runs between what is written and what is read. The build may give up on these. It may not take the file that is written.
const notAsWritten = {
  "a constructor stores another name": `require(new (class { name = "./parts/one.js"; constructor() { this.name = "./parts/two.js"; } })().name)`,
  "a static block stores another name": `require((class { static file = "./parts/one.js"; static { this.file = "./parts/two.js"; } }).file)`,
  "a later field stores another name": `require(new (class { name = "./parts/one.js"; later = (this.name = "./parts/two.js"); })().name)`,
  "the class inherits a setter": `require(new (class extends (class { constructor() { return { name: "./parts/two.js" }; } }) { })().name)`,
  "a getter": `require((class { static get file() { return "./parts/two.js"; } }).file)`,
  "a Map of the file's own": `((Map) => require(new Map([["two", "./parts/one.js"]]).get("two")))(class { get() { return "./parts/two.js"; } })`,
};

async function answers(code: string) {
  using dir = tempDir("aot-name-out-of-an-object-written-there", {
    "parts/one.js": `exports.name = "one";\n`,
    "parts/two.js": `exports.name = "two";\n`,
    "main.js": `let loaded; try { loaded = ${code}; console.log(loaded.name); } catch (error) { console.log(error.code ?? error.name); }\n`,
  });
  const plain = await run([bunExe(), "main.js"], String(dir), bunEnv);
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--outfile", executable, "main.js"],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  renameSync(join(String(dir), "parts"), join(String(dir), "moved-away"));
  const compiled = await run([executable], String(dir), bunEnv);
  return { plain: plain.stdout.trim(), compiled: compiled.stdout.trim() };
}

test.concurrent.each(Object.entries(followed))(
  "%s",
  async (_, code) => {
    expect(await answers(code)).toEqual({ plain: "two", compiled: "two" });
  },
  120_000,
);

test.concurrent.each(Object.entries(notAsWritten))(
  "not as written: %s",
  async (_, code) => {
    expect(await answers(code)).toEqual({ plain: "two", compiled: expect.stringMatching(/^(two|MODULE_NOT_FOUND)$/) });
  },
  120_000,
);
