import { join } from "node:path";
// Every test of the packed portable image that this Linux machine can run.
//
//   bun test/run-tests.ts [--runs 3] [--json out/test-results.json] [--only substring]
//
// A run of a test image passes with exit code 42 and the expected line of
// output. What runs where:
//   native   the x86_64 container, its Linux stub, the shells, the POSIX host
//   qemu     the aarch64 container, its Linux stub and the aarch64 POSIX host
//            (/usr/bin/qemu-aarch64, user mode)
//   static   the checking tools: the format, the PE dumps, the signature
//   not run  Windows and macOS: there is no Windows machine and no Mac here.
//            The Windows host is an input file, the packed PE is only checked
//            statically (tools/pe-compare.ts). See NOTES.md.
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { inspect } from "../tools/inspect.ts";
import { checkSignature } from "../tools/check_signature.ts";
import { pack, partKey, stripImageSignature } from "../tools/pack.ts";
import { decodeToc } from "../tools/format.ts";
import { movePe } from "../tools/pe.ts";
import { comparePe } from "../tools/pe-compare.ts";
import { buildLinuxStub } from "../tools/build.ts";

const here = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const out = `${here}/out`;
const cache = `${here}/cache`;
const BUSYBOX = `${cache}/bbin`;
const ZSH = `${cache}/zsh-x86_64/bin/zsh`;
const QEMU = "/usr/bin/qemu-aarch64";
const LLVM = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const WIN_HOSTS = process.env.PORTABLE_WIN_HOSTS ?? join(import.meta.dir, "../../../../build/portable/inputs/windows");
const WIN_HOST: Record<string, string> = { x86_64: `${WIN_HOSTS}/host-x64.exe`, aarch64: `${WIN_HOSTS}/host-arm64.exe` };
const M2 = /^m2: threads=8 total=204263652 thread_locals_ok=8\/8 main_tls=unset file_roundtrip=1 wall_year_ok=1 pid_ok=1 /m;
const BIGBSS = /^bigbss: bss=4 MiB zero_at_start=4194304 written=4194304 data_ok=1 data_writable=1$/m;

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const RUNS = Number(opt("runs", "3"));
const ONLY = opt("only");

type Result = { name: string; runs: number; passes: number; how: string; note?: string };
const results: Result[] = [];

function record(name: string, how: string, runs: number, passes: number, note?: string) {
  results.push({ name, runs, passes, how, note });
  const mark = how === "not run" ? "--  " : passes === runs ? "ok  " : "FAIL";
  const count = how === "not run" ? "" : `: ${passes} of ${runs}`;
  console.log(`${mark} ${name}${count} (${how})${note ? ` ${note}` : ""}`);
}

type Want = { code?: number; stdout?: RegExp; stderr?: RegExp };
function once(cmd: string[], env: Record<string, string>, want: Want, cwd?: string): { pass: boolean; why: string } {
  const p = Bun.spawnSync({ cmd, env: { ...process.env, ...env } as Record<string, string>, stdout: "pipe", stderr: "pipe", cwd });
  const stdout = p.stdout.toString();
  const stderr = p.stderr.toString();
  const why: string[] = [];
  if (want.code !== undefined && p.exitCode !== want.code) why.push(`exit ${p.exitCode}, wanted ${want.code}`);
  if (want.stdout && !want.stdout.test(stdout)) why.push(`stdout does not match ${want.stdout}`);
  if (want.stderr && !want.stderr.test(stderr)) why.push(`stderr does not match ${want.stderr}`);
  if (why.length) why.push(`out=${JSON.stringify(stdout.slice(0, 200))} err=${JSON.stringify(stderr.slice(0, 200))}`);
  return { pass: why.length === 0, why: why.join("; ") };
}

function many(name: string, how: string, runs: number, cmd: string[], env: Record<string, string>, want: Want, cwd?: string) {
  if (ONLY && !name.includes(ONLY)) return;
  let passes = 0;
  let why = "";
  for (let i = 0; i < runs; i++) {
    const r = once(cmd, env, want, cwd);
    if (r.pass) passes++;
    else why ||= r.why;
  }
  record(name, how, runs, passes, why || undefined);
}

function check(name: string, how: string, body: () => string | void) {
  if (ONLY && !name.includes(ONLY)) return;
  try {
    record(name, how, 1, 1, body() || undefined);
  } catch (e) {
    record(name, how, 1, 0, String((e as Error).message ?? e));
  }
}

