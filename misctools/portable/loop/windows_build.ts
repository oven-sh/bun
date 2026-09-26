// How the Windows host of the portable image is built, with libuv inside: the sources and the flags.
// package-windows.ts writes them into the commands for a Windows machine, and check-windows.ts runs
// the same commands here, with the compiler for Windows and the SDK of ../tools/windows-sdk.ts.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
export const repo = resolve(here, "../../..");

const script = readFileSync(join(repo, "scripts/build/deps/libuv.ts"), "utf8");
const listOf = (name: string) => {
  const list = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(script);
  if (!list) throw new Error(`scripts/build/deps/libuv.ts has no list ${name}`);
  return [...list[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
};

/** libuv as bun builds it for Windows (scripts/build/deps/libuv.ts): bun's fork, the commit it pins, its patches. */
export const libuv = {
  repository: "https://github.com/oven-sh/libuv",
  commit: /const LIBUV_COMMIT = "([0-9a-f]+)"/.exec(script)![1],
  /** Relative to the checkout. */
  sources: [...listOf("SHARED").map(name => `src/${name}.c`), ...listOf("WIN").map(name => `src/win/${name}.c`)],
  shared: listOf("SHARED"),
  win: listOf("WIN"),
  patches: readdirSync(join(repo, "patches/libuv"))
    .filter(name => name.endsWith(".patch"))
    .sort(),
  patchDirectory: join(repo, "patches/libuv"),
  /** The definitions and flags of bun's build, as the driver `clang` takes them. */
  flags: [
    "-O2", "-fms-runtime-lib=dll", "-fno-strict-aliasing", "-Wno-int-conversion", "-Wno-deprecated-declarations",
    "-DWIN32_LEAN_AND_MEAN", "-D_CRT_DECLARE_NONSTDC_NAMES=0", "-DWIN32", "-D_WINDOWS", "-D_WIN32_WINNT=0x0A00",
  ],
};

/** The host: host_win.c with the table of libuv (host_win_uv.c) and libuv's objects. */
export const host = {
  sources: ["host_win.c", "host_win_uv.c"],
  // One C runtime for the host, libuv and the image: the DLL that the import "ucrtbase" of the image names.
  flags: ["-O2", "-fms-runtime-lib=dll", "-DBUN_HOST_LIBUV"],
  libraries: ["synchronization", "advapi32", "psapi", "user32", "iphlpapi", "userenv", "ws2_32", "dbghelp", "ole32", "shell32"],
};

/** What check_on_windows.c is compiled with, and check_on_windows.cpp by clang++. */
export const headerCheckFlags = ["-fsyntax-only", "-D_WIN32_WINNT=0x0A00"];
export const signatureCheckFlags = ["-fsyntax-only", "-std=c++17", "-D_WIN32_WINNT=0x0A00"];
