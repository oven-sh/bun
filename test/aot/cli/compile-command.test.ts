import { expect } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const interpreterForbidden = { ...env, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const bun = (cwd: string, ...args: string[]) => spawned([bunExe(), ...args], cwd, env);
const executable = (folder: string, name: string) => join(folder, isWindows ? name + ".exe" : name);
const hasCompiledProgram = (path: string) => {
  const file = readFileSync(path);
  const trailer = file.lastIndexOf("\n---- Bun! ----\n", undefined as any, "latin1");
  return (file.readUInt32LE(trailer - 4) & (1 << 14)) !== 0;
};

async function buildAndHash(folder: string, ...command: string[]) {
  const app = executable(folder, "app");
  rmSync(app, { force: true });
  const build = await bun(folder, ...command, "--outfile", "app");
  built(build);
  return {
    sha256: new Bun.CryptoHasher("sha256").update(readFileSync(app)).digest("hex"),
    // A time is padded to a fixed width.
    output: (build.stdout + build.stderr).replace(/ *\[[\d.]+ ?m?s\]/g, "[time]"),
  };
}

const buildLimit = 300_000;
const program = {
  "app.ts": `import { twice } from "./lib";\nconst list: number[] = [1, 2, 3];\nconsole.log(list.map(twice).join(), process.argv.slice(2).join(" "));\n`,
  "lib.ts": `export function twice(n: number): number {\n  return n * 2;\n}\n`,
};
const unbuildable = {
  "wrong.ts": `import "./missing-module";\nconst n: number = "one";\nconsole.log(n);\n`,
  "app.order": "",
};

const mainSource = (worker: string, lib: string) => `import { twice } from "${lib}";
const worker = new Worker("${worker}");
const answer = await new Promise<number>(resolve => {
  worker.onmessage = event => resolve(event.data);
  worker.postMessage(10);
});
worker.terminate();
console.log(twice(answer));
`;
const workerSource = (lib: string) => `import { twice } from "${lib}";
declare var self: Worker;
self.onmessage = event => postMessage(twice(event.data) + 1);
`;

// In an executable, a Worker's relative path starts at the directory that contains every entry point.
const entryPatterns: [patterns: string[], matches: string[], files: Record<string, string>][] = [
  [
    ["apps/*/main.ts"],
    ["apps/web/main.ts"],
    {
      "apps/web/main.ts": `import { twice } from "./lib";\nconsole.log(twice(21));\n`,
      "apps/web/lib.ts": program["lib.ts"],
      "apps/docs/notes.ts": `console.log("not an entry point");\n`,
    },
  ],
  [
    ["src/**/*.ts"],
    ["src/app.ts", "src/lib.ts", "src/workers/answer.ts"],
    {
      "src/app.ts": mainSource("./workers/answer.ts", "./lib"),
      "src/lib.ts": program["lib.ts"],
      "src/workers/answer.ts": workerSource("../lib"),
    },
  ],
  [
    ["apps/*/main.ts", "packages/*/worker.ts"],
    ["apps/web/main.ts", "packages/answer/worker.ts"],
    {
      "apps/web/main.ts": mainSource("./packages/answer/worker.ts", "../../lib"),
      "packages/answer/worker.ts": workerSource("../../lib"),
      "lib.ts": program["lib.ts"],
    },
  ],
];
const entryPatternsRow = (pattern: string) => entryPatterns.find(([patterns]) => patterns.join() === pattern)!;

const other = process.platform === "linux" ? "bun-darwin-x64" : "bun-linux-x64";
const invalidExplain = (value: string) =>
  `Invalid value for --explain: "${value}". Must be one of text, json, guards, guards-json, trim, missed-optimizations, allocations, statistics`;
const aotCrossCompile = "--aot can't cross-compile. It only builds for the platform it runs on";

const rejected: [string[], string][] = [
  [["build", "--aot"], "--aot requires --compile"],
  [["build", "--trim"], "--trim requires --compile"],
  [["build", "--compile", "--aot-log-type-mismatches"], "--aot-log-type-mismatches requires --aot"],
  [["build", "--compile", "--explain"], "--explain requires --aot"],
  [["build", "--compile", "--aot-huge-heap"], "--aot-huge-heap requires --aot"],
  [["build", "--compile", "--compile-in-place"], "--compile-in-place requires --aot"],
  [["compile", "--no-aot", "--explain=guards"], "--explain requires --aot"],
  [["compile", "--aot", "--no-aot"], "Cannot use both --aot and --no-aot"],
  [["build", "--compile", "--aot", `--target=${other}`], aotCrossCompile],
  [
    ["compile", `--target=${other}`],
    "bun compile can't cross-compile. It only builds for the platform it runs on\nnote: run this on the target platform, or pass --no-aot to bundle your code with the Bun runtime instead, like bun build --compile",
  ],
  [
    ["compile", "--aot-type-errors=warn"],
    "unknown flag --aot-type-errors. The --aot flags for this command are --aot, --aot-allow-code-from-disk, --aot-huge-heap, --aot-log-type-mismatches",
  ],
  [["compile", "--explain=nonsense"], invalidExplain("nonsense")],
  [["compile", "--explain=json", "--explain=allocation"], invalidExplain("allocation")],
  [["build", "--aot", "--explain=nonsense"], "--aot requires --compile"],
  [["build", "--compile", "--aot", `--target=${other}`, "--format=cjs"], aotCrossCompile],
];

const publicFlags: Record<string, string[]> = {
  "": ["--aot", "--aot-log-type-mismatches"],
  run: ["--aot", "--aot-log-type-mismatches"],
  test: ["--aot", "--aot-log-type-mismatches"],
  build: ["--aot", "--aot-allow-code-from-disk", "--aot-log-type-mismatches", "--aot-huge-heap"],
  compile: ["--aot", "--no-aot", "--aot-allow-code-from-disk", "--aot-log-type-mismatches", "--aot-huge-heap"],
};

describe.concurrent("bun compile", () => {
  test.each([
    [[]],
    [["--aot-log-type-mismatches", "--no-compile-function-source"]],
    [["--aot-huge-heap", "--explain=json"]],
    [["--define", 'process.env.MODE="x"', "--compile-exec-argv=--smol"]],
  ])(
    "writes what bun build --compile --aot writes: %j",
    (flags: string[]) =>
      slot(async () => {
        using dir = tempDir("compile-same-bytes", program);
        const folder = String(dir);
        expect(await buildAndHash(folder, "compile", ...flags, "app.ts")).toEqual(
          await buildAndHash(folder, "build", "--compile", "--aot", ...flags, "app.ts"),
        );
        const app = executable(folder, "app");
        expect(await spawned([app, "a", "b"], folder, env)).toMatchObject({
          stdout: "2,4,6 a b\n",
          exitCode: 0,
          signal: null,
        });
        expect(hasCompiledProgram(app)).toBe(true);
      }),
    buildLimit,
  );

  test.each(entryPatterns)(
    "entry point patterns write what their matches write: %j",
    (patterns: string[], matches: string[], files: Record<string, string>) =>
      slot(async () => {
        using dir = tempDir("compile-entry-patterns", files);
        const folder = String(dir);
        const fromMatches = await buildAndHash(folder, "compile", ...matches);
        expect(await buildAndHash(folder, "compile", ...patterns)).toEqual(fromMatches);
        expect(await spawned([executable(folder, "app")], "/", interpreterForbidden)).toMatchObject({
          stdout: "42\n",
          exitCode: 0,
          signal: null,
        });
      }),
    buildLimit,
  );

  test(
    "without --outfile, the first match of an entry point pattern names the executable",
    () =>
      slot(async () => {
        const [patterns, , files] = entryPatternsRow("src/**/*.ts");
        using dir = tempDir("compile-pattern-default-name", files);
        const folder = String(dir);
        built(await bun(folder, "compile", ...patterns));
        expect(existsSync(executable(folder, "*"))).toBe(false);
        const app = executable(folder, "app");
        expect(hasCompiledProgram(app)).toBe(true);
        expect(await spawned([app], "/", interpreterForbidden)).toMatchObject({
          stdout: "42\n",
          exitCode: 0,
          signal: null,
        });
      }),
    buildLimit,
  );

  test("an entry point pattern without a match is an error", async () => {
    using dir = tempDir("compile-pattern-without-match", program);
    const folder = String(dir);
    const ran = await bun(folder, "compile", "apps/*/main.ts", "--outfile", "out");
    expect(ran.stderr).toContain(`no file matches the entry point "apps/*/main.ts"`);
    expect(ran.exitCode).toBe(1);
    expect(existsSync(executable(folder, "out"))).toBe(false);
  });

  test(
    "reads [bundle] entryPoints of bunfig.toml as bun build --compile --aot does",
    () =>
      slot(async () => {
        using dir = tempDir("compile-bunfig-entry-points", {
          ...program,
          "bunfig.toml": `[bundle]\nentryPoints = ["./app.ts"]\n`,
        });
        const folder = String(dir);
        expect(await buildAndHash(folder, "compile")).toEqual(
          await buildAndHash(folder, "build", "--compile", "--aot"),
        );
        const app = executable(folder, "app");
        expect(hasCompiledProgram(app)).toBe(true);
        expect(await spawned([app], folder, env)).toMatchObject({ stdout: "2,4,6 \n", exitCode: 0, signal: null });
      }),
    buildLimit,
  );

  test(
    "Bun.build compiles, and --no-aot and plain --compile do not",
    () =>
      slot(async () => {
        using dir = tempDir("compile-other-commands", {
          ...program,
          "build.ts": `const result = await Bun.build({ entrypoints: ["./app.ts"], compile: { aot: true, outfile: "./from-api" } });\nconsole.log(result.success);\n`,
        });
        const folder = String(dir);
        const printsProgramOutput = { stdout: "2,4,6 \n", exitCode: 0, signal: null };

        const api = await bun(folder, "build.ts");
        expect({ stdout: api.stdout, exitCode: api.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
        const fromApi = executable(folder, "from-api");
        expect(hasCompiledProgram(fromApi)).toBe(true);
        expect(await spawned([fromApi], folder, env)).toMatchObject(printsProgramOutput);

        built(await bun(folder, "compile", "--no-aot", "app.ts", "--outfile", "plain"));
        const plain = executable(folder, "plain");
        expect(hasCompiledProgram(plain)).toBe(false);
        expect(await spawned([plain], folder, env)).toMatchObject(printsProgramOutput);

        built(await bun(folder, "build", "--compile", "app.ts", "--outfile", "bundled"));
        expect(hasCompiledProgram(executable(folder, "bundled"))).toBe(false);
      }),
    buildLimit,
  );

  test(
    "Bun.build expands an entry point pattern, and its first match names the executable",
    () =>
      slot(async () => {
        const [patterns, , files] = entryPatternsRow("apps/*/main.ts");
        using dir = tempDir("compile-api-entry-pattern", {
          ...files,
          "build.ts": `const result = await Bun.build({ entrypoints: ${JSON.stringify(patterns)}, compile: { aot: true } });\nconsole.log(result.success);\n`,
        });
        const folder = String(dir);

        const api = await bun(folder, "build.ts");
        expect({ stdout: api.stdout, stderr: api.exitCode ? api.stderr : "", exitCode: api.exitCode }).toEqual({
          stdout: "true\n",
          stderr: "",
          exitCode: 0,
        });
        const main = executable(folder, "main");
        expect(hasCompiledProgram(main)).toBe(true);
        expect(await spawned([main], "/", interpreterForbidden)).toMatchObject({
          stdout: "42\n",
          exitCode: 0,
          signal: null,
        });
      }),
    buildLimit,
  );

  test("a compile script runs before flags are parsed, and --no-script runs the command", async () => {
    using dir = tempDir("compile-script", {
      ...program,
      "package.json": JSON.stringify({ name: "has-a-script", scripts: { compile: "echo the script" } }),
    });
    const folder = String(dir);

    const script = await bun(folder, "compile", "--aot-nonsense", "--explain=nonsense");
    expect({ stdout: script.stdout, exitCode: script.exitCode }).toEqual({
      stdout: "the script --aot-nonsense --explain=nonsense\n",
      exitCode: 0,
    });

    const command = await bun(folder, "compile", "--no-script", "--explain=nonsense", "app.ts");
    expect({ stdout: command.stdout, stderr: command.stderr, exitCode: command.exitCode }).toEqual({
      stdout: "",
      stderr: `error: ${invalidExplain("nonsense")}\n`,
      exitCode: 1,
    });
  });

  test.each(rejected)("bun %j", async (args: string[], message: string) => {
    using dir = tempDir("compile-rejected", unbuildable);
    const folder = String(dir);
    const ran = await bun(folder, ...args, "wrong.ts", "--outfile", "out");
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
      stdout: "",
      stderr: `error: ${message}\n`,
      exitCode: 1,
    });
    expect(existsSync(executable(folder, "out"))).toBe(false);
  });

  test("a rejection through Bun.build uses the names of the API", async () => {
    using dir = tempDir("compile-rejected-api", {
      ...unbuildable,
      "reject.ts": `const requests = [
  { entrypoints: ["./wrong.ts"], compile: { outfile: "./out", aotExplain: "guards" } },
  { entrypoints: ["./wrong.ts"], compile: { aot: true, target: ${JSON.stringify(other)}, outfile: "./out" } },
];
for (const request of requests) {
  try {
    await Bun.build(request as any);
    console.log("built");
  } catch (error) {
    console.log(error.message);
  }
}
`,
    });
    const folder = String(dir);
    const ran = await bun(folder, "reject.ts");
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
      stdout:
        "compile.aotExplain requires compile.aot: true\n" +
        "compile.aot can't cross-compile. It only builds for the platform it runs on\n",
      exitCode: 0,
    });
    expect(existsSync(executable(folder, "out"))).toBe(false);
  });

  test.each(Object.keys(publicFlags))("bun %s --help", async (command: string) => {
    using dir = tempDir("compile-help", program);
    const ran = await bun(String(dir), ...(command ? [command] : []), "--help");
    const help = ran.stdout + ran.stderr;
    expect(ran.exitCode).toBe(0);

    const named = [...new Set(help.match(/--[a-z-]*\baot\b[a-z-]*/g) ?? [])].sort();
    expect(named).toEqual([...publicFlags[command]].sort());
    expect(help).not.toContain("--trim-without");

    if (command === "build" || command === "compile") {
      for (const flag of ["--trim", "--explain", "--compile-in-place", "--no-compile-function-source"]) {
        expect(help).toContain(flag);
      }
    }
    if (command === "build") {
      expect(help).not.toContain("--no-script");
    }
  });
});
