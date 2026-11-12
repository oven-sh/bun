// An import of a macro stops a build with --aot: docs/compiler/compatibility.mdx. Every form of such an import is refused by name, the macro is not run, and no
// executable is written. Without --aot the same program builds, runs its macro and prints what its row says: so the program is right, and the refusal is about the macro.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "../harness/commands";
import { describe, test } from "../supported";

type Files = Record<string, string>;

const refusal = "TS100053: Macros are disabled";
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

// A macro that runs leaves a file behind.
const markOfMacro = "a-macro-ran.txt";
const MACROS = `// @ts-ignore
import { writeFileSync } from "node:fs";
const ran = () => writeFileSync(${JSON.stringify(markOfMacro)}, "");
export function number() {
  ran();
  return 42;
}
export function inner() {
  ran();
  return [1, 2];
}
export function outer(values: number[]) {
  ran();
  return values.map(value => value * 10);
}
export function throws() {
  ran();
  throw new Error("thrown by the macro");
}
`;

const calling = (names: string, body: string): Files => ({
  "main.ts": `import { ${names} } from "./macros" with { type: "macro" };\n${body}\n`,
});

// `prints`: what the executable prints that is built without --aot. Left out where `bun build` refuses the program too.
const forms: Record<string, { files: Files; flags?: string[]; prints?: string }> = {
  "a named import": {
    files: calling("number", "console.log(number() + 1, typeof number());"),
    prints: "43 number\n",
  },
  "a namespace import": {
    files: {
      "main.ts": `import * as macros from "./macros" with { type: "macro" };
console.log(macros.number(), macros.inner().length);
`,
    },
    prints: "42 2\n",
  },
  "a call among the operands of a call": {
    files: calling("inner, outer", "console.log(JSON.stringify(outer(inner())));"),
    prints: "[10,20]\n",
  },
  "a function of a built-in module": {
    files: {
      "note.txt": "read at build time\n",
      "main.ts": `// @ts-ignore
import { readFileSync } from "node:fs" with { type: "macro" };
console.log(readFileSync("note.txt", "utf8").trim());
`,
    },
    prints: "read at build time\n",
  },
  "in a file that the entry point imports": {
    files: {
      "first.ts": `import { number } from "./macros" with { type: "macro" };
export const first = number();
`,
      "main.ts": `import { first } from "./first";
console.log(first);
`,
    },
    prints: "42\n",
  },
  "in a package of node_modules": {
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
  },
  "an export that the file does not have": { files: calling("missing", "console.log(missing());") },
  "a macro that would throw": { files: calling("throws", "console.log(throws());") },
  "an operand that is no constant": { files: calling("outer", "let x = Date.now();\nconsole.log(outer([x]));") },
  "beside --no-macros": { files: calling("number", "console.log(number());"), flags: ["--no-macros"] },
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
};

async function expectRefusal(command: string[], program: string, folder: string) {
  const built = await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" });
  expect({
    output: built.stdout + built.stderr,
    exitCode: built.exitCode,
    signal: built.signal,
    wroteExecutable: existsSync(program),
    ranMacro: existsSync(join(folder, markOfMacro)),
  }).toEqual({
    output: expect.stringContaining(refusal),
    exitCode: 1,
    signal: null,
    wroteExecutable: false,
    ranMacro: false,
  });
}

async function buildAndRun(command: string[], program: string, folder: string) {
  const built = await spawned(command, folder, bunEnv);
  expect({ command, stderr: built.stderr, exitCode: built.exitCode, signal: built.signal }).toEqual({
    command,
    stderr: expect.any(String),
    exitCode: 0,
    signal: null,
  });
  return spawned([program], folder, bunEnv);
}

describe.concurrent("compile/aot/load/macros", () => {
  for (const [name, { files, flags = [], prints }] of Object.entries(forms)) {
    test(
      "is refused by name, is not run, and nothing is written: " + name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-load-macros", { "tsconfig.json": tsconfig(), "macros.ts": MACROS, ...files });
          const folder = String(dir);
          const build = (mode: string[], program: string) => [
            bunExe(),
            "build",
            "--compile",
            ...mode,
            ...flags,
            "main.ts",
            "--outfile",
            program,
          ];
          const refused = join(folder, exe("refused"));
          await expectRefusal(build(["--aot"], refused), refused, folder);
          if (prints === undefined) return;
          const program = join(folder, exe("program"));
          const ran = await buildAndRun(build([], program), program, folder);
          expect({
            stdout: ran.stdout,
            exitCode: ran.exitCode,
            signal: ran.signal,
            ranMacro: existsSync(join(folder, markOfMacro)),
          }).toEqual({
            stdout: prints,
            exitCode: 0,
            signal: null,
            ranMacro: Object.values(files).some(text => text.includes(`"./macros"`)),
          });
        }),
      600_000,
    );
  }

  test(
    "is refused by name, and nothing is written: in a component file, built by Bun.build()",
    () =>
      slot(async () => {
        using dir = tempDir("aot-load-macros", COMPONENT_PROGRAM);
        const folder = String(dir);
        const refused = join(folder, exe("refused"));
        await expectRefusal([bunExe(), "build.ts", refused, "aot"], refused, folder);
        const program = join(folder, exe("program"));
        expect(await buildAndRun([bunExe(), "build.ts", program, "bundled"], program, folder)).toEqual({
          stdout: "<p>shown from the macro 1</p> 2\n",
          stderr: expect.stringContaining("[react-compiler] a cache of "),
          exitCode: 0,
          signal: null,
        });
      }),
    600_000,
  );
});
