// This is almost verbatim esbuild's postinstall script.
// Thank you @evanw.

import fs = require("fs");
import os = require("os");
import path = require("path");
import zlib = require("zlib");
import https = require("https");
import child_process = require("child_process");

declare const BUN_VERSION: string;

const version = BUN_VERSION;
const binPath = path.join(__dirname, "bin", "bun");

async function installBinaryFromPackage(
  name: string,
  fromPath: string,
  toPath: string
): Promise<void> {
  // Try to install from the cache if possible
  const cachePath = getCachePath(name);
  try {
    // Copy from the cache
    fs.copyFileSync(cachePath, toPath);
    fs.chmodSync(toPath, 0o755);

    // Verify that the binary is the correct version
    validateBinaryVersion(toPath);

    // Mark the cache entry as used for LRU
    const now = new Date();
    fs.utimesSync(cachePath, now, now);
    return;
  } catch {}

  // Next, try to install using npm. This should handle various tricky cases
  // such as environments where requests to npmjs.org will hang (in which case
  // there is probably a proxy and/or a custom registry configured instead).
  let buffer: Buffer | undefined;
  let didFail = false;
  try {
    buffer = installUsingNPM(name, fromPath);
  } catch (err) {
    didFail = true;
    console.error(`Trying to install "${name}" using npm`);
    console.error(
      `Failed to install "${name}" using npm: ${(err && err.message) || err}`
    );
  }

  // If that fails, the user could have npm configured incorrectly or could not
  // have npm installed. Try downloading directly from npm as a last resort.
  if (!buffer) {
    const url = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
    console.error(`Trying to download ${JSON.stringify(url)}`);
    try {
      buffer = extractFileFromTarGzip(await fetch(url), fromPath);
    } catch (err) {
      console.error(
        `Failed to download ${JSON.stringify(url)}: ${
          (err && err.message) || err
        }`
      );
    }
  }

  // Give up if none of that worked
  if (!buffer) {
    console.error(`Install unsuccessful`);
    process.exit(1);
  }

  // Write out the binary executable that was extracted from the package
  fs.writeFileSync(toPath, buffer, { mode: 0o755 });

  // Verify that the binary is the correct version
  try {
    validateBinaryVersion(toPath);
  } catch (err) {
    console.error(
      `The version of the downloaded binary is incorrect: ${
        (err && err.message) || err
      }`
    );
    console.error(`Install unsuccessful`);
    process.exit(1);
  }

  // Also try to cache the file to speed up future installs
  try {
    fs.mkdirSync(path.dirname(cachePath), {
      recursive: true,
      mode: 0o700, // https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
    });
    fs.copyFileSync(toPath, cachePath);
    cleanCacheLRU(cachePath);
  } catch {}

  if (didFail) console.error(`Install successful`);
}

function validateBinaryVersion(binaryPath: string): void {
  const stdout = child_process
    .execFileSync(binaryPath, ["--version"])
    .toString()
    .trim();
  if (stdout !== version) {
    throw new Error(
      `Expected ${JSON.stringify(version)} but got ${JSON.stringify(stdout)}`
    );
  }
}

function getCachePath(name: string): string {
  const home = os.homedir();
  const common = ["bun", "bin", `${name}@${version}`];
  if (process.platform === "darwin")
    return path.join(home, "Library", "Caches", ...common);
  if (process.platform === "win32")
    return path.join(home, "AppData", "Local", "Cache", ...common);

  // https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
  const XDG_CACHE_HOME = process.env.XDG_CACHE_HOME;
  if (
    process.platform === "linux" &&
    XDG_CACHE_HOME &&
    path.isAbsolute(XDG_CACHE_HOME)
  )
    return path.join(XDG_CACHE_HOME, ...common);

  return path.join(home, ".cache", ...common);
}

