import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// `import { x }` without `from "module"` is a syntax error that the parser recovers from, so the build goes on with an import that names no module. Whoever follows `x` to
// the module it comes from has to find none. A test run also reads the strings of the test files as code, so there the broken text need not even be code.
// As code it is TypeScript: in a JavaScript file the parser gives up at the error and nothing is left to follow.
// What crashed the compiler: a require() that follows the name, a call of the name of a macro, a call on the namespace of one.
const programs = [
  { file: "required-through-import-meta", code: `import.meta.require(x);\nimport { x }\n` },
  { file: "a-member-called-for-require", code: `require(x.join("a", "b"));\nimport { x }\n` },
  { file: "a-macro-called", code: `console.log(x(1));\nimport { x } from y with { type: "macro" }\n` },
  {
    file: "a-member-of-a-macros-namespace-called",
    code: `console.log(x.m(1));\nimport * as x from y with { type: "macro" }\n`,
  },
];

// A process that a signal ended has 128 + the signal for its exit code.
async function exitCodes(directory: string, extension: "js" | "ts", ...command: string[]) {
  const codes: Record<string, number> = {};
  await Promise.all(
    programs.map(async ({ file }) => {
      const flags = command[0] === "build" ? [`--outfile=${file}.out`] : [];
      codes[file] = (
        await run([bunExe(), ...command, ...flags, `./${file}.test.${extension}`], directory, bunEnv)
      ).exitCode;
    }),
  );
  return codes;
}

const every = (code: number) => Object.fromEntries(programs.map(({ file }) => [file, code]));

test.concurrent("in a string of a test file it stops no test run", async () => {
  const files = programs.map(({ file, code }) => [`${file}.test.js`, `const text = ${JSON.stringify(code)};\n`]);
  using dir = tempDir("an-import-that-names-no-module-in-a-string", Object.fromEntries(files));
  expect(await exitCodes(String(dir), "js", "test")).toEqual(every(0));
  expect(await exitCodes(String(dir), "js", "test", "--aot")).toEqual(every(0));
});

test.concurrent("as code it fails the test run with its syntax error", async () => {
  const files = programs.map(({ file, code }) => [`${file}.test.ts`, code]);
  using dir = tempDir("an-import-that-names-no-module-as-code", Object.fromEntries(files));
  expect(await exitCodes(String(dir), "ts", "test")).toEqual(every(1));
  expect(await exitCodes(String(dir), "ts", "test", "--aot")).toEqual(every(1));
});

test.concurrent("as code it fails the build of an executable with its syntax error", async () => {
  const files = programs.map(({ file, code }) => [`${file}.test.ts`, code]);
  using dir = tempDir("an-import-that-names-no-module-in-an-executable", Object.fromEntries(files));
  expect(await exitCodes(String(dir), "ts", "build", "--compile", "--aot")).toEqual(every(1));
});
