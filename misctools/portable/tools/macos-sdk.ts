// Makes a directory that clang and lld take as the SDK of macOS (-isysroot), on a machine that is no Mac.
//
//   bun macos-sdk.ts [--tag 0.15.2] [--out <directory>]      default: WORK/ref/macos-sdk
//
// WORK is /tmp/portable/n3 unless the environment says otherwise. Prints the directory.
//
// What is in it comes from the repository of zig (https://github.com/ziglang/zig), which ships what a
// compiler needs to build for macOS from any machine:
//   usr/include            lib/libc/include/any-macos-any: the headers of macOS, Apple's own, under the
//                          Apple Public Source License
//   usr/lib/libSystem.tbd  lib/libc/darwin/libSystem.tbd: the names that libSystem and the libraries
//                          behind it export, for each processor
// SDK.txt says which macOS that is (lib/libc/darwin/SDKSettings.json) and from which tag.
//
// Only the two directories are fetched (a clone without files, then the files of those paths).
// With them the host is compiled and linked as on a Mac (test/check-macos-host.ts), the program that
// asks the headers is evaluated (bindings/darwin-headers.ts), and every function that the image binds
// is looked up (bindings/darwin-exports.ts). Nothing that is built with it can run here.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const tag = option("--tag", "0.15.2");
const out = resolve(option("--out", join(work, "ref/macos-sdk")));
const clone = join(work, "ref/zig-macos");
const paths = ["lib/libc/include/any-macos-any", "lib/libc/darwin"];

function git(args: string[], cwd?: string): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: exit code ${result.exitCode}\n${result.stderr.toString().slice(-2000)}`);
  return result.stdout.toString().trim();
}

const stamp = join(out, "SDK.txt");
const wanted = `zig ${tag}`;
if (!existsSync(stamp) || !readFileSync(stamp, "utf8").startsWith(wanted)) {
  if (!existsSync(join(clone, ".git"))) {
    mkdirSync(join(work, "ref"), { recursive: true });
    git(["clone", "--filter=blob:none", "--sparse", "--depth", "1", "--branch", tag, "https://github.com/ziglang/zig", clone]);
  } else if (git(["describe", "--tags", "--always"], clone) !== tag) {
    git(["fetch", "--filter=blob:none", "--depth", "1", "origin", `refs/tags/${tag}:refs/tags/${tag}`], clone);
    git(["checkout", "--quiet", tag], clone);
  }
  git(["sparse-checkout", "set", ...paths], clone);
  for (const path of paths) if (!existsSync(join(clone, path))) throw new Error(`${tag} of zig has no ${path}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "usr/lib"), { recursive: true });
  cpSync(join(clone, paths[0]), join(out, "usr/include"), { recursive: true });
  cpSync(join(clone, paths[1], "libSystem.tbd"), join(out, "usr/lib/libSystem.tbd"));
  const settings = JSON.parse(readFileSync(join(clone, paths[1], "SDKSettings.json"), "utf8"));
  writeFileSync(stamp, `${wanted}, commit ${git(["rev-parse", "HEAD"], clone)}\nmacOS ${settings.MinimalDisplayName}\n`);
}
console.log(out);
console.error(readFileSync(stamp, "utf8").trim().split("\n").join(", "));
