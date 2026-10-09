// What `bun-lint` and the fuzzers link of Bun's C++ side: JavaScriptCore's regular expression engine, which `bun_lint::regex`
// runs on, and WTF's `toFixed`, `toPrecision` and `toExponential`. There is no stand-in for them in
// `src/sema/standalone/native.rs`: a test binary runs the engine that ships.
//
//   bun scripts/build/lint-standalone-native.ts <directory> [--asan | --lto] [--fetch] [--force] [--dry-run]
//
// Prints the arguments for the linker, one a line, which has to be lld (`-fuse-ld=lld` is the first of them): the order of
// archives does not matter to it, and it does not ask for symbols that only sections without a use want. With
// `--gc-sections`, which rustc passes, what Yarr does not reach is dropped: all of JavaScriptCore is read, 1.6 MB of it stay.
//
// In <directory>/<WebKit's version>, made on first use and kept:
// - the archives of the prebuilt WebKit of `scripts/build/deps/webkit.ts`, without debug information (which a linker copies
//   for every member that it loads, dropped sections or not: 480 MB). The variant without a suffix: machine code, no LTO, no
//   sanitizer. It is what `bun run build:release --lto=off` links, and is in the same cache. `--fetch` fetches it (450 MB),
//   and says so where the arguments are printed: it is for a person, once for each version of WebKit.
// - `SOURCES`, compiled with the flags that `build/debug/compile_commands.json` has for them (`bun bd --configure-only`
//   writes it), as a release build: optimized, no assertions, no sanitizer, position independent.
//
// `--asan`: the `-asan` variant, which has assertions, and `SOURCES` with AddressSanitizer: the layout of `WTF::Vector`
// depends on it, so the two cannot be mixed. For programs built with `-Zsanitizer=address`.
// `--lto`: the `-lto` variant, which a release build has fetched: LLVM bitcode, used where it is. lld compiles what is reached
// and keeps the result in <directory>/<version>-lto/cache.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { sharedCacheDir } from "./config.ts";
import { WEBKIT_VERSION } from "./deps/webkit.ts";
import { fetchPrebuilt } from "./download.ts";

/** Each is compiled by itself. What a function of theirs wants of the rest of Bun's C++ does not matter if nothing calls it. */
const SOURCES = [
  "src/jsc/bindings/RegularExpression.cpp",
  "src/jsc/bindings/NumberConversions.cpp",
  "src/lint/standalone/native.cpp",
];
const ARCHIVES = ["JavaScriptCore", "WTF", "bmalloc", "icui18n", "icuuc", "icudata"];

const root = resolve(import.meta.dirname, "../..");
const flags = new Set(process.argv.slice(2).filter(it => it.startsWith("--")));
const [directory] = process.argv.slice(2).filter(it => !it.startsWith("--"));
const isDryRun = flags.has("--dry-run");
const suffix = flags.has("--asan") ? "-asan" : flags.has("--lto") ? "-lto" : "";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function run(command: string[]): void {
  if (isDryRun) return console.error(command.join(" "));
  const { status, stdout, stderr } = spawnSync(command[0]!, command.slice(1), { encoding: "utf8" });
  // With paths from the root of the repository, as cargo prints them.
  process.stderr.write(`${stdout ?? ""}${stderr ?? ""}`.replaceAll(`${root}/`, ""));
  if (status !== 0) fail(`${basename(command[0]!)} failed`);
}

if (directory === undefined)
  fail("usage: bun lint-standalone-native.ts <directory> [--asan | --lto] [--fetch] [--force] [--dry-run]");
if (process.platform !== "linux" || process.arch !== "x64")
  fail("lint-standalone-native.ts knows the prebuilt WebKit of linux-x64 only");

// The names of scripts/build/deps/webkit.ts.
const isTag = WEBKIT_VERSION.startsWith("autobuild-");
const key = (isTag ? WEBKIT_VERSION.slice("autobuild-".length) : WEBKIT_VERSION.slice(0, 16)) + suffix;
const webkit = join(sharedCacheDir(root), `webkit-${key}`);
const identity = WEBKIT_VERSION + suffix;
const url = `https://github.com/oven-sh/WebKit/releases/download/${isTag ? "" : "autobuild-"}${WEBKIT_VERSION}/bun-webkit-linux-amd64${suffix}.tar.gz`;
const stamp = join(webkit, ".identity");
if (!existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== identity) {
  if (!flags.has("--fetch")) fail(`${webkit} is not there: run this once more with --fetch (${url})`);
  if (isDryRun) console.error(`fetch ${url} -> ${webkit}`);
  else await fetchPrebuilt("WebKit", url, webkit, identity);
}

