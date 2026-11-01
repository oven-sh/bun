// A test replaces what a program reads to find out which runtime it is on: `process.versions`, `process.release`, `process.isBun`, or a member of the first two. An executable folds
// those reads and locks the members. A test run folded and locked all but `process.versions.bun` and `.node`, so each of the others was refused: "Cannot assign to process.versions".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { waysFor } from "./harness/ways";
import { test } from "./supported";

const files = {
  "project.ts": `
    export const facts = () => [typeof process.versions.bun, typeof Bun, process.isBun, process.isBun ? "the arm of Bun" : "the other arm", process.versions.node.split(".")[0] === "0" ? "old node" : "node",
      process.release.name, process.release.name === "node" ? "the arm of node" : "the other arm", "bun" in process.versions, !!process.versions?.bun, typeof process.release, typeof process.versions].join(" | ");`,
  "helpers.ts": `
    export function override(object: object, name: string, value: unknown) {
      const before = Object.getOwnPropertyDescriptor(object, name)!;
      Object.defineProperty(object, name, { value, configurable: true, writable: true });
      return () => { Object.defineProperty(object, name, before); };
    }`,
};
const ways = {
  "versions defined": `const d = Object.getOwnPropertyDescriptor(process, "versions")!; Object.defineProperty(process, "versions", { value: { node: "0.10.0" }, configurable: true }); undo = () => { Object.defineProperty(process, "versions", d); };`,
  "versions stored": `const v = process.versions; (process as any).versions = { node: "0.10.0" }; undo = () => { (process as any).versions = v; };`,
  "versions without bun": `const d = Object.getOwnPropertyDescriptor(process, "versions")!; Object.defineProperty(process, "versions", { value: { ...process.versions, bun: undefined }, configurable: true }); undo = () => { Object.defineProperty(process, "versions", d); };`,
  "versions by a helper": `undo = override(process, "versions", { node: "0.10.0" });`,
  "versions.bun deleted": `const v = process.versions.bun; delete (process.versions as any).bun; undo = () => { (process.versions as any).bun = v; };`,
  "release defined": `const d = Object.getOwnPropertyDescriptor(process, "release")!; Object.defineProperty(process, "release", { value: { name: "fake" }, configurable: true }); undo = () => { Object.defineProperty(process, "release", d); };`,
  "release.name stored": `const v = process.release.name; (process.release as any).name = "fake"; undo = () => { (process.release as any).name = v; };`,
  "isBun defined": `const d = Object.getOwnPropertyDescriptor(process, "isBun")!; Object.defineProperty(process, "isBun", { value: false, configurable: true }); undo = () => { Object.defineProperty(process, "isBun", d); };`,
  "isBun stored": `const v = process.isBun; (process as any).isBun = false; undo = () => { (process as any).isBun = v; };`,
};

async function linesOf(way: string, flags: string[], words?: string) {
  using dir = tempDir("aot-another-runtime", {
    ...files,
    "a.test.ts": `
      import { test } from "bun:test";
      import { facts } from "./project.ts";
      import { override } from "./helpers.ts";
      test("t", () => {
        let undo = () => {}, outcome = "done";
        console.error("OUT before", facts());
        try { ${way} } catch (error: any) { outcome = error.constructor.name + ": " + error.message; }
        console.error("OUT", outcome, facts());
        undo();
        console.error("OUT after", facts());
        void override;
      });`,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test.concurrent.each(Object.entries(ways).map(([name, way], index) => [name, way, index] as const))(
  "%s",
  async (_, way, index) => {
    const plain = await linesOf(way, []);
    expect(plain.lines.length).toBe(3);
    expect(plain.lines[1]).toStartWith("OUT done ");
    expect(plain.lines[1].slice(8)).not.toBe(plain.lines[0].slice(10));
    for (const words of waysFor([undefined, "TestRunLayers:2"], index === 0))
      expect(await linesOf(way, ["--aot"], words)).toEqual(plain);
  },
  240_000,
);
