// A fault in the machine code of a compiled function, or in code that the compiled functions share: what the process prints
// is enough to tell the build, the function and the line, and every compiled caller is there. The faults are planted: a copy of
// the executable gets a load from a low address written over its code.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { locksEnvironment } from "./hardened";
import { without } from "./harness/capabilities";
import { withoutCoreDump } from "./harness/commands";
import { afterAll, raiseDefaultTimeout } from "./harness/default-timeout";
import { run as runCommand } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

raiseDefaultTimeout(240_000);

// Each function may call itself, by a test that no build can decide. So each has code and a symbol of its own whatever the
// compiler thinks of its size, though its caller may hold a copy of it in line. The call is never in tail position: that would
// make a loop of the body, and in a loop Map.get is searched inline, without a call of the code that the functions share.
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
    return process.argv.length > 99 ? this.total() + 1 : sum;
  }
}

function lineTotal(item: Item): number {
  const price = priceOf(item.name);
  return process.argv.length > 99 ? lineTotal(item) + 1 : price * item.count;
}

async function checkout(order: Order): Promise<string> {
  await Promise.resolve();
  const total = order.total();
  return "total " + total;
}

const order = new Order().add("tea", 2).add("cake", 3).add("milk", 1);
for (const signal of process.argv.slice(2)) process.on(signal as NodeJS.Signals, () => {});
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
  return process.argv.length > 99 ? priceOf(name) + 1 : price;
}
`,
};

// priceOf between two functions that fill more than a page each: the functions that a file imports lie in the order of their
// names. So the page of its first instructions holds code of these three alone, and none that a report of a fault there reads.
const filler = (name: string) =>
  `export function ${name}(n: number): number { let x = n | 0; ${"x = ((x ^ (x >>> 3)) + 7) | 0; ".repeat(600)}return process.argv.length > 99 ? ${name}(x) + 1 : x; }\n`;
const filesWithPriceOfBetweenFillers = {
  "app.ts": files["app.ts"]
    .replace("import { priceOf,", "import { before, priceOf, trailing,")
    .replace(
      "  const price = priceOf(",
      "  if (process.argv.length > 99) return before(item.count) + trailing(item.count);\n  const price = priceOf(",
    ),
  "prices.ts": files["prices.ts"] + filler("before") + filler("trailing"),
};

const quiet = {
  ...(!locksEnvironment && { BUN_CRASH_REPORT_URL: "" }),
  BUN_ENABLE_CRASH_REPORTING: "0",
  NO_COLOR: "1",
};
async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(withoutCoreDump(cmd), cwd, { ...bunEnv, ...quiet, ...env });
  return { stdout, stderr, exitCode };
}

// `mov eax, [0x18]`
const loadFromLowAddress = Buffer.from([0x8b, 0x04, 0x25, 0x18, 0x00, 0x00, 0x00]);
// `ud2`: what compiled code traps with.
const illegalInstruction = Buffer.from([0x0f, 0x0b]);
// `nop; xor eax, eax; call rax` and `push 8; pop rax; call rax`: a call of an address where nothing can run, as long as a near call.
const callOfZero = Buffer.from([0x90, 0x31, 0xc0, 0xff, 0xd0]);
const callOfEight = Buffer.from([0x6a, 0x08, 0x58, 0xff, 0xd0]);
// `mov [rip - 6], eax`: a store to the instruction itself. No code may be written, so the fault has the address of its instruction.
const storeToItself = Buffer.from([0x89, 0x05, 0xfa, 0xff, 0xff, 0xff]);
// `lea rdi, [rip - 7]; and rdi, -4096; mov esi, 4096; xor edx, edx; mov eax, 10; syscall; ret`: mprotect() takes every
// permission from the page of this code, and the processor cannot fetch the `ret` behind the call.
// prettier-ignore
const losesItsPage = Buffer.from([
  0x48, 0x8d, 0x3d, 0xf9, 0xff, 0xff, 0xff, 0x48, 0x81, 0xe7, 0x00, 0xf0, 0xff, 0xff, 0xbe, 0x00, 0x10, 0x00, 0x00,
  0x31, 0xd2, 0xb8, 0x0a, 0x00, 0x00, 0x00, 0x0f, 0x05, 0xc3,
]);

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
  /** Where the typed body starts. Its symbol is `<name> <file>:<line>`; any other unit of the function has its role after that. */
  addressOf(name: string) {
    for (const [symbol, address] of this.symbols)
      if (symbol.startsWith(name + " ") && /:\d+$/.test(symbol)) return address;
    throw new Error(`the executable has no symbol ${name}`);
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
  /** Where the near calls of `callee` return to in the program's other functions: in the body of its caller, and wherever that body was copied in line. */
  returnAddressesOfCallsOf(callee: string) {
    const target = this.addressOf(callee);
    const sorted = [...this.addresses].sort((a, b) => a - b);
    const found: number[] = [];
    for (const [symbol, start] of this.symbols) {
      if (!/ (?:app|prices)\.ts:\d+/.test(symbol) || start === target) continue;
      const end = sorted.find(address => address > start)!;
      for (let address = start; address + 5 <= end; address++) {
        const at = this.offsetOf(address);
        if (this.bytes[at] === 0xe8 && address + 5 + this.bytes.readInt32LE(at + 1) === target) found.push(address + 5);
      }
    }
    if (!found.length) throw new Error(`nothing calls ${callee}`);
    return found;
  }
  writeWithFaultAt(addresses: number | number[], path: string, fault = loadFromLowAddress) {
    const planted = Buffer.from(this.bytes);
    for (const address of [addresses].flat()) fault.copy(planted, this.offsetOf(address));
    writeFileSync(path, planted);
    chmodSync(path, 0o755);
  }
}

const framesOf = (text: string) =>
  [...text.matchAll(/^ +at (?:(.*) \()?\.\/(.*?)\)?$/gm)].map(([, name, place]) => `${name ?? ""} ${place}`);

// The planted bytes are x64's, the symbol table is ELF's, and in a Bun built with AddressSanitizer its handler answers, not Bun's.
describe.skipIf(!isLinux || process.arch !== "x64" || isASAN)("a planted fault", () => {
  async function build(cwd: string) {
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "--aot-symbols", "app.ts", "--outfile", "app"],
      cwd,
    );
    expect(built.stderr).not.toMatch(/^error\b/m);
    expect(built.exitCode).toBe(0);
    const id = built.stdout.match(/^ +build id  ([0-9a-f]{32})$/m)?.[1];
    expect(id).toBeString();
    expect(await run([join(cwd, "app")], cwd)).toEqual({ stdout: "started\ntotal 23\n", stderr: "", exitCode: 0 });
    return { id: id!, executable: new Executable(join(cwd, "app")) };
  }
  const plantedLoad = { address: "0x18", code: "8b 04 25 18 00 00 00" };
  /**
   * `address` is what the processor could not reach. `code` is the planted instruction, where the fault is not at the
   * address of the instruction itself. `rip` is what that register held, where it is no place in the code.
   */
  async function crash(cwd: string, id: string, fault: { address: string; code?: string; rip?: string } = plantedLoad) {
    const { address, code, rip } = fault;
    const { stdout, stderr, exitCode } = await run([join(cwd, "planted")], cwd);
    expect(stdout).toBe("started\n");
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(new RegExp(`Segmentation fault at address ${address}\n`));
    expect(stderr.split("\n")).toContain("Build ID: " + id);
    // What the processor held: the planted instruction itself, and no value that says where anything was loaded.
    expect(stderr).toMatch(
      code ? new RegExp(`^Code at rip: ${code}( [0-9a-f]{2})*$`, "m") : /^Code at rip: not readable$/m,
    );
    const registers = stderr.match(/^Registers:((?: r[a-z0-9]+=\S+){17})$/m)?.[1];
    expect(registers).toBeString();
    for (const [, name, value] of registers!.matchAll(/ (\w+)=(\S+)/g)) {
      expect(`${name}=${value}`).toMatch(
        /=(0x[0-9a-f]{1,8}|0x[0-9a-f]{13,16}|code\+0x[0-9a-f]+|stack[+-]0x[0-9a-f]+|address\.\.[0-9a-f]{3})$/,
      );
    }
    expect(registers).toMatch(/ rsp=stack\+0x0 /);
    expect(registers).toMatch(rip ? new RegExp(` rip=${rip}$`) : / rip=code\+0x[0-9a-f]+$/);
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
    executable.writeWithFaultAt(executable.returnAddressesOfCallsOf("priceOf"), join(String(dir), "planted"));
    expect(await crash(String(dir), id)).toEqual([
      "lineTotal app.ts:17:17",
      "total app.ts:11:43",
      "checkout app.ts:23:23",
    ]);
  });

  // Bun's handler for a signal that JavaScript listens for notes the signal and returns: onto the instruction that raised it, for ever.
  test("under a listener for its signal: the report all the same", async () => {
    using dir = tempDir("aot-crash-in-compiled-code", files);
    const { executable } = await build(String(dir));
    for (const [signal, fault, words] of [
      ["SIGSEGV", loadFromLowAddress, "Segmentation fault at address 0x18\n"],
      ["SIGILL", illegalInstruction, "Illegal instruction at address 0x"],
    ] as const) {
      executable.writeWithFaultAt(executable.returnAddressesOfCallsOf("priceOf"), join(String(dir), "planted"), fault);
      await using child = Bun.spawn({
        cmd: withoutCoreDump([join(String(dir), "planted"), "SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE"]),
        cwd: String(dir),
        env: { ...bunEnv, ...quiet },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
        killSignal: "SIGKILL",
      });
      const [stdout, stderr] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      expect({ stdout, signal: child.signalCode }).toEqual({ stdout: "started\n", signal });
      expect(stderr).toContain(words);
      expect(framesOf(stderr)[0]).toBe("lineTotal app.ts:17:17");
    }
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

  // The call of priceOf becomes a call of an address where nothing can run. Nothing of a function there has run, so it has
  // no frame, and the report starts at the function that called.
  test("a call of an address where nothing can run: the function that called and all its callers", async () => {
    using dir = tempDir("aot-crash-in-compiled-code", files);
    const { id, executable } = await build(String(dir));
    const calls = executable.returnAddressesOfCallsOf("priceOf").map(behind => behind - callOfZero.length);
    for (const [call, address] of [
      [callOfZero, "0x0"],
      [callOfEight, "0x8"],
    ] as const) {
      executable.writeWithFaultAt(calls, join(String(dir), "planted"), call);
      expect(await crash(String(dir), id, { address, rip: address })).toEqual([
        "lineTotal app.ts:17:17",
        "total app.ts:11:43",
        "checkout app.ts:23:23",
      ]);
    }
  });

  // A call in tail position whose result changes form is a plain call, and a frame that has made one is not shown once
  // what it called runs. What this one called has not run.
  test("a call in tail position of an address where nothing can run: the function that called is there", async () => {
    using dir = tempDir("aot-crash-in-compiled-code", {
      "app.ts": `import { whole } from "./whole.ts";

