import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// The path of the file comes from the environment or holds the pid, so no build sees the file. Its text stands in the test.
// What a build finds in one file holds for the whole program: a spy on `total` opens every export of that name. So each way has a folder, a module and an export of its own.
const ways: Record<
  string,
  { module: string; name: string; imports?: string; text: string; isTemplate?: boolean; call: string }
> = {
  "it imports the module and spies on an export": {
    module: "sums",
    name: "total",
    text: `import { spyOn } from "bun:test"; import * as lib from "../sums.js"; export const spy = () => spyOn(lib, "total");`,
    call: `loaded.spy()`,
  },
  // What the run puts into the text is no value and not nothing, so the build cannot parse the text, whatever it puts there.
  "its text is a template with a name left open": {
    module: "counts",
    name: "count",
    text: `import { spyOn } from "bun:test"; import * as lib from "../counts.js"; export const spy = () => spyOn(lib, "count"); export const seen = lib.\${method}(1);`,
    isTemplate: true,
    call: `loaded.spy()`,
  },
  "it is handed the namespace object and the name": {
    module: "tallies",
    name: "tally",
    imports: `import * as lib from "./tallies.js";`,
    text: `import { spyOn } from "bun:test"; export const spy = (object, name) => spyOn(object, name);`,
    call: `loaded.spy(lib, "tally")`,
  },
};

const filesOf = ({ module, name, imports, text, isTemplate, call }: (typeof ways)[string]) => ({
  [`${module}/${module}.js`]: `export function ${name}(list) { let sum = 0; for (const item of list) sum += item; return sum; }\nexport function other(x) { return x * 2; }\n`,
  [`${module}/reader.js`]: `import { ${name}, other } from "./${module}.js";\nexport const read = () => [${name}([1, 2, 3]), other(4)];\n`,
  [`${module}/a.test.js`]: `
import { test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { read } from "./reader.js";
${imports ?? ""}
test("a spy", async () => {
  mkdirSync(import.meta.dir + "/made", { recursive: true });
  const path = import.meta.dir + "/made/spy" + process.pid + ".js";
  const method = process.env.METHOD ?? "other";
  writeFileSync(path, ${isTemplate ? "`" + text + "`" : JSON.stringify(text)});
  const before = read();
  const loaded = await import(process.env.WHERE ?? path);
  const made = ${call};
  made.mockImplementation(() => "spied");
  const under = read();
  made.mockRestore();
  console.error("SEEN ${name} " + JSON.stringify([before, under, read()]));
});
`,
});

// A spy that is told its object and its name opens every export of the program, so that way has a project of its own.
// Over layers the fault was that no layer was told what the text of a test file spies on.
const spelled = ["it imports the module and spies on an export", "its text is a template with a name left open"];
const told = ["it is handed the namespace object and the name"];
test.each([
  [spelled, "as one program", "TestRunLayers:0"],
  [told, "as one program", "TestRunLayers:0"],
])("a file that a test writes and loads by a made path: %j: %s", async (names, _, words) => {
  using dir = tempDir("aot-written-file-spies", {
    "package.json": `{ "name": "written-file-spies", "type": "module" }`,
    ...Object.assign({}, ...names.map(name => filesOf(ways[name]))),
  });
  const seenWith = async (flags: string[], words?: string) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
      ...bunEnv,
      BUN_JSC_logAOTPhaseTimes: "1",
      ...(words && { BUN_DEBUG_TEST_AOT_WORDS: words }),
    });
    const lines = (stdout + "\n" + stderr).split("\n");
    return {
      seen: lines.filter(line => line.startsWith("SEEN ") || line.includes("Cannot spy")).sort(),
      startsOver: lines.filter(line => line.startsWith("AOT build starts over")),
      exitCode,
    };
  };
  const plain = await seenWith([]);
  expect(plain).toEqual({
    seen: names.map(name => `SEEN ${ways[name].name} [[6,8],["spied",8],[6,8]]`).sort(),
    startsOver: [],
    exitCode: 0,
  });
  expect(await seenWith(["--aot"], words)).toEqual(plain);
});
