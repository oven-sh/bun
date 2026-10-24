// What Bun without --aot must not get from the compiler. Every test here passes on a Bun that has no compiler at all.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, tempDir } from "harness";

// The collector reads every word of a live stack frame. A word that only a compiled or validated program writes keeps what an
// earlier call left in it, and the frames of the event loop lie at the same addresses in every turn.
// TODO: on Linux arm64 some runs say "alive": of the eight below the first said "collected" and the second "alive", both without
// the JIT. Whether a Bun without the compiler does the same there has not been run.
test.todoIf(isLinux && isArm64)(
  "a stream that failed is collected within a few turns of the event loop",
  async () => {
    using dir = tempDir("plain-bun-collects", {
      "main.js": `
      const zlib = require("zlib");
      const { releaseWeakRefs } = require("bun:jsc");
      let ref;
      function isAlive() { return ref.deref() !== undefined; }
      {
        const stream = zlib.createInflate();
        stream.end(Buffer.from("foobar"));
        stream.once("error", () => {
          let turn = 0;
          const step = () => {
            releaseWeakRefs();
            Bun.gc(true);
            if (!isAlive()) return console.log("collected");
            if (++turn > 10) return console.log("alive");
            (turn % 2 ? process.nextTick : setImmediate)(step);
          };
          setImmediate(step);
        });
        ref = new WeakRef(stream);
      }
    `,
    });
    const run = async (env: Record<string, string>) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js"],
        cwd: String(dir),
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { stdout, exitCode };
    };
    const runs = await Promise.all([
      ...Array.from({ length: 4 }, () => run({ BUN_JSC_useJIT: "0" })),
      ...Array.from({ length: 4 }, () => run({})),
    ]);
    for (const result of runs) expect(result).toEqual({ stdout: "collected\n", exitCode: 0 });
  },
  60_000,
);

test("the members of a native class come in the order of localeCompare", () => {
  const names = Object.getOwnPropertyNames(Bun.RedisClient.prototype);
  expect(names.indexOf("getbit")).toBeGreaterThan(-1);
  expect(names.indexOf("getbit")).toBeLessThan(names.indexOf("getBuffer"));
});