async function checkAsync(name: string, how: string, body: () => Promise<string | void>) {
  if (ONLY && !name.includes(ONLY)) return;
  try {
    record(name, how, 1, 1, (await body()) || undefined);
  } catch (e) {
    record(name, how, 1, 0, String((e as Error).message ?? e));
  }
}

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const fresh = (dir: string) => {
  rmSync(dir, { recursive: true, force: true });
  return dir;
};
const failures = (checks: { ok: boolean; what: string; detail?: string }[]) =>
  checks.filter(c => !c.ok).map(c => `${c.what}${c.detail ? ` [${c.detail}]` : ""}`);

const x64 = `${out}/pack/threads-x86_64.com`;
const a64 = `${out}/pack/threads-aarch64.com`;
const toc64 = decodeToc(readFileSync(x64))!;
const fake = `${out}/fake`; // a stand-in uname, for the branches of the header script
mkdirSync(fake, { recursive: true });
copyFileSync(`${here}/test/fake-uname.ts`, `${fake}/uname`);
chmodSync(`${fake}/uname`, 0o755);
const fakeEnv = (system: string, machine: string) => ({
  PATH: `${fake}:${process.env.PATH}`,
  BUN_FAKE_UNAME_S: system,
  BUN_FAKE_UNAME_M: machine,
});

/* ================= the format itself ================= */
for (const [arch, path] of [
  ["x86_64", x64],
  ["aarch64", a64],
] as const) {
  check(`${arch}: the packed file passes every format check (tools/inspect.ts)`, "static", () => {
    const bad = failures(inspect(readFileSync(path), { path }).checks);
    if (bad.length) throw new Error(bad.join(", "));
    return `${inspect(readFileSync(path), { path }).checks.length} checks, including the shell header numbers`;
  });
  check(`${arch}: the packed PE is the input host, moved (tools/pe-compare.ts)`, "static", () => {
    const r = comparePe(WIN_HOST[arch], path);
    const bad = failures(r.bytes);
    if (bad.length || r.differences.length) {
      throw new Error([...bad, ...r.differences.map(d => `line ${d.line}: ${d.input} -> ${d.packed}`)].join(", "));
    }
    return `${r.lines} lines of llvm-readobj, 0 unexpected differences, PE header moved by ${r.delta}; NOT RUN on Windows`;
  });
  many(
    `${arch}: llvm-readobj reads the packed file without an error`,
    "static",
    1,
    [`${LLVM}/llvm-readobj`, "--file-headers", "--sections", "--coff-imports", "--coff-basereloc", "--coff-load-config", "--unwind", path],
    {},
    { code: 0, stdout: /Magic: MZ/ },
  );
  check(`${arch}: packing is a pure function of its inputs`, "static", () => {
    const inputs = {
      arch: arch as "x86_64" | "aarch64",
      image: readFileSync(`${out}/${arch}/threads.img`),
      winHost: readFileSync(WIN_HOST[arch]),
      linuxStub: readFileSync(`${out}/stub/linux-stub-${arch}`),
      sign: arch === "aarch64",
    };
    const a = pack(inputs).file;
    const b = pack(inputs).file;
    if (!a.equals(b)) throw new Error("two packs of the same inputs differ");
    if (!a.equals(readFileSync(path))) throw new Error("the pack differs from the file on disk");
    return `${a.length} bytes, sha256 ${createHash("sha256").update(a).digest("hex").slice(0, 16)}`;
  });
  check(`${arch}: building the Linux stub twice gives the same bytes`, "native", () => {
    const stub = `${out}/stub/linux-stub-${arch}`;
    const was = sha(stub);
    buildLinuxStub(arch, `${out}/stub`);
    if (sha(stub) !== was) throw new Error("the second build came out different");
    return `${statSync(stub).size} bytes, sha256 ${was.slice(0, 16)}`;
  });
}