function half(n: number): number {
  if (process.argv.length > 99) return half(n) + 1;
  return n > 0 ? whole(n) : 0.5;
}

function outer(n: number): number {
  return process.argv.length > 99 ? outer(n) + 1 : half(n) + 1;
}

console.log("started");
console.log("total " + (outer(process.argv.length) + 20));
`,
      "whole.ts": `export function whole(n: number): number {
  return (process.argv.length > 99 ? whole(n) + 1 : n) | 0;
}
`,
    });
    const { id, executable } = await build(String(dir));
    const calls = executable.returnAddressesOfCallsOf("whole").map(behind => behind - callOfZero.length);
    executable.writeWithFaultAt(calls, join(String(dir), "planted"), callOfZero);
    expect(await crash(String(dir), id, { address: "0x0", rip: "0x0" })).toEqual([
      "half app.ts:5:18",
      "outer app.ts:9:52",
      " app.ts:13:25",
    ]);
  });

  // A fault at the address of its own instruction is also what a page of code gives that cannot be fetched. Its line is then
  // found without a read of the code in front of it. Here it is where priceOf returns to, as in the first test of a function.
  test("a fault at its own address behind a call: the function by the line of the call, and all its callers", async () => {
    using dir = tempDir("aot-crash-in-compiled-code", files);
    const { id, executable } = await build(String(dir));
    const behindCalls = executable.returnAddressesOfCallsOf("priceOf");
    executable.writeWithFaultAt(behindCalls, join(String(dir), "planted"), storeToItself);
    expect(await crash(String(dir), id, { address: "0x[0-9A-F]+" })).toEqual([
      "lineTotal app.ts:17:17",
      "total app.ts:11:43",
      "checkout app.ts:23:23",
    ]);
  });

  // Here the code at the address cannot be read either, as where a page of the executable is lost. The report reads none
  // of it: the line of the function is from the tables, and its callers are on other pages.
  test("a fault at an instruction on a page that can no longer be read: the function and all its callers", async () => {
    using dir = tempDir("aot-crash-in-compiled-code", filesWithPriceOfBetweenFillers);
    const { id, executable } = await build(String(dir));
    const entry = executable.addressOf("priceOf");
    const page = entry - (entry % 4096);
    // What a symbol names ends where the next symbol starts.
    const sorted = [...executable.addresses].sort((a, b) => a - b);
    const startsOnPage = new Set(sorted.filter((start, index) => start < page + 4096 && sorted[index + 1] > page));
    const namesOnPage = new Set<string>();
    for (const [symbol, start] of executable.symbols)
      if (startsOnPage.has(start)) namesOnPage.add(symbol.split(" ")[0]);
    expect({ names: [...namesOnPage].sort(), endsOnPage: entry + losesItsPage.length <= page + 4096 }).toEqual({
      names: ["before", "priceOf", "trailing"],
      endsOnPage: true,
    });
    executable.writeWithFaultAt(entry, join(String(dir), "planted"), losesItsPage);
    const placeInPage = ((entry + losesItsPage.length - 1) % 4096).toString(16).padStart(3, "0").toUpperCase();
    expect(await crash(String(dir), id, { address: `0x[0-9A-F]*${placeInPage}` })).toEqual([
      "priceOf prices.ts:13:17",
      "lineTotal app.ts:18:17",
      "total app.ts:11:43",
      "checkout app.ts:24:23",
    ]);
  });

  // The function at such an address may have run, so it stays on the list. Here it is the first instruction of priceOf,
  // which has no frame record yet.
  test("a fault at the address of the first instruction of a function: the function and all its callers", async () => {
    using dir = tempDir("aot-crash-in-compiled-code", files);
    const { id, executable } = await build(String(dir));
    const entry = executable.addressOf("priceOf");
    executable.writeWithFaultAt(entry, join(String(dir), "planted"), storeToItself);
    // Where the executable is loaded does not change the place in the page.
    const placeInPage = (entry % 4096).toString(16).padStart(3, "0").toUpperCase();
    expect(await crash(String(dir), id, { address: `0x[0-9A-F]*${placeInPage}` })).toEqual([
      "priceOf prices.ts:12:1",
      "lineTotal app.ts:17:17",
      "total app.ts:11:43",
      "checkout app.ts:23:23",
    ]);
  });
});

// Its program crashes by bun:internal-for-testing, which a locked environment opens to no compiled code.
describe.skipIf(isWindows || isASAN || !without("a locked environment"))(
  "a crash in what a compiled function calls",
  () => {
    const program = `import { read } from "bun:ffi";
