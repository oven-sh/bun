/**
 * Prefetch every archive the build would download, into a flat content-
 * addressed directory. Bake the result into a CI image (or persist it on a
 * build host), point `$BUN_DEPS_CACHE_DIR` at it, and a fresh checkout
 * builds with zero network round-trips for deps.
 *
 *   bun scripts/build/prefetch.ts                  # host target, default variants
 *   bun scripts/build/prefetch.ts --out=/opt/deps  # explicit output dir
 *   bun scripts/build/prefetch.ts --print          # list URLs, don't download
 *   bun scripts/build/prefetch.ts --webkit=lto,asan,debug,baseline
 *
 * Output layout: `<out>/<sha256(url)>` per file plus `<out>/manifest.json`
 * mapping key → {url, bytes}. The key matches `offlineCacheKey()` in
 * download.ts — that function is the only contract between this script and
 * the build.
 *
 * Not covered: cargo crates (lolhtml). Cargo has its own offline workflow
 * (`cargo fetch` + CARGO_NET_OFFLINE) that needs the dep's Cargo.lock,
 * which doesn't exist until the dep tarball is extracted. Left for a
 * follow-up if crate downloads become a CI bottleneck.
 */

import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Abi, type Arch, type Config, type OS, detectHost, detectLinuxAbi } from "./config.ts";
import { allDeps } from "./deps/index.ts";
import { NODEJS_VERSION } from "./deps/nodejs-headers.ts";
import { WEBKIT_VERSION, prebuiltUrl } from "./deps/webkit.ts";
import { DEPS_CACHE_ENV, downloadWithRetry, offlineCacheKey } from "./download.ts";
import { BuildError } from "./error.ts";
import { ZIG_COMMIT, zigDownloadUrl } from "./zig.ts";

// ───────────────────────────────────────────────────────────────────────────
// URL collection
// ───────────────────────────────────────────────────────────────────────────

interface PrefetchTarget {
  os: OS;
  arch: Arch;
  abi: Abi | undefined;
}

/**
 * WebKit ABI variants to prefetch. Each is a distinct tarball (~200MB), so
 * the default set is conservative: `lto` for release builds, `none` for
 * assert builds. Pass `--webkit=…` to widen.
 */
type WebKitVariant = "none" | "lto" | "debug" | "asan" | "baseline";

interface CollectOptions {
  target: PrefetchTarget;
  webkitVariants: readonly WebKitVariant[];
  /** Fetch the ReleaseSafe zig compiler (CI default) in addition to ReleaseFast. */
  zigSafe: boolean;
}

/**
 * A `Config` populated only with fields the URL builders read. Everything
 * `dep.source()` and `prebuiltUrl()`/`zigDownloadUrl()` touch is real; the
 * rest is inert. We don't go through `resolveConfig()` because that requires
 * a working toolchain (clang probe, sysroot detection) and prefetch must run
 * on a bare image before any of that exists.
 */
function urlConfig(t: PrefetchTarget, v: { debug: boolean; lto: boolean; asan: boolean; baseline: boolean }): Config {
  const host = detectHost();
  const windows = t.os === "windows";
  return {
    os: t.os,
    arch: t.arch,
    abi: t.abi,
    linux: t.os === "linux",
    darwin: t.os === "darwin",
    windows,
    unix: t.os !== "windows",
    x64: t.arch === "x64",
    arm64: t.arch === "aarch64",
    host,
    exeSuffix: windows ? ".exe" : "",
    objSuffix: windows ? ".obj" : ".o",
    libPrefix: windows ? "" : "lib",
    libSuffix: windows ? ".lib" : ".a",
    debug: v.debug,
    lto: v.lto,
    asan: v.asan,
    baseline: v.baseline,
    webkit: "prebuilt",
    webkitVersion: WEBKIT_VERSION,
    nodejsVersion: NODEJS_VERSION,
    zigCommit: ZIG_COMMIT,
    ci: true,
    cacheDir: "",
  } as Config;
}

function variantFlags(v: WebKitVariant): { debug: boolean; lto: boolean; asan: boolean; baseline: boolean } {
  return {
    debug: v === "debug",
    lto: v === "lto",
    asan: v === "asan",
    baseline: v === "baseline",
  };
}

/**
 * Every URL the build would fetch for `opts`. Map preserves insertion order
 * and dedupes by URL — github-archive deps are target-independent, so
 * collecting across variants converges on one entry per dep.
 */
function collectUrls(opts: CollectOptions): Map<string, string> {
  const urls = new Map<string, string>();
  const add = (label: string, url: string) => {
    if (!urls.has(url)) urls.set(url, label);
  };

  // ── Vendored deps ──
  // A neutral (release) cfg for source() calls. Every github-archive dep
  // currently ignores cfg; if one ever becomes target-dependent, it'll
  // resolve against this and still produce a valid URL.
  const depCfg = urlConfig(opts.target, variantFlags("none"));
  for (const dep of allDeps) {
    const src = dep.source(depCfg);
    if (src.kind === "github-archive") {
      add(dep.name, `https://github.com/${src.repo}/archive/${src.commit}.tar.gz`);
    } else if (src.kind === "prebuilt" && dep.name !== "WebKit") {
      add(dep.name, src.url);
    }
  }

  // ── WebKit (one tarball per ABI variant) ──
  for (const v of opts.webkitVariants) {
    const flags = variantFlags(v);
    if (flags.baseline && opts.target.arch !== "x64") continue;
    add(`WebKit-${v}`, prebuiltUrl(urlConfig(opts.target, flags)));
  }

  // ── Zig compiler (host-dependent) ──
  add("zig", zigDownloadUrl(depCfg, false));
  if (opts.zigSafe) add("zig-safe", zigDownloadUrl(depCfg, true));

  return urls;
}

