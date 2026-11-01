// `import * as math from "./math.ts"; (math as any).double = f`: `bun build` refuses the file, and so does a build of an executable. `bun test` bundles nothing: the statement
// throws a TypeError when it runs, inside its test, and the other tests of the file run. `bun test --aot` took the build's refusal and lost the whole file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "math.ts": `export function double(n: number) { return n * 2; }\nexport let count = 1;`,
  "project.ts": `import * as math from "./math.ts";\nexport function tryStore() { try { (math as any).double = () => 0; return "stored"; } catch (e: any) { return e.constructor.name; } }`,
  "a.test.ts": `
    import { expect, test } from "bun:test";
    import * as math from "./math.ts";
    import { tryStore } from "./project.ts";
    const out = (label: string, f: () => unknown) => { let r; try { r = f(); } catch (e: any) { r = e.constructor.name + ": " + e.message; } console.error("OUT", label, String(r), math.double(2), math.count); };
    test("stores", () => {
      out("by name", () => { (math as any).double = () => 0; });
      out("by a written key", () => { (math as any)["double"] = 1; });
      out("a new name", () => { (math as any).added = 1; });
      out("an update", () => { (math as any).count++; });
      out("a pattern", () => { ({ a: (math as any).double } = { a: 1 }); });
      out("a delete", () => delete (math as any).double);
      out("a delete of nothing", () => delete (math as any).missing);
      out("the mark", () => { (math as any).__esModule = true; return (math as any).__esModule; });
      out("in the project", () => tryStore());
    });
    test("expected to throw", () => { expect(() => { (math as any).count = 2; }).toThrow(TypeError); });
    test("another test of the file", () => { console.error("OUT another", math.double(4)); });`,
};

async function run(cmd: string[], words?: string) {
  using dir = tempDir("aot-store-to-a-namespace-import", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using child = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd: String(dir), env, stdio: ["ignore", "pipe", "pipe"] });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  return { lines: stderr.split("\n").filter(line => /^OUT| pass$| fail$/.test(line)), exitCode, stderr };
}

test("a test run prints what bun test prints", async () => {
  const { stderr: _, ...plain } = await run(["test", "--isolate"]);
  expect(plain.lines).toContain(" 3 pass");
  expect(plain.lines.length).toBe(12);
  for (const words of [undefined, "TestRunLayers:2"]) {
    const { stderr: _, ...compiled } = await run(["test", "--aot", "--isolate"], words);
    expect(compiled).toEqual(plain);
  }
}, 240_000);

test("an executable is refused, as by bun build", async () => {
  const built = await run(["build", "--compile", "--aot", "./project.ts", "--outfile", "project"]);
  expect(built.exitCode).not.toBe(0);
  expect(built.stderr).toContain("TS2540");
}, 240_000);
