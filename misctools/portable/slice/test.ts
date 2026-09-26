// Runs the file system slice on this Linux machine, each way it can run here, and checks what it prints.
//
//   bun test.ts [--runs 3] [--out <dir>]     after build.ts, --out as there
//
//   direct        the kernel runs the image
//   hosted        the Linux test host (../host/host_posix.c) maps the image and serves its requests
//   abi           hosted: the image calls functions of the host that have the calling convention of
//                 Windows x64, through its import table, and the host calls a function of the image
//   abi, direct   there is no host to resolve anything: the first call has to stop the image
//   as win32      BUN_PORTABLE_HOST_INTERFACE=win32 makes bun call the functions of Windows, on Linux:
//                 the image takes bun's code for Windows, and its first call of Windows has to stop it
//                 with a message
//   imports       the import table has the functions of kernel32, ntdll and libuv that bun's file
//                 system code for Windows calls, and none of them resolves on Linux
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TREE } from "../flags.ts";
import { ARCH, places } from "./places.ts";

const here = dirname(import.meta.path);
const args = process.argv.slice(2);
const { out, slice, image, host } = places(args);
const runs = Number(args.includes("--runs") ? args[args.indexOf("--runs") + 1] : 3);
const directory = join(slice, "run");
mkdirSync(directory, { recursive: true });

const built = Bun.spawnSync([process.execPath, join(TREE, "build.ts"), "host", "--arch", ARCH, "--out", out], {
  stdout: "inherit",
  stderr: "inherit",
});
if (built.exitCode !== 0 || !existsSync(image))
  throw new Error("the host does not build, or build.ts of the slice has not made the image");

const expected = readFileSync(join(here, "expected/linux.jsonl"), "utf8");
function run(command: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync(command, {
    cwd: directory,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    signal: result.signalCode,
    out: result.stdout.toString(),
    err: result.stderr.toString(),
  };
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
  return r.code === 0 && r.out === expected
    ? undefined
    : `exit code ${r.code}, output ${r.out === expected ? "as expected" : "not as expected"}`;
});
check("hosted", () => {
  const r = run([host, image, directory]);
  return r.code === 0 && r.out === expected
    ? undefined
    : `exit code ${r.code}, output ${r.out === expected ? "as expected" : "not as expected"}`;
});
check("abi, hosted", () => {
  const r = run([host, image, "--abi"]);
  const lines = r.out
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const checks = lines.filter(line => "as_expected" in line);
  return r.code === 0 && checks.length === 4 && checks.every(line => line.as_expected === true)
    ? undefined
    : `exit code ${r.code}: ${r.out}`;
});
check("abi, direct: stops", () => {
  const r = run([image, "--abi"]);
  return r.code !== 0 &&
    r.out === "" &&
    r.err.includes("bun_host_test!test_sum6 is a function of Windows, and this host is Linux")
    ? undefined
    : `exit code ${r.code}: ${r.err}`;
});
check("as win32: stops at the first call of Windows", () => {
  const r = run([image, directory], { BUN_PORTABLE_HOST_INTERFACE: "win32" });
  return r.code !== 0 && r.out === "" && / is a function of Windows, and this host is Linux/.test(r.err)
    ? undefined
    : `exit code ${r.code}: ${r.err}`;
});
check("imports", () => {
  const r = run([host, image, "--imports"]);
  const lines = r.out
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const summary = lines.pop();
  const has = (library: string, symbol: string) =>
    lines.some(line => line.library === library && line.symbol === symbol);
  const needed: [string, string][] = [
    ["ntdll", "NtCreateFile"],
    ["ntdll", "NtQueryDirectoryFile"],
    ["ntdll", "NtSetInformationFile"],
    ["ntdll", "NtClose"],
    ["kernel32", "ReadFile"],
    ["kernel32", "WriteFile"],
    ["kernel32", "GetCurrentDirectoryW"],
    ["kernel32", "GetFileAttributesW"],
    ["libuv", "uv_fs_open"],
    ["libuv", "uv_fs_mkdir"],
    ["libuv", "uv_fs_stat"],
    ["libuv", "uv_fs_rename"],
    ["libuv", "uv_fs_symlink"],
    ["libuv", "uv_fs_readlink"],
  ];
  const absent = needed.filter(([library, symbol]) => !has(library, symbol));
  return r.code === 1 && summary?.total === summary?.missing && summary.total > 100 && absent.length === 0
    ? undefined
    : `exit code ${r.code}, ${JSON.stringify(summary)}, not in the table: ${JSON.stringify(absent)}`;
});

for (const r of results)
  console.log(`${r.test}: ${r.passes} of ${r.runs}${r.note ? `   (${r.note.slice(0, 300)})` : ""}`);
console.log(JSON.stringify(results));
process.exit(results.every(r => r.passes === r.runs) ? 0 : 1);
