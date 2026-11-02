import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "../harness/commands";
import { describe, test } from "../supported";

type Files = Record<string, string>;

const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const NO_COLOR = { ...bunEnv, NO_COLOR: "1" };
const BOTH_MODES = [[], ["--aot"]];
const AOT_ONLY = [["--aot"]];
const exe = (name: string) => name + (isWindows ? ".exe" : "");

const tsconfig = (compilerOptions: object = {}) =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      noEmit: true,
      types: [],
      lib: ["ESNext", "DOM"],
      ...compilerOptions,
    },
  });

const MACROS = `export function number() {
  return 42;
}
export function loneSurrogate() {
  return "a\\uD800b";
}
export function ownProto() {
  return JSON.parse('{ "__proto__": 1, "a": 2 }');
}
export function nested() {
  return [[1, [2, 3]], [], ["x", null]];
}
export async function promised() {
  await Promise.resolve();
  return "later";
}
export function response() {
  return new Response(JSON.stringify({ ok: true, list: [1, 2] }), { headers: { "content-type": "application/json" } });
}
export function kindsOf(...values: unknown[]) {
  return values.map(value => {
    const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    return kind + " " + JSON.stringify(value);
  });
}
export function inner() {
  return [1, 2];
}
export function outer(values: number[]) {
  return values.map(value => value * 10);
}
export function throws() {
  throw new Error("thrown by the macro");
}
export function returnsFunction() {
  return () => 1;
}
export function returnsCycle() {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  return cycle;
}
`;

const calling = (names: string, body: string): Files => ({
  "main.ts": `import { ${names} } from "./macros" with { type: "macro" };\n${body}\n`,
});

const who = (file: string) => `export function who(): string {\n  return ${JSON.stringify(file)};\n}\n`;

// Packages whose every file says which file it is. A macro import takes the file that `bun run` takes for it.
const PACKAGES: Files = {
  "node_modules/typed/package.json": `{ "name": "typed", "exports": { "aot": "./index.aot.ts", "default": "./index.ts" } }`,
  "node_modules/typed/index.aot.ts": who("index.aot.ts"),
  "node_modules/typed/index.ts": who("index.ts"),
  "node_modules/two-entries/package.json": `{ "name": "two-entries", "main": "./main.ts", "module": "./module.ts" }`,
  "node_modules/two-entries/main.ts": who("main.ts"),
  "node_modules/two-entries/module.ts": who("module.ts"),
  "node_modules/two-formats/package.json": `{ "name": "two-formats", "main": "./index.cjs", "module": "./index.mjs", "types": "./index.d.ts" }`,
  "node_modules/two-formats/index.cjs": `exports.who = function who() {\n  return "index.cjs";\n};\n`,
  "node_modules/two-formats/index.mjs": `export function who() {\n  return "index.mjs";\n}\n`,
  "node_modules/two-formats/index.d.ts": `export declare function who(): string;\n`,
  "node_modules/for-development/package.json": `{ "name": "for-development", "exports": { "development": "./dev.ts", "default": "./index.ts" } }`,
  "node_modules/for-development/dev.ts": who("dev.ts"),
  "node_modules/for-development/index.ts": who("index.ts"),
};

const IMPORTING_PACKAGES = `import { who as typed } from "typed" with { type: "macro" };
import { who as twoEntries } from "two-entries" with { type: "macro" };
import { who as twoFormats } from "two-formats" with { type: "macro" };
import { who as forDevelopment } from "for-development" with { type: "macro" };
`;

// `below/calls.ts` has a `node_modules` of its own. `registry` counts in the one file of it that the macros load.
const callingPackages: Files = {
  ...PACKAGES,
  "node_modules/nearest/package.json": `{ "name": "nearest", "main": "./index.ts" }`,
  "node_modules/nearest/index.ts": who("above"),
  "below/node_modules/nearest/package.json": `{ "name": "nearest", "main": "./index.ts" }`,
  "below/node_modules/nearest/index.ts": who("below"),
  "below/node_modules/only-below/package.json": `{ "name": "only-below", "main": "./index.ts" }`,
  "below/node_modules/only-below/index.ts": who("below"),
  "below/calls.ts": `import { who as nearest } from "nearest" with { type: "macro" };
import { who as onlyBelow } from "only-below" with { type: "macro" };
export const found: string = nearest() + " " + onlyBelow();
`,
  "node_modules/registry/package.json": `{ "name": "registry", "main": "./main.ts", "module": "./module.ts" }`,
  ...Object.fromEntries(
    ["main.ts", "module.ts"].map(file => [
      "node_modules/registry/" + file,
      `const names: string[] = [];
export function register(name: string): number {
  return names.push(name);
}
`,
    ]),
  ),
  "through.ts": `import { register } from "registry";
export function registerThrough(name: string): number {
  return register(name);
}
`,
  "main.ts": `${IMPORTING_PACKAGES}import { register } from "registry" with { type: "macro" };
import { registerThrough } from "./through" with { type: "macro" };
import { found } from "./below/calls";
console.log(typed(), twoEntries(), twoFormats(), forDevelopment(), found, register("a"), registerThrough("b"), register("c"));
`,
};

