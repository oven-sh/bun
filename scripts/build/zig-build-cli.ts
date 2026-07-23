/**
 * zig-build-cli — the build-time entry point for `nested-zig` deps.
 *
 * Invoked by the `dep_zig_build` ninja rule (see source.ts). It does three
 * things, all at BUILD time (never at configure time):
 *
 *  1. Resolve a Zig compiler (see `resolveZig`).
 *  2. Pre-fetch the dep's Zig package dependencies into the Zig global
 *     cache so `zig build` never makes its own network requests. Zig's
 *     package manager is content-addressed: a package that is already in
 *     the cache under the hash declared in `build.zig.zon` is used as-is
 *     and its URL is never consulted, so this also keeps all downloads on
 *     our `downloadWithRetry` path (retries, prefetch cache, proxies).
 *  3. Run `zig build <args> --prefix <prefix>` in the dep's source dir.
 *
 * ## Usage (ninja only — not meant to be run by hand)
 *
 *   zig-build-cli.ts --prefix <dir> --cache <dir>
 *                    [--package <url> <zig-package-hash>]...
 *                    -- <zig build args...>
 *
 * cwd must be the dep's source directory (the ninja rule sets it via
 * stream.ts `--cwd=`).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { downloadWithRetry } from "./download.ts";
import { assert, BuildError } from "./error.ts";

/** Absolute path to this file, for ninja rule command strings. */
export const zigBuildCliPath: string = import.meta.filename;

/**
 * The pinned Zig release used to build `nested-zig` deps. Bumping it means
 * updating every sha256 below from
 * https://ziglang.org/download/index.json (the same data is mirrored at
 * github.com/ziglang/www.ziglang.org in assets/download/index.json).
 */
export const ZIG_VERSION = "0.15.2";

/**
 * Official release tarball sha256s, keyed by `<arch>-<os>` in Zig's own
 * naming. The downloaded tarball is rejected if its digest differs.
 */
const ZIG_TARBALL_SHA256: Record<string, string> = {
  "x86_64-linux": "02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239",
  "aarch64-linux": "958ed7d1e00d0ea76590d27666efbf7a932281b3d7ba0c6b01b0ff26498f667f",
  "x86_64-macos": "375b6909fc1495d16fc2c7db9538f707456bfc3373b14ee83fdd3e22b3d43f7f",
  "aarch64-macos": "3cc2bab367e185cdfb27501c4b30b1b0653c28d9f73df8dc91488e66ece5fa6b",
  "x86_64-freebsd": "5509ff57cd3f219165caed0da10221739af82742b9edfcda3f7bfaf4da7212dd",
  "aarch64-freebsd": "c62efd319f86663eb7747709dfca259205edba8eaee98efc96a51ce40a9437de",
};

/**
 * Zig's `<arch>-<os>` key for the machine running this build. The Linux
 * binaries are fully static (musl), so one tarball covers glibc and musl
 * hosts.
 */
function hostZigPlatform(): string {
  const archNames: Record<string, string> = { x64: "x86_64", arm64: "aarch64" };
  const osNames: Record<string, string> = { linux: "linux", darwin: "macos", freebsd: "freebsd" };
  const arch = archNames[process.arch];
  const os = osNames[process.platform];
  assert(
    arch !== undefined && os !== undefined,
    `No Zig ${ZIG_VERSION} download for host ${process.platform}-${process.arch}`,
    {
      hint: "Install Zig yourself and point BUN_ZIG at it, or add the platform to ZIG_TARBALL_SHA256 in zig-build-cli.ts",
    },
  );
  return `${arch}-${os}`;
}

/**
 * Find a usable `zig` executable, in order:
 *
 *  1. `$BUN_ZIG` — an explicit path, taken as-is (no version check: the
 *     nested `zig build` enforces its own `minimum_zig_version`).
 *  2. `zig` on `$PATH` whose `zig version` reports `major.minor` matching
 *     `ZIG_VERSION`. A mismatched system Zig is skipped, not fatal.
 *  3. Download the official `ZIG_VERSION` release into
 *     `<cacheDir>/zig/<version>/<arch-os>/`, verifying its sha256 against
 *     the pinned table above. Cached like the other toolchain downloads.
 */
