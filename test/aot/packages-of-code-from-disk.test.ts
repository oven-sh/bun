import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const counter = (name: string) => `exports.name = ${JSON.stringify(name)}; exports.count = 0;`;
const files = {
  "main.cjs": `
    const kit = require("kit"), scoped = require("@scope/kit"), tool = require("tool"), own = require("./own.cjs");
    const load = name => require(Buffer.from(__dirname + "/" + name).toString());
    globalThis.paths = { own: require.resolve("./own.cjs"), tool: require.resolve("tool/state.cjs") };
    kit.part.count = scoped.part.count = tool.state.count = own.count = 1;
    const say = (name, value) => console.log(name, JSON.stringify(value));
    for (const name of process.argv.slice(2)) {
      try { say(name, load(name)); } catch (error) { say(name, error.code); }
    }
    say("program", [kit.part.count, scoped.part.count, tool.state.count, own.count]);
  `,
  "own.cjs": counter("own"),
  // A package that a file from disk asks for by name is a second instance, with all of its files.
  "by-name.cjs": `
    const kit = require("kit"), scoped = require("@scope/kit");
    kit.part.count += 10; scoped.part.count += 10;
    module.exports = [kit.part.name, kit.part.count, kit === require(require.resolve("kit")), kit.part === require("kit/part.cjs"), scoped.part.count];
  `,
  "by-import.mjs": `
    import kit from "kit"; import scoped from "@scope/kit";
    export default [kit.part.name, scoped.part.name];
  `,
  // Its files ask for each other and for other packages.
  "by-other.cjs": `module.exports = require("other").kit;`,
  // The program's own files are refused, and so are those of a package that nothing from disk has asked for by name.
  "by-path.cjs": `module.exports = require(globalThis.paths.own).name;`,
  "by-relative.cjs": `module.exports = require("./own.cjs").name;`,
  "by-path-of-package.cjs": `module.exports = require(globalThis.paths.tool).name;`,
  "node_modules/kit/package.json": `{ "name": "kit", "main": "index.cjs" }`,
  "node_modules/kit/index.cjs": `exports.part = require("./part.cjs");`,
  "node_modules/kit/part.cjs": counter("kit part"),
  "node_modules/@scope/kit/package.json": `{ "name": "@scope/kit", "main": "lib/index.cjs" }`,
  "node_modules/@scope/kit/lib/index.cjs": `exports.part = require("../part.cjs");`,
  "node_modules/@scope/kit/part.cjs": counter("scoped part"),
  "node_modules/other/package.json": `{ "name": "other", "main": "index.cjs" }`,
  "node_modules/other/index.cjs": `exports.kit = require("kit").part.name + " of other";`,
  "node_modules/tool/package.json": `{ "name": "tool", "main": "index.cjs" }`,
  "node_modules/tool/index.cjs": `exports.state = require("./state.cjs");`,
  "node_modules/tool/state.cjs": counter("state"),
  // A part that the program itself loads by its path belongs to the program's instance.
  "node_modules/tool/late.cjs": `module.exports = require("./state.cjs").name;`,
};

let directory: string;
let outfile: string;
let kept: ReturnType<typeof tempDir> | undefined;
async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
beforeAll(async () => {
  kept = tempDir("aot-packages-of-code-from-disk", files);
  directory = String(kept);
  outfile = join(directory, "program");
  const flags = ["build", "--compile", "--aot", "--aot-allow-code-from-disk", "main.cjs", "--outfile", outfile];
  const built = await run([bunExe(), ...flags], directory);
  if (built.exitCode !== 0) throw new Error(built.stderr);
});
afterAll(() => kept?.[Symbol.dispose]());

const answers: [string, string, string][] = [
  ["by-name.cjs", `["kit part",10,true,true,10]`, "[1,1,1,1]"],
  ["by-import.mjs", `{"default":["kit part","scoped part"]}`, "[1,1,1,1]"],
  ["by-other.cjs", `"kit part of other"`, "[1,1,1,1]"],
  ["by-path.cjs", `"MODULE_NOT_FOUND"`, "[1,1,1,1]"],
  ["by-relative.cjs", `"MODULE_NOT_FOUND"`, "[1,1,1,1]"],
  ["by-path-of-package.cjs", `"MODULE_NOT_FOUND"`, "[1,1,1,1]"],
  ["node_modules/tool/late.cjs", `"MODULE_NOT_FOUND"`, "[1,1,1,1]"],
];
test.concurrent.each(answers)("%s", async (name, answer, program) => {
  const { stdout, exitCode } = await run([outfile, name], directory);
  expect(stdout).toBe(`${name} ${answer}\nprogram ${program}\n`);
  expect(exitCode).toBe(0);
});
