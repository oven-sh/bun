import { isAbsolute, relative } from "path";
import { unzipSync } from "zlib";
import { debug, error } from "../console";
import { fetch } from "../fetch";
import { chmod, join, link, rename, rm, tmp, write } from "../fs";
import type { Platform } from "../platform";
import { abi, arch, os, supportedPlatforms } from "../platform";
import { spawn } from "../spawn";

declare const version: string;
declare const module: string;
declare const owner: string;

export async function importBun(): Promise<string> {
  if (!supportedPlatforms.length) {
    throw new Error(`Unsupported platform: ${os} ${arch} ${abi || ""}`);
  }
  for (const platform of supportedPlatforms) {
    try {
      return await requireBun(platform);
    } catch (error) {
      debug("requireBun failed", error);
    }
  }
  throw new Error(`Failed to install package "${module}"`);
}

async function requireBun(platform: Platform): Promise<string> {
  const module = `${owner}/${platform.bin}`;
  try {
    return checkBun(require.resolve(join(module, platform.exe)));
  } catch (cause) {
    debug("resolve failed", cause);
    error(
      `Failed to find package "${module}".`,
      `You may have used the "--no-optional" flag when running "npm install".`,
    );
  }
  const dst = join(__dirname, "node_modules", module);
  try {
    installBun(platform, dst);
  } catch (cause) {
    debug("installBun failed", cause);
    error(`Failed to install package "${module}" using "npm install".`, cause);
    try {
      await downloadBun(platform, dst);
    } catch (cause) {
      debug("downloadBun failed", cause);
      error(`Failed to download package "${module}" from "registry.npmjs.org".`, cause);
    }
  }
  // Not require.resolve() again: when `bun install` runs this script without node installed,
  // it runs under bun, whose resolver remembers that the lookup above failed.
  return checkBun(join(dst, platform.exe));
}

function checkBun(exe: string): string {
  const { exitCode, stderr, stdout } = spawn(exe, ["--version"]);
  if (exitCode === 0) {
    return exe;
  }
  throw new Error(stderr || stdout);
}

function installBun(platform: Platform, dst: string): void {
  const module = `${owner}/${platform.bin}`;
  // Inside this package rather than the system temporary directory, which can be a different
  // file system that the rename below cannot move the package out of.
  const cwd = tmp(__dirname);
  try {
    write(join(cwd, "package.json"), "{}");
    const command = [
      "npm",
      "install",
      "--loglevel=error",
      "--prefer-offline",
      "--no-audit",
      "--progress=false",
      `${module}@${version}`,
    ];
    const options = {
      cwd,
      env: {
        ...process.env,
        npm_config_global: undefined,
      },
    };
    // On Windows npm is npm.cmd, which only a shell can run.
    const { exitCode, stdout, stderr } =
      os === "win32"
        ? spawn(command.join(" "), [], { ...options, shell: true })
        : spawn(command[0], command.slice(1), options);
    if (exitCode !== 0) {
      error(stderr || stdout);
      throw new Error("npm install failed");
    }
    rename(join(cwd, "node_modules", module), dst);
  } finally {
    try {
      rm(cwd);
    } catch (error) {
      debug("rm failed", error);
      // There is nothing to do if the directory cannot be cleaned up.
    }
  }
}

async function downloadBun(platform: Platform, dst: string): Promise<void> {
  const response = await fetch(`https://registry.npmjs.org/${owner}/${platform.bin}/-/${platform.bin}-${version}.tgz`);
  const tgz = await response.arrayBuffer();
  let buffer: Buffer;
  try {
    buffer = unzipSync(tgz);
  } catch (cause) {
    throw new Error("Invalid gzip data", { cause });
  }
  function str(i: number, n: number): string {
    return String.fromCharCode(...buffer.subarray(i, i + n)).replace(/\0.*$/, "");
  }
  let offset = 0;
  while (offset < buffer.length) {
    const name = str(offset, 100).replace("package/", "");
    const size = parseInt(str(offset + 124, 12), 8);
    offset += 512;
    if (!isNaN(size)) {
      const entryPath = join(dst, name);
      const entryName = relative(dst, entryPath);
      if (entryName && !entryName.startsWith("..") && !isAbsolute(entryName)) {
        write(entryPath, buffer.subarray(offset, offset + size));
        if (name === platform.exe) {
          try {
            chmod(entryPath, 0o755);
          } catch (error) {
            debug("chmod failed", error);
          }
        }
      }
      offset += (size + 511) & ~511;
    }
  }
}

export function optimizeBun(path: string): void {
  const installScript =
    os === "win32" ? 'powershell -c "irm bun.sh/install.ps1 | iex"' : "curl -fsSL https://bun.com/install | bash";
  try {
    rename(path, join(__dirname, "bin", "bun.exe"));
    link(join(__dirname, "bin", "bun.exe"), join(__dirname, "bin", "bunx.exe"));
    return;
  } catch (error) {
    debug("optimizeBun failed", error);
  }
  throw new Error(
    `Your package manager doesn't seem to support bun. To use bun, install using the following command: ${installScript}`,
  );
}
