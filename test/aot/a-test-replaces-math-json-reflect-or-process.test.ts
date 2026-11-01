// `const mockMath = Object.create(global.Math); mockMath.random = () => 0.5; global.Math = mockMath;` is how many a suite fixes Math.random, and `globalThis.process = undefined` how a
// library is tested as in a browser. A test run unlocks a function or a class on the global object that a file spells a store to. Math, JSON, Reflect, Atomics and process are neither,
// so the store was refused: "Cannot assign to Math because built-in objects are read-only in compiled code".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { waysFor } from "./harness/ways";
import { test } from "./supported";

const project = `
  export const facts = () => {
    const ask = (f: () => unknown) => { try { return String(f()); } catch (error: any) { return error.constructor.name; } };
    return [ask(() => { const v = Math.random(); return [0.5, 0.25].includes(v) ? v : "random"; }), ask(() => Math.floor(1.5)), ask(() => Math.PI > 3), ask(() => JSON.stringify({ a: 1 })), ask(() => JSON.parse("[1]").length),
      ask(() => Reflect.ownKeys({ a: 1 }).length), ask(() => typeof Atomics), ask(() => typeof process), ask(() => process.platform === "fake"), ask(() => typeof process.env), ask(() => typeof process?.versions?.node),
      ask(() => { let sum = 0; for (let i = 0; i < 100; i++) sum += Math.floor(i / 2); return sum; })].join(" | ");
  };`;
const ways = {
  "Math by an heir of it": `const old = global.Math; const mockMath = Object.create(global.Math); mockMath.random = () => 0.5; global.Math = mockMath; undo = () => { global.Math = old; };`,
  "Math by another object": `const old = globalThis.Math; (globalThis as any).Math = { random: () => 0.25, floor: () => "floored", PI: 1 }; undo = () => { globalThis.Math = old; };`,
  "Math by its name": `const old = Math; Math = { random: () => 0.25, floor: old.floor, PI: old.PI } as any; undo = () => { Math = old; };`,
  "Math by a definition": `const d = Object.getOwnPropertyDescriptor(globalThis, "Math")!; Object.defineProperty(globalThis, "Math", { value: { random: () => 0.5, floor: Math.floor, PI: 4 }, configurable: true, writable: true }); undo = () => { Object.defineProperty(globalThis, "Math", d); };`,
  "JSON": `const old = globalThis.JSON; (globalThis as any).JSON = { stringify: () => "fake text", parse: () => [1, 2, 3] }; undo = () => { globalThis.JSON = old; };`,
  "Reflect": `const old = globalThis.Reflect; (globalThis as any).Reflect = { ownKeys: () => [1, 2, 3] }; undo = () => { globalThis.Reflect = old; };`,
  "Atomics": `const old = globalThis.Atomics; (globalThis as any).Atomics = undefined; undo = () => { globalThis.Atomics = old; };`,
  "process by another object": `const old = globalThis.process; (globalThis as any).process = { platform: "fake", env: {} }; undo = () => { globalThis.process = old; };`,
  "process by undefined": `const old = globalThis.process; (globalThis as any).process = undefined; undo = () => { globalThis.process = old; };`,
  "process deleted": `const d = Object.getOwnPropertyDescriptor(globalThis, "process")!; delete (globalThis as any).process; undo = () => { Object.defineProperty(globalThis, "process", d); };`,
};

async function linesOf(way: string, flags: string[], words?: string) {
  using dir = tempDir("aot-namespace-replaced", {
    "project.ts": project,
    "a.test.ts": `
      import { test } from "bun:test";
      import { facts } from "./project.ts";
      const write = process.stderr.write.bind(process.stderr);
      test("t", () => {
        let undo = () => {}, outcome = "done";
        write("OUT before " + facts() + "\\n");
        try { ${way} } catch (error: any) { outcome = error.constructor.name + ": " + error.message; }
        const seen = facts();
        undo();
        write("OUT " + outcome + " " + seen + "\\n");
        write("OUT after " + facts() + "\\n");
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

test.concurrent.each(Object.entries(ways))(
  "%s",
  async (name, way) => {
    const plain = await linesOf(way, []);
    expect(plain.lines.length).toBe(3);
    expect(plain.lines[1]).toStartWith("OUT done ");
    expect(plain.lines[1].slice(9)).not.toBe(plain.lines[0].slice(11));
    // Each was refused in both forms on the build in front of the cure: over layers one is the witness and the benches run the others.
    for (const words of waysFor([undefined, "TestRunLayers:2"], name === "Math by an heir of it"))
      expect(await linesOf(way, ["--aot"], words)).toEqual(plain);
  },
  240_000,
);
