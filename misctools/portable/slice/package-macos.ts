// Makes the directory that a person takes to a Mac, to run the file system slice there once.
//
//   bun package-macos.ts [--out <directory>]        default: WORK/mac-package
//
// after build.ts --arch x86_64 and build.ts --arch aarch64. WORK as in build.ts. In the directory:
//
//   run-on-mac.sh              what the person runs: sh run-on-mac.sh (it says what it does)
//   package.txt                the commit, and the images with their hashes
//   image/                     the two images. The one for aarch64 ends with an ad-hoc code
//                              signature: Apple Silicon maps code from a file only under one
//   host/                      the sources of the host: cc -O2 -o host host_posix.c
//   verify/darwin_layout.c     prints what the headers of macOS say (../bindings/darwin.ts)
//   verify/parts.txt           what each part of darwin_layout.c is about
//   verify/image-layout-<arch>.jsonl   the same facts from each image, as it printed them here
//   expected/darwin.jsonl      what the slice prints on macOS (expected.ts)
//
// The images are run here for that, the one of the other processor under qemu (user mode).
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { signature } from "../launch/tools/apple_sign.ts";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const repo = resolve(tree, "../..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const argv = process.argv.slice(2);
const out = resolve(argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : join(work, "mac-package"));

function run(command: string[], options: { cwd?: string } = {}) {
  const result = Bun.spawnSync(command, { cwd: options.cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`exit code ${result.exitCode}: ${command.join(" ")}\n${result.stderr.toString().slice(-2000)}`);
  return result.stdout;
}

/** The image with its signature: the image, zeros up to a page of macOS on arm64, the signature, and
    where it is (code_off, code_len, sig_off, sig_len, "BUNSIG01"), which host_posix.c reads. */
function signed(image: Buffer): Buffer {
  const page = 16384;
  const code = Buffer.concat([image, Buffer.alloc((page - (image.length % page)) % page)]);
  const blob = signature(code);
  const trailer = Buffer.alloc(40);
  trailer.writeBigUInt64LE(0n, 0);
  trailer.writeBigUInt64LE(BigInt(code.length), 8);
  trailer.writeBigUInt64LE(BigInt(code.length), 16);
  trailer.writeBigUInt64LE(BigInt(blob.length), 24);
  trailer.write("BUNSIG01", 32, "latin1");
  return Buffer.concat([code, blob, trailer]);
}

for (const generated of [["bun", join(tree, "bindings/darwin.ts"), "--check"], ["bun", join(here, "expected.ts"), "darwin"]]) run(generated);
rmSync(out, { recursive: true, force: true });
for (const dir of ["image", "host", "verify", "expected"]) mkdirSync(join(out, dir), { recursive: true });

const lines: string[] = [];
const commit = run(["git", "rev-parse", "HEAD"], { cwd: repo }).toString().trim();
const dirty = run(["git", "status", "--porcelain", "--untracked-files=no"], { cwd: repo }).toString().trim();
lines.push(`commit ${commit}${dirty ? " and changes that are not committed" : ""}, packed ${new Date().toISOString()}`);
const machine = process.arch === "x64" ? "x86_64" : "aarch64";
for (const arch of ["x86_64", "aarch64"]) {
  const built = join(work, `out/bun_fs_slice-${arch}.img`);
  if (!existsSync(built)) throw new Error(`${built}: build.ts --arch ${arch} has not made the image`);
  const bytes = arch === "aarch64" ? signed(readFileSync(built)) : readFileSync(built);
  const image = join(out, `image/bun_fs_slice-${arch}.img`);
  writeFileSync(image, bytes);
  chmodSync(image, 0o755);
  lines.push(`image/bun_fs_slice-${arch}.img ${bytes.length} bytes sha256 ${createHash("sha256").update(bytes).digest("hex")}${arch === "aarch64" ? " (with its code signature)" : ""}`);
  // What the image in the package says about the definitions of macOS.
  const emulator = arch === machine ? [] : [`qemu-${arch}`];
  const facts = run([...emulator, image, "--layout-darwin"]);
  writeFileSync(join(out, `verify/image-layout-${arch}.jsonl`), facts);
  lines.push(`verify/image-layout-${arch}.jsonl ${facts.toString().split("\n").filter(Boolean).length} facts`);
}
for (const name of ["host_posix.c", "linux_abi.h", "memory.h"]) copyFileSync(join(tree, "host", name), join(out, "host", name));
copyFileSync(join(tree, "bindings/darwin_layout.c"), join(out, "verify/darwin_layout.c"));
const parts: { part: number; what: string }[] = JSON.parse(readFileSync(join(tree, "bindings/darwin.json"), "utf8")).parts_of_darwin_layout_c;
writeFileSync(join(out, "verify/parts.txt"), parts.map(part => `${part.part} ${part.what}`).join("\n") + "\n");
copyFileSync(join(here, "expected/darwin.jsonl"), join(out, "expected/darwin.jsonl"));
copyFileSync(join(here, "run-on-mac.sh"), join(out, "run-on-mac.sh"));
chmodSync(join(out, "run-on-mac.sh"), 0o755);
writeFileSync(join(out, "package.txt"), lines.join("\n") + "\n");
const archive = `${out}.tgz`;
run(["tar", "-czf", archive, "-C", dirname(out), out.split("/").pop()!]);
console.log(lines.join("\n"));
console.log(`${out}\n${archive}: ${readFileSync(archive).length} bytes`);
