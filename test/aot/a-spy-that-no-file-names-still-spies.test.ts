import { expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// Each way is a folder of its own, with its own files: what one file spies on is open for all the others.
// No file spells `spyOn` beside `bun:test`, or `Bun.jest`, so the build has to follow the values.
const ways: Record<string, { imports?: string; spy: string }> = {
  "Bun.jest under a name that is made at run time": {
    spy: `return Bun[["je", "st"].join("")](import.meta.path).spyOn(lib, "total");`,
  },
  "Bun under a name that is made at run time": {
    spy: `return globalThis[["B", "un"].join("")].jest(import.meta.path).spyOn(lib, "total");`,
  },
  "Bun.jest by Reflect.get": {
    spy: `return Reflect.get(Bun, "jest")(import.meta.path).spyOn(lib, "total");`,
  },
  "Bun is handed to a helper": {
    imports: `import { toolsOf } from "./tools.js";`,
    spy: `return toolsOf(Bun, import.meta.path).spyOn(lib, "total");`,
  },
  "the helper makes the name": {
    imports: `import { spyBy } from "./tools.js";`,
    spy: `return spyBy(["je", "st"].join(""), import.meta.path, lib, "total");`,
  },
  "the name of the spy is made too": {
    spy: `return Bun[["je", "st"].join("")](import.meta.path)[["spy", "On"].join("")](lib, "total");`,
  },
  "jest.spyOn of what it answers": {
    spy: `return Bun[["je", "st"].join("")](import.meta.path).jest.spyOn(lib, "total");`,
  },
  "the name of the export is made too": {
    spy: `return Bun[["je", "st"].join("")](import.meta.path).spyOn(lib, ["to", "tal"].join(""));`,
  },
  "the spy waits in a list": {
    spy: `const steps = []; steps.push(Bun[["je", "st"].join("")](import.meta.path).spyOn); return steps.pop()(lib, "total");`,
  },
  "the namespace object lies on the global object": {
    spy: `globalThis.kept = lib; return Bun[["je", "st"].join("")](import.meta.path).spyOn(globalThis.kept, "total");`,
  },
  "text from a file is handed the namespace object": {
    spy: `return new Function("ns", "path", textOf("operand"))(lib, import.meta.path);`,
  },
  "text from a file is handed it as the second operand": {
    spy: `return new Function("path", "ns", textOf("operand"))(import.meta.path, lib);`,
  },
  "text from a file is handed it in an object": {
    spy: `return new Function("held", "path", textOf("member"))({ module: lib }, import.meta.path);`,
  },
  "text from a file takes it off the global object": {
    spy: `globalThis.kept = lib; return new Function("path", textOf("global"))(import.meta.path);`,
  },
  "a built-in function calls text from a file": {
    spy: `globalThis.path = import.meta.path; return [lib].map(new Function("ns", textOf("operand")))[0];`,
  },
  "eval of text from a file sees the variable": {
    spy: `const ns = lib, path = import.meta.path; return eval("(() => {" + textOf("operand") + "})()");`,
  },
  "node:vm runs the text": {
    imports: `import vm from "node:vm";`,
    spy: `return vm.runInThisContext("(ns, path) => {" + textOf("operand") + "}")(lib, import.meta.path);`,
  },
};

const testFile = (way: { imports?: string; spy: string }) => `
import { test } from "bun:test";
import { readFileSync } from "node:fs";
import * as lib from "./lib.js";
import { read } from "./reader.js";
${way.imports ?? ""}
const textOf = name => readFileSync(import.meta.dir + "/" + name + ".txt", "utf8");
test("a spy", async () => {
  let said;
  try {
    const before = read();
    const made = await (async () => { ${way.spy} })();
    made.mockImplementation(() => "spied");
    const under = read();
    made.mockRestore();
    said = [before, under, read()];
  } catch (error) {
    said = error.name + ": " + String(error.message).slice(0, 60);
  }
  console.error("SEEN " + JSON.stringify(said));
});
`;

// The words by which a way reaches the runner. A build notes once, for all its files, that a spy may be where nobody
// sees it. From then on every module is open whose namespace object a file hands to a callee nobody knows. So only the
// ways with the same words are the folders of one project, which is built once: beside a way with other words, a way
// whose own words no longer made the build note that would still pass.
const reachedBy = [
  `Bun[["je", "st"].join("")](import.meta.path)`,
  `globalThis[["B", "un"].join("")]`,
  `Reflect.get(Bun, "jest")`,
  `toolsOf(Bun, import.meta.path)`,
  `spyBy(["je", "st"].join(""), import.meta.path`,
  `new Function(`,
  `eval(`,
  `vm.runInThisContext(`,
];
function wordsOf(name: string) {
  const found = reachedBy.filter(words => ways[name].spy.includes(words));
  if (found.length !== 1) throw new Error(`"${name}" has ${found.length} of the words of reachedBy. It needs one.`);
  return found[0];
}
const projects = Map.groupBy(Object.keys(ways), wordsOf);
const folderOf = (name: string) => name.replace(/\W+/g, "-");
// `total` of each folder begins at a number of its own: a file that got the module of another folder says so.
const beginOf = (name: string) => 1 + Object.keys(ways).indexOf(name);

// A folder of every project. It spies on nothing, and its namespace object goes only to a callee that the build knows:
// the build leaves its exports closed. One that opened them would let a way pass that it did not follow.
const nobodySpies = `
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";
const namesOf = object => Object.keys(object);
test("no spy", () => {
  console.error("SEEN " + JSON.stringify([read(), namesOf(lib)]));
});
`;

const filesOf = (text: string, begin: number) => ({
  "lib.js": `export function sumOf(pair) { return pair.x + pair.y; }\nexport function total(list) { let sum = ${begin}; for (const item of list) sum += item; return sum; }\n`,
  "reader.js": `import { sumOf, total } from "./lib.js";\nexport const read = () => [sumOf({ x: 1, y: 2 }), total([1, 2, 3])];\n`,
  "tools.js": `export const toolsOf = (holder, path) => holder.jest(path);\nexport const spyBy = (name, path, object, key) => Bun[name](path).spyOn(object, key);\n`,
  "operand.txt": `return Bun.jest(path).spyOn(ns, "total")`,
  "member.txt": `return Bun.jest(path).spyOn(held.module, "total")`,
  "global.txt": `return Bun.jest(path).spyOn(kept, "total")`,
  "a.test.js": text,
});

/** `bun test <flags>` in a project: the lines under each test file, by its folder, and those under none. No times. */
async function ranWith(project: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], project, env);
  // A build logs before the first test file runs.
  const report = stderr.slice(Math.max(stderr.search(/^.+\.test\.js:$/m), 0));
  const said: Record<string, string[]> = {};
  const ended: string[] = [];
  for (const block of normalizeBunSnapshot(report).split("\n\n")) {
    const lines = block.split("\n");
    const folder = /^(.+)\/a\.test\.js:$/.exec(lines[0])?.[1];
    if (folder) said[folder] = lines.slice(1);
    else ended.push(...lines);
  }
  // How many exports spies may replace, once the build has started over for the last time.
  const opened = [...stderr.matchAll(/^AOT build starts over \| in all: replaced exports \d+ > (\d+) /gm)].at(-1)?.[1];
  return { stdout: normalizeBunSnapshot(stdout), said, ended, opened: opened ? Number(opened) : undefined, exitCode };
}