const expanded: Record<string, { files: Files; prints: string; modes?: string[][]; flags?: string[] }> = {
  "returns a number": {
    files: calling("number", "console.log(number() + 1, typeof number());"),
    prints: "43 number\n",
  },
  "returns a string with a lone surrogate": {
    files: calling(
      "loneSurrogate",
      `const text = loneSurrogate();
console.log(text.length, text.charCodeAt(1).toString(16), JSON.stringify(text));`,
    ),
    prints: '3 d800 "a\\ud800b"\n',
  },
  "returns an object with an own __proto__ key": {
    files: calling(
      "ownProto",
      `const value = ownProto();
console.log(Object.keys(value).join(), Object.getPrototypeOf(value) === Object.prototype, value.a);`,
    ),
    prints: "__proto__,a true 2\n",
  },
  "returns nested arrays": {
    files: calling("nested", "console.log(JSON.stringify(nested()));"),
    prints: '[[1,[2,3]],[],["x",null]]\n',
  },
  "returns a promise": {
    files: calling("promised", "console.log(promised());"),
    prints: "later\n",
  },
  "returns a JSON Response": {
    files: calling("response", "console.log(JSON.stringify(response()));"),
    prints: '{"ok":true,"list":[1,2]}\n',
  },
  "receives arguments of every kind": {
    files: calling(
      "kindsOf",
      `const kinds = kindsOf(
  1.5,
  -2,
  "text é 😀",
  true,
  false,
  null,
  undefined,
  [1, [2, "x"]],
  { a: { b: [null] }, "c d": 0 },
);
console.log(kinds.join("\\n"));`,
    ),
    prints: [
      "number 1.5",
      "number -2",
      'string "text é 😀"',
      "boolean true",
      "boolean false",
      "null null",
      "undefined undefined",
      'array [1,[2,"x"]]',
      'object {"a":{"b":[null]},"c d":0}',
      "",
    ].join("\n"),
  },
  "nested macro calls": {
    files: calling("inner, outer", "console.log(JSON.stringify(outer(inner())));"),
    prints: "[10,20]\n",
  },
  "namespace import": {
    files: {
      "main.ts": `import * as macros from "./macros" with { type: "macro" };
console.log(macros.number(), macros.nested().length);
`,
    },
    prints: "42 3\n",
  },
  "function of a built-in module": {
    files: {
      "note.txt": "read at build time\n",
      "main.ts": `// @ts-ignore
import { readFileSync } from "node:fs" with { type: "macro" };
console.log(readFileSync("note.txt", "utf8").trim());
`,
    },
    prints: "read at build time\n",
  },
  // `bun build` without --aot takes "module" and "development", and loads `registry` twice.
  "functions of packages": {
    files: callingPackages,
    prints: "index.ts main.ts index.cjs index.ts below below 1 2 3\n",
    modes: AOT_ONLY,
  },
  "functions of packages with --packages=external": {
    files: callingPackages,
    flags: ["--packages=external"],
    prints: "index.ts main.ts index.cjs index.ts below below 1 2 3\n",
    modes: AOT_ONLY,
  },
  "functions of packages with --external": {
    files: callingPackages,
    flags: ["typed", "two-entries", "two-formats", "for-development", "nearest", "only-below", "registry"].flatMap(
      name => ["--external", name],
    ),
    prints: "index.ts main.ts index.cjs index.ts below below 1 2 3\n",
    modes: AOT_ONLY,
  },
  "functions of packages with --conditions=development": {
    files: callingPackages,
    flags: ["--conditions=development"],
    prints: "index.ts main.ts index.cjs dev.ts below below 1 2 3\n",
    modes: AOT_ONLY,
  },
  "macro module is evaluated once for two importers": {
    files: {
      "counter.ts": `let calls = 0;
export function fromFirst() {
  return ++calls;
}
export function fromSecond() {
  return ++calls;
}
`,
      "first.ts": `import { fromFirst } from "./counter" with { type: "macro" };
export const first = fromFirst();
`,
      "second.ts": `import { fromSecond } from "./counter" with { type: "macro" };
export const second = fromSecond();
`,
      "main.ts": `import { first } from "./first";
import { second } from "./second";
console.log([first, second].sort().join());
`,
    },
    prints: "1,2\n",
    // Each worker of `bun build` has its own virtual machine, so there the count depends on scheduling.
    modes: AOT_ONLY,
  },
};