function cleanCacheLRU(fileToKeep: string): void {
  // Gather all entries in the cache
  const dir = path.dirname(fileToKeep);
  const entries: { path: string; mtime: Date }[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    try {
      const stats = fs.statSync(entryPath);
      entries.push({ path: entryPath, mtime: stats.mtime });
    } catch {}
  }

  // Only keep the most recent entries
  entries.sort((a, b) => +b.mtime - +a.mtime);
  for (const entry of entries.slice(5)) {
    try {
      fs.unlinkSync(entry.path);
    } catch {}
  }
}

function fetch(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          (res.statusCode === 301 || res.statusCode === 302) &&
          res.headers.location
        )
          return fetch(res.headers.location).then(resolve, reject);
        if (res.statusCode !== 200)
          return reject(new Error(`Server responded with ${res.statusCode}`));
        let chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

function extractFileFromTarGzip(buffer: Buffer, file: string): Buffer {
  try {
    buffer = zlib.unzipSync(buffer);
  } catch (err) {
    throw new Error(
      `Invalid gzip data in archive: ${(err && err.message) || err}`
    );
  }
  let str = (i: number, n: number) =>
    String.fromCharCode(...buffer.subarray(i, i + n)).replace(/\0.*$/, "");
  let offset = 0;
  file = `package/${file}`;
  while (offset < buffer.length) {
    let name = str(offset, 100);
    let size = parseInt(str(offset + 124, 12), 8);
    offset += 512;
    if (!isNaN(size)) {
      if (name === file) return buffer.subarray(offset, offset + size);
      offset += (size + 511) & ~511;
    }
  }
  throw new Error(`Could not find ${JSON.stringify(file)} in archive`);
}

function installUsingNPM(name: string, file: string): Buffer {
  const installDir = path.join(
    os.tmpdir(),
    "bun-cli-" + Math.random().toString(36).slice(2)
  );
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(path.join(installDir, "package.json"), "{}");

  // Erase "npm_config_global" so that "npm install --global bun" works.
  // Otherwise this nested "npm install" will also be global, and the install
  // will deadlock waiting for the global installation lock.
  const env = { ...process.env, npm_config_global: undefined };

  child_process.execSync(
    `npm install --loglevel=error --prefer-offline --no-audit --progress=false ${name}@${version}`,
    { cwd: installDir, stdio: "pipe", env }
  );
  const buffer = fs.readFileSync(
    path.join(installDir, "node_modules", name, file)
  );
  try {
    removeRecursive(installDir);
  } catch (e) {
    // Removing a file or directory can randomly break on Windows, returning
    // EBUSY for an arbitrary length of time. I think this happens when some
    // other program has that file or directory open (e.g. an anti-virus
    // program). This is fine on Unix because the OS just unlinks the entry
    // but keeps the reference around until it's unused. In this case we just
    // ignore errors because this directory is in a temporary directory, so in
    // theory it should get cleaned up eventually anyway.
  }
  return buffer;
}

function removeRecursive(dir: string): void {
  for (const entry of fs.readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    let stats;
    try {
      stats = fs.lstatSync(entryPath);
    } catch (e) {
      continue; // Guard against https://github.com/nodejs/node/issues/4760
    }
    if (stats.isDirectory()) removeRecursive(entryPath);
    else fs.unlinkSync(entryPath);
  }
  fs.rmdirSync(dir);
}

function isYarnBerryOrNewer(): boolean {
  const { npm_config_user_agent } = process.env;
  if (npm_config_user_agent) {
    const match = npm_config_user_agent.match(/yarn\/(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10) >= 2;
    }
  }
  return false;
}

