import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { built } from "./run-programs";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    function read(buffer) { return buffer.readUInt32LE(0); }
    function write(buffer, value) { return buffer.writeUInt16BE(value, 2); }
    class Subclass extends Uint8Array {}
    Object.setPrototypeOf(Subclass.prototype, Buffer.prototype);
    const subclassed = new Subclass(8), reparented = Object.setPrototypeOf(Buffer.alloc(8), Object.create(Buffer.prototype)), plain = Buffer.alloc(8);
    subclassed[0] = 1; reparented[0] = 2; plain[0] = 3;
    const rounds = Number(process.argv[2]);
    let sum = 0;
    for (let i = 0; i < 20; i++) sum += read(subclassed) + read(reparented) + write(subclassed, i) + write(reparented, i);
    Bun.gc(true);
    for (let i = 0; i < rounds; i++) sum += read(plain) + write(plain, i);
    for (let i = 0; i < 20; i++) sum += read(subclassed) + read(reparented);
    Bun.gc(true);
    console.log(sum, plain.readUInt16BE(2), subclassed.readUInt16BE(2), reparented.readUInt16BE(2));
  `,
};

test("Buffer accessor sites reached first by Buffer subclasses stay cached for plain Buffers", async () => {
  using dir = tempDir("aot-buffer-accessors-relookup", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  built(await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], String(dir), bunEnv));
  const countOperations = async (rounds: number) => {
    const underBunRun = await run([bunExe(), "main.mjs", String(rounds)], String(dir), bunEnv);
    expect({ stderr: underBunRun.stderr, exitCode: underBunRun.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const path = join(String(dir), "counts" + rounds);
    const env = {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: undefined,
      BUN_JSC_crashIfInterpreterIsUsed: "1",
      BUN_JSC_aotCountsPath: path,
    };
    expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
      stdout: underBunRun.stdout,
      stderr: "",
      exitCode: 0,
    });
    const counts = new Map<string, number>();
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\t");
      if (name?.startsWith("operation:")) counts.set(name, Number(count));
    }
    return counts;
  };
  const few = await countOperations(500);
  const many = await countOperations(2500);
  // Buffer.prototype is not locked, so every call reads its accessor by name. A read that lost its cache would call the run time once per round.
  expect(few.size).toBeGreaterThan(0);
  expect([...many].filter(([name, count]) => count - (few.get(name) ?? 0) > 200)).toEqual([]);
}, 240_000);
