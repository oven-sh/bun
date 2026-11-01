// What a machine, a build or an environment must have for some tests of this folder to run. CI prints nothing of a file that passes: not how
// many tests it skipped, nor what it said on stderr. So a test that skips itself for want of one of these is seen by nobody, and a lane
// that loses one goes on passing. A skip of that kind asks `without()`, and ../what-this-lane-can.test.ts holds what every lane has
// against ../what-this-lane-can.json.
// The file that finds a thing says how: `declare()`. This file imports none of the large ones, so a test loads only what it asks for.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { findBuiltinTable } from "./builtin-table";

// test/harness.ts imports ../hardened.ts, which imports this file: so this file imports nothing of "harness", whose constants are not yet made while it runs.
const bunExe = () => process.execPath;

// ./every-build.ts. ../../harness.ts takes CI's own variables out of the environment when it is loaded, and loads this file before that.
if (process.env.AOT_WHOLE_GRIDS === "1") process.env.AOT_WHOLE ??= "1";
if (process.env.BUILDKITE_BUILD_NUMBER)
  process.env.AOT_WHOLE ??= process.env.BUILDKITE_MESSAGE?.includes("[aot whole]") ? "1" : "0";

export const capabilities = [
  "the table of built-ins",
  "jsc",
  "testaot",
  "the tests of the engine",
  "the scripts of the shell",
  "a Bun that trims",
  "a counter of instructions",
  "one process watches another",
  "a hardened build",
  "a locked environment",
  "guarded pages",
  "the words that break a build on purpose",
  "a C compiler",
  "python3",
  "a canary",
  "test files of a folder below run by name",
] as const;
export type Capability = (typeof capabilities)[number];

const {
  EXPECTED_PLATFORM_OS: os = { darwin: "darwin", win32: "windows" }[process.platform as string] ?? process.platform,
  EXPECTED_PLATFORM_ARCH: arch = process.arch === "arm64" ? "aarch64" : process.arch,
  EXPECTED_PLATFORM_ABI: abi = existsSync("/etc/alpine-release") ? "musl" : undefined,
  EXPECTED_PLATFORM_PROFILE: profile = /asan|debug/.exec(basename(process.execPath))?.[0],
} = process.env;
/** By what .buildkite/ci.ts tells a step that tests a build. AOT_LANE: a bench with a line of its own. */
export const lane = process.env.AOT_LANE ?? [os, arch, abi, profile].filter(Boolean).join("-");

// CI shows what a file said only where the file fails. ../what-this-lane-can.test.ts leaves what it found here, and every file of the
// folder that runs behind it in the same temporary folder says it again, so that whatever fails there carries it.
export const whereTheLineOfThisLaneLies = join(tmpdir(), `what-this-lane-can.${lane}.json`);
// A script that a test starts says nothing: its stderr may be held against a text.
const isTestFile = /\.test\.[cm]?[jt]sx?$/.test(Bun.main);
if (isTestFile && existsSync(whereTheLineOfThisLaneLies))
  console.error(`lane ${lane} can: ${readFileSync(whereTheLineOfThisLaneLies, "utf8")}`);

type Probe = () => string | undefined;
const probes = new Map<Capability, Probe>();
const answers = new Map<Capability, string | undefined>();

/** `whyNot` answers why it is not to be had here, in words for whoever reads a log. Undefined: it is. */
export function declare(capability: Capability, whyNot: Probe): void {
  probes.set(capability, whyNot);
}

/** Why `capability` is not to be had here. Undefined: it is. The first answer stands, and goes to stderr once. */
export function without(capability: Capability): string | undefined {
  if (answers.has(capability)) return answers.get(capability);
  const probe = probes.get(capability);
  if (!probe) throw new Error(`nothing that is loaded here finds ${capability}: import the file that declares it`);
  const reason = probe();
  answers.set(capability, reason);
  if (isTestFile)
    console.error(`lane ${lane}: ${capability}: ${reason === undefined ? "it is to be had" : `SKIPPED: ${reason}`}`);
  return reason;
}

declare("the table of built-ins", () =>
  findBuiltinTable(bunExe())
    ? undefined
    : `AOT_BUILTIN_TABLE names none, and no aot_builtin_table.json lies beside ${bunExe()}`,
);
export const cCompiler = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
declare("a C compiler", () => (cCompiler ? undefined : "no cc, gcc or clang is on the path, and $CC names none"));
declare("python3", () => (Bun.which("python3") ? undefined : "no python3 is on the path"));
declare("a canary", () =>
  Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary") ? undefined : "this Bun is a release",
);
// No test may lean on it: ./test-files.ts. The table says which file systems the lanes have.
declare("test files of a folder below run by name", () => {
  const project = mkdtempSync(join(tmpdir(), "aot-order-of-test-files-"));
  mkdirSync(join(project, "tests"));
  for (const name of ["a", "m", "z"])
    writeFileSync(join(project, "tests", `${name}.test.js`), `test("${name}", () => console.error("RAN ${name}"));\n`);
  const { stderr } = Bun.spawnSync([bunExe(), "test"], { cwd: project, stderr: "pipe", stdout: "ignore" });
  rmSync(project, { recursive: true, force: true });
  const ran = [...stderr.toString().matchAll(/^RAN (.)$/gm)].map(match => match[1]).join(" ");
  return ran === "a m z" ? undefined : `written a m z below ${tmpdir()}, they run ${ran}`;
});
