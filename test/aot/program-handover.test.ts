// `bun test --aot` and `bun run --debug-aot` build the program in one process and run it in others. It gets there in an unnamed
// file: a memfd, else shared memory, else a deleted file of the temporary directory. Only Linux has all three.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const files = {
  "tmp/.keep": "",
  "seen.ts": `
    import { fstatSync, readdirSync, readFileSync } from "node:fs";
    function fileOfCode() {
      if (process.platform !== "linux") {
        // Shared memory is no regular file there.
        const isDeletedFile = (descriptor: string) => {
          try {
            const status = fstatSync(Number(descriptor));
            return status.isFile() && status.nlink === 0;
          } catch {
            return false;
          }
        };
        return readdirSync("/dev/fd").some(isDeletedFile) ? "deleted" : "none";
      }
      const path = / r-xp .* (\\S+) \\(deleted\\)$/m.exec(readFileSync("/proc/self/maps", "utf8"))?.[1] ?? "none";
      if (path.startsWith("/memfd:")) return "memfd";
      if (path.startsWith("/dev/shm/")) return "shared-memory";
      return path.endsWith(".bun-program") ? "deleted" : path;
    }
    export const seen = () => "code in " + fileOfCode() + ", temporary files: " + readdirSync(process.env.BUN_TMPDIR!).join(" ");
  `,
  "a.test.ts": `
    import { expect, test } from "bun:test";
    import { seen } from "./seen";
    test("a", () => { console.log("a: " + seen()); expect(1).toBe(1); });
  `,
  "b.test.ts": `
    import { expect, test } from "bun:test";
    import { seen } from "./seen";
    test("b", () => { console.log("b: " + seen()); expect(1).toBe(1); });
  `,
  "waits.ts": `
    import { seen } from "./seen";
    console.log(seen());
    setInterval(() => {}, 1 << 30);
  `,
};

const namesInSharedMemory = () =>
  existsSync("/dev/shm") ? readdirSync("/dev/shm").filter(name => name.endsWith(".bun-program")) : [];

// Alpine mounts it `noexec`.
const sharedMemoryHoldsCode =
  isLinux && /^\S+ \/dev\/shm \S+ (?!\S*\bnoexec\b)/m.test(readFileSync("/proc/mounts", "utf8"));
// macOS has the last one alone: it maps shared memory neither executable nor private.
const kinds = isLinux ? ["memfd", ...(sharedMemoryHoldsCode ? ["shared-memory"] : []), "deleted"] : ["deleted"];
// A build costs over a second of CPU however small the program. With three kinds, Linux runs each under --parallel, which hands the
// program on twice, and kills a run of one. The runs with /dev/shm mounted anew are without --parallel, and those of
// test-run-in-parts.test.ts are in parts.
const kindThatIsKilled = kinds.includes("shared-memory") ? "shared-memory" : "deleted";

