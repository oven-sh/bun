/**
 * Fetch CLI — the single entry point ninja invokes for all downloads.
 *
 * Ninja rules reference this file via `cfg.bun <this-file> <kind> <args...>`.
 * This is BUILD-time code (runs under ninja), not CONFIGURE-time. The
 * configure-time modules (source.ts, deps/*.ts) emit ninja rules that call
 * into here but don't execute any of it themselves.
 *
 * ## Adding a new fetch kind
 *
 * 1. Write the implementation below (or in download.ts if shared).
 * 2. Add a `case` in main() that parses argv and calls it.
 * 3. Reference `fetchCliPath` in the ninja rule command.
 *
 * ## Args format
 *
 *   argv: [bun, fetch-cli.ts, <kind>, ...kind-specific-positional-args]
 *
 * Positional, not flags — these commands are only invoked by ninja with
 * args we control, never by humans. Named flags would be YAGNI.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readFileSync, type Stats } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { downloadWithRetry, extractTarGz, fetchPrebuilt, gitArchive, parseGitArchiveUrl } from "./download.ts";
import { assert, BuildError } from "./error.ts";
import { writeIfChanged } from "./fs.ts";
import { formatElapsed } from "./tty.ts";

/**
 * Absolute path to this file. Ninja rules use this in their command strings.
 *
 * This is a stable way for library modules to build the ninja command
 * without knowing where fetch-cli.ts lives — import this constant and
 * use it in `command: "${cfg.bun} ${fetchCliPath} <kind> ..."`.
 */
export const fetchCliPath: string = import.meta.filename;

// ───────────────────────────────────────────────────────────────────────────
// Dispatch
// ───────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , kind, ...args] = process.argv;

  switch (kind) {
    case "plan": {
      // fetch-cli.ts plan <name> <url> <ref> <dest> <cache> <dyndep> <static-outputs> <build-dir> [...patches]
      const [name, url, ref, dest, cache, dyndep, staticOutputs, buildDir, ...patches] = args;
      assert(name !== undefined && url !== undefined && ref !== undefined, "plan: missing name/url/ref");
      assert(dest !== undefined && cache !== undefined, "plan: missing dest/cache");
      assert(
        dyndep !== undefined && staticOutputs !== undefined && buildDir !== undefined,
        "plan: missing dyndep/static-outputs/build-dir",
      );
      return planDep(name, url, ref, dest, cache, dyndep, staticOutputs, buildDir, patches);
    }

    case "dep": {
      // fetch-cli.ts dep <name> <url> <ref> <dest> <cache> [...patches]
      const [name, url, ref, dest, cache, ...patches] = args;
      assert(name !== undefined && url !== undefined && ref !== undefined, "dep: missing name/url/ref");
      assert(dest !== undefined && cache !== undefined, "dep: missing dest/cache");
      return fetchDep(name, url, ref, dest, cache, patches);
    }

    case "subst": {
      // fetch-cli.ts subst <in> <out> [<from> <to>]...
      // Replaces every literal occurrence of <from> with <to>. Used by
      // DirectBuild deps to materialize *.h.in templates without running
      // the upstream configure (e.g. zlib-ng's zlib.h.in → zlib.h, where
      // the only substitution is `@ZLIB_SYMBOL_PREFIX@` → ``).
      const [inPath, outPath, ...pairs] = args;
      assert(inPath !== undefined && outPath !== undefined, "subst: missing in/out");
      assert(pairs.length % 2 === 0, "subst: replacements must be <from> <to> pairs");
      let text = await readFile(inPath, "utf8");
      for (let i = 0; i + 1 < pairs.length; i += 2) {
        assert(pairs[i]!.length > 0, `subst: empty <from> at index ${i}`);
        text = text.split(pairs[i]!).join(pairs[i + 1]!);
      }
      // dep_subst is restat=1 — preserve mtime when the rendered text is
      // unchanged so depfile-tracked .o files (libarchive ← zlib.h) don't
      // recompile after a no-op re-fetch.
      writeIfChanged(outPath, text);
      return;
    }

    case "check-undefined": {
      // fetch-cli.ts check-undefined <name> <nm> <rspfile> <stamp> <symbols>
      // <rspfile> is the edge's response file (one object per line);
      // <symbols> is comma-separated. Writes <stamp> when no object has an
      // undefined reference to any of the symbols. See
      // DirectBuild.forbidUndefined in source.ts.
      const [name, nm, rspfile, stamp, symbols] = args;
      assert(
        name !== undefined && nm !== undefined && rspfile !== undefined && stamp !== undefined && symbols !== undefined,
        "check-undefined: missing name/nm/rspfile/stamp/symbols",
      );
      return checkUndefined(name, nm, rspfile, stamp, symbols.split(","));
    }

    case "prebuilt": {
      // fetch-cli.ts prebuilt <name> <url> <dest> <identity> [...rm_paths]
      const [name, url, dest, identity, ...rmPaths] = args;
      assert(
        name !== undefined && url !== undefined && dest !== undefined && identity !== undefined,
        "prebuilt: missing name/url/dest/identity",
      );
      return fetchPrebuilt(name, url, dest, identity, rmPaths);
    }

    case undefined:
    case "--help":
    case "-h":
      process.stderr.write(USAGE);
      process.exit(1);
      break;

    default:
      throw new BuildError(`Unknown fetch kind: ${kind}`, { hint: USAGE });
  }
}