async function resolveZig(cacheDir: string): Promise<string> {
  const fromEnv = process.env.BUN_ZIG;
  if (fromEnv) {
    assert(existsSync(fromEnv), `BUN_ZIG points at a path that does not exist: ${fromEnv}`);
    return fromEnv;
  }

  const wantMinor = ZIG_VERSION.split(".").slice(0, 2).join(".");
  const exe = process.platform === "win32" ? "zig.exe" : "zig";
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, exe);
    if (!existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const version = probe.status === 0 ? (probe.stdout ?? "").trim() : "";
    if (version.split(".").slice(0, 2).join(".") === wantMinor) {
      return candidate;
    }
  }

  // ─── Download ───
  const platform = hostZigPlatform();
  const sha = ZIG_TARBALL_SHA256[platform];
  assert(sha !== undefined, `No pinned Zig ${ZIG_VERSION} sha256 for ${platform}`, {
    hint: "Add it to ZIG_TARBALL_SHA256 in zig-build-cli.ts (from ziglang.org/download/index.json), or set BUN_ZIG",
  });

  const installDir = resolve(cacheDir, "zig", ZIG_VERSION, platform);
  const zigExe = join(installDir, "zig");
  if (existsSync(zigExe)) return zigExe;

  const name = `zig-${platform}-${ZIG_VERSION}`;
  const url = `https://ziglang.org/download/${ZIG_VERSION}/${name}.tar.xz`;
  console.log(`downloading ${url}`);
  const tarball = `${installDir}.${process.pid}.tar.xz`;
  const staging = `${installDir}.${process.pid}.staging`;
  await mkdir(resolve(installDir, ".."), { recursive: true });
  try {
    await downloadWithRetry(url, tarball, name);

    const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    assert(digest === sha, `Zig tarball sha256 mismatch for ${name}`, {
      hint: `expected ${sha}\n     got ${digest}\nfrom ${url}`,
    });

    // -J: the official Zig release archives are .tar.xz on every platform
    // this dep supports. -m normalizes mtimes (same as extractTarGz).
    await mkdir(staging, { recursive: true });
    const tar = spawnSync("tar", ["-xJmf", tarball, "-C", staging, "--strip-components=1"], {
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    });
    assert(tar.status === 0, `Failed to extract ${name}.tar.xz: ${tar.stderr ?? tar.error?.message}`, {
      hint: "Extracting .tar.xz requires xz (apt install xz-utils / brew install xz)",
    });

    // Publish atomically: the rename is the single step that makes a
    // complete toolchain visible at installDir. A concurrent build may
    // have published a complete install while this one was downloading;
    // use it instead of replacing it. The rm below only clears a crashed,
    // incomplete extract (a directory rename cannot overwrite a non-empty
    // target on any platform).
    if (existsSync(zigExe)) return zigExe;
    await rm(installDir, { recursive: true, force: true });
    await rm(tarball, { force: true });
    try {
      await rename(staging, installDir);
    } catch (err) {
      if (!existsSync(zigExe)) throw err;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(tarball, { force: true });
  }

  assert(existsSync(zigExe), `Zig extraction produced no ${zigExe}`);
  return zigExe;
}

/**
 * Ensure a Zig package is present in the global cache at `expectedHash`.
 *
 * Downloads `url` through our downloader, then hands the local tarball to
 * `zig fetch`, which unpacks it into `<globalCache>/p/<hash>/` keyed by
 * the content hash it computes. A mismatch between that hash and the one
 * `build.zig.zon` expects means the URL no longer serves the pinned
 * content — fail loudly rather than letting `zig build` fall back to the
 * network.
 */
async function prefetchZigPackage(zig: string, globalCache: string, url: string, expectedHash: string): Promise<void> {
  if (existsSync(join(globalCache, "p", expectedHash))) return;

  console.log(`fetching zig package ${expectedHash}`);
  const tarball = join(
    globalCache,
    `prefetch.${process.pid}.${createHash("sha256").update(url).digest("hex").slice(0, 8)}.tar.gz`,
  );
  try {
    await downloadWithRetry(url, tarball, expectedHash);
    const fetched = spawnSync(zig, ["fetch", tarball], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: globalCache },
    });
    assert(fetched.status === 0, `zig fetch failed for ${url}: ${fetched.stderr ?? fetched.error?.message}`);
    const got = (fetched.stdout ?? "").trim();
    assert(got === expectedHash, `Zig package hash mismatch for ${url}`, {
      hint:
        `expected ${expectedHash}\n     got ${got}\n` +
        `The URL no longer serves the content build.zig.zon pins. ` +
        `Update the --package hash in deps/ghostty-vt.ts to match the new build.zig.zon.`,
    });
  } finally {
    await rm(tarball, { force: true });
  }
}

/**
 * Fail the build if any archive `zig build` installed exports a symbol that
 * does not start with `exportPrefix`.
 *
 * A Zig static library that bundles compiler_rt defines `memcpy`, `memset`,
 * `memmove`, `memcmp`, and most of libm as weak globals. An executable that
 * links the archive ahead of libc (every ordinary link line) extracts those
 * members and silently replaces the libc implementations for the whole
 * binary; with `-Doptimize=ReleaseSmall` that made every `memcpy` in bun
 * about 4x slower. The dep's patch disables the bundling; this check makes
 * the property "this archive only exports its C API" hold from then on.
 */
