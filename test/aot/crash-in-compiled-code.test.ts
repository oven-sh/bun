// A fault in the machine code of a compiled function, or in code that the compiled functions share: what the process prints
// is enough to tell the build, the function and the line, and every compiled caller is there. The faults are planted: a copy of
// the executable gets a load from a low address written over its code.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
import { describe, test } from "./supported";

setDefaultTimeout(240_000);

const files = {
  "app.ts": `import { priceOf, type Item } from "./prices.ts";

class Order {
  items: Item[] = [];
  add(name: string, count: number): this {
    this.items.push({ name, count });
    return this;
  }
  total(): number {
    let sum = 0;
    for (const item of this.items) sum += lineTotal(item);
    return sum;
  }
}

function lineTotal(item: Item): number {
  const price = priceOf(item.name);
  return price * item.count;
}

async function checkout(order: Order): Promise<string> {
  await Promise.resolve();
  const total = order.total();
  return "total " + total;
}

const order = new Order().add("tea", 2).add("cake", 3).add("milk", 1);
console.log("started");
console.log(await checkout(order));
`,
  "prices.ts": `export interface Item {
  name: string;
  count: number;
}

const prices = new Map<string, number>([
  ["tea", 3],
  ["cake", 5],
  ["milk", 2],
]);

export function priceOf(name: string): number {
  const price = prices.get(name);
  if (price === undefined) throw new RangeError("no price for " + name);
  return price;
}
`,
};

const quiet = { BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0", NO_COLOR: "1" };
async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(withoutCoreDump(cmd), cwd, { ...bunEnv, ...quiet, ...env });
  return { stdout, stderr, exitCode };
}

// `mov eax, [0x18]`
const loadFromLowAddress = Buffer.from([0x8b, 0x04, 0x25, 0x18, 0x00, 0x00, 0x00]);

class Executable {
  bytes: Buffer;
  symbols = new Map<string, number>();
  addresses = new Set<number>();
  #segments: { address: number; offset: number; size: number }[] = [];

  constructor(path: string) {
    const bytes = (this.bytes = readFileSync(path));
    const word = (at: number) => Number(bytes.readBigUInt64LE(at));
    for (let index = 0, at = word(32); index < bytes.readUInt16LE(56); index++, at += bytes.readUInt16LE(54))
      if (bytes.readUInt32LE(at) === 1)
        this.#segments.push({ offset: word(at + 8), address: word(at + 16), size: word(at + 32) });
    const sectionAt = (index: number) => word(40) + index * bytes.readUInt16LE(58);
    for (let index = 0; index < bytes.readUInt16LE(60); index++) {
      const section = sectionAt(index);
      if (bytes.readUInt32LE(section + 4) !== 2) continue;
      const names = word(sectionAt(bytes.readUInt32LE(section + 40)) + 24);
      for (let at = word(section + 24), end = at + word(section + 32); at < end; at += 24) {
        const name = names + bytes.readUInt32LE(at);
        this.symbols.set(bytes.toString("utf8", name, bytes.indexOf(0, name)), word(at + 8));
        this.addresses.add(word(at + 8));
      }
    }
  }
  offsetOf(address: number) {
    const segment = this.#segments.find(({ address: start, size }) => address >= start && address < start + size)!;
    return segment.offset + address - segment.address;
  }
  addressOf(name: string) {
    const address = this.symbols.get(name);
    if (address === undefined) throw new Error(`the executable has no symbol ${name}`);
    return address;
  }
  /** Where the first near call in the function to something that has a symbol returns to. */
  firstReturnAddressIn(name: string) {
    const start = this.addressOf(name);
    const end = Math.min(...[...this.addresses].filter(address => address > start));
    for (let address = start; address + 5 <= end; address++) {
      const at = this.offsetOf(address);
      if (this.bytes[at] === 0xe8 && this.addresses.has(address + 5 + this.bytes.readInt32LE(at + 1)))
        return address + 5;
    }
    throw new Error(`${name} calls nothing that has a symbol`);
  }
  writeWithFaultAt(address: number, path: string) {
    const planted = Buffer.from(this.bytes);
    loadFromLowAddress.copy(planted, this.offsetOf(address));
    writeFileSync(path, planted);
    chmodSync(path, 0o755);
  }
}

const framesOf = (text: string) =>
  [...text.matchAll(/^ +at (?:(.*) \()?\/\$bunfs\/root\/(.*?)\)?$/gm)].map(
    ([, name, place]) => `${name ?? ""} ${place}`,
  );

