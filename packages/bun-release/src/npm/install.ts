import { fetch } from "../fetch";
import { spawn } from "../spawn";
import { chmod, join, rename, rm, tmp, write } from "../fs";
import { unzipSync } from "zlib";
import type { Platform } from "../platform";
import { os, arch, supportedPlatforms } from "../platform";
import { debug, error } from "../console";

declare const version: string;
declare const module: string;
declare const owner: string;

export async function importBun(): Promise<string> {
  if (!supportedPlatforms.length) {
    throw new Error(`Unsupported platform: ${os} ${arch}`);
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
  function resolveBun() {
    const exe = require.resolve(join(module, platform.exe));
    const { exitCode, stderr, stdout } = spawn(exe, ["--version"]);
    if (exitCode === 0) {
      return exe;
    }
    throw new Error(stderr || stdout);
  }
  try {
    return resolveBun();
  } catch (cause) {
    debug("resolveBun failed", cause);
    error(
      `Failed to find package "${module}".`,
      `You may have used the "--no-optional" flag when running "npm install".`,
    );
  }
  const cwd = join("node_modules", module);
  try {
    installBun(platform, cwd);
  } catch (cause) {
    debug("installBun failed", cause);
    error(`Failed to install package "${module}" using "npm install".`, cause);
    try {
      await downloadBun(platform, cwd);
    } catch (cause) {
      debug("downloadBun failed", cause);
      error(`Failed to download package "${module}" from "registry.npmjs.org".`, cause);
    }
  }
  return resolveBun();
}

function installBun(platform: Platform, dst: string): void {
  const module = `${owner}/${platform.bin}`;
  const cwd = tmp();
  try {
    write(join(cwd, "package.json"), "{}");
    const { exitCode } = spawn(
      "npm",
      ["install", "--loglevel=error", "--prefer-offline", "--no-audit", "--progress=false", `${module}@${version}`],
      {
        cwd,
        stdio: "pipe",
        env: {
          ...process.env,
          npm_config_global: undefined,
        },
      },
    );
    if (exitCode === 0) {
      rename(join(cwd, "node_modules", module), dst);
    }
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
      write(join(dst, name), buffer.subarray(offset, offset + size));
      if (name === platform.exe) {
        try {
          chmod(join(dst, name), 0o755);
        } catch (error) {
          debug("chmod failed", error);
        }
      }
      offset += (size + 511) & ~511;
    }
  }
}

export function optimizeBun(path: string): void {
  const installScript = os === "win32" ? 'powershell -c "irm bun.sh/install.ps1 | iex"' : "curl -fsSL https://bun.sh/install | bash";
  try {
    rename(path, join(__dirname, "bin", "bun.exe"));
    return;
  } catch (error) {
    debug("optimizeBun failed", error);
  }
  throw new Error(
    `Your package manager doesn't seem to support bun. To use bun, install using the following command: ${installScript}`,
  );
}
