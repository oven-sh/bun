import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// Prints how many resident pages of the executable's embedded program belong to this process alone.
const program = `import { dlopen, ptr, read } from "bun:ffi";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";

function onLinux() {
  const file = openSync("/proc/self/exe", "r");
  const header = Buffer.alloc(64);
  readSync(file, header, 0, 64, 0);
  const table = Buffer.alloc(header.readUInt16LE(56) * 56);
  readSync(file, table, 0, table.length, Number(header.readBigUInt64LE(32)));
  closeSync(file);
  let start = 0, end = 0;
  for (let at = 0; at < table.length; at += 56) {
    if (table.readUInt32LE(at) !== 0x6fb00002) continue;
    start = Number(table.readBigUInt64LE(at + 8));
    end = start + Number(table.readBigUInt64LE(at + 32));
  }
  if (!end) throw new Error("no program header names the embedded program");
  const own = readFileSync("/proc/self/maps", "utf8").split("\\n")[0].split(" ").pop()!;
  let isInside = false, kilobytes = 0;
  for (const line of readFileSync("/proc/self/smaps", "utf8").split("\\n")) {
    if (/^[0-9a-f]+-[0-9a-f]+ /.test(line)) {
      const offset = parseInt(line.split(" ")[2], 16);
      isInside = line.endsWith(own) && offset >= start && offset < end;
    } else if (isInside && line.startsWith("Anonymous:")) kilobytes += parseInt(line.slice(10));
  }
  return kilobytes / 4;
}

function onMacOS() {
  const { symbols } = dlopen("/usr/lib/libSystem.B.dylib", {
    _NSGetMachExecuteHeader: { args: [], returns: "ptr" },
    getsegmentdata: { args: ["ptr", "cstring", "ptr"], returns: "ptr" },
    getpid: { args: [], returns: "i32" },
    proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" },
  });
  const size = new BigUint64Array(1);
  const start = Number(symbols.getsegmentdata(symbols._NSGetMachExecuteHeader(), Buffer.from("__BUN\\0"), ptr(size)));
  const end = start + Number(size[0]);
  const regionInfo = 7, offsetOfPagesDirtied = 48, offsetOfPrivatePagesResident = 64, offsetOfAddress = 80, offsetOfSize = 88;
  const bytes = new Uint8Array(96);
  const info = new DataView(bytes.buffer);
  let pages = 0;
  for (let address = start; address < end; ) {
    if (symbols.proc_pidinfo(symbols.getpid(), regionInfo, BigInt(address), ptr(bytes), 96) !== 96) throw new Error("proc_pidinfo failed");
    const regionStart = Number(info.getBigUint64(offsetOfAddress, true));
    if (regionStart >= end) break;
    pages += Math.max(info.getUint32(offsetOfPagesDirtied, true), info.getUint32(offsetOfPrivatePagesResident, true));
    address = regionStart + Number(info.getBigUint64(offsetOfSize, true));
  }
  return pages;
}

function onWindows() {
  const { symbols } = dlopen("kernel32.dll", {
    GetModuleHandleW: { args: ["ptr"], returns: "ptr" },
    GetCurrentProcess: { args: [], returns: "ptr" },
    K32QueryWorkingSetEx: { args: ["ptr", "ptr", "u32"], returns: "i32" },
  });
  const base = Number(symbols.GetModuleHandleW(null));
  const headers = base + read.u32(base, 0x3c);
  const sections = headers + 24 + read.u16(headers, 20);
  for (let index = 0; index < read.u16(headers, 6); index++) {
    const section = sections + index * 40;
    if (read.u32(section, 0) !== 0x6e75622e || read.u32(section, 4)) continue;
    const numberOfPages = Math.ceil(read.u32(section, 8) / 4096);
    const pages = new BigUint64Array(numberOfPages * 2);
    for (let page = 0; page < numberOfPages; page++) pages[page * 2] = BigInt(base + read.u32(section, 12) + page * 4096);
    if (!symbols.K32QueryWorkingSetEx(symbols.GetCurrentProcess(), ptr(pages), pages.byteLength)) throw new Error("QueryWorkingSetEx failed");
    const isValid = 1n, isShared = 1n << 15n;
    let own = 0;
    for (let page = 0; page < numberOfPages; page++) if (pages[page * 2 + 1] & isValid && !(pages[page * 2 + 1] & isShared)) own++;
    return own;
  }
  throw new Error("no section holds the embedded program");
}

const texts = ["one", "two", "three"].map(text => text.toUpperCase());
console.log(texts.join(), process.platform === "linux" ? onLinux() : process.platform === "darwin" ? onMacOS() : onWindows());
`;

test.skipIf(!["linux", "darwin", "win32"].includes(process.platform))(
  "a start writes to no page of the embedded program",
  async () => {
    using directory = tempDir("aot-pages-of-the-embedded-program", { "main.ts": program });
    const executable = join(String(directory), process.platform === "win32" ? "main.exe" : "main");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
      cwd: String(directory),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toMatchObject({ exitCode: 0 });
    await using proc = Bun.spawn({ cmd: [executable], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ONE,TWO,THREE 0\n", stderr: "", exitCode: 0 });
  },
);