import { crash_handler } from "bun:internal-for-testing";

function lowest(how: string): number {
  if (how === "fault") return read.u8(8 as never) + 1;
  if (how === "panic") crash_handler.panic();
  if (how === "panic of Rust") crash_handler.rustPanic();
  if (how === "out of memory") crash_handler.outOfMemory();
  if (how === "trap") crash_handler.trap();
  if (how === "abort") crash_handler.abort();
  if (how === "no stack left") crash_handler.stackOverflow();
  return 1;
}

const [how, listens, raw] = process.argv.slice(2);
if (raw) process.stdin.setRawMode(true);
const signals = ["SIGTRAP", "SIGABRT", "SIGILL"] as const;
if (listens) for (const signal of signals) process.on(signal, () => {});
if (listens === "listened") for (const signal of signals) process.removeAllListeners(signal);
if (how.endsWith(" in a Worker")) new Worker("./app.ts", { argv: [how.replace(" in a Worker", "")] });
else console.log("went on", lowest(how));
`;
    const forTesting = { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", BUN_GARBAGE_COLLECTOR_LEVEL: "0" };
    let dir: ReturnType<typeof tempDir>;
    let cwd: string;

    beforeAll(async () => {
      dir = tempDir("aot-crash-below-compiled-code", { "app.ts": program });
      cwd = String(dir);
      const built = await run([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], cwd, forTesting);
      expect(built.stderr).not.toMatch(/^error\b/m);
      expect(built.exitCode).toBe(0);
    });
    afterAll(() => dir?.[Symbol.dispose]());

    const inLowest = /^lowest app\.ts:\d+:\d+$/;

    test.each(["fault", "panic", "panic of Rust", "out of memory", "trap", "abort"])(
      "names the function first: %s",
      async how => {
        const { stdout, stderr } = await run([join(cwd, "app"), how], cwd, forTesting);
        expect(stdout).toBe("");
        expect(framesOf(stderr)[0]).toMatch(inLowest);
      },
    );

    // glibc's raise() keeps no frame record and has the id of the thread where the frame pointer would be, and every eighth id is aligned.
    // From there the stack is searched, and what earlier calls have left on it differs from run to run.
    test("names the function first, run after run: abort", async () => {
      for (let time = 0; time < 16; time++) {
        const { stderr } = await run([join(cwd, "app"), "abort"], cwd, forTesting);
        expect(framesOf(stderr)[0]).toMatch(inLowest);
      }
    });

    test.each([
      "fault",
      "panic",
      "panic of Rust",
      "out of memory",
      "trap",
      "abort",
      "no stack left",
      "no stack left in a Worker",
    ])("the terminal is out of raw mode again: %s", async how => {
      let shown = "";
      const child = Bun.spawn({
        // A stack without a limit never runs out: it grows until the kernel ends the process, and no handler sees that. CI's machines set no limit.
        cmd: ["sh", "-c", 'ulimit -c 0; ulimit -s 8192; "$0" "$@"; stty -a', join(cwd, "app"), how, "", "raw"],
        cwd,
        env: { ...bunEnv, ...quiet, ...forTesting },
        terminal: {
          cols: 200,
          rows: 24,
          data: (_: unknown, data: Uint8Array) => void (shown += new TextDecoder().decode(data)),
        },
      } as never);
      await child.exited;
      expect(shown).toContain("Bun has ");
      expect(shown.match(/-?\b(?:icanon|echo|isig|icrnl)\b/g)?.sort()).toEqual(["echo", "icanon", "icrnl", "isig"]);
    });

    // The npm package signal-exit listens for SIGTRAP and SIGABRT, and half the command line tools on npm load it.
    test.each([
      ...["", "listens", "listened"].map(listens => ["trap", "SIGTRAP", listens] as const),
      ...["", "listens", "listened"].map(listens => ["abort", "SIGABRT", listens] as const),
      ["trap in a Worker", "SIGTRAP", "listens"] as const,
      ["abort in a Worker", "SIGABRT", "listens"] as const,
    ])("%s ends a program with %s and one report, with the argument %j", async (how, signal, listens) => {
      await using child = Bun.spawn({
        cmd: withoutCoreDump([join(cwd, "app"), how, listens]),
        env: { ...bunEnv, ...quiet, ...forTesting },
        stdout: "pipe",
        stderr: "pipe",
        // Where cores are piped to a program, a loaded machine takes seconds to let a process die.
        timeout: 90_000,
        killSignal: "SIGKILL",
      });
      const [stdout, stderr] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      expect({ stdout, signal: child.signalCode }).toEqual({ stdout: "", signal });
      expect(stderr.split("Bun has crashed.").length).toBe(2);
      expect(framesOf(stderr)[0]).toMatch(inLowest);
    });

    test("a closed stderr is no reason to go on", async () => {
      for (const [how, signal] of [
        ["trap", "SIGTRAP"],
        ["abort", "SIGABRT"],
      ]) {
        await using child = Bun.spawn({
          cmd: ["sh", "-c", 'ulimit -c 0; exec "$0" "$@" 2>&-', join(cwd, "app"), how, "listens"],
          env: { ...bunEnv, ...quiet, ...forTesting },
          stdout: "pipe",
          timeout: 90_000,
          killSignal: "SIGKILL",
        });
        const [stdout] = await Promise.all([child.stdout.text(), child.exited]);
        expect({ how, stdout, signal: child.signalCode }).toEqual({ how, stdout: "", signal });
      }
    });

    describe("process.abort()", () => {
      let dir: ReturnType<typeof tempDir>;
      beforeAll(async () => {
        dir = tempDir("aot-process-abort", {
          "app.ts": `const listens = process.argv[2];
