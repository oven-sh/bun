// For run-parallel.ts, which is no test: it takes nothing from test/harness.ts.
//
// What the threads of a run that is over its time limit are doing: the name of each, the system call that it waits in, and the functions on its stack.
// A debugger is not asked to attach. Where the system lets only a parent look into a process, a debugger that is started beside the run is refused. The driver is the parent, so it reads /proc itself.
// The first function of a thread is where it stands. /proc does not say the frame pointer, so the others are looked for among the words of the stack, and a frame record that a call
// left behind when it returned may be taken for the first: then the functions below the first are not the callers.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const bytesRead = 256 * 1024;
const mostFrames = 40;

type Mapping = { from: number; to: number; offset: number; file: string };

function codeOf(pid: number): Mapping[] {
  return readFileSync(`/proc/${pid}/maps`, "utf8")
    .split("\n")
    .map(line => /^([0-9a-f]+)-([0-9a-f]+) ..x. ([0-9a-f]+) \S+ \S+ *(.*)$/.exec(line))
    .filter(found => found !== null)
    .map(([, from, to, offset, file]) => ({ from: parseInt(from, 16), to: parseInt(to, 16), offset: parseInt(offset, 16), file }));
}

/** As much as is there: behind the last page of a stack nothing is mapped. */
function wordsFrom(memory: number, address: number) {
  const bytes = Buffer.alloc(bytesRead);
  let read = 0;
  try {
    for (let got; read < bytesRead && (got = readSync(memory, bytes, read, Math.min(4096, bytesRead - read), address + read)) > 0; ) read += got;
  } catch {}
  return new BigUint64Array(bytes.buffer, bytes.byteOffset, read >> 3);
}

/**
 * A function that keeps a frame record stores two words: where the record of its caller lies, further up the stack, and where it returns to. The walk begins at the first such pair whose caller's
 * record is one too, so what a function without a record has left below it is passed over.
 */
function returnAddresses(words: BigUint64Array, top: number, isCode: (address: number) => boolean) {
  // On arm64 a library may sign what it stores: the signature lies above the 48 bits of an address.
  const returnsTo = (at: number) => Number(process.arch === "arm64" ? words[at + 1] & 0xffff_ffff_ffffn : words[at + 1]);
  const isRecord = (at: number) => at >= 0 && at + 1 < words.length && isCode(returnsTo(at));
  const callerOf = (at: number) => {
    const caller = (Number(words[at]) - top) / 8;
    return Number.isInteger(caller) && caller > at ? caller : -1;
  };
  let at = 0;
  while (at < words.length && !(isRecord(at) && isRecord(callerOf(at)))) at++;
  const found: number[] = [];
  for (; isRecord(at) && found.length < mostFrames; at = callerOf(at)) found.push(returnsTo(at));
  return found;
}

/** A runner lays a Bun without symbols beside the whole one for what builds many executables. It is the same link, and so is every executable: a copy of the Bun that built it. */
function bunWithSymbols() {
  const whole = join(dirname(process.execPath), "bun-profile");
  return basename(process.execPath) === "bun-stripped" && existsSync(whole) ? whole : process.execPath;
}

/** By the table of symbols alone, out of the file: nothing is attached to. */
function namesOf(addresses: number[]) {
  const names = new Map<number, string>();
  const gdb = Bun.which("gdb");
  if (!gdb || !addresses.length) return names;
  const asked = Bun.spawnSync({
    cmd: [gdb, "--readnever", "-nx", "-batch", ...addresses.flatMap(address => ["-ex", `info symbol 0x${address.toString(16)}`]), bunWithSymbols()],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    timeout: 60_000,
  });
  const lines = asked.stdout.toString().split("\n").filter(line => / in section |^No symbol matches /.test(line));
  if (lines.length === addresses.length)
    addresses.forEach((address, at) => / in section /.test(lines[at]) && names.set(address, lines[at].replace(/ in section \S+.*$/, "").replace(/^(.{120}).+( \+ \d+)$/, "$1..$2")));
  return names;
}

export function stacksOf(pid: number) {
  if (process.platform !== "linux") return "";
  let memory: number | undefined;
  try {
    const code = codeOf(pid);
    const mappingOf = (address: number) => code.find(({ from, to }) => address >= from && address < to);
    // An executable, or the Bun that starts a program that was written alone: the first file with code in it.
    const bun = code.find(({ file }) => file.startsWith("/"))?.file;
    memory = openSync(`/proc/${pid}/mem`, "r");
    const threads = readdirSync(`/proc/${pid}/task`).map(thread => {
      const read = (file: string) => readFileSync(`/proc/${pid}/task/${thread}/${file}`, "utf8").trim();
      const stat = read("stat");
      // `running`, or the number of the call, its six arguments, the stack pointer and the program counter.
      const call = read("syscall").split(" ");
      const [top, counter] = call.slice(-2).map(Number);
      const stack = call.length === 9 ? [counter, ...returnAddresses(wordsFrom(memory!, top), top, address => !!mappingOf(address))] : [];
      const says = call.length === 9 ? `system call ${call[0]}(${call.slice(1, 4).join(", ")}, ..)` : call.join(" ");
      return { head: `${read("comm")} (${thread}), ${stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3)}: ${says}`, stack };
    });
    const names = namesOf([...new Set(threads.flatMap(({ stack }) => stack).filter(address => mappingOf(address)!.file === bun))]);
    const shown = (address: number) => {
      const { from, offset, file } = mappingOf(address)!;
      return names.get(address) ?? `${file ? basename(file) : "memory that is no file's"} + 0x${(address - from + offset).toString(16)}`;
    };
    return ["", `the threads of ${pid} at the time limit:`, ...threads.flatMap(({ head, stack }) => [head, ...stack.map(address => `    ${shown(address)}`)]), ""].join("\n");
  } catch (error) {
    return `\nthe threads of ${pid} at the time limit were not read: ${error}\n`;
  } finally {
    if (memory !== undefined) closeSync(memory);
  }
}
