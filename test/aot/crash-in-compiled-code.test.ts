// A fault in the machine code of a compiled function, or in code that the compiled functions share: what the process prints
// is enough to tell the build, the function and the line, and every compiled caller is there. The faults are planted: a copy of
// the executable gets a load from a low address written over its code.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isWindows, tempDir } from "harness";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { locksEnvironment } from "./hardened";
import { without } from "./harness/capabilities";
import { withoutCoreDump } from "./harness/commands";
import { afterAll, raiseDefaultTimeout } from "./harness/default-timeout";
import { run as runCommand } from "./harness/run";
import { beforeAll, describe, eachRow, gap, test } from "./supported";

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
  [...text.matchAll(/^ +at (?:(.*) \()?\/\$bunfs\/root\/(.*?)\)?$/gm)].map(
    ([, name, place]) => `${name ?? ""} ${place}`,
  );

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
if (listens) for (const signal of ["SIGTRAP", "SIGABRT"] as const) process.on(signal, () => {});
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

    // The npm package signal-exit listens for both signals, and half the command line tools on npm load it.
    const forwarded = "Bun's handler for a signal that JavaScript listens for takes the place of the crash handler's";
    eachRow([
      ["trap", "SIGTRAP", "nothing"],
      ["abort", "SIGABRT", "nothing"],
      gap(`${forwarded} and returns: on x64 the program goes on behind the trap, on arm64 it traps for ever`, [
        "trap",
        "SIGTRAP",
        "the signal",
      ]),
      gap(`${forwarded}: abort() ends the process without a word`, ["abort", "SIGABRT", "the signal"]),
    ] as const)("%s ends a program with %s and a report where it listens for %s", async (how, signal, heard) => {
      await using child = Bun.spawn({
        cmd: withoutCoreDump([join(cwd, "app"), how, heard === "nothing" ? "" : "listens"]),
        env: { ...bunEnv, ...quiet, ...forTesting },
        stdout: "pipe",
        stderr: "pipe",
        // Where cores are piped to a program, a loaded machine takes seconds to let a process die. The rows not met yet never end.
        timeout: heard === "nothing" ? 90_000 : 5000,
        killSignal: "SIGKILL",
      });
      const [stdout, stderr] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      expect({ stdout, signal: child.signalCode }).toEqual({ stdout: "", signal });
      expect(framesOf(stderr)[0]).toMatch(inLowest);
    });
  },
);

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
