// Puts together what a person needs on a Windows machine to run the loop slice there.
//
//   bun package-windows.ts [directory]      default: <WORK>/windows-package, WORK as in build.ts
//
// In the directory:
//   bun_loop_slice.img                      the image (x86-64), as build.ts made it
//   host/host_win.c, host/host_win_uv.c     the Windows host and its table of libuv functions
//   host_win.diff                           what this branch changed in the two files
//   patches/*.patch                         bun's patches of libuv
//   windows-c/                              what the C of the image for Windows was compiled against
//                                           (uv_header.ts, windows.ts), and check_on_windows.c
//   bindings/                               windows_layout.c, verify.ts, compare.ts and the layout
//                                           of the bindings in the image (layout.image.json)
//   expected/, compare-run.ts               the expected output of the slice and its comparison
//   imports-linux.jsonl                     the import table of the image, as the image prints it
//   commands.txt                            the PowerShell commands, with what each one is for
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const repo = resolve(tree, "../..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n2");
const out = resolve(process.argv[2] ?? join(work, "windows-package"));
const base = process.env.BASE_COMMIT ?? "5f92f9441a";

const libuvScript = readFileSync(join(repo, "scripts/build/deps/libuv.ts"), "utf8");
const libuvCommit = /const LIBUV_COMMIT = "([0-9a-f]+)"/.exec(libuvScript)![1];
const libuvSources = (name: string) => {
  const list = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(libuvScript)![1];
  return [...list.matchAll(/"([^"]+)"/g)].map(m => m[1]);
};

rmSync(out, { recursive: true, force: true });
for (const dir of ["host", "patches", "bindings", "expected", "windows-c"]) mkdirSync(join(out, dir), { recursive: true });
const image = join(work, "out/bun_loop_slice.img");
copyFileSync(image, join(out, "bun_loop_slice.img"));
for (const name of ["host_win.c", "host_win_uv.c"]) copyFileSync(join(tree, "host", name), join(out, "host", name));
cpSync(join(repo, "patches/libuv"), join(out, "patches"), { recursive: true });
const patches = readdirSync(join(out, "patches")).filter(name => name.endsWith(".patch")).sort();
for (const name of ["windows_layout.c", "verify.ts", "compare.ts"]) copyFileSync(join(tree, "bindings", name), join(out, "bindings", name));
cpSync(join(here, "expected"), join(out, "expected"), { recursive: true });
copyFileSync(join(here, "compare-run.ts"), join(out, "compare-run.ts"));
const include = join(work, "usockets/windows-include");
for (const name of ["bun_windows_c.h", "callbacks.h", "imports.s", "check_on_windows.c", "declared.json"]) copyFileSync(join(include, name), join(out, "windows-c", name));
copyFileSync(join(work, "out/layout.image.json"), join(out, "bindings/layout.image.json"));

const host = join(work, "out/host-linux");
if (!existsSync(host)) throw new Error(`${host} is not there: test.ts makes it`);
const imports = Bun.spawnSync([host, image, "--imports"], { stdout: "pipe" });
writeFileSync(join(out, "imports-linux.jsonl"), imports.stdout);
const total = JSON.parse(imports.stdout.toString().trim().split("\n").pop()!).total;

const diff = Bun.spawnSync(["git", "--no-pager", "diff", base, "--", "misctools/portable/host/host_win.c", "misctools/portable/host/host_win_uv.c"], { cwd: repo, stdout: "pipe" });
writeFileSync(join(out, "host_win.diff"), diff.stdout);