// The planted bytes are x64's, the symbol table is ELF's, and in a Bun built with AddressSanitizer its handler answers, not Bun's.
describe.skipIf(!isLinux || process.arch !== "x64" || isASAN)("a planted fault", () => {
  async function build(cwd: string) {
    // Nothing is inlined, so that each function has code and a symbol of its own whatever the compiler thinks of its size.
    const built = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-symbols",
        "--aot-disable=InlineCalls",
        "app.ts",
        "--outfile",
        "app",
      ],
      cwd,
    );
    expect(built.stderr).not.toMatch(/^error\b/m);
    expect(built.exitCode).toBe(0);
    const id = built.stdout.match(/^ +build id  ([0-9a-f]{32})$/m)?.[1];
    expect(id).toBeString();
    expect(await run([join(cwd, "app")], cwd)).toEqual({ stdout: "started\ntotal 23\n", stderr: "", exitCode: 0 });
    return { id: id!, executable: new Executable(join(cwd, "app")) };
  }
  async function crash(cwd: string, id: string) {
    const { stdout, stderr, exitCode } = await run([join(cwd, "planted")], cwd);
    expect(stdout).toBe("started\n");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Segmentation fault at address 0x18\n");
    expect(stderr.split("\n")).toContain("Build ID: " + id);
    // What the processor held: the planted instruction itself, and no value that says where anything was loaded.
    expect(stderr).toMatch(/^Code at rip: 8b 04 25 18 00 00 00( [0-9a-f]{2})*$/m);
    const registers = stderr.match(/^Registers:((?: r[a-z0-9]+=\S+){17})$/m)?.[1];
    expect(registers).toBeString();
    for (const [, name, value] of registers!.matchAll(/ (\w+)=(\S+)/g)) {
      expect(`${name}=${value}`).toMatch(
        /=(0x[0-9a-f]{1,8}|0x[0-9a-f]{13,16}|code\+0x[0-9a-f]+|stack[+-]0x[0-9a-f]+|address\.\.[0-9a-f]{3})$/,
      );
    }
    expect(registers).toMatch(/ rsp=stack\+0x0 /);
    expect(registers).toMatch(/ rip=code\+0x[0-9a-f]+$/);
    const link = stderr.match(/^ (\S*\/\d+\.\d+\.\d+\/\S+)$/m)?.[1];
    expect(link).toBeString();
    const printed = framesOf(stderr.slice(stderr.indexOf("Compiled JavaScript on the stack:\n")));
    // The link alone says as much to the build that crashed, which here is the file from before the fault was planted.
    const decoded = await run([join(cwd, "app")], cwd, { BUN_OPTIONS: "--aot-decode-crash-report=" + link });
    expect({ frames: framesOf(decoded.stdout), stderr: decoded.stderr, exitCode: decoded.exitCode }).toEqual({
      frames: printed,
      stderr: "",
      exitCode: 0,
    });
    return printed;
  }

  test("a Bun without compiled code prints no registers", async () => {
    using dir = tempDir("aot-crash-in-compiled-code", {
      "fault.js": `require("bun:internal-for-testing").crash_handler.segfault();`,
    });
    const { stderr, exitCode } = await run([bunExe(), "fault.js"], String(dir), {
      BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Segmentation fault at address");
    expect(stderr).not.toContain("Registers:");
    expect(stderr).not.toContain("Code at rip:");
  });

  test("in a function: the function and all its callers, by name, file, line and column", async () => {
    using dir = tempDir("aot-crash-in-compiled-code", files);
    const { id, executable } = await build(String(dir));
    executable.writeWithFaultAt(executable.firstReturnAddressIn("lineTotal"), join(String(dir), "planted"));
    expect(await crash(String(dir), id)).toEqual([
      "lineTotal app.ts:17:17",
      "total app.ts:11:43",
      "checkout app.ts:23:23",
    ]);
  });

  test("in code that the functions share: the function that called it and all its callers", async () => {
    using dir = tempDir("aot-crash-in-compiled-code", files);
    const { id, executable } = await build(String(dir));
    const returnAddress = executable.firstReturnAddressIn("priceOf");
    const called = returnAddress + executable.bytes.readInt32LE(executable.offsetOf(returnAddress) - 4);
    executable.writeWithFaultAt(called, join(String(dir), "planted"));
    expect(await crash(String(dir), id)).toEqual([
      "priceOf prices.ts:13:24",
      "lineTotal app.ts:17:17",
      "total app.ts:11:43",
      "checkout app.ts:23:23",
    ]);
  });
});
