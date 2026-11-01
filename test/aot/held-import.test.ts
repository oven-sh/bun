import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// An import() of k.js has called k's factory. import("./a.js") is held behind m's factory, which it calls itself. It goes on when that has ended, a mock that m's factory
// laid over n.js runs then, and it is held again, behind k's factory.
// k's factory ends only once another import(), which has nothing to do with k.js, has settled: that one must not be held behind k's factory.
// `bun test` does not lay a mock over a module of a graph that is being loaded, so what is expected is written out.
// A guard of the shape, not a red control: the member that held the state of a held import is gone, and since the factories of one load take turns no load has a second
// factory started while it waits for the first, which is what the fault needed.
const project = (factoryOfN: string, behind: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "k.js": `export const k = "real k";`,
  "m.js": `export const m = "real m";`,
  "n.js": `export const n = "real n";`,
  "other.js": `export const other = "other";`,
  "a.js": `import { m } from "./m.js";\nimport { n } from "./n.js";\nimport { k } from "./k.js";\nexport const read = () => [k, m, n].join(" ");`,
  "a.test.js": `
    import { test, vi } from "bun:test";
    const say = (...all) => console.log("SEEN", ...all);
    const orNever = promise => Promise.race([promise, new Promise(done => setTimeout(done, 4000, "never settled"))]);
    test("t", async () => {
      let open;
      const opened = new Promise(resolve => (open = resolve));
      vi.doMock("./k.js", async () => (await opened, { k: "mock k" }));
      vi.doMock("./m.js", async () => {
        await 0;
        vi.doMock("./n.js", ${factoryOfN});
        return { m: "mock m" };
      });
      import("./k.js");
      const a = await orNever(import("./a.js").then(a => a.read(), error => "threw " + error.message));
      say("a", a);
      ${behind}
    }, 30000);`,
});

const projects = {
  "an import() that a factory makes while the held one goes on": [
    project(`() => (import("./other.js").then(it => (say(it.other), open())), { n: "mock n" })`, ""),
    ["SEEN other", "SEEN a mock k mock m mock n"],
  ],
  "an import() behind a held one that ended with a factory's error": [
    project(
      `() => { throw new Error("boom"); }`,
      `Bun.gc(true);\n      const it = await orNever(import("./other.js"));\n      say(it.other ?? it);\n      open();`,
    ),
    ["SEEN a threw boom", "SEEN other"],
  ],
} as const;

for (const [name, [files, expected]] of Object.entries(projects)) {
  test.concurrent(
    name,
    async () => {
      using dir = tempDir("aot-held-import", files);
      const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" };
      const { stdout, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
      expect({ stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode }).toEqual({
        stdout: [...expected],
        exitCode: 0,
      });
    },
    120_000,
  );
}
