import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { locksEnvironment } from "./hardened";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

const program = `import { writeFileSync } from "node:fs";
const [road, mark] = process.argv.slice(2);
writeFileSync(mark, "");
const offending = { BUN_JSC_logGC: "1", MIMALLOC_VERBOSE: "1", BUN_TRACE: "trace.jsonl" };
if (road === "worker") {
  const worker = new Worker("./worker.js", { env: { ...process.env, ...offending } });
  worker.onmessage = event => console.log("the worker sees", event.data);
} else if (road === "child") {
  const child = Bun.spawnSync({ cmd: [process.execPath, "--version", mark + "-of-child"], env: { ...process.env, ...offending } });
  console.log(JSON.stringify({ stdout: child.stdout.toString(), stderr: child.stderr.toString(), exitCode: child.exitCode }));
} else {
  console.log(road, typeof WebAssembly, process.pid);
}
`;
const worker = `postMessage([process.env.BUN_JSC_logGC, process.env.MIMALLOC_VERBOSE, process.env.BUN_TRACE].join(" "));
`;

let directory: ReturnType<typeof tempDir>;
let executable: string;
let starts = false;
let runs = 0;

beforeAll(async () => {
  directory = tempDir("aot-hardened-environment", { "program.js": program, "worker.js": worker });
  executable = join(String(directory), "program");
  const sources = ["program.js", "worker.js"].map(name => join(String(directory), name));
  const built = await run([bunExe(), "build", "--compile", "--aot", ...sources, "--outfile", executable]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const first = await run([executable, "--version", join(String(directory), "first")]);
  starts = first.exitCode === 0;
  asAlways.stdout = first.stdout.replace(/ \d+\n$/, "");
}, 120_000);

/** `ran`: whether the program's first statement did. */
async function start(command: (mark: string) => string[], environment: Record<string, string | undefined>) {
  const mark = join(String(directory), `ran-${runs++}`);
  const { stdout, stderr, exitCode } = await run(command(mark), String(directory), environment);
  return { stdout: stdout.replace(/ \d+\n$/, ""), stderr, exitCode, ran: existsSync(mark), mark };
}
const runWith = (words: Record<string, string>, road = "--version") =>
  start(mark => [executable, road, mark], { ...bunEnv, ...words });

const asAlways = { stdout: "--version object", stderr: "", exitCode: 0, ran: true };
const listOf = (names: string[]) => [names.slice(0, -1).join(", "), names.at(-1)].filter(Boolean).join(" and ");
const sentenceThatNames = (...names: string[]) =>
  `error: can't run this executable's compiled code: the environment sets ${listOf(names)}, which this build of Bun never reads\n`;
const refusalThatNames = (...names: string[]) => ({
  stdout: "",
  stderr: sentenceThatNames(...names),
  exitCode: 1,
  ran: false,
});

// The three tables that keep a variable from being read, out of the sources: a row here for every name in them.
function wordsOfTable(path: string, firstLine: string, lastLine: string) {
  if (!locksEnvironment) return [];
  const text = readFileSync(join(import.meta.dir, "..", "..", path), "utf8");
  const start = text.indexOf(firstLine) + firstLine.length;
  return Array.from(text.slice(start, text.indexOf(lastLine, start)).matchAll(/"(\w+)"/g), match => match[1]);
}
const optionsTaken = wordsOfTable(
  "src/jsc/bindings/ZigGlobalObject.cpp",
  "static bool isOptionThatCompiledCodeTakesFromEnvironment(",
  "};",
);
const wordsOfAllocatorTaken = wordsOfTable(
  "patches/mimalloc/environment-sets-sizes-and-pace-only.patch",
  "bool mi_is_read_from_environment(const char* name) {",
  "};",
);
const namesNeverRead = wordsOfTable("src/bun_core/util.rs", "pub fn is_never_read(", "\n    ];");

const harmlessValues: Record<string, string> = {
  codeBlockAgingLeaseMultiplier: "2",
  crashIfInterpreterIsUsed: "0",
  criticalGCMemoryThreshold: "0.8",
  forceRAMSize: String(2 ** 32),
  gcMaxHeapSize: String(2 ** 31),
  heapGrowthMaxIncrease: "2",
  heapGrowthSteepnessFactor: "1",
  jitMemoryReservationSize: String(2 ** 27),
  largeHeapSize: String(2 ** 24),
  mediumHeapSize: String(2 ** 23),
  numberOfGCMarkers: "2",
  smallHeapSize: String(2 ** 20),
  structureHeapSizeInKB: String(2 ** 18),
  useConcurrentGC: "0",
  useConcurrentJIT: "0",
  useWasm: "1",
};

const startWithRawEnvironment = `import ctypes, sys
strings = lambda items: (ctypes.c_char_p * (len(items) + 1))(*[item.encode() for item in items], None)
count = int(sys.argv[1])
ctypes.CDLL(None).execve(sys.argv[2].encode(), strings(sys.argv[2:2 + count]), strings(sys.argv[2 + count:]))
`;

describe.skipIf(!locksEnvironment)("an executable of a hardened build", () => {
  test("finds the first and the last name of each of the three tables", () => {
    expect([optionsTaken[0], optionsTaken.at(-1)]).toEqual(["codeBlockAgingLeaseMultiplier", "useWasm"]);
    expect([wordsOfAllocatorTaken[0], wordsOfAllocatorTaken.at(-1)]).toEqual([
      "mimalloc_allow_thp",
      "mimalloc_scavenger",
    ]);
    expect([namesNeverRead[0], namesNeverRead.at(-1)]).toEqual(["BUN_BE_BUN", "MI_VERBOSE"]);
  });

  test.each([
    ["BUN_JSC_dumpOptions", "1"],
    ["BUN_JSC_logGC", "1"],
    ["BUN_JSC_useAOT", "0"],
    ["BUN_JSC_thereIsNoSuchOption", "1"],
    ["BUN_JSC_USEWASM", "0"],
    ["BUN_JSC_useWasmMemory64", "0"],
    ["BUN_JSC_", "1"],
    ["MIMALLOC_VERBOSE", "1"],
    ["MIMALLOC_SHOW_STATS", "1"],
    ["MIMALLOC_PURGE_DELAYS", "1"],
    ["MIMALLOC_", "1"],
    ["mimalloc_verbose", "1"],
    ["Mimalloc_Verbose", "1"],
    ["BUN_DEBUG", "1"],
    ["BUN_DEBUG_QUIET_LOGS", "1"],
    ["BUN_DEBUG_ALL", "1"],
    ["BUN_DEBUGGER", "1"],
    ["BUN_AOT_CHECKED_NATIVE_CALLS", "checked.txt"],
    ["BUN_AOT_TYPE_MISMATCH_LOG", "stderr"],
    ["BUN_AOT_TYPE_MISMATCH_LOG_FORMAT", "json"],
    ["BUN_AOT_VERBOSE", "1"],
    ["BUN_AOT_THERE_IS_NO_SUCH_VARIABLE", "1"],
    ["BUN_AOT_", "1"],
    ["BUN_AOT_VERBOSE", ""],
    ["BUN_JSC_logGC", ""],
    ["MIMALLOC_VERBOSE", ""],
    ["BUN_TRACE", ""],
    ["BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING", ""],
  ])("does not start with %s=%s", async (name, value) => {
    if (!starts) return;
    expect(await runWith({ [name]: value })).toMatchObject(refusalThatNames(name));
  });

  test.each(namesNeverRead)("does not start with %s", async name => {
    if (!starts) return;
    expect(await runWith({ [name]: "1" })).toMatchObject(refusalThatNames(name));
  });

  test("is started by the tests with none of them", () => {
    expect(Object.keys(bunEnv).filter(name => namesNeverRead.includes(name))).toEqual([]);
  });

  test("has a value here for every option that it takes", () => {
    expect(Object.keys(harmlessValues)).toEqual(optionsTaken);
  });

  test.each(optionsTaken)("starts with BUN_JSC_%s", async name => {
    if (!starts) return;
    expect(await runWith({ [`BUN_JSC_${name}`]: harmlessValues[name] })).toMatchObject(asAlways);
  });

  test.each(wordsOfAllocatorTaken.flatMap(word => [word, word.toUpperCase()]))("starts with %s", async word => {
    if (!starts) return;
    expect(await runWith({ [word]: "1" })).toMatchObject(asAlways);
  });

  test("starts with every one of them at once, and with variables that are in none of the three tables", async () => {
    if (!starts) return;
    const words = {
      ...Object.fromEntries(optionsTaken.map(name => [`BUN_JSC_${name}`, harmlessValues[name]])),
      ...Object.fromEntries(wordsOfAllocatorTaken.map(word => [word.toUpperCase(), "1"])),
      WTF_numberOfProcessorCores: "2",
      UV_THREADPOOL_SIZE: "2",
      BUN_ENABLE_CRASH_REPORTING: "0",
      BUN_CONFIG_MAX_HTTP_REQUESTS: "64",
      BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: "1",
      BUN_GC_TIMER_INTERVAL: "1000",
      BUN_THERE_IS_NO_SUCH_VARIABLE: "1",
      BUN_AOT: "1",
      bun_aot_verbose: "1",
      NOT_BUN_AOT_VERBOSE: "1",
      bun_jsc_logGC: "1",
      JSC_logGC: "1",
      NOT_BUN_JSC_logGC: "1",
    };
    expect(await runWith(words)).toMatchObject(asAlways);
  });

  test("names every variable that it does not start with, in the order of the environment", async () => {
    if (!starts) return;
    const names = ["MIMALLOC_VERBOSE", "BUN_JSC_logGC", "BUN_TRACE"];
    for (const order of [names, names.toReversed(), names.slice(1)]) {
      const words = Object.fromEntries(order.flatMap(name => [name, `AFTER_${name}`]).map(name => [name, "1"]));
      expect(await runWith(words)).toMatchObject(refusalThatNames(...order));
    }
  });

  test("prints no value", async () => {
    if (!starts) return;
    const { stderr } = await runWith({
      BUN_INSPECT: "ws://127.0.0.1:0/hardened",
      BUN_JSC_aotMapFilePath: "/tmp/hardened",
    });
    expect(stderr).toBe(sentenceThatNames("BUN_INSPECT", "BUN_JSC_aotMapFilePath"));
  });

  test("writes no file that the environment names", async () => {
    if (!starts) return;
    const path = (name: string) => join(String(directory), name);
    const before = readdirSync(String(directory)).sort();
    const words = {
      BUN_AOT_CHECKED_NATIVE_CALLS: path("checked.txt"),
      BUN_AOT_TYPE_MISMATCH_LOG: path("mismatches.jsonl"),
      BUN_BYTECODE_DIGEST_OUT: path("digest.txt"),
      BUN_BYTECODE_ORDER_OUT: path("order.txt"),
      BUN_TRACE: path("trace.jsonl"),
      BUN_JSC_aotCountsPath: path("counts.txt"),
      BUN_JSC_aotMapFilePath: path("map.txt"),
      BUN_JSC_useAOTPerfMap: "1",
      MIMALLOC_SNAPSHOT_ON_EXIT: "1",
      MIMALLOC_SNAPSHOT_PATH: path("heap.snapshot"),
    };
    expect(await runWith(words)).toMatchObject(refusalThatNames(...Object.keys(words)));
    expect(readdirSync(String(directory)).sort()).toEqual(before);
  });

  test.skipIf(!Bun.which("python3"))('does not start with a name that no "=" follows', async () => {
    if (!starts) return;
    const withEntries = (...entries: string[]) =>
      start(mark => ["python3", "-c", startWithRawEnvironment, "3", executable, "--version", mark, ...entries], bunEnv);
    expect(await withEntries("HOME=/", "ALONE")).toMatchObject(asAlways);
    for (const name of [
      "BUN_JSC_useWasm",
      "BUN_JSC_logGC",
      "MIMALLOC_VERBOSE",
      "BUN_TRACE",
      "BUN_DEBUG_ALL",
      "BUN_AOT_VERBOSE",
    ])
      expect(await withEntries("HOME=/", name, "ALONE")).toMatchObject(refusalThatNames(name));
    // The allocator finds its word only in front of a "=", and takes nothing from this one.
    expect(await withEntries("HOME=/", "MIMALLOC_PURGE_DELAY")).toMatchObject(asAlways);
  });

  test("still takes a switch that only takes something away", async () => {
    if (!starts) return;
    expect(await runWith({ BUN_JSC_useWasm: "0" })).toMatchObject({ ...asAlways, stdout: "--version undefined" });
  });

  test("reads BUN_JSC_useConcurrentGC, so a value that is no boolean is refused", async () => {
    if (!starts) return;
    expect(await runWith({ BUN_JSC_useConcurrentGC: "0" })).toMatchObject(asAlways);
    for (const value of ["neither", ""])
      expect(await runWith({ BUN_JSC_useConcurrentGC: value })).toMatchObject({
        stdout: "",
        stderr: expect.stringContaining(`invalid JSC environment variable\n\n    BUN_JSC_useConcurrentGC=${value}\n`),
        exitCode: 1,
        ran: false,
      });
  });

  test("names a variable that it never reads before it looks at the value of one that it does", async () => {
    if (!starts) return;
    const words = { BUN_JSC_useConcurrentGC: "neither", BUN_JSC_logGC: "1" };
    expect(await runWith(words)).toMatchObject(refusalThatNames("BUN_JSC_logGC"));
  });

  test("starts a Worker whose process.env holds such names: they are no environment of a process", async () => {
    if (!starts) return;
    expect(await runWith({}, "worker")).toMatchObject({
      stdout: "the worker sees 1 1 trace.jsonl\n",
      stderr: "",
      exitCode: 0,
    });
    expect(existsSync(join(String(directory), "trace.jsonl"))).toBe(false);
  });

  test("goes on when a copy of itself that it starts with such names does not start", async () => {
    if (!starts) return;
    const { stdout, mark, ...parent } = await runWith({}, "child");
    expect(parent).toMatchObject({ stderr: "", exitCode: 0, ran: true });
    const { ran, ...refusal } = refusalThatNames("BUN_JSC_logGC", "MIMALLOC_VERBOSE", "BUN_TRACE");
    expect(JSON.parse(stdout)).toEqual(refusal);
    expect(existsSync(`${mark}-of-child`)).toBe(ran);
  });

  test.each(["BUN_AOT_CHECKED_NATIVE_CALLS", "BUN_AOT_TYPE_MISMATCH_LOG", "BUN_AOT_VERBOSE"])(
    "has no code that asks for %s",
    name => {
      expect(Bun.spawnSync(["grep", "-q", "-a", name, bunExe()]).exitCode).toBe(1);
    },
  );

  test("is the only thing that does not start: bun itself does", async () => {
    const words = {
      BUN_JSC_logGC: "0",
      MIMALLOC_VERBOSE: "1",
      BUN_DEBUG_QUIET_LOGS: "1",
      BUN_AOT_VERBOSE: "1",
      BUN_BE_BUN: "1",
      BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
      MI_VERBOSE: "1",
    };
    const { stdout, stderr, exitCode } = await run([bunExe(), "-e", "console.log(1 + 1)"], String(directory), {
      ...bunEnv,
      ...words,
    });
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "2\n", stderr: "", exitCode: 0 });
  });
});

describe.skipIf(locksEnvironment)("an executable of any other build", () => {
  test("starts with variables that a hardened build never reads", async () => {
    if (!starts) return;
    const words = {
      BUN_JSC_logGC: "0",
      MIMALLOC_SHOW_ERRORS: "0",
      BUN_DEBUG_QUIET_LOGS: "1",
      BUN_DESTRUCT_VM_ON_EXIT: "0",
      BUN_AOT_THERE_IS_NO_SUCH_VARIABLE: "1",
    };
    expect(await runWith(words)).toMatchObject(asAlways);
  });
});