const sha256 = createHash("sha256").update(readFileSync(image)).digest("hex");
const quoted = (names: string[]) => names.map(n => `"${n}"`).join(",");
writeFileSync(
  join(out, "commands.txt"),
  `The loop slice of the portable image on Windows (x64)
=====================================================

bun_loop_slice.img   sha256 ${sha256}
It is ONE file for Linux, macOS and Windows. It holds bun's event loop twice: the code bun compiles for
Linux (uSockets on epoll, bun's POSIX pipes, posix_spawn) and the code bun compiles for Windows
(uSockets on libuv, bun's libuv pipes, uv_spawn). On Windows the host below maps it and runs it, and
it takes the code for Windows, which calls libuv, ws2_32, kernel32 and ntdll through addresses that the
host resolves (${total} imports).

NOTHING OF THE CODE FOR WINDOWS IN THIS IMAGE HAS RUN BEFORE. It was compiled and linked on Linux, and
on Linux the image was made to take it (BUN_PORTABLE_HOST_OS=win32), where it stops at its first call
of libuv. host_win.c was changed on this branch and has not been compiled since (host_win.diff).
Every result below is news, also a failure of the first step.

Needed on the machine: git, clang of LLVM with the Windows SDK and the MSVC libraries (a "Developer
PowerShell for VS" with LLVM on the PATH has all of it), and bun for the checks.
Every command is PowerShell, run in this directory. Output is redirected by cmd so that it stays
the bytes the program wrote (PowerShell's own ">" re-encodes them).

1. libuv: bun's fork at the commit bun pins, with bun's patches

    git clone https://github.com/oven-sh/libuv libuv
    git -C libuv checkout ${libuvCommit}
${patches.map(name => `    git -C libuv apply ..\\patches\\${name}`).join("\n")}

2. libuv, compiled natively with the definitions of bun's build (scripts/build/deps/libuv.ts)

    $shared = ${quoted(libuvSources("SHARED"))}
    $win = ${quoted(libuvSources("WIN"))}
    $sources = @($shared | % { "..\\libuv\\src\\$_.c" }) + @($win | % { "..\\libuv\\src\\win\\$_.c" })
    mkdir uv-objects; cd uv-objects
    clang -c -O2 -fms-runtime-lib=dll -fno-strict-aliasing -Wno-int-conversion -Wno-deprecated-declarations \`
      -DWIN32_LEAN_AND_MEAN -D_CRT_DECLARE_NONSTDC_NAMES=0 -DWIN32 -D_WINDOWS -D_WIN32_WINNT=0x0A00 \`
      -I..\\libuv\\include -I..\\libuv\\src $sources
    cd ..

3. the host, with libuv inside. -fms-runtime-lib=dll: the host, libuv and the image then use one C
   runtime (ucrtbase.dll), the one that the image's import "ucrtbase" names.

    clang -O2 -fms-runtime-lib=dll -DBUN_HOST_LIBUV -o host.exe host\\host_win.c host\\host_win_uv.c \`
      (Get-ChildItem uv-objects\\*.o | % FullName) \`
      -lsynchronization -ladvapi32 -lpsapi -luser32 -liphlpapi -luserenv -lws2_32 -ldbghelp -lole32 -lshell32

   host_win_uv.c names every libuv function that the image can call: "undefined symbol uv_.." here
   means that this libuv does not have a function that bun's bindings declare. Please send the message.

4. what the C of the image was compiled against, checked against the headers of this machine. The
   image was compiled on a machine without the headers of Windows: the constants, sizes and offsets
   of Winsock are written in misctools/portable/loop/uv_header.ts, the ones of libuv are the ones of
   bun's bindings. Every line that fails to compile names one that is wrong.

    cmd /c "clang -fsyntax-only -D_WIN32_WINNT=0x0A00 -Ilibuv\\include windows-c\\check_on_windows.c > check-windows-c.txt 2>&1"
    echo "exit code $LASTEXITCODE"                   # 0, and check-windows-c.txt has no "error"

5. every import of the image against this Windows (it binds each one and prints the ones that fail)

    cmd /c ".\\host.exe bun_loop_slice.img --imports > imports-windows.jsonl"
    Get-Content imports-windows.jsonl -Tail 1        # {"step":"imports","total":${total},"missing":0,"ok":true}

6. the slice. It starts itself twice as a child process (host.exe with the image).

    cmd /c ".\\host.exe bun_loop_slice.img > run-windows.jsonl 2> run-windows.stderr.txt"
    echo "exit code $LASTEXITCODE"                   # 0
    bun compare-run.ts run-windows.jsonl             # against expected\\linux.jsonl and expected\\differences.json

   Expected: the seven lines of expected\\linux.jsonl, the first one with "os":"win32","code":"windows".
   The child alone, the way the slice starts it:
    cmd /c "echo hello| .\\host.exe bun_loop_slice.img child answer"      # HELLO and a line on stderr, exit code 7

   With more detail from the host (every lookup, every request it refuses):
    $env:BUN_HOST_TRACE = "2"; cmd /c ".\\host.exe bun_loop_slice.img > run-trace.jsonl 2> run-trace.stderr.txt"; $env:BUN_HOST_TRACE = $null
   If the run ends with an out of memory message: the allocator reserves 1 GiB at its start and this
   host commits what is reserved. A smaller reservation (64 MiB):
    $env:MIMALLOC_ARENA_RESERVE = "65536"

7. the layout of the bindings against the headers of this machine

    bun bindings\\verify.ts --libuv libuv --out layout.headers.json
    bun bindings\\compare.ts bindings\\layout.image.json layout.headers.json > layout-compare.txt
    Get-Content layout-compare.txt -Tail 1

Please send back: check-windows-c.txt, imports-windows.jsonl, run-windows.jsonl, run-windows.stderr.txt,
the output of compare-run.ts, layout.headers.json, layout-compare.txt, and the output of
"clang --version". If the host does not compile: the messages of the compiler.

What is known to differ from bun for Windows
--------------------------------------------
- The C library. uSockets and bun's Rust call malloc, memcpy, snprintf and the like of the C library of
  the image (musl and mimalloc in the image), not of ucrtbase.dll. errno of uSockets is the one of
  ucrtbase.dll, as in bun for Windows, because bun's Rust for Windows reads that one.
- _MSC_VER is not defined for the C of the image (clang in its GNU mode compiled it). uSockets has one
  place that asks for it (internal/internal.h: alignas and ssize_t), and takes the other branch.
- The functions of bun that the image is built without (JavaScriptCore, BoringSSL, the resolver of
  names, the owners of sockets in bun's runtime) stop the program with their name if they are called.
  The slice does not call them: its sockets have no TLS and its addresses are numbers.
- A thread that libuv or Windows makes and that calls into the image is adopted by bun's Rust callbacks
  (bun_windows_sys::host_thread). The callbacks of uSockets' C have no such check: libuv calls them on
  the thread of the loop.
`,
);
console.log(`${out}: image sha256 ${sha256}, ${total} imports`);