const USAGE = `\
Usage: bun fetch-cli.ts <kind> <args...>

Kinds:
  dep             <name> <url> <ref> <dest> <cache> [...patches]
  prebuilt        <name> <url> <dest> <identity> [...rm_paths]
  subst           <in> <out> [<from> <to>]...
  check-undefined <name> <nm> <rspfile> <stamp> <symbol,...>

This is invoked by ninja build rules. You shouldn't need to call it
directly — run ninja targets instead.
`;

// ───────────────────────────────────────────────────────────────────────────
// check-undefined: no object of a dep may still reference the given symbols
// ───────────────────────────────────────────────────────────────────────────

/**
 * `llvm-nm -A` prints one `<object>: <value> <type> <name>` line per symbol,
 * with a blank value and type U (w or v when weak) for an undefined one, in
 * the same shape for ELF, COFF, Mach-O and the bitcode objects of an LTO
 * build. Not `-u`: for Mach-O that switches to printing bare names, which
 * would match nothing here and pass the check without checking anything.
 */
const UNDEFINED_SYMBOL_LINE = /^(.*): +[Uwv] +(\S+)\s*$/;

/** Windows' command line tops out at 32K characters; keep each nm invocation well inside it. */
const NM_ARGV_BUDGET = 16_000;

function checkUndefined(name: string, nm: string, rspfile: string, stamp: string, symbols: string[]): void {
  const objects = readFileSync(rspfile, "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
  assert(objects.length > 0, `check-undefined ${name}: ${rspfile} lists no objects`);

  // A Mach-O name carries a leading underscore, so one symbol list serves
  // every format by also matching with it removed.
  const forbidden = new Set(symbols);
  let undefinedSymbols = 0;
  const offenders: string[] = [];
  for (let start = 0; start < objects.length; ) {
    let end = start;
    let length = 0;
    do {
      length += objects[end]!.length + 1;
      end++;
    } while (end < objects.length && length + objects[end]!.length < NM_ARGV_BUDGET);
    const result = spawnSync(nm, ["-A", ...objects.slice(start, end)], { encoding: "utf8", maxBuffer: 1 << 28 });
    if (result.error) throw new BuildError(`check-undefined ${name}: failed to run ${nm}`, { cause: result.error });
    if (result.status !== 0) throw new BuildError(`check-undefined ${name}: ${nm} failed:\n${result.stderr}`);
    for (const line of result.stdout.split("\n")) {
      const match = UNDEFINED_SYMBOL_LINE.exec(line);
      if (match === null) continue;
      undefinedSymbols++;
      const symbol = match[2]!;
      if (forbidden.has(symbol) || (symbol.startsWith("_") && forbidden.has(symbol.slice(1)))) {
        offenders.push(`  ${match[1]}: ${symbol}`);
      }
    }
    start = end;
  }

  // The objects of any dep call each other, libc and the OS, so parsing no
  // undefined symbols at all means nm's output is not in the shape parsed
  // above, and passing would be meaningless.
  assert(
    undefinedSymbols > 0,
    `check-undefined ${name}: no undefined symbols parsed from ${nm} output for ${objects.length} objects`,
  );
  if (offenders.length > 0) {
    throw new BuildError(`${name}: objects reference symbols its build forbids:\n${offenders.join("\n")}`, {
      hint: `The symbols and the objects allowed to use them are declared by forbidUndefined in scripts/build/deps/${name}.ts; the comment there says what the references have to go through instead.`,
    });
  }
  // dep_check_undefined is restat=1: an existing stamp keeps its mtime.
  writeIfChanged(stamp, "");
}

// ───────────────────────────────────────────────────────────────────────────
// dep fetch: download tarball (or sparse git fetch), extract, patch, stamp
// ───────────────────────────────────────────────────────────────────────────

/**
 * Fetch a source tree, extract, apply patches, write .ref stamp.
 *
 * `url` is a tarball URL (a GitHub `/archive/` URL or any release asset), or
 * a `git+https://github.com/<repo>@<commit>?sparse=<patterns>` pseudo-URL
 * (download.ts gitArchiveUrl) for a sparse git fetch, which is cached as a
 * tarball of the same shape — everything from extraction on is one path.
 * `ref` seeds the identity stamp: the commit for github sources,
 * `sha256:<digest>` for tarballs (the download is verified against it).
 *
 * Idempotent: if .ref exists and matches the computed identity, does nothing.
 * The ninja rule has restat=1, so a no-op fetch won't trigger downstream.
 *
 * Tarballs are cached in `cache/` keyed by URL sha256 — downloads are skipped
 * if the tarball already exists. Useful when re-extraction is needed after
 * a failed patch (you don't re-download).
 */
/** Identity, patch contents and git-archive spec shared by `plan` and `dep`. */
async function describeFetch(name: string, url: string, ref: string, patches: string[]) {
  // If a listed patch doesn't exist, that's a bug in the dep definition.
  const patchContents: string[] = [];
  for (const patch of patches) {
    try {
      patchContents.push(await readFile(patch, "utf8"));
    } catch (cause) {
      throw new BuildError(`Patch file not found: ${patch}`, {
        hint: `Check the patches list in deps/${name}.ts`,
        cause,
      });
    }
  }
  const git = parseGitArchiveUrl(url);
  const identity = computeSourceIdentity(ref, git?.sparse ?? [], patchContents);
  return { git, identity, patchContents };
}

const readStamp = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
};