const runs = new Map<string, ReturnType<typeof ranBoth>>();
async function ranBoth(words: string) {
  const folders: Record<string, ReturnType<typeof filesOf>> = { "nobody-spies": filesOf(nobodySpies, 0) };
  for (const name of projects.get(words)!) folders[folderOf(name)] = filesOf(testFile(ways[name]), beginOf(name));
  using dir = tempDir("aot-spy-that-no-file-names", {
    "package.json": `{ "name": "spy-that-no-file-names", "type": "module" }`,
    ...folders,
  });
  // Both runs end before the folder goes, also where one of them throws.
  const [plain, compiled] = [ranWith(String(dir)), ranWith(String(dir), "--aot")];
  await Promise.allSettled([plain, compiled]);
  return { plain: await plain, compiled: await compiled };
}
/** A project runs once, for all the tests that ask. */
const ranProject = (words: string) => runs.getOrInsertComputed(words, ranBoth);

// These come before the tests of the ways: each starts the runs of one project. The ways of a project all wait for the
// same build, and as many of them as may run at once would keep the next project from starting.
test.concurrent.each([...projects])(
  "the build of the ways with %s opens what they spy on and nothing else",
  async (words, names) => {
    const { plain, compiled } = await ranProject(words);
    const files = names.length + 1;
    const besideWays = (ran: typeof plain) => ({ ...ran, said: ran.said["nobody-spies"] });
    expect(besideWays(plain)).toEqual({
      stdout: "bun test <version> (<revision>)",
      said: [`SEEN [[3,6],["sumOf","total"]]`, "(pass) no spy"],
      ended: [` ${files} pass`, " 0 fail", `Ran ${files} tests across ${files} files.`],
      opened: undefined,
      exitCode: 0,
    });
    // Both exports of each way: whoever is handed a namespace object may spy under any name. None of the folder that
    // spies on nothing.
    expect(besideWays(compiled)).toEqual({ ...besideWays(plain), opened: 2 * names.length });
  },
);

test.concurrent.each(Object.keys(ways))("%s", async name => {
  const { plain, compiled } = await ranProject(wordsOf(name));
  const total = 6 + beginOf(name);
  expect(plain.said[folderOf(name)]).toEqual([`SEEN [[3,${total}],[3,"spied"],[3,${total}]]`, "(pass) a spy"]);
  expect(compiled.said[folderOf(name)]).toEqual(plain.said[folderOf(name)]);
});
