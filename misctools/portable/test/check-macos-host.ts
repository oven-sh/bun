// Builds host/host_posix.c for macOS on a machine that is no Mac, as a Mac builds it.
//
//   bun check-macos-host.ts [--sdk <directory>] [--out <directory>]
//
// --sdk is what tools/macos-sdk.ts makes (default WORK/ref/macos-sdk; it is made if it is not there):
// the headers of macOS and the names that libSystem exports. clang has the targets of macOS and lld
// links for them, so for arm64 and for x86-64 the host is
//
//   compiled and linked   cc -O2 -o host host_posix.c, which is what run-on-mac.sh does, and once
//                         more with -DBUN_HOST_WITHOUT_FILES, which is what it falls back to. For the
//                         oldest macOS that the host is for and for the newest that the headers know:
//                         what is deprecated depends on it. No message of the compiler is accepted.
//   compiled              with -Wall -Wextra, as the Linux test host is. No message is accepted.
//
// A name that the headers do not declare, a structure with other fields, a function that libSystem
// does not export: each one stops this. The programs (WORK/out/macho/) are Mach-O files. They cannot
// run here: what the host does when it runs is for a Mac to say.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const sdk = resolve(option("--sdk", join(work, "ref/macos-sdk")));
const out = resolve(option("--out", join(work, "out/macho")));
if (!existsSync(join(sdk, "SDK.txt"))) {
  const made = Bun.spawnSync(["bun", join(here, "../tools/macos-sdk.ts"), "--out", sdk], { stdout: "inherit", stderr: "inherit" });
  if (made.exitCode !== 0) throw new Error("tools/macos-sdk.ts did not make the SDK");
}
const newest = /macOS (\d+(?:\.\d+)*)/.exec(readFileSync(join(sdk, "SDK.txt"), "utf8"))?.[1] ?? "15.0";
mkdirSync(out, { recursive: true });
const source = join(here, "../host/host_posix.c");

let failed = 0;
function attempt(what: string, command: string[]) {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  const messages = (result.stdout.toString() + result.stderr.toString()).trim();
  if (result.exitCode === 0 && !messages) console.log(`${what}: built, no message`);
  else {
    failed++;
    console.log(`${what}: ${result.exitCode === 0 ? "MESSAGES" : "NOT BUILT"}\n${messages.split("\n").slice(0, 40).join("\n")}`);
  }
}
for (const arch of ["arm64", "x86_64"]) {
  for (const macos of ["11.0", newest]) {
    const target = [`--target=${arch}-apple-macos${macos}`, "-isysroot", sdk];
    for (const defines of [[], ["-DBUN_HOST_WITHOUT_FILES"]]) {
      const name = `host-${arch}-macos${macos}${defines.length ? "-without-files" : ""}`;
      attempt(`${arch}, macOS ${macos}${defines.length ? `, ${defines.join(" ")}` : ""}: cc -O2 -o host host_posix.c`, [
        `${llvm}/clang`, ...target, "-fuse-ld=lld", "-nostdlib", "-lSystem", "-O2", ...defines, "-o", join(out, name), source,
      ]);
      attempt(`${arch}, macOS ${macos}${defines.length ? `, ${defines.join(" ")}` : ""}: -Wall -Wextra`, [
        `${llvm}/clang`, ...target, "-O2", "-Wall", "-Wextra", "-Wno-unused-parameter", "-ferror-limit=0", ...defines, "-fsyntax-only", source,
      ]);
    }
  }
}
console.log(failed ? `${failed} builds are not as they have to be` : `the host builds for macOS (headers of macOS ${newest}), every way`);
process.exit(failed ? 1 : 0);
