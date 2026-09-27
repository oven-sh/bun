// Makes the two packages for a Windows machine from the tree: the images of the file system slice and of
// the loop slice, and what a person needs next to each to build the host natively and to run it there.
//
//   bun misctools/portable/packages/rebuild.ts [--out <dir>] [--to <dir>] [--runs 5]
//
//   --out    the output directory of misctools/portable/build.ts for x86_64 (default:
//            build/portable/x86_64 in the repository)
//   --to     where the packages go: <to>/windows-package-files and <to>/windows-package-loop (default:
//            <out>/packages)
//   --runs   how often the tests on Linux run each of their tests (default: 5)
//
// Steps, each one the command of the tool that does it. A step that fails ends the run.
//   bun       all of bun as an image (../build.ts bun), which builds the sysroot first: the slices take
//             the C and C++ of bun from its build directory. Left out when that directory has a build
//   slices    ../loop/build.ts, which builds the file system slice first
//   tests     ../slice/test.ts and ../loop/test.ts: both images on Linux, directly and under the test host
//   windows   ../loop/check-windows.ts: libuv, the host and the checks of the headers, compiled for Windows
//             with the SDK of nuget.org (../tools/windows-sdk.ts), nothing of it run
//   packages  ../slice/package-windows.ts and ../loop/package-windows.ts
//   copy      everything of the two packages but the images, into the directories next to this file
//
// The directories next to this file are what this command wrote last: commands.txt of each has the exact
// PowerShell commands and the sha256 of the image it was written for. An image that is built again has
// another sha256, and this command writes the commands for it.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { REPOSITORY, TREE } from "../flags.ts";

const here = dirname(import.meta.path);
const args = process.argv.slice(2);
function option(name: string, fallback: string) {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  if (args[at + 1] === undefined) throw new Error(`${name} needs a value`);
  return args[at + 1]!;
}
const out = resolve(option("--out", join(REPOSITORY, "build", "portable", "x86_64")));
const to = resolve(option("--to", join(out, "packages")));
const runs = option("--runs", "5");
const portableBuild = resolve(process.env.PORTABLE_BUILD ?? join(REPOSITORY, "build", "release-portable"));

/** The packages: the tool that writes each, and the image that is not copied into the tree. */
const PACKAGES = [
  { name: "windows-package-files", tool: join(TREE, "slice/package-windows.ts"), image: "bun_fs_slice.img" },
  { name: "windows-package-loop", tool: join(TREE, "loop/package-windows.ts"), image: "bun_loop_slice.img" },
];

function step(name: string, command: string[]) {
  console.log(`== ${name}: ${command.join(" ")}`);
  const started = Date.now();
  const result = Bun.spawnSync(command, { cwd: REPOSITORY, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    console.error(`${name} failed with exit code ${result.exitCode}`);
    process.exit(1);
  }
  console.log(`== ${name}: done in ${Math.round((Date.now() - started) / 1000)} s`);
}

const bun = process.execPath;
if (existsSync(join(portableBuild, "compile_commands.json")) && existsSync(join(portableBuild, "bun-profile"))) {
  console.log(`== bun: ${portableBuild} has a build`);
} else {
  step("bun", [bun, join(TREE, "build.ts"), "bun", "--arch", "x86_64", "--out", out]);
}
step("slices", [bun, join(TREE, "loop/build.ts"), "--out", out]);
step("tests of the file system slice", [bun, join(TREE, "slice/test.ts"), "--runs", runs, "--out", out]);
step("tests of the loop slice", [bun, join(TREE, "loop/test.ts"), "--runs", runs, "--out", out]);
step("windows", [bun, join(TREE, "loop/check-windows.ts"), "--out", out]);
mkdirSync(to, { recursive: true });
for (const { name, tool } of PACKAGES) step(name, [bun, tool, "--out", out, join(to, name)]);

for (const { name, image } of PACKAGES) {
  const kept = join(here, name);
  rmSync(kept, { recursive: true, force: true });
  cpSync(join(to, name), kept, { recursive: true, filter: source => source !== join(to, name, image) });
  const files = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
    );
  const bytes = files(kept).reduce((sum, file) => sum + statSync(file).size, 0);
  console.log(`${kept}: ${files(kept).length} files, ${bytes} bytes, without ${image}`);
}
console.log(`the packages with their images: ${PACKAGES.map(({ name }) => join(to, name)).join(", ")}`);
