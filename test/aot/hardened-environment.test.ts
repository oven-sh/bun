import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { locksEnvironment } from "./hardened";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

const program = `console.log(process.argv.slice(2).join(" "), typeof WebAssembly, process.pid);
`;

describe.skipIf(!locksEnvironment)("an executable of a hardened build", () => {
  let directory: ReturnType<typeof tempDir>;
  let executable: string;
  let starts = false;

  beforeAll(async () => {
    directory = tempDir("aot-hardened-environment", { "program.js": program });
    executable = join(String(directory), "program");
    const source = join(String(directory), "program.js");
    const built = await run([bunExe(), "build", "--compile", "--aot", source, "--outfile", executable]);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    starts = (await run([executable])).exitCode === 0;
  }, 120_000);

  const runWith = async (words: Record<string, string>) => {
    const { stdout, stderr, exitCode } = await run([executable, "--version"], String(directory), {
      ...bunEnv,
      ...words,
    });
    const [, kindOfWebAssembly, pid] = stdout.trim().split(" ");
    return { stdout: stdout.replace(/ \d+\n$/, ""), stderr, exitCode, kindOfWebAssembly, pid };
  };
  const asAlways = { stdout: "--version object", stderr: "", exitCode: 0 };

  test.each([
    ["BUN_AOT_VERBOSE", "1"],
    ["BUN_BE_BUN", "1"],
    ["BUN_OPTIONS", "--print 1"],
    ["BUN_INSPECT", "ws://127.0.0.1:0/hardened"],
    ["BUN_JSC_dumpOptions", "1"],
    ["BUN_JSC_logGC", "1"],
    ["BUN_JSC_useAOT", "0"],
    ["BUN_JSC_thereIsNoSuchOption", "1"],
    ["MIMALLOC_VERBOSE", "1"],
    ["MIMALLOC_SHOW_STATS", "1"],
    ["MI_VERBOSE", "1"],
  ])("does what it always does with %s=%s", async (name, value) => {
    if (!starts) return;
    expect(await runWith({ [name]: value })).toMatchObject(asAlways);
  });

  test("writes no file that the environment names", async () => {
    if (!starts) return;
    const path = (name: string) => join(String(directory), name);
    const before = readdirSync(String(directory)).sort();
    const { pid, ...result } = await runWith({
      BUN_AOT_TYPE_MISMATCH_LOG: path("mismatches.jsonl"),
      BUN_BYTECODE_DIGEST_OUT: path("digest.txt"),
      BUN_BYTECODE_ORDER_OUT: path("order.txt"),
      BUN_TRACE: path("trace.jsonl"),
      BUN_JSC_aotCountsPath: path("counts.txt"),
      BUN_JSC_aotMapFilePath: path("map.txt"),
      BUN_JSC_useAOTPerfMap: "1",
      MIMALLOC_SNAPSHOT_ON_EXIT: "1",
      MIMALLOC_SNAPSHOT_PATH: path("heap.snapshot"),
    });
    expect(result).toMatchObject(asAlways);
    expect(readdirSync(String(directory)).sort()).toEqual(before);
    expect(existsSync(`/tmp/perf-${pid}.map`)).toBe(false);
  });

  test("still takes a switch that only takes something away", async () => {
    if (!starts) return;
    expect(await runWith({ BUN_JSC_useWasm: "0" })).toMatchObject({ ...asAlways, stdout: "--version undefined" });
  });
});