check("the signature of the aarch64 container covers the image at its final offsets", "static", () => {
  const file = readFileSync(a64);
  const toc = decodeToc(file)!;
  const image = stripImageSignature(readFileSync(`${out}/aarch64/threads.img`));
  if (!file.subarray(toc.imageOff, toc.imageOff + toc.imageLen).equals(image)) throw new Error("the image in the container is not the input image");
  const bad = failures(checkSignature(file).checks);
  if (bad.length) throw new Error(bad.join(", "));
  if (toc.codeOff !== toc.imageOff) throw new Error("the signed range does not start at the image");
  return `signed range 0x${toc.codeOff.toString(16)} + ${toc.codeLen}, blob 0x${toc.sigOff.toString(16)} + ${toc.sigLen}, every page hashed again`;
});
check("the signature check notices one changed byte in the image", "static", () => {
  const file = readFileSync(a64);
  const toc = decodeToc(file)!;
  file[toc.imageOff + 0x5000] ^= 1;
  const bad = failures(checkSignature(file).checks);
  if (!bad.some(s => s.includes("hash of every one"))) throw new Error(`the changed byte went unnoticed: ${bad.join(", ") || "no failure"}`);
  return bad.find(s => s.includes("hash of every one"))!;
});
check("the same image signed by apple_sign.py and by the packer give the same hashes", "static", () => {
  // The bare aarch64 image from misctools/portable/build.sh is signed by the
  // Python tool at offset 0; the container signs the same bytes at 0x30000.
  // Both cover the same pages, so the hash tables have to be equal.
  const bare = readFileSync(`${out}/aarch64/threads.img`);
  const bareWhere = checkSignature(bare);
  const container = readFileSync(a64);
  const tocC = decodeToc(container)!;
  const blobBare = bare.subarray(bareWhere.where!.sigOff, bareWhere.where!.sigOff + bareWhere.where!.sigLen);
  const blobPacked = container.subarray(tocC.sigOff, tocC.sigOff + tocC.sigLen);
  if (!blobBare.equals(blobPacked)) throw new Error("the two signatures differ");
  return `${blobBare.length} bytes, identical: the packer is a port of tools/apple_sign.py`;
});

check("the image can grow: re-packing puts it at the same offset", "static", () => {
  // What "bun build --compile" does to a compiled program: a section appended
  // to the ELF image (src/elf, StandaloneModuleGraph.inject()). Here with
  // llvm-objcopy on the test image.
  const grown = `${out}/grown.img`;
  const packed = `${out}/pack/grown-x86_64.com`;
  const blob = `${out}/graph.bin`;
  rmSync(grown, { force: true });
  writeFileSync(blob, Buffer.alloc(700 * 1024, 0x42));
  const p = Bun.spawnSync({ cmd: [`${LLVM}/llvm-objcopy`, `--add-section=.bun=${blob}`, `${out}/x86_64/threads.img`, grown], stderr: "pipe" });
  if (!p.success) throw new Error(p.stderr.toString());
  const result = pack({
    arch: "x86_64",
    image: readFileSync(grown),
    winHost: readFileSync(WIN_HOST.x86_64),
    linuxStub: readFileSync(`${out}/stub/linux-stub-x86_64`),
    sign: false,
  });
  writeFileSync(packed, result.file);
  chmodSync(packed, 0o755);
  if (result.report.imageOff !== toc64.imageOff) {
    throw new Error(`the image moved from 0x${toc64.imageOff.toString(16)} to 0x${result.report.imageOff.toString(16)}`);
  }
  const bad = failures(inspect(result.file, { path: packed }).checks);
  if (bad.length) throw new Error(bad.join(", "));
  const run = once(["/bin/sh", packed, `${out}/probe-grown.tmp`], { BUN_PORTABLE_CACHE: `${out}/cache-run` }, { code: 42, stdout: M2 });
  if (!run.pass) throw new Error(run.why);
  return `image ${statSync(`${out}/x86_64/threads.img`).size} -> ${statSync(grown).size} bytes, still at 0x${toc64.imageOff.toString(16)}, and it runs`;
});
check("the signed aarch64 container can grow too, and the signature follows", "static", () => {
  const grown = `${out}/grown-a64.img`;
  const blob = `${out}/graph.bin`;
  const p = Bun.spawnSync({ cmd: [`${LLVM}/llvm-objcopy`, `--add-section=.bun=${blob}`, `${out}/aarch64/threads.img`, grown], stderr: "pipe" });
  if (!p.success) throw new Error(p.stderr.toString());
  const result = pack({
    arch: "aarch64",
    image: readFileSync(grown),
    winHost: readFileSync(WIN_HOST.aarch64),
    linuxStub: readFileSync(`${out}/stub/linux-stub-aarch64`),
    sign: true,
  });
  const toc = decodeToc(result.file)!;
  if (toc.imageOff !== decodeToc(readFileSync(a64))!.imageOff) throw new Error("the image moved");
  const bad = failures(checkSignature(result.file).checks);
  if (bad.length) throw new Error(bad.join(", "));
  writeFileSync(`${out}/pack/grown-aarch64.com`, result.file);
  chmodSync(`${out}/pack/grown-aarch64.com`, 0o755);
  return `image ${toc.imageLen} bytes at 0x${toc.imageOff.toString(16)}, signed range ${toc.codeLen}, blob 0x${toc.sigOff.toString(16)}`;
});

