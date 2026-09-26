// Runs the file system slice on this Linux machine, each way it can run here, and checks what it prints.
//
//   bun test.ts [--arch x86_64|aarch64] [--runs 3]      after build.ts. WORK as in build.ts.
//
// An image for aarch64 runs under qemu-aarch64 (user mode), and so does its test host.
//
//   direct          the kernel runs the image
//   hosted          the Linux test host (../host/host_posix.c) maps the image and serves its requests
//   hosted, macfs   the same, and what the host answers about a directory goes through the form
//                   that macOS has for it (BUN_HOST_TEST=macfs)
//   abi             x86_64, hosted: the image calls functions of the host that have the calling
//                   convention of Windows x64, through its import table, and the host calls a
//                   function of the image
//   abi, direct     x86_64: there is no host to resolve anything, the first call has to stop the image
//   as win32        BUN_PORTABLE_HOST_OS=win32 makes bun decide as on Windows, on Linux: the image takes
//                   bun's code for Windows, and its first call of Windows has to stop it with a message
//   as darwin       the same for macOS, direct and hosted: the image takes bun's code for macOS, and
//                   the first function of macOS has to stop it with a message
//   imports         the import tables have the functions that bun's file system code for Windows and
//                   for macOS calls, and none of them resolves on Linux
//   layout          the image prints the layout of the definitions of macOS, and the host that was
//                   compiled without the requests of the file system is enough for that
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const arch = option("--arch", "x86_64");
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const runs = Number(option("--runs", "3"));
const image = join(work, `out/bun_fs_slice-${arch}.img`);
const host = join(work, `out/host-linux-${arch}`);
const hostWithoutFiles = join(work, `out/host-linux-${arch}-without-files`);
const directory = join(work, `run-${arch}`);
const emulator = arch === process.arch.replace("x64", "x86_64").replace("arm64", "aarch64") ? [] : [`qemu-${arch}`];
mkdirSync(directory, { recursive: true });
if (!existsSync(image)) throw new Error(`${image}: build.ts --arch ${arch} has not made the image`);

/** The test host: a program of this machine, or for another processor a static one against the libc of the image. */
function compileHost(out: string, defines: string[]) {
  const source = join(tree, "host/host_posix.c");
  const warnings = ["-Wall", "-Wextra", "-Wno-unused-parameter"];
  let commands: string[][];
  if (!emulator.length) commands = [["cc", "-O2", ...warnings, ...defines, "-o", out, source, "-lpthread"]];
  else {
    const sys = join(work, `musl-${arch}/sysroot`);
    const resource = Bun.spawnSync([`${llvm}/clang`, "-print-resource-dir"], { stdout: "pipe" }).stdout.toString().trim();
    const builtins = join(work, `musl-${arch}/builtins/lib/linux/libclang_rt.builtins-${arch}.a`);
    commands = [
      [`${llvm}/clang`, `--target=${arch}-linux-musl`, "-O2", ...warnings, ...defines, "-nostdinc", "-isystem", join(sys, "include"), "-isystem", join(resource, "include"), "-fno-stack-protector", "-c", "-o", `${out}.o`, source],
      [`${llvm}/ld.lld`, "-static", "-z", "noexecstack", "-o", out, join(sys, "lib/crt1.o"), join(sys, "lib/crti.o"), `${out}.o`, `-L${join(sys, "lib")}`, "-lc", builtins, "-lc", join(sys, "lib/crtn.o")],
    ];
  }
  for (const command of commands) {
    const result = Bun.spawnSync(command, { stderr: "pipe", stdout: "pipe" });
    const messages = result.stderr.toString().trim();
    if (result.exitCode !== 0 || messages) throw new Error(`the host does not compile without a message:\n${messages}`);
  }
}
compileHost(host, []);
compileHost(hostWithoutFiles, ["-DBUN_HOST_WITHOUT_FILES"]);

