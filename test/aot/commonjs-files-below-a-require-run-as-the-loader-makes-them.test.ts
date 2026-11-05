import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// main.cjs requires an ES module. The CommonJS files that the modules below it import run while the graph is loaded, in front of every module's body, in the order in which Bun's loader makes their
// records. That order is fixed while a require() drains the loader's queue, and it is not breadth first: a file that is asked for a second time before its text has settled overtakes what was asked
// for in front of it, and one that is asked for a third time is made on the spot. The build laid them breadth first, so a file ran before the one that it needs.
// Each program is held against `bun main.cjs` in the same folder.
const graphs: Record<string, Record<string, string[]>> = {
  "each file is asked for once: level by level": { m0: ["m1", "m2"], m1: ["m3"], m2: ["c2"], m3: ["c1"] },
  "what a module that is imported twice imports runs in front": { m0: ["m1", "m2"], m1: ["m2", "c1"], m2: ["c2"] },
  "a CommonJS file that is imported twice runs in front": { m0: ["m1", "m2"], m1: ["c1", "c3"], m2: ["c2", "c3"] },
};

function filesOf(imports: Record<string, string[]>) {
  const pathOf = (name: string) => `./${name}.${name[0] === "m" ? "mjs" : "cjs"}`;
  const files: Record<string, string> = { "main.cjs": `require("./m0.mjs");\nconsole.log("main ends");\n` };
  for (const [name, imported] of Object.entries(imports)) {
    files[pathOf(name)] = imported.map(to => `import "${pathOf(to)}";\n`).join("") + `console.log("${name}");\n`;
    for (const to of imported) if (to[0] === "c") files[pathOf(to)] = `console.log("${to}");\n`;
  }
  return files;
}

async function answersOf(files: Record<string, string>) {
  using dir = tempDir("aot-commonjs-files-below-a-require", files);
  const executable = join(String(dir), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.cjs"], String(dir), bunEnv);
  const built = await run([bunExe(), ...compileCommand, "main.cjs", "--outfile", executable], String(dir), bunEnv);
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], String(dir), bunEnv);
  return {
    plain: { stdout: plain.stdout, exitCode: plain.exitCode },
    compiled: { stdout: compiled.stdout, exitCode: compiled.exitCode },
  };
}

test.each(Object.keys(graphs))("%s", async name => {
  const { plain, compiled } = await answersOf(filesOf(graphs[name]));
  expect(plain.stdout).toEndWith("m0\nmain ends\n");
  expect(compiled).toEqual(plain);
});

test("a file that needs what the file imported in front of it lays down", async () => {
  const { plain, compiled } = await answersOf({
    "main.cjs": `require("./index.mjs");\nconsole.log("main ends");\n`,
    "index.mjs": `import "./b.mjs";\nimport "./c.mjs";\n`,
    "b.mjs": `import "./c.mjs";\nimport "./f.cjs";\n`,
    "c.mjs": `import "./e.cjs";\n`,
    "e.cjs": `globalThis.helper = () => 5;\n`,
    "f.cjs": `console.log("f gets " + helper());\n`,
  });
  expect(plain).toEqual({ stdout: "f gets 5\nmain ends\n", exitCode: 0 });
  expect(compiled).toEqual(plain);
});