/**
 * `<dest>.staging`: the new version's tree, extracted and patched, with its
 * identity in `.ref`. Prepared by `plan` (or by `dep` itself when run without
 * a plan), consumed by `dep`'s sync. Reused as-is when it already holds the
 * wanted identity.
 */
async function prepareStaging(
  name: string,
  url: string,
  ref: string,
  dest: string,
  cache: string,
  patches: string[],
  fetch: Awaited<ReturnType<typeof describeFetch>>,
): Promise<string> {
  const staging = `${dest}.staging`;
  if (readStamp(join(staging, ".ref")) === fetch.identity) return staging;
  const { git, identity, patchContents } = fetch;
  console.log(`fetching ${git ? `${git.repo}@${git.commit.slice(0, 8)}` : url}`);

  // ─── Download (with cache) ───
  const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const tarballPath = join(cache, `${name}-${urlHash}.tar.gz`);
  await mkdir(cache, { recursive: true });
  if (!existsSync(tarballPath)) {
    if (git) await gitArchive(git.repo, git.commit, git.sparse, tarballPath);
    else await downloadWithRetry(url, tarballPath, name);
  }
  // A `sha256:<hex>` ref pins the file's contents (release tarballs, whose
  // URL says nothing about the bytes). Checked on the cached copy too, and a
  // mismatching file is removed so the next run downloads afresh.
  if (ref.startsWith("sha256:")) {
    const expected = ref.slice("sha256:".length);
    const actual = await sha256File(tarballPath);
    if (actual !== expected) {
      await rm(tarballPath, { force: true });
      throw new BuildError(`${name}: ${url} has sha256 ${actual}, expected ${expected}`, {
        hint: `If the upstream file legitimately changed, update sha256 in deps/${name}.ts`,
      });
    }
  }

  // ─── Extract + patch ───
  // Github archives and release tarballs have one top-level directory; stripped.
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await extractTarGz(tarballPath, staging);
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]!;
    const base = basename(p);
    if (p.endsWith(".patch")) {
      console.log(`applying ${base}`);
      applyPatch(staging, p, patchContents[i]!);
    } else {
      // Overlay file: copy into source root. Used for e.g. injecting a
      // CMakeLists.txt into a project that doesn't have one (tinycc).
      console.log(`overlay ${base}`);
      await writeFile(join(staging, base), patchContents[i]!);
    }
  }
  // Identity LAST, so an interrupted extraction is never mistaken for a
  // prepared tree.
  await writeFile(join(staging, ".ref"), identity + "\n");
  return staging;
}

