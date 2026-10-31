// Asking the compiler what it did changes nothing of what it does: a build with a report, or with its explanations, writes the same executable, byte for byte.
// To explain how a value came somewhere the flow analysis keeps more than it needs to compile, and what it keeps may not decide what it finds.
import { describe, expect } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { spawned, unsupported, withoutDebugInformation } from "./harness/commands";
import { afterAll, test } from "./harness/default-timeout";

const root = String(tempDir("aot-asking-for-a-report", {}));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const questions: Record<string, string[]> = {
  "a report of the functions": [`--aot-report=${join(root, "functions.json")}`, "--aot-report-detail=functions"],
  "a report of the sites": [`--aot-report=${join(root, "sites.json")}`, "--aot-report-detail=sites"],
  "the explanations": ["--explain=json"],
};

describe("compile/aot/asking for a report moves no code", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  const carrier = withoutDebugInformation();
  // Proxies that escape and arrive at reads beside values that the compiler does not know.
  const path = join(import.meta.dir, "parallel/builtin-modules/stream-state-mutated.js");
  const build = async (name: string, flags: string[]) => {
    // An executable holds its own name, so all have one name, each in a folder of its own.
    const executable = join(root, name.replaceAll(" ", "-"), isWindows ? "program.exe" : "program");
    mkdirSync(dirname(executable), { recursive: true });
    const built = await spawned(
      [bunExe(), "build", "--compile", "--aot", ...carrier, ...flags, path, "--outfile", executable],
      dirname(path),
      bunEnv,
    );
    return built.exitCode === 0 && !built.signal
      ? new Bun.CryptoHasher("sha256").update(await Bun.file(executable).bytes()).digest("hex")
      : `exit code ${built.exitCode} ${built.signal ?? ""} ${built.stderr.slice(0, 600)}`;
  };
  test("the same executable with and without", async () => {
    const names = Object.keys(questions);
    const [plain, ...asked] = await Promise.all([
      build("nothing", []),
      ...names.map(name => build(name, questions[name])),
    ]);
    expect(plain).toMatch(/^[0-9a-f]{64}$/);
    expect(
      Object.fromEntries(names.map((name, index) => [name, asked[index] === plain ? "the same" : asked[index]])),
    ).toEqual(Object.fromEntries(names.map(name => [name, "the same"])));
  }, 240_000);
});
