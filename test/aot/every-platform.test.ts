import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { unsupported } from "./run-programs";

const files = {
  "hello.ts": `
    class Point { constructor(public x: number, public y: number) {} }
    function sum(count: number) { let total = new Point(0, 0.5); for (let i = 0; i < count; i++) total = new Point(total.x + i, total.y + 1); return total; }
    async function later(value: number) { await null; return value * 2; }
    console.log("hello", JSON.stringify(sum(1000)), await later(21), [3, 1, 2].sort().join(), process.argv.slice(2).join());
  `,
  "hello.test.ts": `
    import { expect, test } from "bun:test";
    test("adds", () => { expect([1, 2, 3].reduce((a, b) => a + b, 0)).toBe(6); });
  `,
};
const output = 'hello {"x":499500,"y":1000.5} 42 1,2,3 ';
const env = { ...bunEnv, BUN_AOT_VERBOSE: "1" };

async function run(cwd: string, cmd: string[]) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test("--aot is not refused on this platform", () => {
  expect(unsupported).toBeUndefined();
});

test("bun build --compile --aot", async () => {
  using dir = tempDir("aot-every-platform-build", files);
  const built = await run(String(dir), [bunExe(), "build", "--compile", "--aot", "hello.ts", "--outfile", "hello"]);
  expect({ ...built, stdout: "" }).toEqual({
    stdout: "",
    stderr: expect.not.stringContaining("error"),
    exitCode: 0,
    signalCode: null,
  });
  const ran = await run(String(dir), [join(String(dir), isWindows ? "hello.exe" : "hello"), "a", "b"]);
  expect(ran).toEqual({
    stdout: output + "a,b\n",
    stderr: expect.stringContaining("[aot] image: "),
    exitCode: 0,
    signalCode: null,
  });
  expect(ran.stderr).toContain("[aot] module: ");
}, 300_000);

test("bun run --debug-aot", async () => {
  using dir = tempDir("aot-every-platform-run", files);
  const ran = await run(String(dir), [bunExe(), "run", "--debug-aot", "hello.ts", "a", "b"]);
  expect(ran).toEqual({
    stdout: output + "a,b\n",
    stderr: expect.stringContaining("[aot] image: "),
    exitCode: 0,
    signalCode: null,
  });
  expect(ran.stderr).toContain("[aot] module: ");
}, 300_000);

test("bun test --debug-aot", async () => {
  using dir = tempDir("aot-every-platform-test", files);
  const ran = await run(String(dir), [bunExe(), "test", "--debug-aot", "hello.test.ts"]);
  expect({ ...ran, stdout: "" }).toEqual({
    stdout: "",
    stderr: expect.stringContaining("1 pass"),
    exitCode: 0,
    signalCode: null,
  });
  expect(ran.stderr).toContain("[aot] image: ");
  expect(ran.stderr).toContain("[aot] module: ");
}, 300_000);
