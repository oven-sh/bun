// The global `JSON.parse` takes no type argument. One that the program declares for itself is erased like any other type:
// nothing is checked, and the program prints what plain Bun prints.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const declaration = `declare global {
  interface JSON {
    parse<T>(text: string): T;
  }
}
`;

test.each([
  ["JSON.parse", 'console.log(JSON.parse<number>("1"));'],
  ["JSON.stringify", "console.log(JSON.stringify<number>(1));"],
])(
  "%s takes no type argument",
  async (_, program) => {
    using dir = tempDir("type-argument-on-the-global", { "program.ts": program });
    const { stderr, exitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", join(String(dir), "program")],
      String(dir),
    );
    expect(stderr).toContain("TS2558");
    expect(exitCode).toBe(1);
  },
  120_000,
);

test.each([
  "console.log(JSON.parse<number>(text), JSON.parse<Map<string, Date>>(text), JSON.parse<() => void>(text));",
  "function load<T>(from: string): T {\n  return JSON.parse<T>(from);\n}\nconsole.log(load<number>(text));",
  "const parse = JSON.parse<number>;\nconsole.log(parse(text), [text].map(JSON.parse<number>));",
  "const parse: <T>(text: string) => T = JSON.parse;\nconsole.log(parse<number>(text));",
  "const { parse } = JSON;\nconsole.log(parse<number>(text), globalThis.JSON.parse<number>(text));",
])(
  "a type argument that the program declares is erased: %s",
  async calls => {
    using dir = tempDir("type-argument-of-the-programs-own", {
      "program.ts": `${declaration}const text: string = '"text"';\n${calls}\nexport {};\n`,
    });
    const executable = join(String(dir), isWindows ? "program.exe" : "program");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", executable],
      String(dir),
    );
    expect({ said: built.stderr, exitCode: built.exitCode }).toEqual({ said: "", exitCode: 0 });
    const compiled = await run([executable], String(dir));
    const plain = await run([bunExe(), "run", "./program.ts"], String(dir));
    expect(plain.stdout).toStartWith("text");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  },
  120_000,
);

test("bun run --aot erases it too", async () => {
  using dir = tempDir("type-argument-of-the-programs-own", {
    "program.ts": `${declaration}console.log(JSON.stringify(JSON.parse<{ id: number }>('{"id":"7"}')));\nexport {};\n`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, target: "esnext", module: "esnext", moduleResolution: "bundler" },
    }),
  });
  expect(await run([bunExe(), "run", "--aot", "./program.ts"], String(dir))).toEqual({
    stdout: `{"id":"7"}\n`,
    stderr: "",
    exitCode: 0,
  });
}, 120_000);
