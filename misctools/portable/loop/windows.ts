// uSockets of bun on libuv, its code for Windows, compiled for the portable image.
//
//   bun windows.ts compile [work]    writes <work>/usockets/windows-include (uv_header.ts) and compiles
//                                    the sources to <work>/usockets/windows-plain/*.o
//   bun windows.ts rename [work]     after flavor.ts: <work>/usockets/windows/*.o, the same objects
//                                    with the names of the flavour
//
// The sources are the files that bun compiles for Windows, unchanged. What makes them the code for
// Windows is what the preprocessor sees: _WIN32 and not __linux__, and the headers of
// windows-include where the headers of Windows and of libuv are included.
//
// A function that libuv calls has the calling convention of Windows x64, like the type of the callback
// it is passed as. The sources do not say so (a compiler for Windows has one convention), so a
// declaration that does stands before each of them: windows-include/callbacks.h, written here from the
// definitions in eventing/libuv.c whose first parameter is a handle of libuv.
//
// The names: the image holds uSockets twice. What this flavour defines, and what it calls that the
// image has once for each flavour, gets the suffix that flavor.ts gives the Rust of the flavour
// (us_socket_write__windows). What the image has once keeps its name (the C library, mimalloc,
// bun_core): flavors/windows/flavor.json lists it.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const repo = resolve(here, "../../..");
const [command, workArgument] = process.argv.slice(2);
const work = resolve(workArgument ?? process.env.WORK ?? "/tmp/portable/n2");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const vendor = process.env.VENDOR ?? "/workspace/bun/vendor";
const sysroot = join(work, "sysroot");
const include = join(work, "usockets/windows-include");
const plain = join(work, "usockets/windows-plain");
const renamed = join(work, "usockets/windows");
const suffix = "__windows";
const sources = ["bsd", "context", "loop", "socket", "udp", "fault_inject", "crypto/openssl", "eventing/libuv"];

function run(cmd: string[], log?: string) {
  console.log(`+ ${cmd.join(" ").slice(0, 300)}`);
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", maxBuffer: 1 << 28 });
  const text = result.stdout.toString() + result.stderr.toString();
  if (log) writeFileSync(log, text);
  if (result.exitCode !== 0) {
    console.error(text.split("\n").slice(0, 80).join("\n"));
    throw new Error(`exit code ${result.exitCode}: ${cmd[0]}`);
  }
  return result.stdout.toString();
}