/**
 * `fetch-cli.ts plan`: make the tree of the pinned version available — the
 * live `dest` when it is already at that identity, otherwise a freshly
 * prepared `<dest>.staging` — and write the ninja dyndep file that declares
 * every regular file of that tree as an output of the `dep` edge (minus the
 * ones build.ninja already declares statically, listed in `staticOutputsFile`;
 * ninja refuses a file produced by two declarations). Loading that file is
 * what lets ninja see, within the same invocation, which headers the sync
 * that follows rewrote: they become restat outputs of the fetch edge, so an
 * object whose depfile names a changed one is rebuilt and one that names only
 * untouched files is left alone.
 */
export async function planDep(
  name: string,
  url: string,
  ref: string,
  dest: string,
  cache: string,
  dyndepFile: string,
  staticOutputsFile: string,
  buildDir: string,
  patches: string[],
): Promise<void> {
  const refPath = join(dest, ".ref");
  assertManagedSource(name, dest, refPath);
  const fetch = await describeFetch(name, url, ref, patches);
  const tree =
    readStamp(refPath) === fetch.identity ? dest : await prepareStaging(name, url, ref, dest, cache, patches, fetch);

  const declared = new Set(
    readFileSync(staticOutputsFile, "utf8")
      .split("\n")
      .filter(l => l.length > 0),
  );
  const files: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(join(tree, rel), { withFileTypes: true })) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(r);
      else if (e.isFile() && r !== ".ref") {
        const abs = join(dest, r);
        if (!declared.has(abs)) files.push(abs);
      }
    }
  };
  await walk("");
  files.sort();
  // Each file under both spellings, build-dir-relative and absolute — to
  // ninja those are two nodes, and a depfile may use either (an include found
  // through a relative -I lands in the deps log as ../../vendor/…, one found
  // through an absolute -I as /abs/vendor/…). build.ninja declares its static
  // outputs the same way (ninja.ts). A declaration only connects to the node
  // with the identical spelling.
  const spellings = (abs: string): string[] => {
    const rel = relative(buildDir, abs);
    return rel === abs ? [abs] : [rel, abs];
  };
  const esc = (path: string) =>
    path.replaceAll("\\", "/").replaceAll("$", "$$").replaceAll(" ", "$ ").replaceAll(":", "$:");
  const outs = files.flatMap(spellings).map(esc).join(" ");
  writeIfChanged(
    dyndepFile,
    `ninja_dyndep_version = 1\nbuild ${esc(refPath)}${outs.length > 0 ? " | " + outs : ""}: dyndep\n`,
  );
  console.log(tree === dest ? `up to date` : `planned ${files.length} files`);
}

/**
 * `fetch-cli.ts dep`: bring `dest` to the pinned version. A no-op when its
 * `.ref` already names that identity. Otherwise the new tree (prepared by
 * `plan`, or here when there was none) is synced into `dest` in place —
 * unchanged files keep their inode and mtime, so the objects compiled from
 * them stay valid and a version bump recompiles only what actually changed —
 * and `.ref` is written last.
 */
export async function fetchDep(
  name: string,
  url: string,
  ref: string,
  dest: string,
  cache: string,
  patches: string[],
): Promise<void> {
  const refPath = join(dest, ".ref");
  assertManagedSource(name, dest, refPath);
  const fetch = await describeFetch(name, url, ref, patches);

  const existing = readStamp(refPath);
  if (existing === fetch.identity) {
    // No-op. Don't touch .ref — restat will see unchanged mtime.
    // Printed so the ninja [N/M] line has closure instead of silence.
    await rm(`${dest}.staging`, { recursive: true, force: true });
    console.log(`up to date`);
    return;
  }
  if (existing !== undefined) {
    console.log(`source identity changed (was ${existing.slice(0, 8)}, now ${fetch.identity.slice(0, 8)})`);
  }
  const started = performance.now();
  const staging = await prepareStaging(name, url, ref, dest, cache, patches, fetch);

  // ─── Sync into dest ───
  // The old .ref goes first: until the new one is written at the end, dest
  // carries no identity, so an interrupted sync is redone by the next build.
  await rm(refPath, { force: true });
  await rm(join(staging, ".ref"), { force: true });
  let stats: SyncStats | undefined;
  if (existsSync(dest)) {
    stats = await syncTree(staging, dest);
    await rm(staging, { recursive: true, force: true });
  } else {
    await rename(staging, dest);
  }

  // ─── Write stamp ───
  // Written LAST — if anything above failed, no stamp means next build retries.
  await writeFile(refPath, fetch.identity + "\n");
  const summary =
    stats === undefined
      ? ""
      : `: ${stats.changed} changed, ${stats.added} added, ${stats.removed} removed, ${stats.kept} unchanged`;
  console.log(`done → ${dest}${summary} (${formatElapsed(performance.now() - started)})`);
}

