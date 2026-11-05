import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun build --compile` links a name that is written out in the call that loads, and no plugin of the run time is asked about it. Every other name it leaves to
// the run time, where a plugin answers first. `--aot` follows a name further, through a constant, a choice or a text with a hole: that brings the files into the executable and decides nothing.
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
    const chosen = yes ? "./lib/c6.cjs" : "./lib/c7.cjs";
    const requiredChoice = yes ? "./lib/c8.cjs" : "./lib/c9.cjs";
    const unaskedChoice = yes ? "./lib/m12.js" : "./lib/m11.js";
    const digit = [2][JSON.parse("0")];
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
    say("a choice behind a const", await import(chosen));
    say("require of a choice behind a const", require(requiredChoice));
    say("a text with a hole", await import("./lib/c" + digit + ".cjs"));
    say("onResolve into a namespace", await import(moved));
    say("a const that no filter matches", await import(unasked));
    say("require of a const that no filter matches", require(unaskedToo));
    say("a choice that no filter matches", await import(unaskedChoice));
    say("a text with a hole that no filter matches", await import(\`./lib/m1\${digit}.js\`));
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
  "a choice behind a const",
  "require of a choice behind a const",
  "a text with a hole",
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
    "a choice that no filter matches: the file",
    "a text with a hole that no filter matches: the file",
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

// What a package.json or a tsconfig.json makes of a name is written down in the executable for the files that a name behind a choice may lead to, so such a name is left
// to the loader too. `bun build --compile` follows no such name and its executable finds no package where no plugin answers: the reference is `bun <file>`.
test("a plugin is asked about the name of a package behind a choice, and the executable finds the package where none answers", async () => {
  using dir = tempDir("aot-plugins-by-name-packages", {
    "package.json": `{ "name": "program", "type": "module" }`,
    "tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["./src/*"] } } }`,
    "src/inner/part.mjs": `export default "the file behind the alias";`,
    "node_modules/kit-a/package.json": `{ "name": "kit-a", "version": "1.0.0", "main": "start.js", "type": "module" }`,
    "node_modules/kit-a/start.js": `export default "package a";`,
    "node_modules/kit-a/sub.js": `export default "package a, sub";`,
    "node_modules/kit-b/package.json": `{ "name": "kit-b", "version": "1.0.0", "main": "start.js" }`,
    "node_modules/kit-b/start.js": `module.exports = "package b";`,
    "node_modules/@scope/kit-c/package.json": `{ "name": "@scope/kit-c", "version": "1.0.0", "type": "module", "exports": { ".": "./lib/main.js", "./tool": "./lib/tool.js" } }`,
    "node_modules/@scope/kit-c/lib/main.js": `export default "package c";`,
    "node_modules/@scope/kit-c/lib/tool.js": `export default "package c, tool";`,
    "main.mjs": `Bun.plugin({
        name: "swap",
        setup(build) {
          build.onResolve({ filter: /^kit-a$/ }, args => ({ path: args.path, namespace: "swapped" }));
          build.onLoad({ filter: /.*/, namespace: "swapped" }, args => ({ contents: "export default " + JSON.stringify("THE PLUGIN for " + args.path), loader: "js" }));
        },
      });
      const many = process.argv.length > 5;
      const asked = many ? "kit-b" : "kit-a";
      const main = many ? "kit-a" : "kit-b";
      const scoped = many ? "kit-a" : "@scope/kit-c";
      const tool = many ? "kit-a" : "@scope/kit-c/tool";
      const sub = many ? "kit-b" : "kit-a/sub.js";
      const alias = many ? "kit-a" : "~/inner/part.mjs";
      for (const name of [asked, main, scoped, tool, sub, alias]) console.log(name + ":", (await import(name)).default);
      console.log("required:", require(asked).default, require(main), import.meta.require(scoped).default);
      console.log("the same modules:", (await import(scoped)) === (await import("@scope/kit-c")), require(main) === require("kit-b"), (await import(alias)) === (await import("./src/inner/part.mjs")));`,
  });
  using elsewhere = tempDir("aot-plugins-by-name-packages-elsewhere", {});
  const directory = String(dir);
  const plain = await run([bunExe(), "main.mjs"], directory, bunEnv);
  expect(plain.stdout.trim().split("\n")).toEqual([
    "kit-a: THE PLUGIN for kit-a",
    "kit-b: package b",
    "@scope/kit-c: package c",
    "@scope/kit-c/tool: package c, tool",
    "kit-a/sub.js: package a, sub",
    "~/inner/part.mjs: the file behind the alias",
    "required: THE PLUGIN for kit-a package b package c",
    "the same modules: true true true",
  ]);
  const executable = join(String(elsewhere), "program");
  const flags = ["build", "--compile", "--aot", "main.mjs", "--outfile", executable];
  const built = await run([bunExe(), ...flags], directory, bunEnv);
  expect(built.exitCode).toBe(0);
  const ran = await run([executable], String(elsewhere), bunEnv);
  expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
    stdout: plain.stdout,
    stderr: "",
    exitCode: 0,
  });
}, 120_000);
