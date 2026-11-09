import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// In the formats of Vitest and Jest, `bun test` prints an export of a module namespace that is not set yet as undefined:
// test/js/bun/test/snapshot-tests/snapshots/snapshot.test.ts. It asks the engine whether the variable of the export is empty.
const files = {
  // Its body throws halfway, so `later` is never set.
  "stops.mjs": `import * as self from "./stops.mjs";
export function hoisted() {}
(() => {
  throw Object.assign(new Error("stops here"), { namespace: self });
})();
export const later = 1;
`,
  "a.test.js": `import { test, expect } from "vitest";
import vm from "node:vm";
const firstLine = f => { try { f(); return "passes"; } catch (error) { return String(error).split("\\n")[0]; } };
const ofFile = await import("./stops.mjs").catch(error => error.namespace);
test("t", async () => {
  const linked = new vm.SourceTextModule("export const later = 1; export function hoisted() {}");
  await linked.link(() => {});
  console.log("SEEN of node:vm:", firstLine(() => expect(linked.namespace).toMatchInlineSnapshot(\`
    {
      "hoisted": [Function],
      "later": undefined,
    }
  \`)));
  console.log("SEEN of a file:", firstLine(() => expect(ofFile).toMatchInlineSnapshot(\`
    {
      "hoisted": [Function],
      "later": undefined,
    }
  \`)));
});
`,
};

async function seenWith(...flags: string[]) {
  using dir = tempDir("aot-snapshot-of-namespace", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, CI: "true" });
  return {
    seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")),
    stderr: exitCode ? stderr : "",
    exitCode,
  };
}
let runs: Promise<Awaited<ReturnType<typeof seenWith>>[]> | undefined;
const both = () => (runs ??= Promise.all([seenWith(), seenWith("--aot")]));

// No build compiles the text of a node:vm module, so its namespace object is the one of `bun test`.
test("the namespace of a node:vm module is printed as bun test prints it", async () => {
  const [plain, compiled] = await both();
  expect(plain).toEqual({ seen: ["SEEN of node:vm: passes", "SEEN of a file: passes"], stderr: "", exitCode: 0 });
  expect({ seen: compiled.seen[0], stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
    seen: plain.seen[0],
    stderr: "",
    exitCode: 0,
  });
});

// The namespace object of a compiled module is of another class, and the engine cannot say yet whether one of its exports is set.
// This is a wrong answer and no goal. The name says it, so that it is listed as one. When it passes, its `failing` goes.
test.failing(
  "the namespace of a compiled module is printed as bun test prints it: a wrong answer today: under `bun test --aot` the matcher throws the ReferenceError, where `bun test` prints undefined for the export",
  async () => {
    const [plain, compiled] = await both();
    expect(compiled.seen[1]).toBe(plain.seen[1]);
  },
);
