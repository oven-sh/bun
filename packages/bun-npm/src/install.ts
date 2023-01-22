import { fetch, chmod, join, rename, rm, tmp, write, spawn } from "./util";
import { unzipSync } from "zlib";
import type { Platform } from "./platform";
import { os, arch, supportedPlatforms } from "./platform";

declare const npmVersion: string;
declare const npmPackage: string;
declare const npmOwner: string;

export async function importBun(): Promise<string> {
  if (!supportedPlatforms.length) {
    throw new Error(`Unsupported platform: ${os} ${arch}`);
  }
  for (const platform of supportedPlatforms) {
    try {
      return await requireBun(platform);
    } catch (error) {
      console.debug("requireBun failed", error);
    }
  }
  throw new Error(`Failed to install package "${npmPackage}"`);
}

async function requireBun(platform: Platform): Promise<string> {
  const npmPackage = `${npmOwner}/${platform.bin}`;
  function resolveBun() {
    const exe = require.resolve(join(npmPackage, platform.exe));
    const { exitCode, stderr, stdout } = spawn(exe, ["--version"]);
    if (exitCode === 0) {
      return exe;
    }
    throw new Error(stderr || stdout);
  }
  try {
    return resolveBun();
  } catch (error) {
    console.debug("resolveBun failed", error);
    console.error(
      `Failed to find package "${npmPackage}".`,
      `You may have used the "--no-optional" flag when running "npm install".`,
    );
  }
  const cwd = join("node_modules", npmPackage);
  try {
    installBun(platform, cwd);
  } catch (error) {
    console.debug("installBun failed", error);
    console.error(
      `Failed to install package "${npmPackage}" using "npm install".`,
      error,
    );
    try {
      await downloadBun(platform, cwd);
    } catch (error) {
      console.debug("downloadBun failed", error);
      console.error(
        `Failed to download package "${npmPackage}" from "registry.npmjs.org".`,
        error,
      );
    }
  }
  return resolveBun();
}

function installBun(platform: Platform, dst: string): void {
  const npmPackage = `${npmOwner}/${platform.bin}`;
  const cwd = tmp();
  try {
    write(join(cwd, "package.json"), "{}");
    const { exitCode } = spawn(
      "npm",
      [
        "install",
        "--loglevel=error",
        "--prefer-offline",
        "--no-audit",
        "--progress=false",
        `${npmPackage}@${npmVersion}`,
      ],
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
      rename(join(cwd, "node_modules", npmPackage), dst);
    }
  } finally {
    try {
      rm(cwd);
    } catch (error) {
      console.debug("rm failed", error);
      // There is nothing to do if the directory cannot be cleaned up.
    }
  }
}

async function downloadBun(platform: Platform, dst: string): Promise<void> {
  const response = await fetch(
    `https://registry.npmjs.org/${npmOwner}/${platform.bin}/-/${platform.bin}-${npmVersion}.tgz`,
  );
  const tgz = await response.arrayBuffer();
  let buffer: Buffer;
  try {
    buffer = unzipSync(tgz);
  } catch (cause) {
    throw new Error("Invalid gzip data", { cause });
  }
  function str(i: number, n: number): string {
    return String.fromCharCode(...buffer.subarray(i, i + n)).replace(
      /\0.*$/,
      "",
    );
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
          console.debug("chmod failed", error);
        }
      }
      offset += (size + 511) & ~511;
    }
  }
}

export function optimizeBun(path: string): void {
  if (os === "win32") {
    return;
  }
  const { npm_config_user_agent } = process.env;
  if (npm_config_user_agent && /\byarn\//.test(npm_config_user_agent)) {
    return;
  }
  try {
    rename(path, join(__dirname, "bin", "bun"));
  } catch (error) {
    console.debug("optimizeBun failed", error);
  }
}
