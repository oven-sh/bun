// Programs of parallel/ as test files. A test file is an ES module that the run has beside it, and the text of a function that is only called is not kept:
// what an error quotes is looked for in the file, at the place of the error. Over layers Bun's library lies in another image than the test file.
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

const project = casesOfOneRun("errors-and-frames-of-a-test-file-read-as-under-plain-bun-test", {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": "{}",
});

const textOf = (program: string) =>
  readFileSync(join(import.meta.dir, "parallel", program), "utf8").replaceAll("console.log(", "say(");

function readsAsPlain(title: string, holds: string, name: string) {
  const ways: [string, string[], string?][] = [
    ["as one program", ["--debug-aot"], "TestRunLayers:0"],
    ["over layers", ["--debug-aot"], "TestRunLayers:2"],
  ];
  test.each(ways)(`${title}, %s`, async (_, flags, words) => {
    const plain = (await project.ran()).get(name);
    expect(plain?.result).toBe("pass");
    expect(plain?.printed).toContain(holds);
    expect((await project.ran(flags, words)).get(name)).toEqual(plain);
  });
}

function programAsTestFile(title: string, holds: string, program: string) {
  const testFile = (name: string) =>
    `${sayOf(name)}\n${textOf(program)}\n;(await import("bun:test")).test("${name}", () => {});\n`;
  readsAsPlain(title, holds, project.add(testFile));
}

function typedProgramBesideTestFile(title: string, holds: string, program: string) {
  const testFile = (name: string) =>
    `import { test } from "bun:test";\nimport { run } from "./typed.ts";\n${sayOf(name)}\nrun(say);\ntest("${name}", () => {});\n`;
  const typed = `export function run(say: (...all: unknown[]) => void) {\n${textOf(program)}\n}\n`;
  readsAsPlain(title, holds, project.add(testFile, { "typed.ts": typed }));
}

programAsTestFile(
  "an error quotes what is written on one line",
  "deep: TypeError: null is not an object (evaluating 'o.p.q')",
  "errors/quoted-in-functions-that-are-only-called.js",
);
programAsTestFile(
  "an error quotes what is written over several lines",
  "the second of two chains: TypeError: undefined is not an object (evaluating 'b.first.second')",
  "errors/quoted-from-expressions-written-over-several-lines.js",
);
typedProgramBesideTestFile(
  "an error quotes what is written over several lines with types",
  "cast: TypeError: undefined is not an object (evaluating 'o.first.second')",
  "errors/quoted-from-typed-expressions-written-over-several-lines.ts",
);
programAsTestFile(
  "a stack taken while import() first loads a built-in module ends at that module",
  "at node:util (node:util:",
  "library-modules/stack-taken-dynamic-import-first-loads.mjs",
);
programAsTestFile(
  "a frame shows the new name of a static method of a class that is made more than once",
  "at renamedMethod | at renamedStatic | renamedMethod renamedStatic",
  "errors/renamed-method-of-a-class-made-more-than-once-names-its-frame.js",
);
