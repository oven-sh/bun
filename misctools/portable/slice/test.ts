// Runs the file system slice on this Linux machine, each way it can run here, and checks what it prints.
//
//   bun test.ts [--runs 3]      after build.ts. WORK as in build.ts.
//
//   direct        the kernel runs the image
//   hosted        the Linux test host (../host/host_posix.c) maps the image and serves its requests
//   abi           hosted: the image calls functions of the host that have the calling convention of
//                 Windows x64, through its import table, and the host calls a function of the image,
//                 also on threads that the host made
//   abi, direct   there is no host to resolve anything: the first call has to stop the image
//   as win32      BUN_PORTABLE_HOST_OS=win32 makes bun decide as on Windows, on Linux: the image takes
//                 bun's code for Windows, and its first call of Windows has to stop it with a message
//   imports       the import table has the functions of kernel32, ntdll and libuv that bun's file
//                 system code for Windows calls, and none of them resolves on Linux
//   convention    the compiler refuses an import that gives the host OS a callback with the calling
//                 convention of the image, as an argument, in a structure, as a result
//                 (../test/convention), and takes the one that gives it callbacks of Windows
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n2");
const runs = Number(process.argv.includes("--runs") ? process.argv[process.argv.indexOf("--runs") + 1] : 3);
const image = join(work, "out/bun_fs_slice.img");
const host = join(work, "out/host-linux");
const directory = join(work, "run");
mkdirSync(directory, { recursive: true });

const compiled = Bun.spawnSync(["cc", "-O2", "-Wall", "-Wextra", "-Wno-unused-parameter", "-o", host, join(tree, "host/host_posix.c"), "-lpthread"], { stderr: "inherit" });
if (compiled.exitCode !== 0 || !existsSync(image)) throw new Error("the host does not compile, or build.ts has not made the image");

const expected = readFileSync(join(here, "expected/linux.jsonl"), "utf8");
function run(command: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync(command, { cwd: directory, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
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

check("direct", () => {
  const r = run([image, directory]);
  return r.code === 0 && r.out === expected ? undefined : `exit code ${r.code}, output ${r.out === expected ? "as expected" : "not as expected"}`;
});
check("hosted", () => {
  const r = run([host, image, directory]);
  return r.code === 0 && r.out === expected ? undefined : `exit code ${r.code}, output ${r.out === expected ? "as expected" : "not as expected"}`;
});
check("abi, hosted", () => {
  const r = run([host, image, "--abi"]);
  const lines = r.out.split("\n").filter(Boolean).map(line => JSON.parse(line));
  const checks = lines.filter(line => "as_expected" in line);
  return r.code === 0 && checks.length === 5 && checks.every(line => line.as_expected === true) ? undefined : `exit code ${r.code}: ${r.out}`;
});
check("abi, direct: stops", () => {
  const r = run([image, "--abi"]);
  return r.code !== 0 && r.out === "" && r.err.includes("bun_host_test!test_sum6 is a function of Windows, and this host is Linux") ? undefined : `exit code ${r.code}: ${r.err}`;
});
check("as win32: stops at the first call of Windows", () => {
  const r = run([image, directory], { BUN_PORTABLE_HOST_OS: "win32" });
  return r.code !== 0 && r.out === "" && / is a function of Windows, and this host is Linux/.test(r.err) ? undefined : `exit code ${r.code}: ${r.err}`;
});
check("imports", () => {
  const r = run([host, image, "--imports"]);
  const lines = r.out.split("\n").filter(Boolean).map(line => JSON.parse(line));
  const summary = lines.pop();
  const has = (library: string, symbol: string) => lines.some(line => line.library === library && line.symbol === symbol);
  const needed: [string, string][] = [
    ["ntdll", "NtCreateFile"], ["ntdll", "NtQueryDirectoryFile"], ["ntdll", "NtSetInformationFile"], ["ntdll", "NtClose"],
    ["kernel32", "ReadFile"], ["kernel32", "WriteFile"], ["kernel32", "GetCurrentDirectoryW"], ["kernel32", "GetFileAttributesW"],
    ["libuv", "uv_fs_open"], ["libuv", "uv_fs_mkdir"], ["libuv", "uv_fs_stat"], ["libuv", "uv_fs_rename"], ["libuv", "uv_fs_symlink"], ["libuv", "uv_fs_readlink"],
  ];
  const absent = needed.filter(([library, symbol]) => !has(library, symbol));
  return r.code === 1 && summary?.total === summary?.missing && summary.total > 100 && absent.length === 0 ? undefined : `exit code ${r.code}, ${JSON.stringify(summary)}, not in the table: ${JSON.stringify(absent)}`;
});

{
  // Compiled once: what the compiler says does not change from one run to the next.
  const cases: [string, boolean][] = [["good", true], ["argument", false], ["field", false], ["result", false]];
  const wrong: string[] = [];
  for (const [name, compiles] of cases) {
    const checked = Bun.spawnSync(["cargo", "check", "--target", "x86_64-unknown-linux-musl"], {
      cwd: join(tree, "test/convention"),
      env: { ...process.env, RUSTFLAGS: `--cfg=bun_portable --cfg=case="${name}"`, CARGO_TARGET_DIR: join(work, "target/convention"), CARGO_BUILD_JOBS: process.env.JOBS ?? "8" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const refused = /the trait `OfTheHost` is not implemented for `unsafe extern "C" fn\(u32\) -> i32`/.test(checked.stderr.toString());
    if (compiles ? checked.exitCode !== 0 : checked.exitCode === 0 || !refused) wrong.push(`${name}: exit code ${checked.exitCode}${compiles ? "" : refused ? "" : ", and not for the callback"}`);
  }
  results.push({ test: "convention: a callback of the image is not given to the host OS", passes: wrong.length ? 0 : 1, runs: 1, note: wrong.join("; ") || undefined });
}
for (const r of results) console.log(`${r.test}: ${r.passes} of ${r.runs}${r.note ? `   (${r.note.slice(0, 300)})` : ""}`);
console.log(JSON.stringify(results));
process.exit(results.every(r => r.passes === r.runs) ? 0 : 1);