// ───────────────────────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────────────────────

interface Args {
  out: string;
  print: boolean;
  target: PrefetchTarget;
  webkitVariants: WebKitVariant[];
  zigSafe: boolean;
  jobs: number;
}

function parseArgs(argv: string[]): Args {
  const host = detectHost();
  const args: Args = {
    out: process.env[DEPS_CACHE_ENV] ?? join(process.cwd(), ".cache", "bun-deps"),
    print: false,
    target: { os: host.os, arch: host.arch, abi: host.os === "linux" ? detectLinuxAbi() : undefined },
    webkitVariants: ["lto", "none"],
    zigSafe: true,
    jobs: 4,
  };

  for (const a of argv) {
    const [flag, val] = a.split("=", 2);
    switch (flag) {
      case "--out":
        if (val === undefined) throw new BuildError(`--out requires a value`);
        args.out = val;
        break;
      case "--print":
        args.print = true;
        break;
      case "--os":
        if (val !== "linux" && val !== "darwin" && val !== "windows") throw new BuildError(`--os: ${val}`);
        args.target.os = val;
        if (val !== "linux") args.target.abi = undefined;
        break;
      case "--arch":
        if (val !== "x64" && val !== "aarch64") throw new BuildError(`--arch: ${val}`);
        args.target.arch = val;
        break;
      case "--abi":
        if (val !== "gnu" && val !== "musl") throw new BuildError(`--abi: ${val}`);
        args.target.abi = val;
        break;
      case "--webkit":
        args.webkitVariants = (val ?? "").split(",").filter(Boolean) as WebKitVariant[];
        for (const v of args.webkitVariants) {
          if (!["none", "lto", "debug", "asan", "baseline"].includes(v)) {
            throw new BuildError(`--webkit: unknown variant '${v}'`);
          }
        }
        break;
      case "--no-zig-safe":
        args.zigSafe = false;
        break;
      case "--jobs":
      case "-j":
        args.jobs = Number(val) || 4;
        break;
      case "--help":
      case "-h":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default:
        throw new BuildError(`Unknown flag: ${a}`, { hint: USAGE });
    }
  }
  return args;
}

const USAGE = `\
Usage: bun scripts/build/prefetch.ts [options]

Downloads every archive the build would fetch (dep tarballs, prebuilt
WebKit, zig compiler) into a content-addressed directory. Set
${DEPS_CACHE_ENV} to that directory and subsequent builds read from it
instead of the network.

Options:
  --out=<dir>       Output dir. Default: $${DEPS_CACHE_ENV} or ./.cache/bun-deps
  --print           List URLs and exit (no download)
  --os=<os>         Target OS for WebKit. Default: host
  --arch=<arch>     Target arch for WebKit (x64|aarch64). Default: host
  --abi=<abi>       Linux ABI for WebKit (gnu|musl). Default: gnu
  --webkit=<v,...>  WebKit variants: none,lto,debug,asan,baseline. Default: lto,none
  --no-zig-safe     Skip the ReleaseSafe zig compiler (CI uses it; local doesn't)
  -j, --jobs=<n>    Concurrent downloads. Default: 4
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const urls = collectUrls({
    target: args.target,
    webkitVariants: args.webkitVariants,
    zigSafe: args.zigSafe,
  });

  if (args.print) {
    for (const [url, label] of urls) {
      process.stdout.write(`${offlineCacheKey(url)}  ${label.padEnd(16)}  ${url}\n`);
    }
    return;
  }

  await mkdir(args.out, { recursive: true });
  console.log(
    `prefetching ${urls.size} archive(s) → ${args.out}\n` +
      `  target: ${args.target.os}-${args.target.arch}${args.target.abi ? `-${args.target.abi}` : ""}` +
      `  webkit: ${args.webkitVariants.join(",") || "(none)"}`,
  );

  const manifest: Record<string, { url: string; label: string; bytes: number }> = {};
  const queue = Array.from(urls.entries());
  let fetched = 0;
  let skipped = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [url, label] = next;
      const key = offlineCacheKey(url);
      const dest = join(args.out, key);
      if (existsSync(dest) && statSync(dest).size > 0) {
        skipped++;
      } else {
        await downloadWithRetry(url, dest, label);
        fetched++;
      }
      manifest[key] = { url, label, bytes: statSync(dest).size };
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.jobs, queue.length) }, worker));
  await writeFile(join(args.out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const totalMiB = Object.values(manifest).reduce((a, b) => a + b.bytes, 0) / 1048576;
  console.log(`done: ${fetched} fetched, ${skipped} cached, ${totalMiB.toFixed(1)} MiB total`);
}

if (process.argv[1] === import.meta.filename) {
  try {
    await main();
  } catch (err) {
    if (err instanceof BuildError) {
      process.stderr.write(err.format());
      process.exit(1);
    }
    throw err;
  }
}
