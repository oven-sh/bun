import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// main.cjs requires an ES module. The CommonJS files that the modules below it import run in the order of the imports, however often and from wherever a file is asked for.
// Each program is held against `bun main.cjs` in the same folder.
const graphs: Record<string, { imports: Record<string, string[]>; said: string }> = {
  "each file is asked for once": {
    imports: { m0: ["m1", "m2"], m1: ["m3"], m2: ["c2"], m3: ["c1"] },
    said: "c1 m3 m1 c2 m2 m0",
  },
  "a module is imported twice": {
    imports: { m0: ["m1", "m2"], m1: ["m2", "c1"], m2: ["c2"] },
    said: "c2 m2 c1 m1 m0",
  },
  "a CommonJS file is imported twice": {
    imports: { m0: ["m1", "m2"], m1: ["c1", "c3"], m2: ["c2", "c3"] },
    said: "c1 c3 m1 c2 m2 m0",
  },
  "a module imports the root, so it waits for the files below the root, and so does what follows it": {
    imports: { m0: ["m1", "m2", "m3"], m1: ["c1", "m0"], m2: ["c2"], m3: ["c3"] },
    said: "c1 c2 c3 m1 m2 m3 m0",
  },
  "a module on a ring is asked for three times": {
    imports: { m0: ["m1", "m4", "m3"], m1: ["m3"], m3: ["c1", "m0"], m4: ["c2", "m1"] },
    said: "c1 c2 m3 m1 m4 m0",
  },
};

function filesOf(imports: Record<string, string[]>) {
  const pathOf = (name: string) => `./${name}.${name[0] === "m" ? "mjs" : "cjs"}`;
  const files: Record<string, string> = { "main.cjs": `require("./m0.mjs");\nconsole.log("main ends");\n` };
  for (const [name, imported] of Object.entries(imports)) {
    files[pathOf(name)] = imported.map(to => `import "${pathOf(to)}";\n`).join("") + `console.log("${name}");\n`;
    for (const to of imported) if (to[0] === "c") files[pathOf(to)] = `console.log("${to}");\nmodule.exports = 1;\n`;
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
  const { plain, compiled } = await answersOf(filesOf(graphs[name].imports));
  expect(plain).toEqual({ stdout: graphs[name].said.replaceAll(" ", "\n") + "\nmain ends\n", exitCode: 0 });
  expect(compiled).toEqual(plain);
});

test("a require() that leads back up closes no ring of imports", async () => {
  const { plain, compiled } = await answersOf({
    "main.cjs": `require("./root.mjs");\nconsole.log("main ends");\n`,
    "root.mjs": `import "./a.mjs";\nimport "./b.mjs";\nconsole.log("root");\n`,
    "a.mjs": `import "./b.mjs";\nimport "./ca.cjs";\nconsole.log("a");\n`,
    "b.mjs": `import "./cb.cjs";\nconsole.log("b");\nglobalThis.later = () => import.meta.require("./a.mjs");\n`,
    "ca.cjs": `console.log("ca");\n`,
    "cb.cjs": `console.log("cb");\n`,
  });
  expect(plain).toEqual({ stdout: "cb\nb\nca\na\nroot\nmain ends\n", exitCode: 0 });
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