const expected = readFileSync(join(here, "expected/linux.jsonl"), "utf8");
function run(command: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync([...emulator, ...command], { cwd: directory, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, signal: result.signalCode, out: result.stdout.toString(), err: result.stderr.toString() };
}
const results: { test: string; passes: number; runs: number; note?: string }[] = [];
function check(test: string, once: () => string | undefined) {
  let passes = 0;
  let note: string | undefined;
  for (let i = 0; i < runs; i++) {
    const problem = once();
    if (problem === undefined) passes++;
    else note = problem;
  }
  results.push({ test, passes, runs, note });
}
const asExpected = (r: ReturnType<typeof run>) => (r.code === 0 && r.out === expected ? undefined : `exit code ${r.code}, output ${r.out === expected ? "as expected" : "not as expected"}: ${r.err.slice(0, 200)}`);

check("direct", () => asExpected(run([image, directory])));
check("hosted", () => asExpected(run([host, image, directory])));
check("hosted, macfs", () => asExpected(run([host, image, directory], { BUN_HOST_TEST: "macfs" })));
if (arch === "x86_64") {
  check("abi, hosted", () => {
    const r = run([host, image, "--abi"]);
    const lines = r.out.split("\n").filter(Boolean).map(line => JSON.parse(line));
    const checks = lines.filter(line => "as_expected" in line);
    return r.code === 0 && checks.length === 4 && checks.every(line => line.as_expected === true) ? undefined : `exit code ${r.code}: ${r.out}`;
  });
  check("abi, direct: stops", () => {
    const r = run([image, "--abi"]);
    return r.code !== 0 && r.out === "" && r.err.includes("bun_host_test!test_sum6 is a function of Windows, and this host is Linux") ? undefined : `exit code ${r.code}: ${r.err}`;
  });
}
check("as win32: stops at the first call of Windows", () => {
  const r = run([image, directory], { BUN_PORTABLE_HOST_OS: "win32" });
  return r.code !== 0 && r.out === "" && / is a function of Windows, and this host is Linux/.test(r.err) ? undefined : `exit code ${r.code}: ${r.err}`;
});
for (const [name, command] of [["direct", [image, directory]], ["hosted", [host, image, directory]]] as const) {
  check(`as darwin, ${name}: stops at the first function of macOS`, () => {
    const r = run([...command], { BUN_PORTABLE_HOST_OS: "darwin" });
    return r.code !== 0 && r.out === "" && /libSystem!\S+ is a function of macOS, and this host is Linux/.test(r.err) ? undefined : `exit code ${r.code}: ${r.err}`;
  });
}
check("imports", () => {
  const r = run([host, image, "--imports"]);
  const lines = r.out.split("\n").filter(Boolean).map(line => JSON.parse(line));
  const ofWindows = lines.pop();
  const ofMacos = lines.find(line => line.step === "imports of macOS");
  const has = (library: string, symbol: string) => lines.some(line => line.library === library && line.symbol === symbol);
  const needed: [string, string][] = [
    ["ntdll", "NtCreateFile"], ["ntdll", "NtQueryDirectoryFile"], ["ntdll", "NtSetInformationFile"], ["ntdll", "NtClose"],
    ["kernel32", "ReadFile"], ["kernel32", "WriteFile"], ["kernel32", "GetCurrentDirectoryW"], ["kernel32", "GetFileAttributesW"],
    ["libuv", "uv_fs_open"], ["libuv", "uv_fs_mkdir"], ["libuv", "uv_fs_stat"], ["libuv", "uv_fs_rename"], ["libuv", "uv_fs_symlink"], ["libuv", "uv_fs_readlink"],
    ["libSystem", "bun_host_darwin_openat_nocancel4"], ["libSystem", "read$NOCANCEL"], ["libSystem", "write$NOCANCEL"], ["libSystem", "pread$NOCANCEL"],
    ["libSystem", "close$NOCANCEL"], ["libSystem", "__getdirentries64"], ["libSystem", "clonefile"], ["libSystem", "clonefileat"], ["libSystem", "copyfile"],
    ["libSystem", "fcopyfile"], ["libSystem", "bun_host_darwin_fcntl3"], ["libSystem", "renameatx_np"], ["libSystem", "lchmod"], ["libSystem", "realpath$DARWIN_EXTSN"],
    ["libSystem", "__error"], ["libSystem", arch === "x86_64" ? "fstat$INODE64" : "fstat"], ["libSystem", arch === "x86_64" ? "fstatat$INODE64" : "fstatat"],
  ];
  const absent = needed.filter(([library, symbol]) => !has(library, symbol));
  const variadic = lines.filter(line => line.library === "libSystem" && /^(open|openat|fcntl|ioctl|syscall|printf)(\$\w+)?$/.test(line.symbol));
  return r.code === 1 && ofWindows?.total === ofWindows?.missing && ofWindows.total > 100 && ofMacos?.total === ofMacos?.missing && ofMacos.total > 50 && absent.length === 0 && variadic.length === 0
    ? undefined
    : `exit code ${r.code}, ${JSON.stringify(ofWindows)}, ${JSON.stringify(ofMacos)}, not in the table: ${JSON.stringify(absent)}, variadic: ${JSON.stringify(variadic)}`;
});
check("layout of macOS, host without the requests of the file system", () => {
  const r = run([hostWithoutFiles, image, "--layout-darwin"]);
  const lines = r.out.split("\n").filter(Boolean);
  const stat = lines.map(line => JSON.parse(line)).find(line => line.fact === "size" && line.of === "stat");
  return r.code === 0 && lines.length > 500 && stat?.value === 144 ? undefined : `exit code ${r.code}, ${lines.length} lines, size of stat ${stat?.value}: ${r.err.slice(0, 200)}`;
});

for (const r of results) console.log(`${r.test}: ${r.passes} of ${r.runs}${r.note ? `   (${r.note.slice(0, 300)})` : ""}`);
console.log(JSON.stringify({ arch, results }));
process.exit(results.every(r => r.passes === r.runs) ? 0 : 1);
