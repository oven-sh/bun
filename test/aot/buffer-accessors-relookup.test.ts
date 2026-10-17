import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const files = {
  "main.mjs": `
    function read(buffer) { return buffer.readUInt32LE(0); }
    function write(buffer, value) { return buffer.writeUInt16BE(value, 2); }
    class Heir extends Uint8Array {}
    Object.setPrototypeOf(Heir.prototype, Buffer.prototype);
    const heir = new Heir(8), changed = Object.setPrototypeOf(Buffer.alloc(8), Object.create(Buffer.prototype)), plain = Buffer.alloc(8);
    heir[0] = 1; changed[0] = 2; plain[0] = 3;
    let sum = 0;
    for (let i = 0; i < 20; i++) sum += read(heir) + read(changed) + write(heir, i) + write(changed, i);
    Bun.gc(true);
    for (let i = 0; i < 1000; i++) sum += read(plain) + write(plain, i);
    for (let i = 0; i < 20; i++) sum += read(heir) + read(changed);
    Bun.gc(true);
    console.log(sum, plain.readUInt16BE(2), heir.readUInt16BE(2), changed.readUInt16BE(2));
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("calls on heirs of Buffer at the start do not lose plain Buffers their accessors for good", async () => {
  using dir = tempDir("aot-buffer-accessors-looked-for-again", files);
  const plainly = await run([bunExe(), "main.mjs"], String(dir), bunEnv);
  expect({ stderr: plainly.stderr, exitCode: plainly.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], String(dir), bunEnv);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const path = join(String(dir), "counts");
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: undefined, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_JSC_useAOTOperationCounters: "1", BUN_JSC_aotTypeCoverageCountsPath: path };
  expect(await run([executable], String(dir), env)).toEqual({ stdout: plainly.stdout, stderr: "", exitCode: 0 });
  const counts: Record<string, number> = { "operationAOTTypedFindBufferAccessor:found": 0, "operationAOTTypedFindBufferAccessor:not-found": 0 };
  for (const line of readFileSync(path + ".operations", "utf8").split("\n")) {
    const [count, name] = line.split("\t");
    if (name !== undefined && name in counts) counts[name] = Number(count);
  }
  expect(counts).toEqual({ "operationAOTTypedFindBufferAccessor:found": 2, "operationAOTTypedFindBufferAccessor:not-found": 32 });
}, 240_000);
