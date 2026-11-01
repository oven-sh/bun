// all.ts imports throws.ts and then tax.ts. import("./all") rejects with what throws.ts threw, and tax.ts stays linked: its body has not run. `bun test` runs such a
// body before it lays a mock over the module, so that the body doesn't assign over the mock later. A compiled run did so only while the graph was still being
// evaluated: behind the error tax.ts never ran, a module that throws didn't fail the call of vi.mock(), and the next test file read the mock.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const ran = `(globalThis.ran ??= [])`;
const graph = (folder: string, last: string) => ({
  [`${folder}/all.ts`]: `import "./throws"; import "./between";`,
  [`${folder}/throws.ts`]: `${ran}.push("throws"); throw new Error("throws.ts threw");`,
  [`${folder}/between.ts`]: `${ran}.push("between"); import "./tax";`,
  [`${folder}/tax.ts`]: `${ran}.push("tax"); export const rate = 0.2; ${last}`,
});
const head = (folder: string) => `import { test, vi } from "bun:test";
const failed = () => import("./${folder}/all").catch(error => console.log("OUT", error.message));`;

const files = {
  "package.json": `{ "name": "mock-linked-failed" }`,
  ...graph("runs", ""),
  "a-runs.test.ts": `${head("runs")}
test("the body runs ahead of the mock", async () => {
  await failed();
  vi.mock("./runs/tax", () => ({ rate: 0.5 }));
  console.log("OUT", (await import("./runs/tax")).rate, ${ran}.splice(0).join());
});`,
  ...graph("fails", `throw new Error("tax.ts threw");`),
  "b-fails.test.ts": `${head("fails")}
test("its error is the error of the call", async () => {
  await failed();
  try {
    vi.mock("./fails/tax", async importOriginal => ({ ...(await importOriginal<any>()) }));
    console.log("OUT nothing thrown");
  } catch (error) {
    console.log("OUT", (error as Error).message, ${ran}.splice(0).join());
  }
});`,
  ...graph("next", ""),
  "c-first.test.ts": `${head("next")}
test("the file that mocks", async () => {
  await failed();
  vi.mock("./next/tax", () => ({ rate: 0.5 }));
  console.log("OUT", (await import("./next/tax")).rate);
});`,
  "d-next.test.ts": `import { test } from "bun:test";
test("the next file", async () => {
  console.log("OUT", (await import("./next/tax")).rate);
});`,
};

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test("runs first, as one program and over layers", async () => {
  using folder = tempDir("aot-mock-linked-failed", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  expect(plain).toEqual({
    lines: [
      "OUT throws.ts threw",
      "OUT 0.5 throws,tax",
      "OUT throws.ts threw",
      "OUT tax.ts threw throws,tax",
      "OUT throws.ts threw",
      "OUT 0.5",
      "OUT 0.2",
    ],
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
