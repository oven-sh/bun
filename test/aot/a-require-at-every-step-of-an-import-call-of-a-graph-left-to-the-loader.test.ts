// An import() of site.mjs is under way when main.cjs requires it, behind 0 to 7 empty jobs: at every step of the load. tools.cjs requires a module of the graph that is being loaded with it,
// so the graph is left to the loader. Between two steps the record is made and the load promise is pending; the require takes the steps of the load itself and answers, as in `bun <file>`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("a require answers at every step of an import() of the same module", async () => {
  using dir = tempDir("aot-a-require-at-every-step-of-an-import-call", {
    "package.json": `{ "name": "p" }`,
    "main.cjs": `const emptyJobs = Number(process.argv[2]);
setTimeout(() => {
  import("./site.mjs").then(got => console.log("import gave", got.name));
  let turn = Promise.resolve();
  for (let i = 0; i < emptyJobs; i++) turn = turn.then(() => {});
  turn.then(() => {
    try { console.log("require gave", require("./site.mjs").name); } catch (error) { console.log("main caught", error.name); }
  });
}, 0);
`,
    "site.mjs": `import "./ring.mjs";\nexport const name = "site";\n`,
    "ring.mjs": `import "./tools.cjs";\nimport "./pages.mjs";\n`,
    "pages.mjs": `import "./ring.mjs";\n`,
    "tools.cjs": `exports.ready = true;\nrequire("./pages.mjs");\n`,
  });
  const cwd = String(dir);
  const exe = join(cwd, "compiled");
  const built = await run([bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", exe], cwd, bunEnv);
  expect(built.exitCode).toBe(0);
  for (let emptyJobs = 0; emptyJobs < 8; emptyJobs++) {
    for (const command of [[bunExe(), "main.cjs"], [exe]]) {
      const { stdout, exitCode } = await run([...command, String(emptyJobs)], cwd, bunEnv);
      expect({ emptyJobs, compiled: command[0] === exe, stdout, exitCode }).toEqual({
        emptyJobs,
        compiled: command[0] === exe,
        stdout: "require gave site\nimport gave site\n",
        exitCode: 0,
      });
    }
  }
});
