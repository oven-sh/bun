// The run time tells which compiled function an address belongs to by the starts of the functions. A return address is the
// address behind a call, so a function whose last instruction is a call, with the next function laid right behind it, hands out
// a return address that is taken for the next function's: a throw, the stack of an Error or a cache that asks "who called me"
// is then answered wrongly. The compiler lays something behind such a call. This test reads the machine code of an executable
// and looks for a function that ends in a call all the same. One call may stand last: the poll that a failed stack check in the
// prologue branches to. It is told its function by the address of the call itself and returns to the prologue, never behind itself.
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

// Methods of many lengths that are taken off their objects. Each has an entry that tests `this`, throws by a call if it is not
// an object of the class, and goes on into the method, which is laid next: the shape that once ended in a call.
const program = join(import.meta.dir, "programs", "typed-objects", "detached-methods-many-lengths.ts");

function codeOf(executable: Buffer) {
  const magic = Buffer.from("BUNAOT01", "latin1");
  for (let at = executable.indexOf(magic); at >= 0; at = executable.indexOf(magic, at + 1)) {
    if (at + 56 > executable.length) break;
    const size = Number(executable.readBigUInt64LE(at + 32));
    const codeOffset = Number(executable.readBigUInt64LE(at + 40));
    const codeSize = Number(executable.readBigUInt64LE(at + 48));
    if (codeSize > 0 && codeOffset + codeSize <= size && at + size <= executable.length)
      return executable.subarray(at + codeOffset, at + codeOffset + codeSize);
  }
  throw new Error("the executable holds no image of compiled code");
}

test.skipIf(!!unsupported)(
  "no compiled function ends in a call with the next function right behind it",
  async () => {
    await slot(async () => {
      using dir = tempDir("aot-ends-in-a-call", {});
      const folder = String(dir);
      const executable = join(folder, isWindows ? "entry.exe" : "entry");
      const mapPath = join(folder, "entry.map");
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", program, "--outfile", executable], folder, {
          ...bunEnv,
          BUN_JSC_aotMapFilePath: mapPath,
        }),
      );
      const [plain, compiled] = await Promise.all([
        spawned([bunExe(), "run", program], folder, bunEnv),
        spawned([executable], folder, bunEnv),
      ]);
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });

      const code = codeOf(readFileSync(executable));
      const functions: { start: number; end: number }[] = [];
      const copiesOfStubs: number[] = [];
      const stubs: number[] = [];
      const entries = new Set<number>();
      for (const line of readFileSync(mapPath, "utf8").split("\n")) {
        const fields = line.split("\t");
        if (fields[0] === "F") functions.push({ start: Number(fields[2]), end: Number(fields[2]) + Number(fields[3]) });
        else if (fields[0] === "C") copiesOfStubs.push(Number(fields[1]));
        else if (fields[0] === "T" && fields[2] !== "PollAtPrologue") stubs.push(Number(fields[1]));
        else if (fields[0] === "U") entries.add(Number(fields[1]));
      }
      for (const { start } of functions) entries.add(start);
      for (const copy of copiesOfStubs.length ? copiesOfStubs : [0]) for (const stub of stubs) entries.add(copy + stub);
      const starts = new Set(functions.map(({ start }) => start));

      // The bytes are taken for a call only where they lead to the start of a function, a stub or an outlined body.
      const endsInCall =
        process.arch === "x64"
          ? ({ start, end }: { start: number; end: number }) =>
              end - 5 >= start && code[end - 5] === 0xe8 && entries.has(end + code.readInt32LE(end - 4))
          : ({ start, end }: { start: number; end: number }) => {
              if (end - 4 < start) return false;
              const word = code.readUInt32LE(end - 4);
              return word >>> 26 === 0x25 && entries.has(end - 4 + ((word << 6) >> 6) * 4);
            };
      expect(functions.length).toBeGreaterThan(32);
      expect(stubs.length).toBeGreaterThan(100);
      expect(functions.filter(f => starts.has(f.end) && endsInCall(f))).toEqual([]);
    });
  },
  600_000,
);
