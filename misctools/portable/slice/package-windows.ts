// Puts together what a person needs on a Windows machine to run the file system slice there.
//
//   bun package-windows.ts [--out <dir>] [directory]
//                                           --out as for build.ts; the default of the directory
//                                           is <out>/slice/windows-package
//
// In the directory:
//   bun_fs_slice.img                        the image (x86-64), as build.ts made it
//   host/host_win.c, host/host_win_uv.c     the Windows host and its table of libuv functions
//   host/linux_abi.h, host/memory.h         what host_win.c includes
//   patches/*.patch                         bun's patches of libuv
//   bindings/                               windows_layout.c, verify.ts, compare.ts and the layout
//                                           of the bindings in the image (layout.image.json)
//   expected/, compare-run.ts               the expected output of the slice and its comparison
//   commands.txt                            the PowerShell commands, with what each one is for
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { REPOSITORY as repo, TREE as tree } from "../flags.ts";
import { places } from "./places.ts";

const here = dirname(import.meta.path);
const args = process.argv.slice(2);
const { slice, image } = places(args);
const out = resolve(args[0] ?? join(slice, "windows-package"));

const libuvCommit = /const LIBUV_COMMIT = "([0-9a-f]+)"/.exec(readFileSync(join(repo, "scripts/build/deps/libuv.ts"), "utf8"))![1];
const libuvSources = (name: string) => {
  const text = readFileSync(join(repo, "scripts/build/deps/libuv.ts"), "utf8");
  const list = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(text)![1];
  return [...list.matchAll(/"([^"]+)"/g)].map(m => m[1]);
};

rmSync(out, { recursive: true, force: true });
for (const dir of ["host", "patches", "bindings", "expected"]) mkdirSync(join(out, dir), { recursive: true });
copyFileSync(image, join(out, "bun_fs_slice.img"));
for (const name of ["host_win.c", "host_win_uv.c", "linux_abi.h", "memory.h"]) copyFileSync(join(tree, "host", name), join(out, "host", name));
cpSync(join(repo, "patches/libuv"), join(out, "patches"), { recursive: true });
for (const name of ["windows_layout.c", "verify.ts", "compare.ts"]) copyFileSync(join(tree, "bindings", name), join(out, "bindings", name));
cpSync(join(here, "expected"), join(out, "expected"), { recursive: true });
copyFileSync(join(here, "compare-run.ts"), join(out, "compare-run.ts"));

const layout = Bun.spawnSync([image, "--layout"], { stdout: "pipe" });
if (layout.exitCode !== 0) throw new Error(`${image} --layout: exit code ${layout.exitCode}`);
writeFileSync(join(out, "bindings/layout.image.json"), layout.stdout);

const sha256 = createHash("sha256").update(readFileSync(image)).digest("hex");
const quoted = (names: string[]) => names.map(n => `"${n}"`).join(",");
writeFileSync(
  join(out, "commands.txt"),
  `The file system slice of the portable image on Windows (x64; for arm64 see the end)
====================================================================================

bun_fs_slice.img   sha256 ${sha256}
It is ONE file for Linux, macOS and Windows. On Windows the host below maps it and runs it, and bun's
code for Windows in it calls kernel32, ntdll and libuv through addresses that the host resolves.

Needed on the machine: git, clang of LLVM with the Windows SDK and the MSVC libraries (a "Developer
PowerShell for VS" with LLVM on the PATH has all of it), and bun for the two checks at the end.
Every command is PowerShell, run in this directory. Output is redirected by cmd so that it stays
the bytes the program wrote (PowerShell's own ">" re-encodes them).

1. libuv: bun's fork at the commit bun pins, with bun's two patches

    git clone https://github.com/oven-sh/libuv libuv
    git -C libuv checkout ${libuvCommit}
    git -C libuv apply ..\\patches\\win-poll-rearm-before-callback.patch
    git -C libuv apply ..\\patches\\win-poll-abort-with-disconnect.patch

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

   host_win_uv.c names every libuv function of bun's bindings: "undefined symbol uv_.." here means
   that this libuv does not have a function that the bindings declare. Please send the message.

4. every import of the image against this Windows (it binds each one and prints the ones that fail)

    cmd /c ".\\host.exe bun_fs_slice.img --imports > imports-windows.jsonl"
    Get-Content imports-windows.jsonl -Tail 1        # {"step":"imports","total":..,"missing":0,..}

5. the slice. "work" has to exist; the slice makes and removes work\\slice-tree.

    mkdir work
    cmd /c ".\\host.exe bun_fs_slice.img work > run-windows.jsonl 2> run-windows.stderr.txt"
    echo "exit code $LASTEXITCODE"
    bun compare-run.ts run-windows.jsonl             # against expected\\linux.jsonl and expected\\differences.json

   With more detail from the host (every lookup, every request it refuses):
    $env:BUN_HOST_TRACE = "2"; cmd /c ".\\host.exe bun_fs_slice.img work > run-trace.jsonl 2> run-trace.stderr.txt"; $env:BUN_HOST_TRACE = $null
   The host reserves what the image maps with MAP_NORESERVE (the arenas of the allocator) and commits
   1 MiB of it where a page is touched first. The kernel of Windows does not touch for the image: a
   system call that gets memory of the image which nothing has written to yet fails with
   ERROR_NOACCESS, and bun reports EACCES. A step that ends so here and passes on Linux is that.

6. the layout of the bindings against the headers of this machine

    bun bindings\\verify.ts --libuv libuv --out layout.headers.json
    bun bindings\\compare.ts bindings\\layout.image.json layout.headers.json > layout-compare.txt
    Get-Content layout-compare.txt -Tail 1

Please send back: imports-windows.jsonl, run-windows.jsonl, run-windows.stderr.txt, the output of
compare-run.ts, layout.headers.json, layout-compare.txt, and the output of "clang --version".

arm64
-----
The host is built with the same commands in an arm64 developer shell (host_win.c has both
architectures). It needs an image for arm64, which is not in this package.
`,
);
console.log(`${out}: image sha256 ${sha256}`);
