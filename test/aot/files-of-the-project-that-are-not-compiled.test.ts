import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// A project's tsconfig.json includes files that the program never imports: tests, scripts, other programs. The build reads the top
// level of such a file alone, and the whole file once a file that it compiles or checks refers to it.

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    jsx: "preserve",
    noEmit: true,
    strict: true,
  },
  include: ["*.ts", "*.tsx"],
});

async function run(cwd: string, ...cmd: string[]) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

async function buildAndRun(name: string, files: Record<string, string>) {
  using dir = tempDir(name, { "tsconfig.json": tsconfig, ...files });
  const executable = join(String(dir), "program");
  const built = await run(String(dir), bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable);
  expect({ stderr: built.stderr, exitCode: built.exitCode, signalCode: built.signalCode }).toEqual({
    stderr: expect.not.stringContaining("error"),
    exitCode: 0,
    signalCode: null,
  });
  return await run(String(dir), executable);
}

test("a type that is inferred from the body of a function in a file that is imported for its types alone", async () => {
  const ran = await buildAndRun("aot-types-from-bodies", {
    "main.ts": `import type { Made } from "./types";\nconst made: Made = { width: 2, name: "a" };\nconsole.log(made.width + 1, made.name);\n`,
    "types.ts": [
      `import { twice } from "./helper";`,
      'export function make() { const text = "}"; const pattern = /[}]/; return { width: twice(text.length), name: `${pattern.source}}` }; }',
      `export type Made = ReturnType<typeof make>;`,
      ``,
    ].join("\n"),
    "helper.ts": `export function twice(n: number) { if (n > 1) { return n * 2; } return n; }\n`,
  });
  expect(ran).toEqual({ stdout: "3 a\n", stderr: "", exitCode: 0, signalCode: null });
}, 120_000);

test("a file that only the body of a function in a file that nobody imports loads is part of the project", async () => {
  const ran = await buildAndRun("aot-import-in-a-body", {
    "main.ts": `globalThis.declaredElsewhere = 5;\nconsole.log(declaredElsewhere + 1);\n`,
    "nobody-imports-this.ts": `export function load() { if (Math.random() > 2) { return import("./outside/adds-a-global"); } }\n`,
    "outside/adds-a-global.ts": `export {};\ndeclare global { var declaredElsewhere: number; }\n`,
  });
  expect(ran).toEqual({ stdout: "6\n", stderr: "", exitCode: 0, signalCode: null });
}, 120_000);

test("what stands in the bodies of functions in files that nobody imports", async () => {
  const ran = await buildAndRun("aot-bodies-nobody-reads", {
    "main.ts": `import { a } from "./a";\nconsole.log(a);\n`,
    "a.ts": `export const a: number = 1;\n`,
    "braces.ts":
      'import { a } from "./a";\nexport function f() { const s = \'}\' + "{" + `}${a}{${`{`}`; /* } */ // }\n return /[/}]\\}/.test(s) ? (a) / 2 : a++ / 2; }\nexport const after = 1;\n',
    "members.ts": `import { a } from "./a";\nexport class C { #p = a; m() { return () => { return { b: { c: this.#p } }; }; } get g() { return 1; } static { a; } }\nexport const after = () => { return a; };\n`,
    "tags.tsx": `import { a } from "./a";\ndeclare namespace JSX { interface IntrinsicElements { p: {}; } }\nexport function f() { return <p>don't {a} http://x }</p>; }\nexport const after = 1;\n`,
    "broken.ts": `import { a } from "./a";\nexport function f() { return a + ); }\nexport const after = 1;\n`,
    "never-closed.ts": `import { a } from "./a";\nexport function f() { return a;\n`,
  });
  expect(ran).toEqual({ stdout: "1\n", stderr: "", exitCode: 0, signalCode: null });
}, 120_000);

test("what a file that nobody imports names at its head, and what it declares for other files behind it", async () => {
  const ran = await buildAndRun("aot-heads-nobody-reads", {
    "main.ts": `globalThis.fromTheHead = 7;\nglobalThis.fromTheRest = 1;\nglobalThis.fromAnExport = 2;\nconsole.log(fromTheHead + fromTheRest + fromAnExport);\n`,
    "head.ts": `// import\nimport "./outside/adds-from-the-head";\n/** What a module requires of a global. */\nexport function f(module: number, global: number) { return module + global; }\nexport { f as g };\n`,
    "rest.ts": `export const a = 1;\nexport function f() { return a; }\ndeclare global { var fromTheRest: number; }\n`,
    "export.ts": `export const a = 1;\nexport function f() { return a; }\nexport { b } from "./outside/adds-from-an-export";\n`,
    "tags.tsx": `import "./outside/adds-from-the-head";\ndeclare namespace JSX { interface IntrinsicElements { p: {}; } }\nexport const p = <p>it's {1} } text</p>;\n`,
    "broken.ts": `import "./outside/adds-from-the-head";\nexport function f() { return 1; } }\n`,
    "outside/adds-from-the-head.ts": `export {};\ndeclare global { var fromTheHead: number; }\n`,
    "outside/adds-from-an-export.ts": `export const b = 1;\ndeclare global { var fromAnExport: number; }\n`,
  });
  expect(ran).toEqual({ stdout: "10\n", stderr: "", exitCode: 0, signalCode: null });
}, 120_000);