const withoutFileForBunRun: Files = {
  "node_modules/only-typed/package.json": `{ "name": "only-typed", "exports": { "aot": "./index.aot.ts" } }`,
  "node_modules/only-typed/index.aot.ts": who("index.aot.ts"),
  "node_modules/only-for-development/package.json": `{ "name": "only-for-development", "exports": { "development": "./dev.ts" } }`,
  "node_modules/only-for-development/dev.ts": who("dev.ts"),
  "main.ts": `import { who as onlyTyped } from "only-typed" with { type: "macro" };
// @ts-ignore
import { who as onlyForDevelopment } from "only-for-development" with { type: "macro" };
console.log(onlyTyped(), onlyForDevelopment());
`,
};
const notFound = ['Macro "only-typed" not found', 'Macro "only-for-development" not found'];

const rejected: Record<string, { files: Files; flags?: string[]; messages: string[] }> = {
  "macro throws": {
    files: calling("throws", "console.log(throws());"),
    messages: ["thrown by the macro", "macro threw exception", "main.ts"],
  },
  "macro returns a function": {
    files: calling("returnsFunction", "console.log(returnsFunction());"),
    messages: ["to Bun's AST"],
  },
  "macro result contains itself": {
    files: calling("returnsCycle", "console.log(returnsCycle());"),
    messages: ['the result of the macro "returnsCycle" of "./macros" contains a circular reference', "main.ts"],
  },
  "export does not exist": {
    files: calling("missing", "console.log(missing());"),
    messages: ["Macro 'missing' not found in"],
  },
  "package without a file that bun run takes": {
    files: withoutFileForBunRun,
    messages: notFound,
  },
  "argument is not a constant": {
    files: calling("kindsOf", "let x = Date.now();\nconsole.log(kindsOf(x));"),
    messages: ["TS100051"],
  },
  "--no-macros": {
    files: calling("number", "console.log(number());"),
    flags: ["--no-macros"],
    messages: ["Macros are disabled"],
  },
  "macro call in node_modules": {
    files: {
      "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "type": "module", "main": "./index.js" }`,
      "node_modules/dep/index.js": `import { number } from "./macros.js" with { type: "macro" };
export const value = number();
`,
      "node_modules/dep/macros.js": `export function number() {
  return 42;
}
`,
      "main.ts": `// @ts-ignore
import { value } from "dep";
console.log(value);
`,
    },
    messages: ["macros cannot be run from node_modules"],
  },
};

const REACT_STAND_IN = join(import.meta.dir, "..", "react-compiler", "react-stand-in");

const COMPONENT_BUILD: Files = {
  ...Object.fromEntries(
    ["compiler-runtime.js", "jsx-runtime.d.ts", "jsx-runtime.js"].map(name => [
      "react-stand-in/" + name,
      readFileSync(join(REACT_STAND_IN, name), "utf8"),
    ]),
  ),
  "tsconfig.json": tsconfig({
    jsx: "react-jsx",
    allowJs: true,
    paths: {
      "react/jsx-runtime": ["./react-stand-in/jsx-runtime"],
      "react/jsx-dev-runtime": ["./react-stand-in/jsx-runtime"],
      "react/compiler-runtime": ["./react-stand-in/compiler-runtime.js"],
    },
  }),
  "build.ts": `const [outfile, mode] = process.argv.slice(2);
const result = await Bun.build({
  entrypoints: ["./main.ts"],
  target: "bun",
  reactCompiler: true,
  reactCompilerOutputMode: "client",
  compile: { outfile, aot: mode === "aot" },
  throw: false,
});
for (const log of result.logs) console.error(String(log));
process.exit(result.success ? 0 : 1);
`,
};