interface SyncStats {
  kept: number;
  changed: number;
  added: number;
  removed: number;
}

/**
 * Make `dest` identical to `src` (a freshly extracted tree) while touching as
 * little as possible: a file whose bytes already match is left alone (same
 * mtime, so ninja keeps the objects built from it), a differing or new file
 * is moved in from `src`, anything in `dest` that `src` does not have is
 * deleted. Symlinks compare by target. `src` is consumed.
 */
export async function syncTree(src: string, dest: string): Promise<SyncStats> {
  const stats: SyncStats = { kept: 0, changed: 0, added: 0, removed: 0 };
  const walk = async (rel: string): Promise<void> => {
    const from = join(src, rel);
    const to = join(dest, rel);
    const wanted = new Map((await readdir(from, { withFileTypes: true })).map(e => [e.name, e]));
    // Removals first, so a name that changes kind (dir ⇄ file) is gone before
    // its replacement arrives.
    for (const e of existsSync(to) ? await readdir(to, { withFileTypes: true }) : []) {
      const w = wanted.get(e.name);
      if (w === undefined || kindOf(w) !== kindOf(e)) {
        await rm(join(to, e.name), { recursive: true, force: true });
        if (w === undefined) stats.removed++;
      }
    }
    await mkdir(to, { recursive: true });
    for (const [name, e] of wanted) {
      const f = join(from, name);
      const t = join(to, name);
      if (e.isDirectory()) {
        await walk(join(rel, name));
      } else if (lstatOrUndefined(t) === undefined) {
        await rename(f, t);
        stats.added++;
      } else if (await sameContent(f, t, e.isSymbolicLink())) {
        stats.kept++;
      } else {
        await rm(t, { force: true });
        await rename(f, t);
        stats.changed++;
      }
    }
  };
  await walk(".");
  return stats;
}

function kindOf(e: { isDirectory(): boolean; isSymbolicLink(): boolean }): "dir" | "link" | "file" {
  return e.isDirectory() ? "dir" : e.isSymbolicLink() ? "link" : "file";
}

function lstatOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

async function sameContent(a: string, b: string, symlink: boolean): Promise<boolean> {
  if (symlink) {
    try {
      return (await readlink(a)) === (await readlink(b));
    } catch {
      return false;
    }
  }
  const [sa, sb] = await Promise.all([lstat(a), lstat(b)]);
  // Mode too: a bump that only flips an execute bit must land.
  if (!sb.isFile() || sa.size !== sb.size || (sa.mode & 0o777) !== (sb.mode & 0o777)) return false;
  // Chunked compare, stopping at the first difference.
  const [fa, fb] = await Promise.all([open(a, "r"), open(b, "r")]);
  try {
    const ba = Buffer.allocUnsafe(256 * 1024);
    const bb = Buffer.allocUnsafe(256 * 1024);
    for (;;) {
      const [ra, rb] = await Promise.all([fa.read(ba, 0, ba.length, null), fb.read(bb, 0, bb.length, null)]);
      if (ra.bytesRead !== rb.bytesRead) return false;
      if (ra.bytesRead === 0) return true;
      if (!ba.subarray(0, ra.bytesRead).equals(bb.subarray(0, rb.bytesRead))) return false;
    }
  } finally {
    await Promise.all([fa.close(), fb.close()]);
  }
}