function installDirectly(name: string) {
  if (process.env.BUN_BINARY_PATH) {
    fs.copyFileSync(process.env.BUN_BINARY_PATH, binPath);
    validateBinaryVersion(binPath);
  } else {
    // Write to a temporary file, then move the file into place. This is an
    // attempt to avoid problems with package managers like pnpm which will
    // usually turn each file into a hard link. We don't want to mutate the
    // hard-linked file which may be shared with other files.
    const tempBinPath = binPath + "__";
    installBinaryFromPackage(name, "bin/bun", tempBinPath)
      .then(() => fs.renameSync(tempBinPath, binPath))
      .catch((e) =>
        setImmediate(() => {
          throw e;
        })
      );
  }
}

function installWithWrapper(
  name: string,
  fromPath: string,
  toPath: string
): void {
  fs.writeFileSync(
    binPath,
    `#!/usr/bin/env node
const path = require('path');
const bun_exe = path.join(__dirname, '..', ${JSON.stringify(toPath)});
const child_process = require('child_process');
console.warn("[Bun] Yarn 2's lack of binary support slows Bun down. Consider using a different package manager until https://github.com/yarnpkg/berry/issues/882 is fixed.\n");
const { status } = child_process.spawnSync(bun_exe, process.argv.slice(2), { stdio: 'inherit' });
process.exitCode = status === null ? 1 : status;
`
  );
  const absToPath = path.join(__dirname, toPath);
  if (process.env.BUN_BINARY_PATH) {
    fs.copyFileSync(process.env.BUN_BINARY_PATH, absToPath);
    validateBinaryVersion(absToPath);
  } else {
    installBinaryFromPackage(name, fromPath, absToPath).catch((e) =>
      setImmediate(() => {
        throw e;
      })
    );
  }
}

function installOnUnix(name: string): void {
  // Yarn 2 is deliberately incompatible with binary modules because the
  // developers of Yarn 2 don't think they should be used. See this thread for
  // details: https://github.com/yarnpkg/berry/issues/882.
  //
  // We want to avoid slowing down bun for everyone just because of this
  // decision by the Yarn 2 developers, so we explicitly detect if bun is
  // being installed using Yarn 2 and install a compatability shim only for
  // Yarn 2. Normal package managers can just run the binary directly for
  // maximum speed.
  if (isYarnBerryOrNewer()) {
    installWithWrapper(name, "bin/bun", "bun");
  } else {
    installDirectly(name);
  }
}

function installOnWindows(name: string): void {
  installWithWrapper(name, "bun.exe", "bun.exe");
}

const platformKey = `${process.platform} ${os.arch()} ${os.endianness()}`;
const knownWindowsPackages: Record<string, string> = {
  //   "win32 arm64 LE": "bun-cli-windows-arm64",
  //   "win32 ia32 LE": "bun-cli-windows-32",
  //   "win32 x64 LE": "bun-cli-windows-64",
};
const knownUnixlikePackages: Record<string, string> = {
  //   "android arm64 LE": "bun-cli-android-arm64",
  "darwin arm64 LE": "bun-cli-darwin-aarch64",
  "darwin x64 LE": "bun-cli-darwin-x64",
  //   "freebsd arm64 LE": "bun-cli-freebsd-arm64",
  //   "freebsd x64 LE": "bun-cli-freebsd-64",
  //   "openbsd x64 LE": "bun-cli-openbsd-64",
  //   "linux arm LE": "bun-cli-linux-arm",
  //   "linux arm64 LE": "bun-cli-linux-arm64",
  //   "linux ia32 LE": "bun-cli-linux-32",
  //   "linux mips64el LE": "bun-cli-linux-mips64le",
  //   "linux ppc64 LE": "bun-cli-linux-ppc64le",
  //   "linux x64 LE": "bun-cli-linux-64",
  //   "sunos x64 LE": "bun-cli-sunos-64",
};

// Pick a package to install
if (platformKey in knownWindowsPackages) {
  installOnWindows(knownWindowsPackages[platformKey]);
} else if (platformKey in knownUnixlikePackages) {
  installOnUnix(knownUnixlikePackages[platformKey]);
} else {
  console.error(`Unsupported platform: ${platformKey}`);
  process.exit(1);
}