const componentPrograms: Record<string, { files: Files; prints: string; modes?: string[] }> = {
  "component file that calls a macro": {
    files: {
      "label.ts": `let calls = 0;
export function label() {
  return "from the macro";
}
export function countCalls() {
  return ++calls;
}
`,
      "Titled.tsx": `import { countCalls, label } from "./label" with { type: "macro" };
export function Titled(props: { title: string }) {
  const lines = [props.title, label(), countCalls()];
  return <p>{lines.join(" ")}</p>;
}
export const callsBehindTitled = countCalls();
`,
      "main.ts": `import { Titled, callsBehindTitled } from "./Titled";
console.log(Titled({ title: "shown" }), callsBehindTitled);
`,
    },
    prints: "<p>shown from the macro 1</p> 2\n",
  },
  // The parser that compiles the components runs the calls in parentheses, and the load runs those of `main.ts`.
  "component file and another file call functions of packages": {
    files: {
      ...PACKAGES,
      "Titled.tsx": `${IMPORTING_PACKAGES}export function Titled(props: { title: string }) {
  const lines = [props.title, (typed)(), (twoEntries)(), (twoFormats)(), (forDevelopment)()];
  return <p>{lines.join(" ")}</p>;
}
`,
      "main.ts": `${IMPORTING_PACKAGES}import { Titled } from "./Titled";
console.log(Titled({ title: "shown" }), typed(), twoEntries(), twoFormats(), forDevelopment());
`,
    },
    prints: "<p>shown index.ts main.ts index.cjs index.ts</p> index.ts main.ts index.cjs index.ts\n",
    modes: ["aot"],
  },
};

// A module that a plugin makes up is no file. Its macros are looked for from the folder in its path, like what else it imports.
const PLUGIN_PROGRAM: Files = {
  ...PACKAGES,
  "tsconfig.json": tsconfig(),
  "build.ts": `import { join } from "node:path";
const [outfile, mode] = process.argv.slice(2);
const result = await Bun.build({
  entrypoints: ["./main.ts"],
  target: "bun",
  plugins: [
    {
      name: "made-up",
      setup(build) {
        const path = join(import.meta.dir, "folder", "made-up.ts");
        build.onResolve({ filter: /^made-up$/ }, () => ({ path, namespace: "made-up" }));
        build.onLoad({ filter: /.*/, namespace: "made-up" }, () => ({
          contents: [
            'import { where } from "./beside" with { type: "macro" };',
            ${JSON.stringify(IMPORTING_PACKAGES)},
            'export const found: string = where() + " " + typed();',
            'export const taken: string = twoEntries() + " " + twoFormats() + " " + forDevelopment();',
          ].join("\\n"),
          loader: "ts",
        }));
      },
    },
  ],
  compile: { outfile, aot: mode === "aot" },
  throw: false,
});
for (const log of result.logs) console.error(String(log));
process.exit(result.success ? 0 : 1);
`,
  "folder/beside.ts": `export function where(): string {
  return "folder/beside.ts";
}
`,
  "beside.ts": `export function where(): string {
  return "beside.ts";
}
`,
  "main.ts": `// @ts-ignore
import { found, taken } from "made-up";
console.log(found);
console.log(taken);
`,
};

// `bun check` runs no program. A branch that stays only where a macro ran another file has a type error.
const CHECKED_PROGRAM: Files = {
  ...PACKAGES,
  "tsconfig.json": tsconfig(),
  "main.ts": `${IMPORTING_PACKAGES}if (typed() !== "index.ts") typed() satisfies never;
if (twoEntries() !== "main.ts") twoEntries() satisfies never;
if (twoFormats() !== "index.cjs") twoFormats() satisfies never;
if (forDevelopment() !== "index.ts") forDevelopment() satisfies never;
`,
};

const TESTED_PROGRAM: Files = {
  ...PACKAGES,
  "tsconfig.json": tsconfig(),
  "packages.test.ts": `import { expect, test } from "bun:test";
${IMPORTING_PACKAGES}
test("each macro ran the file that bun test takes", () => {
  expect([typed(), twoEntries(), twoFormats(), forDevelopment()]).toEqual(["index.ts", "main.ts", "index.cjs", "index.ts"]);
});
`,
};

async function buildAndRun(command: string[], program: string, folder: string, isCompiled: boolean) {
  const built = await spawned(command, folder, bunEnv);
  expect({ command, stderr: built.stderr, exitCode: built.exitCode, signal: built.signal }).toEqual({
    command,
    stderr: expect.any(String),
    exitCode: 0,
    signal: null,
  });
  return spawned([program], folder, isCompiled ? COMPILED : bunEnv);
}