/**
 * A vendor/<name>/ holding a `.git` but no `.ref` is somebody's clone, not a
 * tree the build fetched (those never contain `.git`). Refuse to touch it —
 * the fetch would otherwise wipe it, local branches and all. vendor/WebKit is
 * the case that matters: it is where a full WebKit clone has always lived.
 */
export function assertManagedSource(name: string, srcDir: string, refStamp: string): void {
  if (existsSync(refStamp) || !existsSync(join(srcDir, ".git"))) return;
  throw new BuildError(`${srcDir} is a git clone, not a source tree fetched by the build; refusing to replace it`, {
    hint:
      name === "WebKit"
        ? `vendor/WebKit is where the build fetches the pinned WebKit sources now. Move your clone out of the ` +
          `repository (e.g. \`mv vendor/WebKit ../WebKit\`) and \`export BUN_WEBKIT_PATH=<that path>\` — every ` +
          `worktree can then share the one clone: \`bun run build:local\` builds it ` +
          `(--local-deps=WebKit=$BUN_WEBKIT_PATH), plain \`bun run build\` fetches the pinned commit here.`
        : `To build that clone, pass --local-deps=${name}=${srcDir}. To let the build fetch the pinned commit here instead, move or delete it.`,
  });
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Source identity: sha256(commit + sparse set + patch_contents)[:16]. This is
 * what goes in the .ref stamp. Hashing patch CONTENTS (not paths) means
 * editing a patch invalidates the source without a commit bump. An empty
 * sparse set contributes nothing, so whole-tree identities are just
 * sha256(commit + patch_contents).
 *
 * CRLF→LF normalized before hashing: git autocrlf may have converted
 * LF→CRLF on Windows checkout. Without normalization, the same patch
 * would produce different identities across platforms, triggering
 * spurious re-fetches (and worse: `git apply` rejects CRLF patches as
 * corrupt, so the re-fetch would fail). The normalized content is also
 * what applyPatch() pipes to git — one read, one normalization, used
 * for both hashing and applying.
 *
 * Exported so source.ts can compute the same identity at configure time
 * (for the preemptive-delete-on-mismatch check).
 */
export function computeSourceIdentity(commit: string, sparse: string[], patchContents: string[]): string {
  const h = createHash("sha256");
  h.update(commit);
  for (const pattern of sparse) {
    h.update("\0sparse\0");
    h.update(pattern);
  }
  for (const content of patchContents) {
    h.update("\0"); // Separator so patch concatenation can't produce collisions.
    h.update(normalizeLf(content));
  }
  return h.digest("hex").slice(0, 16);
}

/** CRLF→LF. Used for patch content before hashing and `git apply`. */
function normalizeLf(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

/**
 * Apply a patch via `git apply` over stdin.
 *
 * Normalizes CRLF→LF (same as the identity hash — see computeSourceIdentity)
 * so a CRLF-mangled checkout still applies cleanly. --no-index: dest/ is
 * not a git repo. --ignore-whitespace / --ignore-space-change: patches are
 * authored against upstream which may have different trailing whitespace.
 */
function applyPatch(dest: string, patchPath: string, patchBody: string): void {
  const result = spawnSync("git", ["apply", "--ignore-whitespace", "--ignore-space-change", "--no-index", "-"], {
    cwd: dest,
    input: normalizeLf(patchBody),
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
  });

  if (result.error) {
    throw new BuildError(`Failed to spawn git apply`, { cause: result.error });
  }

  if (result.status !== 0) {
    // Patches apply to a freshly extracted staging tree, so "already applied"
    // cannot happen; a failure here means the patch no longer matches the pin.
    throw new BuildError(`Patch failed: ${result.stderr}`, {
      file: patchPath,
      hint: "The patch may be out of date with the pinned commit",
    });
  }
}

// Only run if this file is the entry point (not imported as a module).
// fetch-cli.ts is ALSO imported by source.ts to get fetchCliPath —
// that import should NOT execute main(). No top-level await: it would mark
// this module HasTLA and force every importer (and the {config,webkit,flags,
// source} cycle) onto the async-evaluation path for code that's dead on
// import anyway.
if (process.argv[1] === import.meta.filename) {
  main().catch(err => {
    // Format BuildError nicely; rethrow anything else to bun's default
    // uncaught handler (gets a stack trace, which is what you want for bugs).
    if (err instanceof BuildError) {
      process.stderr.write(err.format());
      process.exit(1);
    }
    throw err;
  });
}