const commands: { file: string; arguments: string[] }[] = JSON.parse(
  readFileSync(join(root, "build/debug/compile_commands.json"), "utf8"),
);
const out = join(resolve(directory), key);
if (!isDryRun) mkdirSync(out, { recursive: true });
const link = ["-fuse-ld=lld"];
let compiler = "clang++";

for (const source of SOURCES) {
  // All of Bun's C++ has the same flags: a source that the last configuration has not seen takes those of a neighbour, one
  // that is not part of Bun those of the first.
  const entry =
    commands.find(it => it.file.endsWith(`/${source}`)) ??
    commands.find(it => it.file.endsWith(".cpp") && dirname(it.file).endsWith(`/${dirname(source)}`)) ??
    commands.find(it => it.file.endsWith(`/${SOURCES[0]}`));
  if (entry === undefined) fail(`build/debug/compile_commands.json does not know ${source}: bun bd --configure-only`);
  // The build directory can be that of another checkout, linked here.
  const theirRoot = entry.file.slice(0, entry.file.lastIndexOf("/src/"));
  // The arguments are written as a shell wants them.
  const [first, ...rest] = entry.arguments.map(it => it.replaceAll('\\"', '"'));
  compiler = first!;
  const kept = rest
    .filter((it, i) => it !== "-c" && rest[i - 1] !== "-c" && it !== "-o" && rest[i - 1] !== "-o")
    .filter(
      it => !/^(-O\d|-g|-f(no-)?sanitize|-fno-standalone-debug|-Werror|-fno-pi[ce]$|-fdiagnostics-color)/.test(it),
    )
    .filter(it => !/^-D(ASSERT_ENABLED|BUN_DEBUG|BUN_DYNAMIC_JS_LOAD_PATH|LIBUS_SOCKET_FAULT_INJECTION)=/.test(it))
    .map(it => it.replace(/^-I.*\/webkit-[^/]*\/include/, `-I${webkit}/include`))
    // Generated headers are the build directory's. The rest is this checkout's.
    .map(it =>
      it.startsWith(`-I${theirRoot}/`) && !it.startsWith(`-I${theirRoot}/build/`)
        ? `-I${root}${it.slice(2 + theirRoot.length)}`
        : it,
    );
  const mode = flags.has("--asan")
    ? ["-fsanitize=address", "-fsanitize-address-use-after-return=never", "-DASSERT_ENABLED=1"]
    : ["-DASSERT_ENABLED=0"];
  const command = [compiler, "-O3", "-fPIC", "-DNDEBUG", ...mode, ...kept, "-c", join(root, source)];
  // A header of Bun's that the source includes is not looked at: --force.
  const hash = createHash("sha256")
    .update(readFileSync(join(root, source)))
    .update(command.join("\0"))
    .digest("hex");
  const object = join(out, `${basename(source, ".cpp")}-${hash.slice(0, 16)}.o`);
  if (flags.has("--force") || !existsSync(object)) {
    run([...command, "-o", `${object}.${process.pid}`]);
    if (!isDryRun) renameSync(`${object}.${process.pid}`, object);
  }
  link.push(object);
}

const tools = dirname(realpathSync(Bun.which(compiler) ?? compiler));
for (const name of ARCHIVES) {
  const from = join(webkit, "lib", `lib${name}.a`);
  const to = suffix === "-lto" ? from : join(out, `lib${name}.a`);
  if (to !== from && !existsSync(to)) {
    run([join(tools, "llvm-objcopy"), "--strip-debug", from, `${to}.${process.pid}`]);
    if (!isDryRun) renameSync(`${to}.${process.pid}`, to);
  }
  link.push(to);
}
if (suffix === "-lto") link.push(`-Wl,--thinlto-cache-dir=${join(out, "cache")}`);

// WebKit is compiled with the assertions of a libstdc++ of GCC 12 or later. The one that Bun's compiler has chosen, by its
// path: the driver that links can be an older GCC. It has to come before any `-lstdc++`: lld takes the first of a name.
const found = isDryRun ? "" : spawnSync(compiler, ["-print-file-name=libstdc++.so"]).stdout.toString().trim();
link.push(found.startsWith("/") ? realpathSync(found) : "-lstdc++");

console.log(link.join("\n"));