check("one stub serves every container of its architecture", "native", () => {
  // The stub reads the table of contents of the container it is given, so it
  // holds nothing of one container and the cache entry is shared.
  const dir = fresh(`${out}/cache-shared`);
  for (const file of [x64, `${out}/pack/grown-x86_64.com`]) {
    const r = once(["/bin/sh", file, `${out}/probe-shared.tmp`], { BUN_PORTABLE_CACHE: dir }, { code: 42, stdout: M2 });
    if (!r.pass) throw new Error(`${file}: ${r.why}`);
  }
  const names = readdirSync(dir);
  if (names.length !== 1) throw new Error(`the cache has ${names.length} entries: ${names.join(", ")}`);
  return `two containers with different images, one cache entry: ${names[0]}`;
});

check("the packer refuses a Windows host of the other architecture", "static", () => {
  try {
    pack({
      arch: "aarch64",
      image: readFileSync(`${out}/aarch64/threads.img`),
      winHost: readFileSync(WIN_HOST.x86_64),
      linuxStub: readFileSync(`${out}/stub/linux-stub-aarch64`),
      sign: true,
    });
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error("the packer accepted it");
});
check("the packer refuses an image whose segments are not 64 KiB aligned", "static", () => {
  try {
    pack({
      arch: "x86_64",
      image: readFileSync("/usr/bin/dash"),
      winHost: readFileSync(WIN_HOST.x86_64),
      linuxStub: readFileSync(`${out}/stub/linux-stub-x86_64`),
      sign: false,
    });
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error("the packer accepted it");
});
check("the packer refuses to move the PE header past the first section", "static", () => {
  try {
    movePe(readFileSync(WIN_HOST.x86_64), 0x78 + 0x1000);
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error("movePe accepted it");
});
check("a host that was linked with a PE checksum comes out with 0", "static", () => {
  const host = readFileSync(WIN_HOST.x86_64);
  const lfanew = host.readUInt32LE(0x3c);
  host.writeUInt32LE(0x12345678, lfanew + 4 + 20 + 64);
  const result = pack({
    arch: "x86_64",
    image: readFileSync(`${out}/x86_64/threads.img`),
    winHost: host,
    linuxStub: readFileSync(`${out}/stub/linux-stub-x86_64`),
    sign: false,
  });
  const stored = result.file.readUInt32LE(result.report.headerSize + 4 + 20 + 64);
  if (stored !== 0) throw new Error(`the packed file has CheckSum 0x${stored.toString(16)}`);
  return "CheckSum 0, and a stale one in the input does not survive";
});

/* ================= the Linux start ================= */
check("the header script parses in every shell on this machine (sh -n)", "native", () => {
  // Only the script part: -n would read the binary tail as well.
  const header = `${out}/header.sh`;
  writeFileSync(header, readFileSync(x64).subarray(0, toc64.headerSize));
  const done: string[] = [];
  for (const [name, shell] of [
    ["dash", "/usr/bin/dash"],
    ["bash", "/bin/bash"],
    ["busybox sh", `${BUSYBOX}/sh`],
    ["zsh", ZSH],
  ] as const) {
    if (!existsSync(shell)) continue;
    const p = Bun.spawnSync({ cmd: [shell, "-n", header], stdout: "pipe", stderr: "pipe" });
    if (!p.success) throw new Error(`${name}: ${p.stderr.toString()}`);
    done.push(name);
  }
  return done.join(", ");
});

for (const [name, shell, env] of [
  ["/bin/sh (dash)", "/bin/sh", {}],
  ["dash", "/usr/bin/dash", {}],
  ["bash", "/bin/bash", {}],
  ["zsh 5.8", ZSH, {}],
  ["busybox sh, PATH with busybox applets only", `${BUSYBOX}/sh`, { PATH: BUSYBOX, HOME: out }],
] as const) {
  if (!existsSync(shell)) {
    record(`x86_64 linux start from ${name}`, "native", RUNS, 0, "this shell is not on the machine");
    continue;
  }
  const dir = fresh(`${out}/cache-${name.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`);
  many(`x86_64 linux start from ${name}`, "native", RUNS, [shell, x64, `${out}/probe-sh.tmp`], { ...env, BUN_PORTABLE_CACHE: dir }, { code: 42, stdout: M2 });
}

many(
  "x86_64 linux start by running the file itself (the shell falls back on ENOEXEC)",
  "native",
  RUNS,
  ["/bin/bash", "-c", '"$1" "$2"', "-", x64, `${out}/probe-direct.tmp`],
  { BUN_PORTABLE_CACHE: `${out}/cache-run` },
  { code: 42, stdout: M2 },
);
many(
  "x86_64 linux start through env(1) (execvp falls back to /bin/sh)",
  "native",
  RUNS,
  ["/usr/bin/env", x64, `${out}/probe-env.tmp`],
  { BUN_PORTABLE_CACHE: `${out}/cache-run` },
  { code: 42, stdout: M2 },
);
check("a raw execve of the packed file fails with ENOEXEC, as it must", "native", () => {
  try {
    Bun.spawnSync({ cmd: [x64, `${out}/probe-x.tmp`], stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "ENOEXEC") throw new Error(`execve failed with ${code}, wanted ENOEXEC`);
    return "execve: ENOEXEC. A file that starts with MZ is not an ELF file; a shell has to read it. This is a limit of the format, not a bug";
  }
  throw new Error("execve did not fail");
});

check("the stub is written once, with the bytes that were packed", "native", () => {
  const dir = fresh(`${out}/cache-once`);
  const stub = `${out}/stub/linux-stub-x86_64`;
  const want = sha(stub);
  const name = `${dir}/stub-linux-x86_64-${want.slice(0, 16)}`;
  let first: ReturnType<typeof statSync> | undefined;
  for (let i = 0; i < 2; i++) {
    const r = once(["/bin/sh", x64, `${out}/probe-once.tmp`], { BUN_PORTABLE_CACHE: dir }, { code: 42, stdout: M2 });
    if (!r.pass) throw new Error(r.why);
    if (i === 0) first = statSync(name);
  }
  const second = statSync(name);
  if (sha(name) !== want) throw new Error("the stub in the cache is not the stub that was packed");
  if (first!.ino !== second.ino || first!.mtimeMs !== second.mtimeMs) throw new Error("the second start wrote the stub again");
  if (!(second.mode & 0o111)) throw new Error("the stub in the cache is not executable");
  return `${name.split("/").pop()}, ${second.size} bytes, same inode after the second start`;
});
await checkAsync("eight first starts at once end with one stub in the cache", "native", async () => {
  // The header script writes to a temporary name and renames, so no start
  // can see a half-written stub, and the last rename wins.
  const dir = fresh(`${out}/cache-race`);
  const procs = Array.from({ length: 8 }, (_, i) =>
    Bun.spawn({
      cmd: ["/bin/sh", x64, `${out}/probe-race-${i}.tmp`],
      env: { ...process.env, BUN_PORTABLE_CACHE: dir } as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  const status = await Promise.all(procs.map(p => p.exited));
  const names = readdirSync(dir);
  if (status.some(c => c !== 42)) throw new Error(`exit codes ${status.join(",")}`);
  if (names.length !== 1) throw new Error(`the cache holds ${names.length} files: ${names.join(", ")}`);
  if (sha(`${dir}/${names[0]}`) !== sha(`${out}/stub/linux-stub-x86_64`)) throw new Error("the stub in the cache is not the packed stub");
  return `8 of 8 runs exited 42, one cache entry: ${names[0]}`;
});

check("with no BUN_PORTABLE_CACHE, no XDG_CACHE_HOME, no HOME and no TMPDIR the cache is /tmp/.cache", "native", () => {
  // The four nested defaults of the header script, in a shell whose
  // environment holds nothing but PATH.
  rmSync("/tmp/.cache/bun-portable", { recursive: true, force: true });
  const p = Bun.spawnSync({ cmd: ["/bin/dash", x64, `${out}/probe-nohome.tmp`], env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 42) throw new Error(`exit ${p.exitCode}: ${p.stderr.toString().slice(0, 200)}`);
  if (!M2.test(p.stdout.toString())) throw new Error("the image did not print its line");
  const names = readdirSync("/tmp/.cache/bun-portable");
  if (names.length !== 1 || sha(`/tmp/.cache/bun-portable/${names[0]}`) !== sha(`${out}/stub/linux-stub-x86_64`)) {
    throw new Error(`/tmp/.cache/bun-portable holds ${names.join(", ")}`);
  }
  return `/tmp/.cache/bun-portable/${names[0]}`;
});
many(
  "x86_64 linux start from the busybox ash applet",
  "native",
  1,
  [`${BUSYBOX}/ash`, x64, `${out}/probe-ash.tmp`],
  { PATH: BUSYBOX, HOME: out, BUN_PORTABLE_CACHE: `${out}/cache-ash` },
  { code: 42, stdout: M2 },
);

check("the image is mapped from the packed file, not copied", "native", () => {
  const proc = Bun.spawn({
    cmd: ["/bin/sh", x64, `${out}/probe-maps.tmp`],
    env: { ...process.env, BUN_PORTABLE_CACHE: `${out}/cache-run` } as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  let maps = "";
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      maps = readFileSync(`/proc/${proc.pid}/maps`, "utf8");
    } catch {
      break;
    }
    if (maps.includes("threads-x86_64.com")) break;
  }
  const lines = maps.split("\n").filter(l => l.includes("threads-x86_64.com"));
  const exec = lines.find(l => / r-xp /.test(l));
  if (!exec) throw new Error(`no executable file mapping of the container in the maps of the image:\n${lines.join("\n")}`);
  const offset = parseInt(exec.split(/\s+/)[2], 16);
  if (offset % 0x10000) throw new Error(`the code is mapped from offset 0x${offset.toString(16)}, not a multiple of 64 KiB`);
  return `${lines.length} mappings of the container, code from file offset 0x${offset.toString(16)} (r-xp)`;
});

many(
  "the arguments of the image are the container and its arguments",
  "native",
  1,
  ["/bin/sh", x64, `${out}/probe-args.tmp`, "second", "third"],
  { BUN_PORTABLE_CACHE: `${out}/cache-run` },
  { code: 42, stdout: /argc=4/ },
);
check("a container in a directory with spaces in its name starts", "native", () => {
  const dir = `${out}/a directory with spaces`;
  mkdirSync(dir, { recursive: true });
  const copy = `${dir}/packed file.com`;
  copyFileSync(x64, copy);
  chmodSync(copy, 0o755);
  const r = once(["/bin/sh", copy, `${out}/probe-space.tmp`], { BUN_PORTABLE_CACHE: `${out}/cache-run` }, { code: 42, stdout: M2 });
  if (!r.pass) throw new Error(r.why);
  return copy;
});
many(
  "a relative path from another working directory starts",
  "native",
  1,
  ["/bin/sh", "./threads-x86_64.com", `${out}/probe-rel.tmp`],
  { BUN_PORTABLE_CACHE: `${out}/cache-run` },
  { code: 42, stdout: M2 },
  `${out}/pack`,
);

/* the branches of the header script, with a stand-in uname */
many(
  "on macOS without a macOS stub the header script says so",
  "native",
  1,
  ["/bin/sh", x64],
  fakeEnv("Darwin", "x86_64"),
  { code: 1, stderr: /was packed without a macos loader stub for x86_64/ },
);
many("an unknown system is refused with a message", "native", 1, ["/bin/sh", x64], fakeEnv("SunOS", "x86_64"), {
  code: 1,
  stderr: /SunOS is not one of Linux, Darwin and Windows/,
});
many("a container of the other architecture is refused with a message", "native", 1, ["/bin/sh", a64], fakeEnv("Linux", "x86_64"), {
  code: 1,
  stderr: /this file holds an image for aarch64, this machine is x86_64/,
});
many("a cache directory that cannot be written gives a clear message", "native", 1, ["/bin/sh", x64], { BUN_PORTABLE_CACHE: "/proc/cannot/write/here" }, {
  code: 1,
  stderr: /cannot write the linux loader stub|mkdir/,
});
many("the Linux stub refuses a file without a table of contents", "native", 1, [`${out}/stub/linux-stub-x86_64`, `${out}/x86_64/threads.img`], {}, {
  code: 127,
  stderr: /has no table of contents/,
});
many("the Linux stub refuses a container of the other architecture", "native", 1, [`${out}/stub/linux-stub-x86_64`, a64], {}, {
  code: 127,
  stderr: /holds an image for another processor/,
});

check("the macOS branch of the header script extracts the macOS stub", "native", () => {
  // A real macOS stub can only be linked on a Mac. What is packed here is the
  // Mach-O object of the macOS compile check, as a stand-in: the extraction
  // is the whole test, the exec cannot work on Linux.
  const standin = `${out}/mac/host_posix.arm64.o`;
  if (!existsSync(standin)) throw new Error(`no Mach-O stand-in at ${standin}`);
  const container = `${out}/pack/standin-macstub-aarch64.com`;
  const result = pack({
    arch: "aarch64",
    image: readFileSync(`${out}/aarch64/threads.img`),
    winHost: readFileSync(WIN_HOST.aarch64),
    linuxStub: readFileSync(`${out}/stub/linux-stub-aarch64`),
    macosStub: readFileSync(standin),
    sign: true,
  });
  writeFileSync(container, result.file);
  chmodSync(container, 0o755);
  const bad = failures(inspect(result.file, { path: container }).checks);
  if (bad.length) throw new Error(bad.join(", "));
  const dir = fresh(`${out}/cache-mac`);
  const want = sha(standin);
  const r = once(["/bin/dash", container], { ...fakeEnv("Darwin", "arm64"), BUN_PORTABLE_CACHE: dir }, { code: 126, stderr: /Exec format error/ });
  if (!r.pass) throw new Error(r.why);
  const name = `${dir}/stub-macos-aarch64-${want.slice(0, 16)}`;
  if (sha(name) !== want) throw new Error("the extracted macOS stub differs from the packed one");
  return `${decodeToc(result.file)!.stubMacosLen} bytes extracted byte for byte to ${name.split("/").pop()}; Linux cannot exec a Mach-O file`;
});

/* ================= aarch64, under qemu ================= */
const a64Cache = fresh(`${out}/cache-a64`);
const a64Stub = `${a64Cache}/stub-linux-aarch64-${sha(`${out}/stub/linux-stub-aarch64`).slice(0, 16)}`;
check("aarch64: the header script extracts its stub here (the exec then needs qemu)", "native", () => {
  const r = once(
    ["/bin/dash", a64, `${out}/probe-a64.tmp`],
    { ...fakeEnv("Linux", "aarch64"), BUN_PORTABLE_CACHE: a64Cache },
    { code: 126, stderr: /Exec format error/ },
  );
  if (!r.pass) throw new Error(r.why);
  if (sha(a64Stub) !== sha(`${out}/stub/linux-stub-aarch64`)) throw new Error("the extracted stub differs from the packed stub");
  return "uname, the cache path and dd are the real ones; this kernel cannot exec an aarch64 program";
});
many("aarch64: the extracted stub maps the image out of the container and runs it", "qemu", RUNS, [QEMU, a64Stub, a64, `${out}/probe-a64.tmp`], {}, {
  code: 42,
  stdout: M2,
});
check("aarch64: the whole chain, shell header to image", "qemu", () => {
  // The exec has to go through qemu, so the cache holds a wrapper under the
  // name the header script looks for; it runs qemu on the real stub.
  // Everything else is the real header script: uname, the cache path, dd,
  // chmod, mv and exec.
  const dir = fresh(`${out}/cache-a64-chain`);
  mkdirSync(dir, { recursive: true });
  const stub = `${out}/stub/linux-stub-aarch64`;
  const name = `${dir}/stub-linux-aarch64-${sha(stub).slice(0, 16)}`;
  writeFileSync(
    name,
    `#!/usr/bin/env bun
// Test wrapper: this machine is x86-64, so the exec of the aarch64 stub goes
// through qemu-aarch64. Everything else is the header script of the container.
const p = Bun.spawnSync({ cmd: ["${QEMU}", "${stub}", ...process.argv.slice(2)], stdout: "inherit", stderr: "inherit", stdin: "inherit" });
process.exit(p.exitCode ?? 1);
`,
  );
  chmodSync(name, 0o755);
  const r = once(
    ["/bin/dash", a64, `${out}/probe-a64-chain.tmp`],
    { ...fakeEnv("Linux", "aarch64"), BUN_PORTABLE_CACHE: dir },
    { code: 42, stdout: M2 },
  );
  if (!r.pass) throw new Error(r.why);
  return "native: dash, uname, dd, chmod, mv, exec; under qemu-aarch64: the stub and the image";
});
many("aarch64: the grown container (a section appended to the image) runs", "qemu", 1, [QEMU, a64Stub, `${out}/pack/grown-aarch64.com`, `${out}/probe-a64g.tmp`], {}, {
  code: 42,
  stdout: M2,
});

/* ================= the second image: a .bss larger than a page ================= */
for (const [arch, how, cmd] of [
  ["x86_64", "native", ["/bin/sh", `${out}/pack/bigbss-x86_64.com`]],
  ["aarch64", "qemu", [QEMU, a64Stub, `${out}/pack/bigbss-aarch64.com`]],
] as const) {
  check(`${arch}: the packed bigbss image passes every format check`, "static", () => {
    const path = `${out}/pack/bigbss-${arch}.com`;
    const bad = failures(inspect(readFileSync(path), { path }).checks);
    if (bad.length) throw new Error(bad.join(", "));
    return "its writable segment has 4 MiB of zero pages after its file pages";
  });
  many(`${arch}: the bigbss image starts (zero pages after the file pages)`, how, RUNS, [...cmd], { BUN_PORTABLE_CACHE: `${out}/cache-run` }, {
    code: 42,
    stdout: BIGBSS,
  });
}

/* ================= the hosts, on Linux ================= */
many(
  "the POSIX host reads the table of contents and maps the image from the container (x86_64)",
  "native",
  RUNS,
  [`${out}/host-linux-x86_64`, x64, `${out}/probe-host.tmp`],
  {},
  { code: 42, stdout: M2 },
);
many("the POSIX host still starts a bare image file (x86_64)", "native", RUNS, [`${out}/host-linux-x86_64`, `${out}/x86_64/threads.img`, `${out}/probe-host2.tmp`], {}, {
  code: 42,
  stdout: M2,
});
many("the POSIX host maps the image at the right offset (x86_64, BUN_HOST_TRACE)", "native", 1, [`${out}/host-linux-x86_64`, x64, `${out}/probe-host5.tmp`], {
  BUN_HOST_TRACE: "1",
}, { code: 42, stderr: new RegExp(`image at 0x${toc64.imageOff.toString(16)}`) });
many("the POSIX host starts the bigbss image out of its container (x86_64)", "native", 1, [`${out}/host-linux-x86_64`, `${out}/pack/bigbss-x86_64.com`], {}, {
  code: 42,
  stdout: BIGBSS,
});
many(
  "the POSIX host reads the table of contents and maps the image from the container (aarch64)",
  "qemu",
  RUNS,
  [QEMU, `${out}/host-linux-aarch64`, a64, `${out}/probe-host3.tmp`],
  {},
  { code: 42, stdout: M2 },
);
many("the POSIX host still starts a bare image file (aarch64)", "qemu", RUNS, [QEMU, `${out}/host-linux-aarch64`, `${out}/aarch64/threads.img`, `${out}/probe-host4.tmp`], {}, {
  code: 42,
  stdout: M2,
});

/* ================= what was not run ================= */
record("x86_64 and aarch64 windows start", "not run", 0, 0, "no Windows machine here: the packed PE is only checked statically, see tools/pe-compare.ts");
record("x86_64 and aarch64 macOS start", "not run", 0, 0, "no Mac here: bun tools/mac-stub.ts prints the script a person runs");

/* ================= summary ================= */
const notRun = results.filter(r => r.how === "not run");
const ran = results.filter(r => r.how !== "not run");
const failed = ran.filter(r => r.passes !== r.runs);
console.log(`\n${ran.length - failed.length} of ${ran.length} tests passed, ${notRun.length} could not run here`);
const json = opt("json");
if (json) await Bun.write(json, JSON.stringify({ runs: RUNS, results }, null, 2) + "\n");
if (failed.length) process.exit(1);