describe.skipIf(isWindows).each(kinds)("in %s", kind => {
  const envOf = (dir: string, words?: string) => ({
    ...bunEnv,
    BUN_TMPDIR: join(dir, "tmp"),
    // Elsewhere the test says which kind Bun takes by itself.
    BUN_DEBUG_TEST_AOT_PROGRAM_FILE: isLinux ? kind : undefined,
    BUN_DEBUG_TEST_AOT_WORDS: words,
  });
  // Under --parallel what a test prints comes out on stderr.
  const whatEachTestSees = (output: string) =>
    output
      .split("\n")
      .filter(line => line.includes("code in "))
      .sort();

  test.concurrent.each(isLinux ? [[["--parallel=2"]]] : [[[]], [["--parallel=2"]]])(
    "bun test --aot %j",
    async flags => {
      using dir = tempDir("aot-program-handover", files);
      const { stdout, stderr, exitCode } = await run(
        [bunExe(), "test", "--aot", ...flags],
        String(dir),
        envOf(String(dir)),
      );
      expect(whatEachTestSees(stdout + stderr)).toEqual(
        ["a", "b"].map(name => `${name}: code in ${kind}, temporary files: .keep`),
      );
      expect(stderr).toMatch(/^ *2 pass$/m);
      expect(readdirSync(join(String(dir), "tmp"))).toEqual([".keep"]);
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent.skipIf(isLinux)("bun test --aot in parts", async () => {
    using dir = tempDir("aot-program-handover", files);
    const env = envOf(String(dir), "TestRunPartFiles:1");
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
    expect(whatEachTestSees(stdout + stderr).map(line => line.replace(/,.*/, ""))).toEqual([
      `a: code in ${kind}`,
      `b: code in ${kind}`,
    ]);
    expect(stderr).toMatch(/^ *2 pass$/m);
    expect(readdirSync(join(String(dir), "tmp"))).toEqual([".keep"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(kind !== kindThatIsKilled)("a run that is killed leaves nothing", async () => {
    using dir = tempDir("aot-program-handover", files);
    const before = new Set(namesInSharedMemory());
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--debug-aot", "waits.ts"],
      cwd: String(dir),
      env: envOf(String(dir)),
      stdout: "pipe",
      stderr: "inherit",
    });
    const { value } = await proc.stdout.getReader().read();
    expect(new TextDecoder().decode(value)).toBe(`code in ${kind}, temporary files: .keep\n`);
    proc.kill("SIGKILL");
    await proc.exited;
    expect(readdirSync(join(String(dir), "tmp"))).toEqual([".keep"]);
    // Another run's name is there between two of its system calls.
    let left = namesInSharedMemory().filter(name => !before.has(name));
    if (left.length) {
      await Bun.sleep(100);
      left = namesInSharedMemory().filter(name => left.includes(name));
    }
    expect(left).toEqual([]);
  });
});

const inOwnMounts = ["unshare", "-Urm"];
const canMount =
  isLinux &&
  !!Bun.which("unshare") &&
  Bun.spawnSync({ cmd: [...inOwnMounts, "mount", "-t", "tmpfs", "tmpfs", "/dev/shm"] }).exitCode === 0;

test.concurrent.skipIf(!canMount).each(["noexec", "size=64k"])(
  "shared memory that is mounted with %s is passed over",
  async option => {
    using dir = tempDir("aot-program-handover", files);
    const { stdout, stderr, exitCode } = await run(
      [
        ...inOwnMounts,
        "sh",
        "-c",
        `mount -t tmpfs -o ${option} tmpfs /dev/shm && exec "$@"`,
        "sh",
        bunExe(),
        "test",
        "--aot",
      ],
      String(dir),
      { ...bunEnv, BUN_TMPDIR: join(String(dir), "tmp"), BUN_DEBUG_TEST_AOT_PROGRAM_FILE: "shared-memory" },
    );
    expect(stdout).toContain("a: code in deleted, temporary files: .keep\n");
    expect(stderr).toMatch(/^ *2 pass$/m);
    expect(exitCode).toBe(0);
  },
);

// What the test files import waits in deleted files, which every process of the run maps: ./test-run-in-parts.test.ts. What a build
// prints goes to a file of the same directory.
describe.skipIf(!canMount)("a temporary directory without room for what the test files import", () => {
  const runTests = (dir: string, kind?: string) =>
    run(
      [
        ...inOwnMounts,
        "sh",
        "-c",
        `mount -t tmpfs -o size=1m tmpfs "$BUN_TMPDIR" && exec "$@"`,
        "sh",
        bunExe(),
        "test",
        "--aot",
      ],
      dir,
      {
        ...bunEnv,
        BUN_TMPDIR: join(dir, "tmp"),
        BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1",
        BUN_DEBUG_TEST_AOT_PROGRAM_FILE: kind,
      },
    );
  const about = (stderr: string, word: string) => stderr.split("\n").filter(line => line.includes(word));

  test.concurrent("it is compiled again and waits in memory", async () => {
    using dir = tempDir("aot-program-handover", files);
    const { stdout, stderr, exitCode } = await runTests(String(dir));
    expect(about(stderr, "no room")).toEqual([
      `warn: the temporary directory ${join(String(dir), "tmp")} has no room for what the test files import, compiled. It is compiled again and kept in memory`,
    ]);
    expect(about(stderr, "could not")).toEqual([]);
    expect(stdout).toContain("a: code in memfd, temporary files: \n");
    expect(stderr).toMatch(/^ *2 pass$/m);
    expect(exitCode).toBe(0);
  });

  test.concurrent("where memory has none either, that is what is said", async () => {
    using dir = tempDir("aot-program-handover", files);
    const { stderr, exitCode } = await runTests(String(dir), "deleted");
    expect(about(stderr, "could not")).toEqual([
      "error: what the test files import could not be compiled: neither memory nor the temporary directory has room for the program, in the build of the packages. None of the 2 test files ran",
    ]);
    expect(exitCode).toBe(1);
  });
});
