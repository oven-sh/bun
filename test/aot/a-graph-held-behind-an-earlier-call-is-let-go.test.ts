import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { counted, countingIn } from "./harness/held-graphs";
import { run } from "./harness/run";
import { test } from "./supported";

// `import("./pages.mjs")`, three jobs later `import("./menu.mjs")`: menu.mjs imports into the ring of pages.mjs and layout.mjs. Its graph is loaded first, and is held until that of pages.mjs is loaded.
// A graph that is held and never let go is an import() that never settles: however the earlier graph ends, as many are let go as were held.
// The lines are those of Node.js. `bun main.mjs` reads the texts on other threads, and on a busy machine some of its runs enter the ring elsewhere: no run of it is held here.
const main = (first: string) => `const ran = [], settled = [];
globalThis.say = word => ran.push(word);
const note = (name, call) => call.then(() => settled.push(name + "+"), () => settled.push(name + "!"));
note("pages", import("./${first}"));
await null; await null; await null;
note("menu", import("./menu.mjs"));
for (let turn = 0; turn < 20; turn++) await new Promise(done => setImmediate(done));
console.log(ran.join(" ") + " | " + settled.join(" "));
`;
const ring = {
  "layout.mjs": `import "./pages.mjs";\nimport "./deep.mjs";\nsay("layout");\n`,
  "deep.mjs": `say("deep");\n`,
  "menu.mjs": `import "./layout.mjs";\nsay("menu");\n`,
};
const cases = [
  ["runs", `import "./layout.mjs";\nsay("pages");\n`, "deep layout pages menu | pages+ menu+"],
  ["throws", `import "./layout.mjs";\nsay("pages");\nthrow new Error("pages");\n`, "deep layout pages | pages! menu!"],
  ["waits for ever", `import "./layout.mjs";\nsay("pages");\nawait new Promise(() => {});\n`, "deep layout pages | "],
] as const;

test.concurrent.each(cases)("the earlier graph %s", async (_, pages, printed) => {
  using dir = tempDir("aot-held-graphs", { "main.mjs": main("pages.mjs"), "pages.mjs": pages, ...ring });
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "compiled.exe"], cwd);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const compiled = await run([join(cwd, "compiled.exe")], cwd, countingIn(cwd));
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: printed + "\n", exitCode: 0 });
  expect({
    held: counted(cwd, "GraphsDeferredForImports"),
    letGo: counted(cwd, "DeferredGraphsResumed"),
  }).toEqual({
    held: 1,
    letGo: 1,
  });
});
