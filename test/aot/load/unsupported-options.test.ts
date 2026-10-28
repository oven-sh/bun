import { expect } from "bun:test";
import { bunEnv, bunExe, isMusl, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

const exe = (name: string) => name + (isWindows ? ".exe" : "");
const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const MAIN = 'console.log("ran");\n';
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext", "dom"],
  },
});
const BANNER_WITH_CODE = "--banner=globalThis.fromBanner = 1;";
const BANNER_MESSAGE = "--aot does not support --banner with code";
const otherTarget = process.platform === "linux" ? "bun-darwin-x64" : "bun-linux-x64";
const hostSystem = { linux: "linux", darwin: "darwin", win32: "windows" }[process.platform as string];
const hostTarget = hostSystem && `bun-${hostSystem}-${process.arch}${isMusl ? "-musl" : ""}`;

const programPath = (folder: string) => join(folder, exe("program"));

async function build(folder: string, flags: string[]) {
  const built = await spawned(
    [bunExe(), "build", "--compile", "--aot", ...flags, "main.ts", "--outfile", programPath(folder)],
    folder,
    { ...bunEnv, NO_COLOR: "1" },
  );
  const errors = (built.stdout + built.stderr)
    .split(/\r?\n/)
    .filter(line => line.startsWith("error: "))
    .map(line => line.slice("error: ".length));
  return { errors, exitCode: built.exitCode, wrote: existsSync(programPath(folder)) };
}

async function expectRejected(files: Record<string, string>, flag: string, message: string) {
  using dir = tempDir("aot-load-options", files);
  const result = await build(String(dir), [flag]);
  expect(result).toEqual({ errors: [expect.any(String)], exitCode: 1, wrote: false });
  expect(result.errors[0]).toEndWith(message);
}

const rejected: [flag: string, message: string][] = [
  [BANNER_WITH_CODE, BANNER_MESSAGE],
  ["--footer=globalThis.fromFooter = 1;", "--aot does not support --footer with code"],
  [`--target=${otherTarget}`, "--aot can't cross-compile. It only builds for the platform it runs on"],
  ...(hostTarget
    ? ([[`--target=${hostTarget}-v1.0.0`, "--aot can't cross-compile. It only builds for the platform it runs on"]] as [
        string,
        string,
      ][])
    : []),
];

const accepted = [
  "--banner=// a banner",
  "--footer=/* a footer */",
  "--banner=// one\n/* two */",
  "--format=esm",
  "--format=cjs",
  "--format=iife",
  "--target=bun",
  "--bytecode",
  "--bytecode-depth=1",
  "--bytecode-order=app.order",
  "--splitting",
  ...(hostTarget ? [`--target=${hostTarget}`, `--target=${hostTarget}-baseline`, `--target=${hostTarget}-modern`] : []),
];

const BUILD_SCRIPT = `const result = await Bun.build({ entrypoints: ["./main.ts"], banner: "globalThis.fromBanner = 1;", compile: { outfile: "./program", aot: true }, throw: false });
console.log(result.success, JSON.stringify(result.logs.filter(log => log.level === "error").map(log => log.message)));
`;

const BUILD_FOR_HOST_SCRIPT = `const result = await Bun.build({ entrypoints: ["./main.ts"], target: process.argv[2], compile: { outfile: "./program", aot: true }, throw: false });
console.log(result.success, JSON.stringify(result.logs.filter(log => log.level === "error").map(log => log.message)));
`;

describe.concurrent("compile/aot/load/unsupported-options", () => {
  test.each(rejected)(
    "rejected: %s",
    (flag, message) => slot(() => expectRejected({ "main.ts": MAIN, "app.order": "" }, flag, message)),
    600_000,
  );

  test.each(accepted)(
    "accepted: %j",
    flag =>
      slot(async () => {
        using dir = tempDir("aot-load-options", { "tsconfig.json": TSCONFIG, "main.ts": MAIN, "app.order": "" });
        const folder = String(dir);
        expect(await build(folder, [flag])).toEqual({ errors: [], exitCode: 0, wrote: true });
        const ran = await spawned([programPath(folder)], folder, COMPILED);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
          stdout: "ran\n",
          exitCode: 0,
          signal: null,
        });
      }),
    600_000,
  );

  test(
    "an unsupported option is reported before any file is loaded",
    () =>
      slot(() =>
        expectRejected({ "main.ts": 'const n: number = "text";\nconsole.log(n);\n' }, BANNER_WITH_CODE, BANNER_MESSAGE),
      ),
    600_000,
  );

  test.skipIf(!hostTarget)(
    "Bun.build accepts the platform it runs on, spelled with -baseline",
    () =>
      slot(async () => {
        using dir = tempDir("aot-load-options", {
          "tsconfig.json": TSCONFIG,
          "main.ts": MAIN,
          "build.ts": BUILD_FOR_HOST_SCRIPT,
        });
        const folder = String(dir);
        const built = await spawned([bunExe(), "build.ts", `${hostTarget}-baseline`], folder, bunEnv);
        expect({ stdout: built.stdout, exitCode: built.exitCode }).toEqual({ stdout: "true []\n", exitCode: 0 });
        const ran = await spawned([programPath(folder)], folder, COMPILED);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
          stdout: "ran\n",
          exitCode: 0,
          signal: null,
        });
      }),
    600_000,
  );

  test(
    "Bun.build reports an unsupported option in its logs",
    () =>
      slot(async () => {
        using dir = tempDir("aot-load-options", { "main.ts": MAIN, "build.ts": BUILD_SCRIPT });
        const folder = String(dir);
        const ran = await spawned([bunExe(), "build.ts"], folder, bunEnv);
        expect({
          stdout: ran.stdout,
          stderr: ran.stderr,
          exitCode: ran.exitCode,
          wrote: existsSync(programPath(folder)),
        }).toEqual({
          stdout: expect.stringMatching(/^false \["[^"]*--banner with code"\]\n$/),
          stderr: expect.any(String),
          exitCode: 0,
          wrote: false,
        });
      }),
    600_000,
  );
});
