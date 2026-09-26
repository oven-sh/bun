// Puts together what a person needs on a Windows machine to run the loop slice there.
//
//   bun package-windows.ts [directory]      default: <WORK>/windows-package, WORK as in build.ts.
//                                           After build.ts, test.ts and check-windows.ts.
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
//   checked-on-linux/                       what check-windows.ts found on the machine that built the
//                                           image, with the host that was linked there (host.exe)
//   commands.txt                            the PowerShell commands, with what each one is for
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { headerCheckFlags, host as hostBuild, libuv } from "./windows_build.ts";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const repo = resolve(tree, "../..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n2");
const out = resolve(process.argv[2] ?? join(work, "windows-package"));
const base = process.env.BASE_COMMIT ?? "5f92f9441a";
const checked = join(work, "wincheck");

const summaryPath = join(checked, "summary.json");
if (!existsSync(summaryPath)) throw new Error(`${summaryPath} is not there: check-windows.ts makes it`);
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));

rmSync(out, { recursive: true, force: true });
for (const dir of ["host", "patches", "bindings", "expected", "windows-c", "checked-on-linux"]) mkdirSync(join(out, dir), { recursive: true });
const image = join(work, "out/bun_loop_slice.img");
copyFileSync(image, join(out, "bun_loop_slice.img"));
for (const name of hostBuild.sources) copyFileSync(join(tree, "host", name), join(out, "host", name));
for (const name of libuv.patches) copyFileSync(join(libuv.patchDirectory, name), join(out, "patches", name));
for (const name of ["windows_layout.c", "verify.ts", "compare.ts"]) copyFileSync(join(tree, "bindings", name), join(out, "bindings", name));
cpSync(join(here, "expected"), join(out, "expected"), { recursive: true });
copyFileSync(join(here, "compare-run.ts"), join(out, "compare-run.ts"));
const include = join(work, "usockets/windows-include");
for (const name of ["bun_windows_c.h", "callbacks.h", "callbacks.list", "imports.s", "check_on_windows.c", "declared.json"]) copyFileSync(join(include, name), join(out, "windows-c", name));
copyFileSync(join(checked, "layout.image.json"), join(out, "bindings/layout.image.json"));
for (const name of [
  "summary.json", "host.exe", "host-compile.log", "uv-compile.log", "check-windows-c.txt", "layout.headers.json", "layout-compare.txt",
  "bun_loop_slice.img.imports-libraries.json",
])
  copyFileSync(join(checked, name), join(out, "checked-on-linux", name));

const hostLinux = join(work, "out/host-linux");
if (!existsSync(hostLinux)) throw new Error(`${hostLinux} is not there: test.ts makes it`);
const imports = Bun.spawnSync([hostLinux, image, "--imports"], { stdout: "pipe" });
writeFileSync(join(out, "imports-linux.jsonl"), imports.stdout);
const total = JSON.parse(imports.stdout.toString().trim().split("\n").pop()!).total;

