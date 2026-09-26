// Stands for the programs of a Mac that slice/run-on-mac.sh calls, on this Linux machine.
//
//   bun mac-tools-on-linux.ts <cc|uname|sw_vers|sysctl|hdiutil> <the arguments of the program>
//
// slice/test-run-on-mac.ts puts a directory in front of PATH that has one small script for each of
// them, which calls this. With them the script of the Mac runs here from its first line to its last,
// on what this machine can know of a Mac:
//
//   cc        for the host: builds it for macOS first, with the headers of macOS and the names that
//             libSystem exports (tools/macos-sdk.ts), and says what clang says if that fails. Then it
//             builds the host for this machine, which is the program that runs. For an image of the
//             other processor that is a static program and qemu (user mode) in front of it.
//             for verify/darwin_layout.c: translates the part for macOS with the headers of macOS, says
//             what clang says if that fails, and writes a program that prints what the part prints
//             (bindings/evaluate-c.ts).
//   uname, sw_vers, sysctl
//             say what they say on a Mac with the processor MAC_TOOLS_ARCH.
//   hdiutil   create, attach and detach do nothing but say that they did: the directory of the
//             "volume" is a directory. MAC_TOOLS_HDIUTIL=refuses makes attach fail.
//
// What runs is the image under the Linux test host, with a stand-in for libSystem
// (libsystem_on_linux.h) if the environment of the test says so. It is not macOS.
//
// Environment: MAC_TOOLS_ARCH (x86_64 or aarch64), WORK (default /tmp/portable/n3), LLVM_BIN,
// MAC_TOOLS_HOST=hangs (the host that cc builds never ends).
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { evaluate, sdkOfMacos, targetOfMacos } from "../bindings/evaluate-c.ts";

const here = dirname(import.meta.path);
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const arch = process.env.MAC_TOOLS_ARCH ?? "x86_64";
if (arch !== "x86_64" && arch !== "aarch64") throw new Error("MAC_TOOLS_ARCH: x86_64 or aarch64");
const machine = arch === "aarch64" ? "arm64" : "x86_64";
const native = process.arch === (arch === "aarch64" ? "arm64" : "x64");
const [tool, ...argv] = process.argv.slice(2);

const sdk = () => sdkOfMacos(join(work, "ref/macos-sdk"));
const versionOfMacos = () => /macOS (\S+)/.exec(readFileSync(join(sdk(), "SDK.txt"), "utf8"))?.[1] ?? "0";

function run(command: string[]): { code: number; messages: string } {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode ?? 1, messages: result.stdout.toString() + result.stderr.toString() };
}
function finish(code: number, messages = ""): never {
  if (messages) process.stderr.write(messages.endsWith("\n") ? messages : messages + "\n");
  process.exit(code);
}
function script(path: string, lines: string[]) {
  writeFileSync(path, ["#!/bin/sh", ...lines, ""].join("\n"));
  chmodSync(path, 0o755);
}

function cc() {
  if (argv.includes("--version")) {
    console.log(`clang for macOS ${versionOfMacos()} on Linux (test/mac-tools-on-linux.ts), ${machine}`);
    return;
  }
  const out = argv[argv.indexOf("-o") + 1];
  const source = argv[argv.length - 1];
  const flags = argv.filter((arg, index) => arg !== "-o" && index !== argv.indexOf("-o") + 1 && arg !== source);
  if (!out || !source.endsWith(".c")) finish(1, `cc: this stand-in compiles one file of C with -o: ${argv.join(" ")}`);
  const target = targetOfMacos(arch);

  if (source.endsWith("darwin_layout.c")) {
    const translated = evaluate({ llvm, sdk: sdk(), target, source, flags });
    if (!translated.ok) finish(1, translated.messages);
    script(out, ["cat <<'THE_FACTS'", ...translated.lines, "THE_FACTS"]);
    finish(0, translated.messages);
  }

  // The host, as a Mac builds it.
  const forMacos = run([`${llvm}/clang`, `--target=${target}`, "-isysroot", sdk(), "-fuse-ld=lld", "-nostdlib", "-lSystem", ...flags, "-o", `${out}.macho`, source]);
  if (forMacos.code !== 0) finish(1, forMacos.messages);
  if (process.env.MAC_TOOLS_HOST === "hangs") {
    script(out, ["exec sleep 100000"]);
    finish(0, forMacos.messages);
  }
  // And as this machine runs it.
  if (native) {
    const built = run(["/usr/bin/cc", ...flags, "-o", out, source, "-lpthread"]);
    finish(built.code, forMacos.messages + built.messages);
  }
  const sys = join(work, `musl-${arch}/sysroot`);
  const resource = run([`${llvm}/clang`, "-print-resource-dir"]).messages.trim();
  const builtins = join(work, `musl-${arch}/builtins/lib/linux/libclang_rt.builtins-${arch}.a`);
  for (const command of [
    [`${llvm}/clang`, `--target=${arch}-linux-musl`, ...flags, "-nostdinc", "-isystem", join(sys, "include"), "-isystem", join(resource, "include"), "-fno-stack-protector", "-c", "-o", `${out}.o`, source],
    [`${llvm}/ld.lld`, "-static", "-z", "noexecstack", "-o", `${out}.real`, join(sys, "lib/crt1.o"), join(sys, "lib/crti.o"), `${out}.o`, `-L${join(sys, "lib")}`, "-lc", builtins, "-lc", join(sys, "lib/crtn.o")],
  ]) {
    const built = run(command);
    if (built.code !== 0) finish(built.code, built.messages);
  }
  script(out, [`exec qemu-${arch} '${out}.real' "$@"`]);
  finish(0, forMacos.messages);
}

function hdiutil() {
  const [verb] = argv;
  if (verb === "create") {
    const image = argv[argv.indexOf("-o") + 1];
    writeFileSync(image, "");
    console.log(`created: ${image}`);
  } else if (verb === "attach") {
    const at = argv[argv.indexOf("-mountpoint") + 1];
    if (process.env.MAC_TOOLS_HDIUTIL === "refuses") finish(1, "hdiutil: attach failed - Operation not permitted");
    if (!existsSync(at)) finish(1, `hdiutil: attach failed - no mount point ${at}`);
    console.log(`/dev/disk99          \t                               \t${at}`);
  } else if (verb === "detach") console.log('"disk99" ejected.');
  else finish(1, `hdiutil: this stand-in has create, attach and detach: ${argv.join(" ")}`);
}

switch (tool) {
  case "cc":
    cc();
    break;
  case "uname":
    if (argv[0] === "-m") console.log(machine);
    else if (argv[0] === "-srm") console.log(`Darwin 24.5.0 ${machine}`);
    else finish(1, `uname: this stand-in has -m and -srm`);
    break;
  case "sw_vers":
    if (argv[0] === "-productVersion") console.log(versionOfMacos());
    else if (argv[0] === "-buildVersion") console.log("headers");
    else console.log(`ProductName:\t\tmacOS\nProductVersion:\t\t${versionOfMacos()}\nBuildVersion:\t\theaders`);
    break;
  case "sysctl":
    if (argv.join(" ") === "-n sysctl.proc_translated") console.log("0");
    else finish(1, "sysctl: this stand-in has -n sysctl.proc_translated");
    break;
  case "hdiutil":
    hdiutil();
    break;
  default:
    finish(2, "usage: bun mac-tools-on-linux.ts <cc|uname|sw_vers|sysctl|hdiutil> <arguments>");
}
