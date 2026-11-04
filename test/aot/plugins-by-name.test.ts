import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun build --compile` links a name that is written out in the call that loads, and no plugin of the run time is asked about it. Every other name it leaves to
// the run time, where a plugin answers first. `--aot` follows a name further, through a constant: that brings the file into the executable and decides nothing.
// Where no plugin answers, the compiled file does: the executables run in a folder without the files.
// One thing of the reference is not followed, on purpose: a file of an extension that nobody knows, named by a constant, that no plugin answers for. `bun run` and
// `--aot` answer with its path. `bun build --compile` runs it as JavaScript ("ReferenceError: x is not defined"), which is a fault of its own and no form of this test.
const modules: Record<string, string> = {};
for (let index = 1; index <= 12; index++) {
  modules[`lib/m${index}.js`] = `export default "the file";`;
  modules[`lib/c${index}.cjs`] = `module.exports = "the file";`;
}
const files: Record<string, string> = {
  ...modules,
  "lib/d.json": `{ "it": "the file" }`,
  "lib/t.txt": `the file`,
  "lib/x.mine": `x`,
  "main.ts": `Bun.plugin({
      name: "probe",
      setup(build) {
        build.onLoad({ filter: /lib\\/([mc]\\d\\.c?js|d\\.json|t\\.txt|x\\.mine)$/ }, () => ({ contents: 'export default "THE PLUGIN"', loader: "js" }));
        build.onResolve({ filter: /m10\\.js$/ }, args => ({ path: args.path, namespace: "ours" }));
        build.onLoad({ filter: /.*/, namespace: "ours" }, () => ({ contents: 'export default "THE NAMESPACE"', loader: "js" }));
      },
    });
    const say = (label: string, it: any) => console.log(label + ":", typeof it === "string" ? it : (it.default ?? JSON.stringify(it)));
    const yes = process.argv.length > 0;
    const held = "./lib/m5.js";
    let changing = "./lib/m6.js";
    const required = "./lib/c5.cjs";
    const folder = "./lib";
    const data = "./lib/d.json";
    const text = "./lib/t.txt";
    const unknown = "./lib/x.mine";
    const moved = "./lib/m10.js";
    const unasked = "./lib/m11.js";
    const unaskedToo = "./lib/c11.cjs";
    say("a text", await import("./lib/m1.js"));
    say("a template without substitutions", await import(\`./lib/m2.js\`));
    say("texts joined", await import("./lib/" + "m3.js"));
    say("a choice of texts", await import(yes ? "./lib/m4.js" : "./lib/m1.js"));
    say("a text in parentheses", await import(("./lib/m7.js")));
    say("a text with a type assertion", await import("./lib/m8.js" as string));
    say("require of a text", require("./lib/c1.cjs"));
    say("require of texts joined", require("./lib/" + "c3.cjs"));
    say("require of a choice", require(yes ? "./lib/c4.cjs" : "./lib/c1.cjs"));
    say("a const", await import(held));
    say("a let", await import(changing));
    say("a template with a const in it", await import(\`\${folder}/m9.js\`));
    say("require of a const", require(required));
    say("data", await import(data));
    say("a text file", await import(text));
    say("an extension that nobody knows", await import(unknown));
    say("onResolve into a namespace", await import(moved));
    say("a const that no filter matches", await import(unasked));
    say("require of a const that no filter matches", require(unaskedToo));
    say("a const, again", await import(held));`,
};
const linked = [
  "a text",
  "a template without substitutions",
  "texts joined",
  "a choice of texts",
  "a text in parentheses",
  "a text with a type assertion",
  "require of a text",
  "require of texts joined",
  "require of a choice",
];
const asked = [
  "a const",
  "a let",
  "a template with a const in it",
  "require of a const",
  "data",
  "a text file",
  "an extension that nobody knows",
];

test("a plugin of the run time is asked about the names that bun build leaves to the run time", async () => {
  using dir = tempDir("aot-plugins-by-name", files);
  using elsewhere = tempDir("aot-plugins-by-name-elsewhere", {});
  const directory = String(dir);
  const bundled = join(directory, "bundled");
  const compiled = join(String(elsewhere), "compiled");
  for (const flags of [
    ["--outfile", bundled],
    ["--aot", "--outfile", compiled],
  ]) {
    const built = await run([bunExe(), "build", "--compile", "main.ts", ...flags], directory, bunEnv);
    expect(built.exitCode).toBe(0);
  }
  const reference = await run([bundled], directory, bunEnv);
  expect(reference.stdout.trim().split("\n")).toEqual([
    ...linked.map(label => label + ": the file"),
    ...asked.map(label => label + ": THE PLUGIN"),
    "onResolve into a namespace: THE NAMESPACE",
    "a const that no filter matches: the file",
    "require of a const that no filter matches: the file",
    "a const, again: THE PLUGIN",
  ]);
  const ran = await run([compiled], String(elsewhere), bunEnv);
  expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
    stdout: reference.stdout,
    stderr: "",
    exitCode: 0,
  });
}, 240_000);

// One build of several entry points. There the build makes no further file an entry point, so the loader would not find one: the calls stay linked, and a program
// that finds its files by the names in a folder, beside one that registers a plugin, finds them as before.
test("a plugin in one entry point takes no file from another entry point", async () => {
  using dir = tempDir("aot-plugins-by-name-entry-points", {
    "with-plugin.mjs": `Bun.plugin({ name: "probe", setup(build) { build.onLoad({ filter: /never$/ }, () => ({ contents: "", loader: "js" })); } });
      console.log("registered");`,
    "commands/ping.cjs": `module.exports = "ping";`,
    "commands/pong.cjs": `module.exports = "pong";`,
    "lib/held.cjs": `module.exports = "held";`,
    "finder.cjs": `const { readdirSync } = require("node:fs");
      const { join } = require("node:path");
      const folder = join(__dirname, "commands");
      for (const name of readdirSync(folder).sort()) console.log(require(join(folder, name)));
      const held = "./lib/held.cjs";
      console.log(require(held));`,
  });
  const directory = String(dir);
  const plain = await run([bunExe(), "finder.cjs"], directory, bunEnv);
  expect(plain.stdout).toBe("ping\npong\nheld\n");
  const executable = join(directory, "program");
  const flags = ["build", "--compile", "--aot", "finder.cjs", "with-plugin.mjs", "--outfile", executable];
  const built = await run([bunExe(), ...flags], directory, bunEnv);
  expect(built.exitCode).toBe(0);
  const ran = await run([executable], directory, bunEnv);
  expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
    stdout: plain.stdout,
    stderr: "",
    exitCode: 0,
  });
}, 120_000);