function verifyArchiveExports(nm: string, prefix: string, exportPrefix: string): void {
  const libDir = resolve(prefix, "lib");
  const archives = readdirSync(libDir).filter(f => f.endsWith(".a") || f.endsWith(".lib"));
  assert(archives.length > 0, `zig-build-cli: no archives found under ${libDir} to verify`);
  for (const archive of archives) {
    const path = resolve(libDir, archive);
    const out = spawnSync(nm, ["--defined-only", "--extern-only", path], { encoding: "utf8" });
    if (out.error || out.status !== 0) {
      throw new BuildError(`Failed to run ${nm} on ${path}`, {
        cause: out.error,
        hint: out.stderr?.toString(),
      });
    }
    const offenders = new Set<string>();
    for (const line of out.stdout.split("\n")) {
      // llvm-nm archive output: `member.o:` headers, blank lines, and
      // `<addr> <type> <name>` symbol lines. Keep the defined names.
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.endsWith(":")) continue;
      const name = trimmed.split(/\s+/).pop()!.replace(/@.*$/, "");
      // Mach-O prefixes every C symbol with `_` (so the API is
      // `_ghostty_*` there) and defines reserved `__mh_*` header
      // symbols; ELF uses the bare name. A leaked libc symbol is caught
      // either way: neither `memcpy` nor `_memcpy` matches any of these.
      if (name.startsWith(exportPrefix)) continue;
      if (name.startsWith(`_${exportPrefix}`)) continue;
      if (name.startsWith("__mh_")) continue;
      offenders.add(name);
    }
    if (offenders.size > 0) {
      const list = [...offenders].sort();
      const shown = list.slice(0, 12).join(", ");
      throw new BuildError(
        `${archive} exports ${list.length} symbol(s) outside its public API (${exportPrefix}*): ${shown}${list.length > 12 ? ", ..." : ""}`,
        {
          hint:
            `A Zig static library must not export anything but its C API. In particular, Zig's bundled\n` +
            `compiler_rt defines libc/libm symbols (memcpy, memset, exp, ...) that would silently replace\n` +
            `the libc implementations for every consumer of the archive. Keep bundle_compiler_rt and\n` +
            `bundle_ubsan_rt disabled in the dep's patch (see patches/ghostty-vt/lib-vt-only.patch).`,
        },
      );
    }
  }
}

async function main(): Promise<void> {
  let prefix = "";
  let cacheDir = "";
  let nm = "";
  let exportPrefix = "";
  const packages: Array<{ url: string; hash: string }> = [];
  const zigArgs: string[] = [];

  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--prefix") {
      prefix = argv[++i] ?? "";
    } else if (a === "--cache") {
      cacheDir = argv[++i] ?? "";
    } else if (a === "--nm") {
      nm = argv[++i] ?? "";
    } else if (a === "--expect-export-prefix") {
      exportPrefix = argv[++i] ?? "";
    } else if (a === "--package") {
      const url = argv[++i];
      const hash = argv[++i];
      assert(url !== undefined && hash !== undefined, "--package requires <url> <hash>");
      packages.push({ url, hash });
    } else if (a === "--") {
      zigArgs.push(...argv.slice(i + 1));
      break;
    } else {
      throw new BuildError(`Unknown zig-build-cli argument: ${a}`);
    }
  }
  assert(prefix.length > 0 && cacheDir.length > 0, "zig-build-cli: --prefix and --cache are required");
  assert(
    (exportPrefix.length === 0) === (nm.length === 0),
    "zig-build-cli: --expect-export-prefix and --nm must be passed together",
  );

  const zig = await resolveZig(cacheDir);

  // Shared across profiles and checkouts (package store + compiled Zig
  // stdlib), like the tarball cache. The local cache is per dep build dir
  // so debug and release builds never invalidate each other.
  const globalCache = resolve(cacheDir, "zig-global-cache");
  const localCache = resolve(prefix, ".zig-cache");
  await mkdir(globalCache, { recursive: true });

  for (const pkg of packages) {
    await prefetchZigPackage(zig, globalCache, pkg.url, pkg.hash);
  }

  const result = spawnSync(zig, ["build", ...zigArgs, "--prefix", prefix], {
    stdio: "inherit",
    env: {
      ...process.env,
      ZIG_GLOBAL_CACHE_DIR: globalCache,
      ZIG_LOCAL_CACHE_DIR: localCache,
    },
  });
  if (result.error) {
    throw new BuildError(`Failed to spawn ${zig}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new BuildError(`zig build exited with ${result.status}`, {
      hint: `command: ${zig} build ${zigArgs.join(" ")} --prefix ${prefix}`,
    });
  }

  if (exportPrefix.length > 0) {
    verifyArchiveExports(nm, prefix, exportPrefix);
  }
}

if (process.argv[1] === import.meta.filename) {
  main().catch(err => {
    if (err instanceof BuildError) {
      process.stderr.write(err.format());
      process.exit(1);
    }
    throw err;
  });
}
