// Under a limit on threads (`ulimit -u`, a container's pids limit) that is reached, no thread can be started. A compiled program starts its threads late: the collector's helpers at the first large collection,
// the thread pool at the first file. What it can do alone it does alone, and whatever needs a thread says so by name. Nothing ends in a bare abort().
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
import { describe, test } from "./supported";

const program = `type Cell = { id: number; next: Cell | null };
if (!Bun.isMainThread) {
  postMessage("runs");
  process.exit(0);
}
const what = process.env.WHAT;
if (what === "limit") {
  console.log(Bun.spawnSync(["true"]).exitCode);
} else if (what === "collections") {
  const kept: (Cell | null)[] = new Array(64).fill(null);
  let head: Cell | null = null;
  for (let i = 0; i < 8_000_000; i++) {
    head = { id: i, next: i % 1000 ? head : null };
    if (i % 1000 === 999) kept[((i / 1000) % 64) | 0] = head;
  }
  await Bun.sleep(20);
  let cells = 0;
  for (let cell of kept) for (; cell; cell = cell.next) cells++;
  console.log("made and collected", head!.id, cells);
} else if (what === "awaited collections") {
  for (let round = 0; round < 4; round++) Bun.gc(true);
} else if (what === "worker") {
  try {
    new Worker(new URL(import.meta.url));
    console.log("started");
  } catch (error) {
    console.log((error as Error).name + ": " + (error as Error).message);
  }
} else if (what === "file") {
  console.log((await Bun.file(process.execPath).slice(0, 10).text()).length);
} else if (what === "fetch") {
  await fetch("http://127.0.0.1:1/").catch(() => {});
}
console.log("the end");
`;

// The limit counts every process of the user, so 1 is reached wherever the tests run. It does not bind root. In dash its letter is p.
const underLimit = (executable: string) => [
  "sh",
  "-c",
  '{ ulimit -u 1 2>/dev/null || ulimit -p 1; } && exec "$0"',
  executable,
];

describe.skipIf(!isLinux || isASAN)("a compiled program that can start no thread", () => {
  const folder = tempDir("aot-no-thread", { "program.ts": program });
  const executable = join(String(folder), "program");
  let isBound = false;
  const ask = async (what: string) => {
    const { stdout, stderr, exitCode } = await runCommand(withoutCoreDump(underLimit(executable)), String(folder), {
      ...bunEnv,
      BUN_CRASH_REPORT_URL: "",
      WHAT: what,
    });
    return { stdout, exitCode, lines: stderr.split("\n").filter(line => /^(error|note|FATAL|panic)/.test(line)) };
  };

  test("builds, and the limit binds this user", async () => {
    const built = await runCommand(
      [bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile", "program"],
      String(folder),
      bunEnv,
    );
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    // The program ran and could start no process: an uncaught EAGAIN. A shell that cannot set the limit ends with 2.
    isBound = (await ask("limit")).exitCode === 1;
    if (!isBound)
      console.error("SKIPPED: the tests of no-thread-can-be-started.test.ts: `ulimit -u` does not bind this user");
  }, 120_000);

  test("makes and collects millions of objects by itself", async () => {
    if (!isBound) return;
    expect(await ask("collections")).toEqual({
      stdout: "made and collected 7999999 64000\nthe end\n",
      exitCode: 0,
      lines: [],
    });
  }, 120_000);

  // A collection that takes longer than its slice of time goes on beside the program. A program that waits for it hands it to the collector's own thread.
  test.todo(
    "waits for the collections that it asks for, on a busy machine too",
    async () => {
      if (!isBound) return;
      expect(await ask("awaited collections")).toEqual({ stdout: "the end\n", exitCode: 0, lines: [] });
    },
    120_000,
  );

  test("new Worker() throws", async () => {
    if (!isBound) return;
    expect(await ask("worker")).toEqual({
      stdout: "TypeError: Failed to spawn worker thread\nthe end\n",
      exitCode: 0,
      lines: [],
    });
  }, 120_000);

  test("the first task of the thread pool ends the program with a line that says why", async () => {
    if (!isBound) return;
    const { stdout, exitCode, lines } = await ask("file");
    expect({ stdout, lines }).toEqual({
      stdout: "",
      lines: [
        expect.stringMatching(/^error: Failed to start a thread of the thread pool: /),
        expect.stringMatching(/^note: The process or thread limit may have been reached/),
      ],
    });
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test("so does the first fetch", async () => {
    if (!isBound) return;
    const { stdout, exitCode, lines } = await ask("fetch");
    expect({ stdout, lines }).toEqual({
      stdout: "",
      lines: [
        expect.stringMatching(/^error: Failed to start HTTP Client thread: /),
        expect.stringMatching(/^note: The process or thread limit may have been reached/),
      ],
    });
    expect(exitCode).not.toBe(0);
  }, 120_000);
});