if (listens) process.on("SIGABRT", () => {});
if (listens === "listened") process.removeAllListeners("SIGABRT");
process.abort();
`,
        });
        const built = await run([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], String(dir));
        expect(built.exitCode).toBe(0);
      });
      afterAll(() => dir?.[Symbol.dispose]());

      test.each(["", "listens", "listened"])("reports no crash, with the argument %j", async listens => {
        await using child = Bun.spawn({
          cmd: withoutCoreDump([join(String(dir), "app"), listens]),
          env: { ...bunEnv, ...quiet },
          stderr: "pipe",
        });
        const [stderr] = await Promise.all([child.stderr.text(), child.exited]);
        expect({ stderr, signal: child.signalCode }).toEqual({ stderr: "", signal: "SIGABRT" });
      });
    });
  },
);

// Fault injection: the compiler takes the result of reverse() for a new array, and the runtime checks what it gets.
describe.skipIf(isWindows || isASAN)("a check of the runtime that fails", () => {
  let dir: ReturnType<typeof tempDir>;
  beforeAll(async () => {
    dir = tempDir("aot-failed-check", {
      "app.ts": `const listens = process.argv[2];
const signals = ["SIGTRAP", "SIGABRT"] as const;
if (listens) for (const signal of signals) process.on(signal, () => console.log("heard", signal));
if (listens === "listened") for (const signal of signals) process.removeAllListeners(signal);
const flip = (list: number[]) => list.reverse()[0];
console.log("started");
console.log(flip([1, 2, 3]));
`,
    });
    const switches =
      "UnderstateEffects:Builtin/Array.prototype.reverse/FreshnessOfResult,CheckResultFreshnessAtRunTime";
    const flags = ["--compile", "--aot", "--aot-testing=" + switches];
    const built = await run([bunExe(), "build", ...flags, "app.ts", "--outfile", "app"], String(dir));
    expect(built.exitCode).toBe(0);
  });
  afterAll(() => dir?.[Symbol.dispose]());

  test.each(["", "listens", "listened"])("ends the program with one report, with the argument %j", async listens => {
    await using child = Bun.spawn({
      cmd: withoutCoreDump([join(String(dir), "app"), listens]),
      env: { ...bunEnv, ...quiet },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 90_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    expect({ stdout, signal: child.signalCode }).toEqual({
      stdout: "started\n",
      signal: isMacOS ? "SIGTRAP" : "SIGABRT",
    });
    expect(stderr).toContain(
      "Array.prototype.reverse is declared to return a fresh object, but the result is the receiver\n",
    );
    expect(stderr.split("Bun has crashed.").length).toBe(2);
  });
});

// In a test run a stack goes from a test file to what it imports and back.
// Every function has something left to do behind its call, so that its frame is still there.
const filesOfTestRun = {
  "helpers/lib.ts": `import { read } from "bun:ffi";
