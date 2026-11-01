import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

// An early error of the language stops bun run before the first statement runs. Bun's parser reports some. These are reported by JavaScriptCore's, when it is
// handed the transpiled module. A compiled program is never handed to it, so the build reports them: the type checker finds them in every file, typed or
// not, and names the file and the line of the source. The words are the checker's, not those of bun run.
async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { stdout, stderr, exitCode };
}

function syntaxErrorOf(stderr: string) {
  return stderr.match(/SyntaxError: .*/)?.[0];
}

async function expectEarlyError(file: string, source: string, line: number, ...buildFlags: string[]) {
  using dir = tempDir("aot-early-errors", { [file]: source });
  const cwd = String(dir);
  const plain = await run(cwd, "run", `./${file}`);
  expect({ error: syntaxErrorOf(plain.stderr), stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({
    error: expect.any(String),
    stdout: "",
    exitCode: 1,
  });
  const location = new RegExp(`${file.replace(".", "\\.")}:${line}:\\d+$`);
  const said: string[][] = [];
  for (const args of [
    ["run", "--debug-aot", `./${file}`],
    ["build", "--compile", "--aot", ...buildFlags, `./${file}`, "--outfile", "app"],
  ]) {
    const { stdout, stderr, exitCode } = await run(cwd, ...args);
    expect({ args, stdout: args[0] === "run" ? stdout : "", exitCode }).toEqual({ args, stdout: "", exitCode: 1 });
    const errors = stderr.match(/^error\b.*/gm) ?? [];
    expect(errors.filter(error => !/^error: TS\d+: \S/.test(error))).toEqual([]);
    const locations = stderr.match(/^\s+at .*$/gm) ?? [];
    expect(locations.filter(printed => !location.test(printed))).toEqual([]);
    expect({ args, errors: errors.length > 0, locations: locations.length > 0 }).toEqual({
      args,
      errors: true,
      locations: true,
    });
    said.push(errors);
  }
  expect(said[1]).toEqual(said[0]);
  return said[0];
}

describe.concurrent("an early error that only JavaScriptCore reports stops the build at the line of the source", () => {
  test("the line is that of the TypeScript source", async () => {
    const source = `interface Point {\n  x: number;\n  y: number;\n}\ntype Name = string;\nconst never: string = "never printed";\nfunction unused(point: Point, name: Name): RegExp {\n  return /(?<n>a)(?<n>b)/;\n}\nconsole.log(unused);\n`;
    await expectEarlyError("main.ts", source, 8);
  });

  test("the line is that of the source under --minify", async () => {
    await expectEarlyError(
      "main.js",
      `console.log("never printed");\n\n\nfunction unused() {\n  return /[b-a]/;\n}\nconsole.log(unused);\n`,
      5,
      "--minify",
    );
  });

  test("the name is that of the source under --minify-identifiers", async () => {
    const errors = await expectEarlyError(
      "main.js",
      `console.log("never printed");\nvar both; function both() {} both;\nconsole.log("never printed");\n`,
      2,
      "--minify-identifiers",
    );
    expect(errors[0]).toContain("'both'");
  });

  test("in a module that is imported", async () => {
    using dir = tempDir("aot-early-errors", {
      "main.ts": `import { value } from "./imported";\nconsole.log("never printed", value);\n`,
      "imported.ts": `export const value: number = 1;\n\nclass Unused { constructor() {} constructor() {} }\n`,
    });
    const cwd = String(dir);
    const expected = syntaxErrorOf((await run(cwd, "run", "./main.ts")).stderr);
    expect(expected).toBe("SyntaxError: Cannot declare multiple constructors in a single class.");
    for (const args of [
      ["run", "--debug-aot", "./main.ts"],
      ["build", "--compile", "--aot", "./main.ts", "--outfile", "app"],
    ]) {
      const { stderr, exitCode } = await run(cwd, ...args);
      expect({ args, errors: (stderr.match(/^error\b.*/gm) ?? []).length > 0, exitCode }).toEqual({
        args,
        errors: true,
        exitCode: 1,
      });
      expect(stderr).toMatch(/imported\.ts:3:\d+/);
    }
  });

  test("in a CommonJS module", async () => {
    await expectEarlyError(
      "main.cjs",
      `module.exports = 1;\nconsole.log("never printed");\nfunction unused() { return /(?<n>a)(?<n>b)/; } console.log(unused);\n`,
      3,
    );
  });
});
