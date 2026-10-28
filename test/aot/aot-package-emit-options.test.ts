// The "compilerOptions" in a package's own package.json decide how the TypeScript under its "aot" condition becomes JavaScript.
// The tsconfig.json and the flags of the program that installs the package decide nothing there, so the package behaves the same in every program.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const executable = isWindows ? "out.exe" : "out";

type CompilerOptions = Record<string, unknown>;

const classFields = `class Base { declare seen: number | undefined; set z(value: number) { this.seen = value; } }
class A extends Base { x: number | undefined; y: number = 1; }
class B extends Base {
  // @ts-expect-error
  z: number = 2;
}
export function answer(): string { return Object.keys(new A()).join() + " " + Object.keys(new B()).join(); }
`;

const element = `const React = { createElement: (tag: unknown) => "classic " + String(tag), Fragment: "Fragment" };
const make = (tag: unknown) => "made " + String(tag);
const Part = "Part";
export function answer(): string { void React, make, Part; return String(ELEMENT); }
`;

interface Case {
  option: string;
  source: string;
  /** What the program that installs the package says. */
  application: CompilerOptions;
  /** What the package says in every scene. */
  always?: CompilerOptions;
  /** The answer while the package does not state the option. */
  unstated: string;
  /** What the package says to get the other answer. Left out for an option that Bun reads nowhere. */
  own?: CompilerOptions;
  stated?: string;
}

const cases: Case[] = [
  {
    option: "useDefineForClassFields",
    source: classFields,
    application: { useDefineForClassFields: false },
    unstated: "x,y z",
    own: { useDefineForClassFields: false },
    stated: "y seen",
  },
  {
    option: "target",
    source: classFields,
    application: { target: "es2015" },
    unstated: "x,y z",
  },
  {
    option: "experimentalDecorators",
    source: `const kinds: string[] = [];
function mark(_: unknown, context: unknown): void { kinds.push(typeof context === "string" ? "legacy" : "standard"); }
class Box { @mark open(): void {} }
export function answer(): string { new Box().open(); return kinds.join(); }
`,
    application: { experimentalDecorators: true },
    unstated: "standard",
    own: { experimentalDecorators: true },
    stated: "legacy",
  },
  {
    option: "emitDecoratorMetadata",
    source: `const keys: string[] = [];
(Reflect as unknown as { metadata: unknown }).metadata = (key: string) => { keys.push(key); return () => {}; };
function mark(_: unknown, __: unknown): void {}
class Box { @mark size: number = 1; }
export function answer(): string { new Box(); return keys.join() || "none"; }
`,
    application: { experimentalDecorators: true, emitDecoratorMetadata: true },
    always: { experimentalDecorators: true },
    unstated: "none",
    own: { emitDecoratorMetadata: true },
    stated: "design:type",
  },
  {
    option: "jsx",
    source: element.replace("ELEMENT", "<p />"),
    application: { jsx: "react" },
    unstated: "automatic p",
    own: { jsx: "react" },
    stated: "classic p",
  },
  {
    option: "jsxFactory",
    source: element.replace("ELEMENT", "<p />"),
    application: { jsx: "react", jsxFactory: "make" },
    always: { jsx: "react" },
    unstated: "classic p",
    own: { jsxFactory: "make" },
    stated: "made p",
  },
  {
    option: "jsxFragmentFactory",
    source: element.replace("ELEMENT", "<></>"),
    application: { jsx: "react", jsxFactory: "React.createElement", jsxFragmentFactory: "Part" },
    always: { jsx: "react", jsxFactory: "React.createElement" },
    unstated: "classic Fragment",
    own: { jsxFragmentFactory: "Part" },
    stated: "classic Part",
  },
  {
    option: "jsxImportSource",
    source: element.replace("ELEMENT", "<p />"),
    application: { jsxImportSource: "tiny-jsx" },
    unstated: "automatic p",
    own: { jsxImportSource: "tiny-jsx" },
    stated: "tiny p",
  },
  {
    option: "verbatimModuleSyntax",
    source: `import { loud } from "./loud.aot.ts";
export function answer(): string { return (globalThis as { wasLoud?: boolean }).wasLoud ? "kept" : "dropped"; }
`,
    application: { verbatimModuleSyntax: true },
    unstated: "dropped",
  },
];

function jsxPackage(name: string, says: string) {
  return {
    [`node_modules/${name}/package.json`]: JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      exports: { "./jsx-runtime": "./jsx.js", "./jsx-dev-runtime": "./jsx.js" },
    }),
    [`node_modules/${name}/jsx.js`]: `export const jsx = tag => ${JSON.stringify(says + " ")} + String(tag);
export const jsxs = jsx, jsxDEV = jsx, Fragment = "Fragment";
`,
  };
}

