import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { locksEnvironment } from "./hardened";
import { withoutCoreDump } from "./run-programs";
import { describe, test } from "./supported";

// What `bun build --compile --aot` cuts out of the executable leaves a hole in its address space, which later mappings may fill.
const program = `import { CFunction, dlopen, read } from "bun:ffi";
const [how, hole] = process.argv.slice(2);
const libc = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
  mmap: { args: ["ptr", "usize", "i32", "i32", "i32", "i64"], returns: "ptr" },
  ...(process.platform === "darwin" && { _dyld_get_image_vmaddr_slide: { args: ["u32"], returns: "i64" } }),
});
const address = Number(hole) + Number(libc.symbols._dyld_get_image_vmaddr_slide?.(0) ?? 0);
const call = () => new CFunction({ ptr: address, args: [], returns: "void" })();
const [read_write, fixed_private_anonymous] = [3, process.platform === "darwin" ? 0x1012 : 0x32];
const map = () => console.log("mapped", libc.symbols.mmap(address, 16384, read_write, fixed_private_anonymous, -1, 0) === address);
console.log("started");
if (how === "call") call();
if (how === "read") read.u8(address);
if (how === "call mapped data") (map(), call());
if (how === "read mapped data") (map(), console.log(read.u8(address)));
`;

function segmentsOfElf(file: Buffer) {
  const [offset, size, count] = [Number(file.readBigUInt64LE(32)), file.readUInt16LE(54), file.readUInt16LE(56)];
  return Array.from({ length: count }, (_, index) => offset + index * size)
    .filter(header => file.readUInt32LE(header) === 1)
    .map(header => ({
      start: Number(file.readBigUInt64LE(header + 16)),
      end: Number(file.readBigUInt64LE(header + 16) + file.readBigUInt64LE(header + 40)),
    }));
}

function segmentsOfMachO(file: Buffer) {
  const segments: { start: number; end: number }[] = [];
  for (let command = 32, index = 0; index < file.readUInt32LE(16); command += file.readUInt32LE(command + 4), index++) {
    if (file.readUInt32LE(command) !== 0x19 || file.toString("latin1", command + 8, command + 18) === "__PAGEZERO")
      continue;
    const start = Number(file.readBigUInt64LE(command + 24));
    segments.push({ start, end: start + Number(file.readBigUInt64LE(command + 32)) });
  }
  return segments;
}

function middleOfLargestHole(executable: string) {
  const file = readFileSync(executable);
  const segments = (isLinux ? segmentsOfElf(file) : segmentsOfMachO(file)).sort((a, b) => a.start - b.start);
  const holes = segments
    .slice(1)
    .map(({ start }, index) => ({ start: segments[index].end, size: start - segments[index].end }));
  const largest = holes.sort((a, b) => b.size - a.size)[0];
  const middle = largest.start + largest.size / 2;
  return { address: middle - (middle % 0x4000), size: largest.size };
}

describe.skipIf(!isLinux && !isMacOS)("a fault at an address inside a removed range", () => {
  test("is called a removed feature only where removed code was called", async () => {
    using dir = tempDir("fault-inside-a-removed-range", { "main.ts": program });
    const folder = String(dir);
    const spawned = async (cmd: string[]) => {
      await using child = Bun.spawn({
        cmd,
        cwd: folder,
        env: {
          ...bunEnv,
          NO_COLOR: "1",
          BUN_ENABLE_CRASH_REPORTING: "0",
          ...(!locksEnvironment && { BUN_CRASH_REPORT_URL: "" }),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      return { stdout, stderr, exitCode, signalCode: child.signalCode };
    };
    expect(await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "main"])).toMatchObject({
      exitCode: 0,
    });
    const hole = middleOfLargestHole(join(folder, "main"));
    if (hole.size < 1024 * 1024) return; // This Bun can't be cut.

    const found: Record<string, unknown> = {};
    const said: string[] = [];
    const stride = Math.floor(hole.size / 10 / 0x4000) * 0x4000;
    // Later mappings fill the hole from its start: on macOS its middle has held data by the time the program ran, and a call of data is
    // an ordinary fault. So "call" asks from the end of the hole on, and the others ask where it found nothing mapped.
    const places = [4, 3, 2, 1, 0, -1, -2, -3].map(steps => hole.address + steps * stride);
    let free = places[0];
    for (const how of ["call", "read", "call mapped data", "read mapped data"]) {
      for (const address of how === "call" ? places : [free]) {
        const cmd = withoutCoreDump([join(folder, "main"), how, String(address)]);
        const { stdout, stderr, exitCode, signalCode } = await spawned(cmd);
        said.push(
          `${how}: exit ${exitCode}, signal ${signalCode}, at ${address} of ${hole.size}\n${stderr.slice(0, 1500)}`,
        );
        const saysRemoved = / removed .* from this executable/.test(stderr);
        found[how] = { stdout, saysRemoved, exits70: exitCode === 70 };
        if (saysRemoved) {
          free = address;
          break;
        }
      }
    }
    const wanted = {
      "call": { stdout: "started\n", saysRemoved: true, exits70: true },
      "read": { stdout: "started\n", saysRemoved: false, exits70: false },
      "call mapped data": { stdout: "started\nmapped true\n", saysRemoved: false, exits70: false },
      "read mapped data": { stdout: "started\nmapped true\n0\n", saysRemoved: false, exits70: false },
    };
    if (said.length > 4 || !Bun.deepEquals(found, wanted)) console.error(said.join("\n"));
    expect(found).toEqual(wanted);
  }, 240_000);
});