const diff = Bun.spawnSync(["git", "--no-pager", "diff", base, "--", ...hostBuild.sources.map(name => `misctools/portable/host/${name}`)], { cwd: repo, stdout: "pipe" });
writeFileSync(join(out, "host_win.diff"), diff.stdout);

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const quoted = (names: string[]) => names.map(n => `"${n}"`).join(",");
const continued = (flags: string[], perLine: number) => {
  const lines: string[] = [];
  for (let i = 0; i < flags.length; i += perLine) lines.push(flags.slice(i, i + perLine).join(" "));
  return lines.join(" `\n      ");
};
const layout = summary["layout of the bindings"];
const headers = summary["headers of the C of the image"];
writeFileSync(
  join(out, "commands.txt"),
  `The loop slice of the portable image on Windows (x64)
=====================================================

bun_loop_slice.img   sha256 ${sha256(image)}
It is ONE file for Linux, macOS and Windows. It holds bun's event loop twice: the code bun compiles for
Linux (uSockets on epoll, bun's POSIX pipes, posix_spawn) and the code bun compiles for Windows
(uSockets on libuv, bun's libuv pipes, uv_spawn). On Windows the host below maps it and runs it, and
it takes the code for Windows, which calls libuv, ws2_32, kernel32 and ntdll through addresses that the
host resolves (${total} imports).

NOTHING OF THE CODE FOR WINDOWS IN THIS IMAGE HAS RUN BEFORE, AND NEITHER HAS THIS HOST. On Linux the
image was made to take the code for Windows (BUN_PORTABLE_HOST_OS=win32), where it stops at its first
call of libuv. Every result below is news, also a failure of the first step.

What was done on the machine that built the image, without running anything (checked-on-linux\\):
  ${summary.compiler}, target ${summary.target},
  Windows SDK ${summary.windows_sdk} and Visual C++ tools ${summary.visual_cpp_tools} (Microsoft's packages of nuget.org)
  - steps 1 to 3 below: libuv compiled (0 errors), the host compiled and linked. checked-on-linux\\host.exe
    is that host, sha256 ${sha256(join(checked, "host.exe"))}. It has never run. If step 3 fails
    on your machine, the steps after it can be tried with it (copy it to host.exe), and please say so.
  - step 4: ${headers.constants} constants, ${headers.sizes_and_offsets} sizes and offsets, ${headers.functions_declared} functions: no error.
  - step 7, with the facts read from the object file instead of printed by the program:
    ${layout.the_same} facts the same, ${layout.differ} differ, ${layout.not_compared} not compared (names these headers do not have).
  - the ${total} imports: every one is in the import library of the SDK that the image names, or in the
    host's table of libuv.
  The same steps on your machine check your headers and your libuv, and steps 5 and 6 are the ones
  that only Windows can do.

Needed on the machine: git, clang of LLVM with the Windows SDK and the MSVC libraries (a "Developer
PowerShell for VS" with LLVM on the PATH has all of it), and bun for the checks.
Every command is PowerShell, run in this directory. Output is redirected by cmd so that it stays
the bytes the program wrote (PowerShell's own ">" re-encodes them).

1. libuv: bun's fork at the commit bun pins, with bun's patches

    git clone ${libuv.repository} libuv
    git -C libuv checkout ${libuv.commit}
${libuv.patches.map(name => `    git -C libuv apply ..\\patches\\${name}`).join("\n")}

2. libuv, compiled natively with the definitions of bun's build (scripts/build/deps/libuv.ts)

    $shared = ${quoted(libuv.shared)}
    $win = ${quoted(libuv.win)}
    $sources = @($shared | % { "..\\libuv\\src\\$_.c" }) + @($win | % { "..\\libuv\\src\\win\\$_.c" })
    mkdir uv-objects; cd uv-objects
    clang -c ${continued(libuv.flags, 5)} \`
      -I..\\libuv\\include -I..\\libuv\\src $sources
    cd ..

3. the host, with libuv inside. -fms-runtime-lib=dll: the host, libuv and the image then use one C
   runtime (ucrtbase.dll), the one that the image's import "ucrtbase" names.

    clang ${hostBuild.flags.join(" ")} -o host.exe ${hostBuild.sources.map(name => `host\\${name}`).join(" ")} \`
      (Get-ChildItem uv-objects\\*.o | % FullName) \`
      ${hostBuild.libraries.map(name => `-l${name}`).join(" ")}

   host_win_uv.c names every libuv function that the image can call: "undefined symbol uv_.." here
   means that this libuv does not have a function that bun's bindings declare. Please send the message.

4. what the C of the image was compiled against, checked against the headers of this machine: the
   constants, sizes and offsets of Winsock are written in misctools/portable/loop/uv_header.ts, the
   ones of libuv are the ones of bun's bindings. Every line that fails to compile names one that is
   wrong.

    cmd /c "clang ${headerCheckFlags.join(" ")} -Ilibuv\\include windows-c\\check_on_windows.c > check-windows-c.txt 2>&1"
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
- libuv allocates with the C runtime of the host. bun for Windows gives libuv its own allocator
  (uv_replace_allocator, in bun's runtime, which this program is built without).
- _MSC_VER is not defined for the C of the image (clang in its GNU mode compiled it). uSockets has one
  place that asks for it (internal/internal.h: alignas and ssize_t), and takes the other branch.
- long has 64 bits in the C of the image. What the C passes to Windows and to libuv has fixed widths
  (windows-c\\bun_windows_c.h); its own functions keep their long, in C and in the Rust that calls them.
- The functions of bun that the image is built without (JavaScriptCore, BoringSSL, the resolver of
  names, the owners of sockets in bun's runtime) stop the program with their name if they are called.
  The slice does not call them: its sockets have no TLS and its addresses are numbers.
- A function of the image that Windows or libuv calls checks first whether its thread has a thread
  pointer of the image, and a thread that has none (a thread that libuv or Windows made) is adopted:
  bun's Rust callbacks through bun_windows_sys::host_thread, the callbacks of uSockets' C through a
  call that the compiler wrote at their entry (windows-c\\callbacks.list). In this program all of them
  run on threads of the image: no thread is adopted, and the host says so if one is (BUN_HOST_TRACE).
`,
);
console.log(`${out}: image sha256 ${sha256(image)}, ${total} imports`);