export function theirs(f: () => number): number {
  return f() + 1;
}
export function theirsCrashes(): number {
  return read.u8(8 as any, 0) + 1;
}
`,
  "mine.test.ts": `import { test } from "bun:test";
import { read } from "bun:ffi";
import { theirs } from "./helpers/lib";
function mineOnTop(): number {
  return read.u8(8 as any, 0) + 1;
}
function mineBelow() {
  return theirs(function mineInTheMiddle() {
    return theirs(mineOnTop) + 1;
  }) + 1;
}
test("a crash in the test file", () => {
  console.log(mineBelow());
});
`,
  "theirs.test.ts": `import { test } from "bun:test";
import { theirs, theirsCrashes } from "./helpers/lib";
function mineBelow() {
  return theirs(function mineInTheMiddle() {
    return theirsCrashes() + 1;
  }) + 1;
}
test("a crash in what the test file imports", () => {
  console.log(mineBelow());
});
`,
  "tsconfig.json": "{}",
};

// It needs nothing that a hardened build refuses.
test.skipIf(!isLinux || isASAN)(
  "in an executable: the function that faults and all its callers, in their order",
  async () => {
    using dir = tempDir("aot-crash-in-an-executable", {
      "helpers/lib.ts": filesOfTestRun["helpers/lib.ts"],
      "app.ts": `import { read } from "bun:ffi";