function project(source: string, application: CompilerOptions, own: CompilerOptions | undefined) {
  return {
    "package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, module: "preserve", moduleResolution: "bundler", ...application },
    }),
    "main.ts": `import { answer } from "widgets";\nconsole.log(answer());\n`,
    "node_modules/widgets/package.json": JSON.stringify({
      name: "widgets",
      version: "1.0.0",
      type: "module",
      exports: { ".": { aot: "./index.aot.tsx", default: "./index.js" } },
      compilerOptions: own,
    }),
    "node_modules/widgets/index.js": `export function answer() { return "index.js"; }\n`,
    "node_modules/widgets/index.aot.tsx": source,
    "node_modules/widgets/loud.aot.ts": `(globalThis as { wasLoud?: boolean }).wasLoud = true;\nexport const loud = 1;\n`,
    ...jsxPackage("react", "automatic"),
    ...jsxPackage("tiny-jsx", "tiny"),
  };
}

async function print(root: string, command: string[]) {
  const { stdout, stderr, exitCode } = await spawned(command, root, env);
  return exitCode === 0 ? stdout.trim() : `exited with ${exitCode}: ${stderr}`;
}

/** What the program prints compiled ahead of time, and with its .aot.ts files run as they are. */
async function answers(files: Record<string, string>, flags: string[] = [], entry = "./main.ts") {
  using dir = tempDir("aot-package-emit-options", files);
  const root = String(dir);
  const built = await print(root, [bunExe(), "build", "--compile", "--aot", ...flags, entry, "--outfile", executable]);
  return {
    compiled: built.startsWith("exited with") ? built : await print(root, [join(root, executable)]),
    run: await print(root, [bunExe(), "run", "--aot", ...flags, entry]),
  };
}

describe.concurrent("emit options of a package with the aot condition", () => {
  test.each(cases)("$option in the program's tsconfig.json does not change the package", async it => {
    const found = await answers(project(it.source, it.application, it.always));
    expect(found).toEqual({ compiled: it.unstated, run: it.unstated });
  });

  test.each(cases.filter(it => it.own))("$option in the package's package.json applies", async it => {
    const found = await answers(project(it.source, {}, { ...it.always, ...it.own }));
    expect(found).toEqual({ compiled: it.stated!, run: it.stated! });
  });

  test("a package that is loaded with require() is no different", async () => {
    const files = {
      ...project(classFields, { useDefineForClassFields: false }, undefined),
      "required.cjs": `console.log(require("widgets").answer());\n`,
    };
    expect(await answers(files, [], "./required.cjs")).toEqual({ compiled: "x,y z", run: "x,y z" });
  });

  test("--tsconfig-override does not change the package", async () => {
    const files = {
      ...project(classFields, {}, undefined),
      "tsconfig.build.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
    };
    const found = await answers(files, ["--tsconfig-override=./tsconfig.build.json"]);
    expect(found).toEqual({ compiled: "x,y z", run: "x,y z" });
  });

  test("--jsx-import-source does not change the package", async () => {
    const found = await answers(project(element.replace("ELEMENT", "<p />"), {}, undefined), [
      "--jsx-import-source=tiny-jsx",
    ]);
    expect(found).toEqual({ compiled: "automatic p", run: "automatic p" });
  });

  test("a package without the aot condition follows the program's tsconfig.json", async () => {
    const files = project(classFields, { useDefineForClassFields: false }, undefined);
    files["node_modules/widgets/package.json"] = JSON.stringify({
      name: "widgets",
      version: "1.0.0",
      type: "module",
      exports: "./index.aot.tsx",
    });
    expect(await answers(files)).toEqual({ compiled: "y seen", run: "y seen" });
  });

  test("tsconfig.json applies in the package that you are working on", async () => {
    const files = {
      "package.json": JSON.stringify({
        name: "widgets",
        version: "1.0.0",
        type: "module",
        exports: { ".": { aot: "./src/index.ts", default: "./dist/index.js" } },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "preserve",
          moduleResolution: "bundler",
          useDefineForClassFields: false,
        },
      }),
      "src/index.ts": classFields,
      "try.ts": `import { answer } from "widgets";\nconsole.log(answer());\n`,
    };
    expect(await answers(files, [], "./try.ts")).toEqual({ compiled: "y seen", run: "y seen" });
  });
});