describe.concurrent("compile/aot/load/macros", () => {
  for (const [name, { files, prints, modes = BOTH_MODES, flags = [] }] of Object.entries(expanded)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-load-macros", { "tsconfig.json": tsconfig(), "macros.ts": MACROS, ...files });
          const folder = String(dir);
          for (const mode of modes) {
            const program = join(folder, exe("program" + mode.length));
            const command = [bunExe(), "build", "--compile", ...mode, ...flags, "main.ts", "--outfile", program];
            const ran = await buildAndRun(command, program, folder, mode.length > 0);
            expect({ mode, stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
              mode,
              stdout: prints,
              exitCode: 0,
              signal: null,
            });
          }
        }),
      600_000,
    );
  }

  for (const [name, { files, prints, modes = ["bundled", "aot"] }] of Object.entries(componentPrograms)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-load-macros", { ...COMPONENT_BUILD, ...files });
          const folder = String(dir);
          for (const mode of modes) {
            const program = join(folder, exe("program-" + mode));
            const ran = await buildAndRun([bunExe(), "build.ts", program, mode], program, folder, mode === "aot");
            expect({ mode, ...ran }).toEqual({
              mode,
              stdout: prints,
              stderr: expect.stringContaining("[react-compiler] a cache of "),
              exitCode: 0,
              signal: null,
            });
          }
        }),
      600_000,
    );
  }

  test(
    "module that a plugin makes up calls macros",
    () =>
      slot(async () => {
        using dir = tempDir("aot-load-macros", PLUGIN_PROGRAM);
        const folder = String(dir);
        // `Bun.build` without `aot` takes "module" and "development" for the second line. https://github.com/oven-sh/bun/pull/46802 changes that.
        const prints = {
          bundled: "folder/beside.ts index.ts\nmodule.ts index.mjs dev.ts\n",
          aot: "folder/beside.ts index.ts\nmain.ts index.cjs index.ts\n",
        };
        for (const mode of ["bundled", "aot"] as const) {
          const program = join(folder, exe("program-" + mode));
          const ran = await buildAndRun([bunExe(), "build.ts", program, mode], program, folder, mode === "aot");
          expect({ mode, stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
            mode,
            stdout: prints[mode],
            exitCode: 0,
            signal: null,
          });
        }
      }),
    600_000,
  );

  test(
    "bun check --aot runs the files that a build runs",
    () =>
      slot(async () => {
        using dir = tempDir("aot-load-macros", CHECKED_PROGRAM);
        const checked = await spawned([bunExe(), "check", "--aot", "--no-pretty", "main.ts"], String(dir), NO_COLOR);
        expect({ output: checked.stdout + checked.stderr, exitCode: checked.exitCode }).toEqual({
          output: expect.stringContaining("No type errors"),
          exitCode: 0,
        });
        using without = tempDir("aot-load-macros", { "tsconfig.json": tsconfig(), ...withoutFileForBunRun });
        const refused = await spawned(
          [bunExe(), "check", "--aot", "--no-pretty", "main.ts"],
          String(without),
          NO_COLOR,
        );
        for (const message of notFound) expect(refused.stdout + refused.stderr).toContain(message);
        expect(refused.exitCode).toBe(1);
      }),
    600_000,
  );

  test(
    "bun test --aot runs the files that bun test takes",
    () =>
      slot(async () => {
        using dir = tempDir("aot-load-macros", TESTED_PROGRAM);
        const tested = await spawned([bunExe(), "test", "--aot", "./packages.test.ts"], String(dir), NO_COLOR);
        expect({ output: tested.stdout + tested.stderr, exitCode: tested.exitCode }).toEqual({
          output: expect.stringContaining("1 pass"),
          exitCode: 0,
        });
      }),
    600_000,
  );

  for (const [name, { files, flags = [], messages }] of Object.entries(rejected)) {
    // TODO: where the macro throws, the build says "cannot coerce Exception (JSType(0)) to Bun's AST" and not what was thrown.
    (name === "macro throws" ? test.todo : test)(
      "rejected: " + name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-load-macros", { "tsconfig.json": tsconfig(), "macros.ts": MACROS, ...files });
          const folder = String(dir);
          const program = join(folder, exe("program"));
          const command = [bunExe(), "build", "--compile", "--aot", ...flags, "main.ts", "--outfile", program];
          const built = await spawned(command, folder, NO_COLOR);
          const output = built.stdout + built.stderr;
          expect({
            output,
            exitCode: built.exitCode,
            signal: built.signal,
            wroteExecutable: existsSync(program),
          }).toEqual({
            output: expect.any(String),
            exitCode: 1,
            signal: null,
            wroteExecutable: false,
          });
          for (const message of messages) expect(output).toContain(message);
        }),
      600_000,
    );
  }
});
