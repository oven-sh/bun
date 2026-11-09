import { expect } from "bun:test";
import { existsSync, statSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../harness/commands";
import "../harness/real-executables";
import { describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const bun = (cwd: string, ...args: string[]) => spawned([bunExe(), ...args], cwd, env);
const executable = (folder: string, name: string) => join(folder, isWindows ? name + ".exe" : name);
const compile = (folder: string, entry: string, name: string, ...flags: string[]) =>
  bun(folder, "build", "--compile", "--aot", ...flags, entry, "--outfile", name);
const run = (folder: string, name: string) => spawned([executable(folder, name)], folder, env);

const nm = isWindows ? null : (Bun.which("nm") ?? Bun.which("llvm-nm"));

async function hasSymbol(path: string, name: string) {
  const { stdout, exitCode } = await spawned([nm!, path], "/", env);
  expect(exitCode).toBe(0);
  // A symbol is named "<function> <file>:<line>", followed by the role of the code for anything but the body.
  return new RegExp(`^[0-9a-f]+ \\S ${name}(?: |$)`, "m").test(stdout);
}

const accepted = [
  "check=Validate,verify-each-stage",
  "testing=NoExecutable",
  "testing=TypeErrorsWarn",
  "references=wide",
  "references=narrow",
  // The engine has names for ARM64 CPUs alone.
  ...(process.arch === "arm64" ? ["cpu=apple-m1"] : []),
  "threads=1",
  "erase-types",
  "out=program.bin",
  "symbols",
];

const removed = [
  "disable=flow-results",
  "only-passes=ResolveCalls",
  "disable-in=0:1",
  "limit=MaxDataNodes:1",
  "heat=everything-is-cold",
  "sabotage=NoCallWrites",
  "count-branches",
  "count-arrivals",
  "drop-guard=TypeTest:0",
  "layout-seed=7",
  "verify-each-pass",
  "report=report.json",
  "report-detail=sites",
  "list=registry",
  "log-type-mismatches",
  "separate-programs",
  "flow=Widened",
  "validate",
];

const unknownFlag = (word: string) =>
  `unknown flag --aot-${word.split("=")[0]}. The --aot flags for this command are --aot, --aot-allow-code-from-disk, --aot-huge-heap`;

const rejected = [
  ...removed.map(word => [word, unknownFlag(word)]),
  ["check=no-such-check", "--aot-check=no-such-check: unknown check no-such-check"],
  ["check=verify-each-pass", "--aot-check=verify-each-pass: unknown check verify-each-pass"],
  ["testing=DropGuard", "--aot-testing=DropGuard: unknown testing switch DropGuard"],
  ["cpu=no-such-cpu", "--aot-cpu=no-such-cpu: unknown CPU no-such-cpu"],
  ["threads=many", 'Invalid value for --aot-threads: "many". Must be a whole number above zero'],
  ["threads=0", 'Invalid value for --aot-threads: "0". Must be a whole number above zero'],
  ["references=medium", 'Invalid value for --aot-references: "medium". Must be one of narrow, wide'],
];

const hiddenExplainValues = ["unknown-code", "unproven-type"];

const invalidProgram = {
  "wrong.ts": `import "./missing-module";
const n: number = "one";
console.log(n);
`,
};

const pointsProgram = {
  "app.ts": `interface Point { x: number; y: number }
const points: Point[] = [];
for (let i = 0; i < 3; i++) points.push({ x: i, y: i + 1 });
console.log(points.map(point => point.x + point.y).join(), /abcdef+/.test("abcdefff"));
`,
};

const mistypedArgumentProgram = {
  "app.ts": `function double(n: number): number {
  return n * 2;
}
console.log(double(JSON.parse(process.argv[2] ?? '"4"')));
`,
};

// A recursive function keeps code of its own, however much of it is inlined.
const recursiveProgram = {
  "app.ts": `function fibonacci(n: number): number {
  return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2);
}
console.log(fibonacci(process.argv.length > 99 ? 1 : 10));
`,
};

describe.concurrent("the hidden --aot- flags of a build", () => {
  test.each(accepted)("--aot-%s is accepted", async word => {
    using dir = tempDir("aot-accepted-flag", {});
    const { stderr, exitCode } = await compile(String(dir), "./no-such-file.ts", "out", "--aot-" + word);
    // The build fails at its entry point, which it looks for only after it has accepted every flag.
    expect(stderr).toContain("no-such-file");
    expect(stderr).not.toContain("--aot-");
    expect(exitCode).toBe(1);
  });

  test.each(rejected)("--aot-%s is rejected before any file is loaded", async (word, message) => {
    using dir = tempDir("aot-rejected-flag", invalidProgram);
    const folder = String(dir);
    const { stdout, stderr, exitCode } = await compile(folder, "wrong.ts", "out", "--aot-" + word);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: `error: ${message}\n`, exitCode: 1 });
    expect(existsSync(executable(folder, "out"))).toBe(false);
  });

  test("--aot-erase-types requires --aot", async () => {
    using dir = tempDir("aot-flag-without-aot", invalidProgram);
    const { stdout, stderr, exitCode } = await bun(
      String(dir),
      "build",
      "--compile",
      "--aot-erase-types",
      "wrong.ts",
      "--outfile",
      "out",
    );
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: "error: --aot-erase-types requires --aot\n",
      exitCode: 1,
    });
  });

  test(
    "the build summary lists the flags that changed the code",
    () =>
      slot(async () => {
        using dir = tempDir("aot-flags-in-summary", pointsProgram);
        const folder = String(dir);
        const flags = ["--aot-check=Validate"];
        const changed = await compile(folder, "app.ts", "changed", ...flags);
        built(changed);
        expect((changed.stdout + changed.stderr).split("\n")).toContain(
          "Built with developer options: " + flags.join(" "),
        );
        expect(await run(folder, "changed")).toMatchObject({ stdout: "1,3,5 true\n", exitCode: 0, signal: null });

        const unchanged = await compile(folder, "app.ts", "unchanged", "--aot-threads=1", "--aot-symbols");
        built(unchanged);
        expect(unchanged.stdout + unchanged.stderr).not.toMatch(/^Built with developer options/m);
        expect(await run(folder, "unchanged")).toMatchObject({ stdout: "1,3,5 true\n", exitCode: 0, signal: null });
      }),
    300_000,
  );

  test(
    "--aot-out writes the emitted program",
    () =>
      slot(async () => {
        using dir = tempDir("aot-out", pointsProgram);
        const folder = String(dir);
        built(await compile(folder, "app.ts", "out", "--aot-out=program.bin"));
        expect(statSync(join(folder, "program.bin")).size).toBeGreaterThan(0);
      }),
    300_000,
  );

  // A build with plugins is a call and has no command line.
  test(
    "compile.aotOut of Bun.build() writes it too",
    () =>
      slot(async () => {
        using dir = tempDir("aot-out-by-call", {
          ...pointsProgram,
          "build.ts": `await Bun.build({ entrypoints: ["./app.ts"], compile: { outfile: "./out", aot: true, aotOut: "program.bin" } as any });\n`,
        });
        const folder = String(dir);
        expect(await bun(folder, "build.ts")).toMatchObject({ exitCode: 0, signal: null });
        expect(statSync(join(folder, "program.bin")).size).toBeGreaterThan(0);
      }),
    300_000,
  );

  test(
    "a value of another type than declared is computed with as in plain Bun, with and without --aot-erase-types",
    () =>
      slot(async () => {
        using dir = tempDir("aot-erase-types", mistypedArgumentProgram);
        const folder = String(dir);
        const expected = { stdout: "8\n", stderr: "", exitCode: 0, signal: null };
        built(await compile(folder, "app.ts", "typed"));
        expect(await run(folder, "typed")).toEqual(expected);

        built(await compile(folder, "app.ts", "erased", "--aot-erase-types"));
        expect(await run(folder, "erased")).toEqual(expected);
      }),
    300_000,
  );

  test.skipIf(!nm)(
    "--aot-symbols adds a symbol for a compiled function",
    () =>
      slot(async () => {
        using dir = tempDir("aot-symbols", recursiveProgram);
        const folder = String(dir);
        built(await compile(folder, "app.ts", "named", "--aot-symbols"));
        expect(await hasSymbol(executable(folder, "named"), "fibonacci")).toBe(true);
        expect(await run(folder, "named")).toMatchObject({ stdout: "55\n", exitCode: 0, signal: null });

        built(await compile(folder, "app.ts", "unnamed"));
        expect(await hasSymbol(executable(folder, "unnamed"), "fibonacci")).toBe(false);
      }),
    300_000,
  );

  test.each([
    [[], "--aot-allow-code-from-disk"],
    [["run"], "--aot-allow-code-from-disk"],
    [["test"], "--aot"],
    [["build"], "guards-json"],
    [["compile"], "guards-json"],
    [["check"], "--explain"],
  ] as [string[], string][])("bun %j --help lists no hidden value of --explain", async (command, listed) => {
    using dir = tempDir("aot-help", {});
    const { stdout, stderr } = await bun(String(dir), ...command, "--help");
    const help = stdout + stderr;
    expect(help).toContain(listed);
    for (const value of hiddenExplainValues) expect(help).not.toContain(value);
  });

  test("bun check --help lists --aot and no hidden flag", async () => {
    using dir = tempDir("aot-check-help", {});
    const { stdout, stderr } = await bun(String(dir), "check", "--help");
    const help = stdout + stderr;
    expect([...new Set(help.match(/--[a-z-]*\baot\b[a-z-]*/g))]).toEqual(["--aot"]);
    expect(help).not.toContain("--trim-without");
  });
});
