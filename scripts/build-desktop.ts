/**
 * Builds the UI library of `bun:desktop` (packages/bun-desktop), which `bun` loads at run time.
 *
 *   bun run build:desktop [--release] [--target=<rust triple>] [--pack] [-- <arguments for cargo>]
 *
 * The library lands in build/desktop, and beside every `bun` in build/ that is for this machine, where it is found
 * without BUN_DESKTOP_LIBRARY. `--pack` also writes the tarball of `@oven/bun-desktop-<os>-<arch>`.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");
const { values, positionals: cargoArguments } = parseArgs({
  allowPositionals: true,
  options: {
    release: { type: "boolean", default: false },
    target: { type: "string" },
    pack: { type: "boolean", default: false },
  },
});

function run(command: string, args: string[], cwd = root) {
  const { status, error } = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
}

/** The app that has the old file mapped keeps it. */
function replace(from: string, to: string) {
  try {
    rmSync(to, { force: true });
  } catch {
    // Windows lets it be renamed.
    renameSync(to, `${to}.${Date.now()}.old`);
  }
  copyFileSync(from, to);
}

function platformOf(triple: string | undefined) {
  if (triple === undefined) return { os: process.platform, cpu: process.arch };
  const os = triple.includes("-darwin") ? "darwin" : triple.includes("-windows-") ? "win32" : "linux";
  return { os, cpu: triple.startsWith("aarch64-") ? "arm64" : "x64" };
}

const outputDirectory = join(root, "build", "desktop");
const targetDirectory = resolve(process.env.CARGO_TARGET_DIR ?? join(outputDirectory, "target"));
run(
  "cargo",
  [
    "build",
    "--target-dir",
    targetDirectory,
    ...(values.release ? ["--release"] : []),
    ...(values.target ? ["--target", values.target] : []),
    ...cargoArguments,
  ],
  join(root, "packages", "bun-desktop"),
);

const { os, cpu } = platformOf(values.target);
const libraryName = os === "darwin" ? "libbun_desktop.dylib" : os === "win32" ? "bun_desktop.dll" : "libbun_desktop.so";
const built = join(targetDirectory, values.target ?? "", values.release ? "release" : "debug", libraryName);

mkdirSync(outputDirectory, { recursive: true });
const destinations = [outputDirectory];
if (os === process.platform && cpu === process.arch) {
  const executables = ["bun", "bun-debug", "bun-profile"].map(name => (os === "win32" ? `${name}.exe` : name));
  for (const name of readdirSync(join(root, "build"))) {
    const directory = join(root, "build", name);
    if (executables.some(executable => existsSync(join(directory, executable)))) destinations.push(directory);
  }
}
for (const directory of destinations) {
  replace(built, join(directory, libraryName));
  console.log(join(directory, libraryName));
}

if (values.pack) {
  // `desktop_package` in src/options_types/compile_target.rs names it, and `download_to_path` takes the file from `bin`.
  const name = `bun-desktop-${os === "win32" ? "windows" : os}-${cpu === "arm64" ? "aarch64" : cpu}`;
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const staging = join(outputDirectory, "npm", name);
  mkdirSync(join(staging, "package", "bin"), { recursive: true });
  replace(built, join(staging, "package", "bin", libraryName));
  copyFileSync(join(root, "LICENSE.md"), join(staging, "package", "LICENSE.md"));
  cpSync(join(root, "packages", "bun-desktop", "licenses"), join(staging, "package", "licenses"), { recursive: true });
  const manifest = {
    name: `@oven/${name}`,
    version,
    description: "The UI library of bun:desktop.",
    homepage: "https://bun.com",
    bugs: "https://github.com/oven-sh/bun/issues",
    license: "MIT",
    repository: "https://github.com/oven-sh/bun",
    preferUnplugged: true,
    os: [os],
    cpu: [cpu],
    ...(os === "linux" ? { libc: ["glibc"] } : {}),
  };
  writeFileSync(join(staging, "package", "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  const tarball = `${name}-${version}.tgz`;
  run("tar", ["-czf", join("..", tarball), "package"], staging);
  console.log(join(outputDirectory, "npm", tarball));
}
