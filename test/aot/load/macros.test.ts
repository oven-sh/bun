import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

type Files = Record<string, string>;

const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
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

const expanded: Record<string, { files: Files; prints: string; modes?: string[][] }> = {
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
    messages: ["the macro result of ", "macros.ts", "contains a circular reference"],
  },
  "export does not exist": {
    files: calling("missing", "console.log(missing());"),
    messages: ["Macro 'missing' not found in"],
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

const COMPONENT_PROGRAM: Files = {
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
  "label.ts": `export function label() {
  return "from the macro";
}
`,
  "Titled.tsx": `import { label } from "./label" with { type: "macro" };
export function Titled(props: { title: string }) {
  const lines = [props.title, label()];
  return <p>{lines.join(" ")}</p>;
}
`,
  "main.ts": `import { Titled } from "./Titled";
console.log(Titled({ title: "shown" }));
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
  for (const [name, { files, prints, modes = BOTH_MODES }] of Object.entries(expanded)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-load-macros", { "tsconfig.json": tsconfig(), "macros.ts": MACROS, ...files });
          const folder = String(dir);
          for (const mode of modes) {
            const program = join(folder, exe("program" + mode.length));
            const command = [bunExe(), "build", "--compile", ...mode, "main.ts", "--outfile", program];
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

  test(
    "component file that calls a macro",
    () =>
      slot(async () => {
        using dir = tempDir("aot-load-macros", COMPONENT_PROGRAM);
        const folder = String(dir);
        for (const mode of ["bundled", "aot"]) {
          const program = join(folder, exe("program-" + mode));
          const ran = await buildAndRun([bunExe(), "build.ts", program, mode], program, folder, mode === "aot");
          expect({ mode, ...ran }).toEqual({
            mode,
            stdout: "<p>shown from the macro</p>\n",
            stderr: expect.stringContaining("[react-compiler] a cache of "),
            exitCode: 0,
            signal: null,
          });
        }
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
          const built = await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" });
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