import { theirs } from "./helpers/lib";
function onTop(): number {
  return read.u8(8 as any, 0) + 1;
}
function below() {
  return theirs(function inTheMiddle() {
    return theirs(onTop) + 1;
  }) + 1;
}
console.log(below());
`,
    });
    const cwd = String(dir);
    const built = await run([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], cwd);
    expect(built.stderr).not.toMatch(/^error\b/m);
    expect(built.exitCode).toBe(0);
    const { stderr } = await run([join(cwd, "app")], cwd);
    const report = stderr.split("Compiled JavaScript on the stack:\n")[1] ?? "";
    expect(
      [...report.slice(0, report.indexOf("\n\n")).matchAll(/^ +at (\S+) \(.*[\\/]([\w.]+:\d+:\d+)\)$/gm)].map(
        ([, name, place]) => `${name} ${place}`,
      ),
    ).toEqual([
      "onTop app.ts:4:15",
      "theirs lib.ts:3:10",
      "inTheMiddle app.ts:8:12",
      "theirs lib.ts:3:10",
      "below app.ts:7:10",
    ]);
  },
);

// A hardened build runs no compiled code but an executable's own, so it has no such test run.
test.skipIf(!isLinux || isASAN || !without("a hardened build"))(
  "in a test run: the frames of the test file and of what it imports, in their order",
  async () => {
    using dir = tempDir("aot-crash-in-a-test-run", filesOfTestRun);
    // A crash ends the run, so each file has a run of its own.
    const stacks: string[][] = [];
    for (const file of ["./mine.test.ts", "./theirs.test.ts"]) {
      const { stderr } = await run([bunExe(), "test", "--aot", "--isolate", file], String(dir));
      stacks.push(
        ...stderr
          .split("Compiled JavaScript on the stack:\n")
          .slice(1)
          .map(text =>
            [...text.slice(0, text.indexOf("\n\n")).matchAll(/^ +at (\S+) \(.*[\\/]([\w.]+:\d+:\d+)\)$/gm)].map(
              ([, name, place]) => `${name} ${place}`,
            ),
          ),
      );
    }
    expect(stacks).toEqual([
      [
        "mineOnTop mine.test.ts:5:15",
        "theirs lib.ts:3:10",
        "mineInTheMiddle mine.test.ts:9:12",
        "theirs lib.ts:3:10",
        "mineBelow mine.test.ts:8:10",
        "<anonymous> mine.test.ts:13:15",
      ],
      [
        "theirsCrashes lib.ts:6:15",
        "mineInTheMiddle theirs.test.ts:5:12",
        "theirs lib.ts:3:10",
        "mineBelow theirs.test.ts:4:10",
        "<anonymous> theirs.test.ts:9:15",
      ],
    ]);
  },
);