function compile() {
  const facts = join(work, "out/layout.image.json");
  if (!existsSync(facts)) throw new Error(`${facts} is not there: it is what bun_fs_slice.img --layout prints (build.ts, step base)`);
  rmSync(include, { recursive: true, force: true });
  run(["bun", join(here, "uv_header.ts"), "--facts", facts, "--out", include]);

  // The callbacks of libuv in eventing/libuv.c.
  const libuv = readFileSync(join(repo, "packages/bun-usockets/src/eventing/libuv.c"), "utf8");
  const callbacks = [...libuv.matchAll(/^(static )?void ([a-z_0-9]+)\((uv_[a-z]+_t \*[a-z_]+(?:, int [a-z_]+)*)\) \{/gm)];
  if (callbacks.length === 0) throw new Error("eventing/libuv.c has no callback of libuv that windows.ts finds");
  writeFileSync(
    join(include, "callbacks.h"),
    [
      "// Written by misctools/portable/loop/windows.ts. Do not edit.",
      "//",
      "// The functions of eventing/libuv.c that libuv calls: they have its calling convention.",
      '#include "bun_windows_c.h"',
      ...callbacks.map(found => `${found[1] ?? ""}void BUN_WINDOWS_ABI ${found[2]}(${found[3]});`),
      "",
    ].join("\n"),
  );

  rmSync(plain, { recursive: true, force: true });
  mkdirSync(plain, { recursive: true });
  mkdirSync(join(work, "logs"), { recursive: true });
  const flags = [
    `--config=${join(sysroot, "portable.cfg")}`,
    "-march=nehalem", "-DNDEBUG", "-O2", "-fno-exceptions", "-fno-omit-frame-pointer", "-fno-stack-protector", "-fvisibility=hidden",
    "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-ffunction-sections", "-fdata-sections", "-std=gnu17",
    "-Wno-c23-extensions", "-Wno-nullability-completeness", "-Wno-pointer-sign", "-Wno-unknown-pragmas", "-Wno-incompatible-pointer-types",
    "-Werror=implicit-function-declaration",
    "-Werror=incompatible-function-pointer-types", "-Werror=int-conversion",
    // The compiler's target is Linux. The code is bun's for Windows.
    "-U__linux__", "-U__linux", "-Ulinux", "-U__gnu_linux__", "-U__unix__", "-U__unix", "-Uunix",
    "-D_WIN32=1", "-D_WIN64=1", "-DWIN32=1",
    "-isystem", include,
    `-I${join(repo, "packages")}`, `-I${join(repo, "packages/bun-usockets")}`, `-I${join(repo, "packages/bun-usockets/src")}`,
    `-I${join(repo, "src/jsc/bindings")}`, `-I${join(repo, "src/uws_sys")}`,
    `-I${join(vendor, "boringssl/include")}`, `-I${join(vendor, "mimalloc/include")}`,
    "-DLIBUS_USE_OPENSSL=1", "-DLIBUS_USE_LIBUV=1", "-DUSE_BUN_MIMALLOC=1", "-DBUN_PORTABLE=1",
  ];
  for (const name of sources) {
    const base = name.split("/").pop()!;
    run(
      [`${llvm}/clang`, ...flags, ...(base === "libuv" ? ["-include", join(include, "callbacks.h")] : []), "-c", join(repo, "packages/bun-usockets/src", `${name}.c`), "-o", join(plain, `${base}.o`)],
      join(work, "logs", `usockets-windows-${base}.log`),
    );
  }
  run([`${llvm}/clang`, `--config=${join(sysroot, "portable.cfg")}`, "-c", join(include, "imports.s"), "-o", join(plain, "imports.o")]);
  console.log(`${plain}: ${sources.length} sources of uSockets for Windows, ${callbacks.length} callbacks of libuv (${callbacks.map(found => found[2]).join(" ")})`);
}

function rename() {
  const flavor = JSON.parse(readFileSync(join(work, "flavors/windows/flavor.json"), "utf8"));
  const ofImage = new Set<string>(flavor.symbols_of_the_image);
  const objects = readdirSync(plain).filter(name => name.endsWith(".o"));
  const symbols = (object: string, which: string) =>
    run([`${llvm}/llvm-nm`, which, "--extern-only", "--format=just-symbols", join(plain, object)]).split("\n").filter(Boolean);
  const defined = new Set(objects.flatMap(object => symbols(object, "--defined-only")));
  const wanted = new Set(objects.flatMap(object => symbols(object, "--undefined-only")));
  // The entries of the import table are the table's: it is one for the image.
  const names = [...new Set([...defined, ...[...wanted].filter(name => !ofImage.has(name))])].filter(name => !name.startsWith("bun_import__")).sort();
  const map = join(work, "usockets/windows-names.txt");
  writeFileSync(map, names.map(name => `${name} ${name}${suffix}`).join("\n") + "\n");
  rmSync(renamed, { recursive: true, force: true });
  mkdirSync(renamed, { recursive: true });
  // .deplibs is where `#pragma comment(lib, "ws2_32.lib")` of the sources went: a request to the linker
  // of Windows. The image reaches ws2_32 through its import table.
  for (const object of objects)
    run([`${llvm}/llvm-objcopy`, `--redefine-syms=${map}`, "--remove-section=.deplibs", join(plain, object), join(renamed, object)]);
  const kept = [...wanted].filter(name => ofImage.has(name) && !defined.has(name)).sort();
  writeFileSync(join(work, "usockets/windows-names.json"), JSON.stringify({ renamed: names, of_the_image: kept }, null, 1) + "\n");
  console.log(`${renamed}: ${names.length} names with ${suffix}, ${kept.length} names of the image kept`);
}

if (command === "compile") compile();
else if (command === "rename") rename();
else throw new Error("usage: bun windows.ts compile|rename [work]");
