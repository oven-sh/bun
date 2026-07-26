// Measure stripped binary sizes for every release platform and compare them
// against the latest finished `main` build ("canary").
//
// CI mode (invoked from .buildkite/ci.mjs after all *-build-bun jobs finish):
//   bun scripts/binary-size.ts \
//     --targets '[{"triplet":"bun-darwin-aarch64"},...]' \
//     --threshold-mb 0.5 \
//     [--no-fail] [--release]
//
//   Always posts an annotation with sizes and deltas. On PR builds it fails if
//   any binary grew by more than --threshold-mb vs canary; on main it never
//   fails (--no-fail) but still shows the comparison against the previous main
//   build. Escape hatch: put `[skip size check]` in the commit message, which
//   makes ci.mjs set soft_fail on this step (it still runs and annotates).
//
// Local mode (no args):
//   bun scripts/binary-size.ts
//
//   Compares the current `canary` GitHub release against the latest tagged
//   release by reading uncompressed binary sizes straight from each zip's
//   central directory (Range request — no full download, no BuildKite access).

import { mkdirSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
// @ts-ignore — utils.mjs has JSDoc types but no .d.ts
import { markBuildkiteStepReported } from "./utils.mjs";

type Target = { triplet: string };
type Sizes = Record<string, number>;

const { values } = parseArgs({
  options: {
    targets: { type: "string" },
    "threshold-mb": { type: "string", default: "0.5" },
    "no-fail": { type: "boolean", default: false },
    release: { type: "boolean", default: false },
  },
});

if (!values.targets) {
  await compareGithubReleases();
  process.exit(0);
}

const targets: Target[] = JSON.parse(values.targets!);
const thresholdBytes = parseFloat(values["threshold-mb"]!) * 1024 * 1024;
const noFail = values["no-fail"];
const isRelease = values.release;
const buildKind = isRelease ? "release" : "canary";

const org = process.env.BUILDKITE_ORGANIZATION_SLUG || "bun";
const pipeline = process.env.BUILDKITE_PIPELINE_SLUG || "bun";
const buildNumber = process.env.BUILDKITE_BUILD_NUMBER;
const branch = process.env.BUILDKITE_BRANCH;
const commit = process.env.BUILDKITE_COMMIT;
const baseBranch = process.env.BUILDKITE_PULL_REQUEST_BASE_BRANCH || "main";

function agent(args: string[], opts: { quiet?: boolean } = {}): string | undefined {
  const { exitCode, stdout } = Bun.spawnSync(["buildkite-agent", ...args], {
    stderr: opts.quiet ? "ignore" : "inherit",
  });
  return exitCode === 0 ? stdout.toString().trim() : undefined;
}

async function getSecret(name: string): Promise<string | undefined> {
  const { exitCode, stdout } = Bun.spawnSync(["buildkite-agent", "secret", "get", name], { stderr: "ignore" });
  if (exitCode !== 0) return undefined;
  return stdout.toString().trim() || undefined;
}

// ─── Collect current build's sizes from meta-data ───
// Each *-build-bun job sets `binary-size:<triplet>` after stripping
// (scripts/build/ci.ts).

console.log("--- Reading sizes from build meta-data");
const sizes: Sizes = {};
for (const { triplet } of targets) {
  const v = agent(["meta-data", "get", `binary-size:${triplet}`], { quiet: true });
  if (!v) {
    console.log(`  ${triplet}: not set (build may have failed), skipping`);
    continue;
  }
  sizes[triplet] = parseInt(v, 10);
  console.log(`  ${triplet.padEnd(30)} ${fmtBytes(sizes[triplet]).padStart(10)}`);
}

await Bun.write(
  "binary-sizes.json",
  JSON.stringify({ build: buildNumber, branch, release: isRelease, sizes }, null, 2),
);
agent(["artifact", "upload", "binary-sizes.json"]);

// ─── Baselines ───

type Baseline = {
  label: string;
  href?: string;
  sizes: Sizes;
  // Triplets whose size came from a build older than the walk's starting
  // commit (the PR's merge-base). Their delta includes growth from main
  // commits this PR already contains, so it is shown but never enforced.
  stale: Set<string>;
  // Per-triplet source build number, for the annotation.
  from: Record<string, number>;
};

const ghToken = (await getSecret("GITHUB_TOKEN")) ?? process.env.GITHUB_TOKEN;
const ghHeaders: Record<string, string> = ghToken ? { Authorization: `Bearer ${ghToken}` } : {};
// Overridable for test/internal/binary-size-baseline.test.ts.
const ghApi = process.env.BINARY_SIZE_GITHUB_API || "https://api.github.com";
const bkWeb = process.env.BINARY_SIZE_BUILDKITE_WEB || "https://buildkite.com";

async function githubJson<T>(path: string): Promise<T> {
  const res = await fetch(`${ghApi}/repos/oven-sh/bun/${path}`, { headers: ghHeaders });
  if (!res.ok) throw new Error(`github ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function buildNumberForCommit(sha: string): Promise<number | undefined> {
  const { statuses } = await githubJson<{ statuses: { context: string; target_url: string }[] }>(
    `commits/${sha}/status`,
  );
  const bk = statuses.find(s => s.context.startsWith("buildkite/"));
  const m = bk?.target_url.match(/\/builds\/(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
}

async function sizesFromBuild(n: number, want: string[]): Promise<{ sizes: Sizes; release?: boolean } | undefined> {
  const res = await fetch(`${bkWeb}/${org}/${pipeline}/builds/${n}.json`);
  if (!res.ok) return;
  const { id, message, source } = (await res.json()) as { id: string; message?: string; source?: string };
  // Fast path: the binary-size step on this build ran and uploaded a complete
  // snapshot (with the canary/release flag).
  const dir = "binary-size-tmp";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ok = agent(["artifact", "download", "binary-sizes.json", dir, "--build", id], { quiet: true });
  if (ok !== undefined) {
    return (await Bun.file(`${dir}/binary-sizes.json`).json()) as { sizes: Sizes; release?: boolean };
  }
  // Fallback: the aggregator step never ran (a build-bun dep was canceled or
  // timed out, which Buildkite does not treat as a "failure" that
  // allow_dependency_failure recovers from). Each *-build-bun job that DID
  // finish still set its own binary-size:<triplet> meta-data; read those
  // directly.
  //
  // The meta-data itself carries no canary/release distinction, so this
  // fallback is restricted to builds we are confident are canary:
  //   - the current build is canary (the normal PR path); and
  //   - the baseline build is webhook-triggered and its commit message carries
  //     no [release] tag (ci.mjs's commit-message signal). Real Bun releases
  //     are manual (source:"ui") triggers with RELEASE=1 in the environment;
  //     the commit message alone does not identify them.
  // Builds that fail either check return undefined, so the caller claims the
  // anchor without sizes and everything older is treated as stale (never a
  // false positive).
  if (isRelease) return;
  if ((source && source !== "webhook") || /\[(release|build release|release build)\]/i.test(message ?? "")) return;
  const sizes: Sizes = {};
  for (const triplet of want) {
    const v = agent(["meta-data", "get", `binary-size:${triplet}`, "--build", id], { quiet: true });
    const bytes = v ? parseInt(v, 10) : NaN;
    if (Number.isFinite(bytes)) sizes[triplet] = bytes;
  }
  return Object.keys(sizes).length > 0 ? { sizes } : undefined;
}

// Canary: walk main commits starting at this PR's merge-base (so the delta is
// the PR's own contribution, not main's growth since an older baseline). For
// each triplet we take the first size we see; triplets that only resolve from
// a build older than the merge-base are marked stale and are not enforced.
console.log(`--- Fetching ${buildKind} baseline`);
let canaryNote = "";
const canary: Baseline | undefined = await (async () => {
  let walkFrom = baseBranch;
  if (commit && branch !== baseBranch) {
    const cmp = await githubJson<{ merge_base_commit?: { sha: string } }>(
      `compare/${encodeURIComponent(baseBranch)}...${commit}`,
    ).catch(() => undefined);
    if (cmp?.merge_base_commit?.sha) walkFrom = cmp.merge_base_commit.sha;
  }
  const commits = await githubJson<{ sha: string }[]>(`commits?sha=${encodeURIComponent(walkFrom)}&per_page=30`);
  const want = new Set(Object.keys(sizes));
  const acc: Sizes = {};
  const from: Record<string, number> = {};
  const stale = new Set<string>();
  // The anchor is the first like-for-like build we consult (the merge-base for
  // PRs, the previous main commit for main builds). A triplet whose size came
  // from an older build is stale: its delta folds in main commits this build
  // already contains, so we show it but never fail on it.
  let anchor: number | undefined;
  for (const { sha } of commits) {
    if (want.size === 0) break;
    const n = await buildNumberForCommit(sha);
    if (!n || String(n) === String(buildNumber)) continue;
    const record = await sizesFromBuild(n, [...want]);
    if (!record) {
      // This commit had no usable sizes at all (every build-bun job canceled).
      // It may carry real growth, so claim the anchor here: anything older is
      // stale and won't be blamed on this PR.
      anchor ??= n;
      continue;
    }
    // Only compare like-for-like: canary builds against canary baselines,
    // release against release. Windows binaries differ by several MB between
    // the two. A mismatched-kind build (e.g. [release] merge-base for a canary
    // PR) is skipped without claiming the anchor: a release-tag commit does not
    // itself change canary-mode sizes, so the next canary build back is still a
    // fair anchor to enforce against.
    if ((record.release ?? false) !== isRelease) continue;
    anchor ??= n;
    for (const t of want) {
      const s = record.sizes[t];
      if (s === undefined) continue;
      acc[t] = s;
      from[t] = n;
      if (n !== anchor) stale.add(t);
      want.delete(t);
    }
  }
  if (anchor === undefined || Object.keys(acc).length === 0) {
    canaryNote = `no recent ${baseBranch} ${buildKind} build has binary sizes yet`;
    return;
  }
  return {
    label: `${baseBranch} #${anchor}`,
    href: `https://buildkite.com/${org}/${pipeline}/builds/${anchor}`,
    sizes: acc,
    stale,
    from,
  };
})().catch(e => ((canaryNote = String(e?.message || e)), undefined));
console.log(canary ? `  ${canary.label}` : `  unavailable: ${canaryNote}`);

// ─── Compare & annotate ───

console.log("--- Results");

type Delta = { base: number; bytes: number; from?: number; stale: boolean };
type Row = { triplet: string; now: number; canary?: Delta };

function delta(now: number, triplet: string): Delta | undefined {
  const base = canary?.sizes[triplet];
  if (!base) return undefined;
  return { base, bytes: now - base, from: canary?.from[triplet], stale: canary?.stale.has(triplet) ?? false };
}

// Preserve --targets order (buildPlatforms in ci.mjs) so OS families stay grouped.
const rows: Row[] = targets
  .filter(t => sizes[t.triplet] !== undefined)
  .map(({ triplet }) => ({
    triplet,
    now: sizes[triplet],
    canary: delta(sizes[triplet], triplet),
  }));

// Stale rows (baseline older than this PR's merge-base) are annotated but never
// enforced: that delta includes main's growth, not just this PR's.
const overThreshold = rows.filter(r => r.canary && !r.canary.stale && r.canary.bytes > thresholdBytes);
const staleOver = rows.filter(r => r.canary?.stale && r.canary.bytes > thresholdBytes);
const failed = !noFail && overThreshold.length > 0;

const link = (b: Baseline | undefined, fallback: string) =>
  b?.href ? `<a href="${b.href}">${b.label}</a>` : (b?.label ?? `${fallback} (n/a)`);

const buildLink = (n: number) => `<a href="https://buildkite.com/${org}/${pipeline}/builds/${n}">#${n}</a>`;

const deltaCells = (d: Delta | undefined, over: boolean) => {
  if (!d) return `<td align="right">—</td><td align="right">—</td>`;
  const note = d.stale ? ` <sup>${buildLink(d.from!)}</sup>` : "";
  return (
    `<td align="right">${fmtBytes(d.base)}${note}</td>` +
    `<td align="right">${over ? "<b>" : ""}${fmtDelta(d.bytes)}${over ? "</b>" : ""}</td>`
  );
};

const tableRows = rows
  .map(r => {
    const over = !!r.canary && r.canary.bytes > thresholdBytes;
    const mark = over ? (r.canary!.stale ? "⚠️ " : "❌ ") : "";
    return (
      `<tr><td>${mark}<code>${r.triplet}</code></td>` +
      `<td align="right">${fmtBytes(r.now)}</td>` +
      deltaCells(r.canary, over) +
      `</tr>`
    );
  })
  .join("\n");

const limit = fmtBytes(thresholdBytes);
const header =
  overThreshold.length > 0
    ? `<b>${overThreshold.length}</b> over ${limit}`
    : canary
      ? `all within ${limit}${staleOver.length ? ` (${staleOver.length} stale ignored)` : ""}`
      : `no ${buildKind} comparison (${canaryNote})`;

const staleNote =
  canary && canary.stale.size > 0
    ? `<p>⚠️ ${canary.stale.size} target(s) had no size recorded for the merge-base build ` +
      `${link(canary, baseBranch)}; their Δ is against the older build linked in the size column ` +
      `and includes ${baseBranch}'s own growth, so it is not enforced.</p>`
    : "";

const annotation = `
<details${failed ? " open" : ""}>
<summary>📦 Binary size — ${header}</summary>
<table>
<tr>
  <th rowspan="2">target</th><th rowspan="2">this build</th>
  <th colspan="2">${buildKind}: ${link(canary, baseBranch)}</th>
</tr>
<tr><th>size</th><th>Δ</th></tr>
${tableRows}
</table>
${staleNote}
${failed ? `<p>Add <code>[skip size check]</code> to the commit message if this increase is intentional.</p>` : ""}
</details>`;

Bun.spawnSync(
  [
    "buildkite-agent",
    "annotate",
    "--style",
    failed ? "error" : "info",
    "--context",
    "binary-size",
    "--priority",
    failed ? "5" : "2",
  ],
  { stdin: new Blob([annotation]), stderr: "inherit" },
);

for (const r of rows) {
  const c = r.canary
    ? `  ${buildKind} ${fmtDelta(r.canary.bytes).padStart(10)}` + (r.canary.stale ? `  (stale: #${r.canary.from})` : "")
    : "";
  console.log(`  ${r.triplet.padEnd(30)} ${fmtBytes(r.now).padStart(10)}${c}`);
}

if (failed) {
  console.error(`\nerror: ${overThreshold.length} target(s) exceeded ${limit} vs ${buildKind}`);
  // Suppress the generic fallback in .buildkite/hooks/pre-exit; this script
  // owns its failure annotation.
  markBuildkiteStepReported();
  process.exit(1);
}

// ─── helpers ───

function fmtBytes(n: number): string {
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function fmtDelta(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  const abs = Math.abs(n);
  return abs >= 1024 * 1024 ? `${sign}${(abs / 1024 / 1024).toFixed(2)} MB` : `${sign}${(abs / 1024).toFixed(1)} KB`;
}

// ─── local mode: canary vs latest tagged release ───

type GithubRelease = { tag_name: string; assets: { name: string; browser_download_url: string }[] };

async function compareGithubReleases() {
  const auth = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : undefined;
  const gh = (p: string) =>
    fetch(`https://api.github.com/repos/oven-sh/bun/${p}`, { headers: auth }).then(r => {
      if (!r.ok) throw new Error(`github ${p}: ${r.status} ${r.statusText}`);
      return r.json() as Promise<GithubRelease>;
    });

  const [latest, canary] = await Promise.all([gh("releases/latest"), gh("releases/tags/canary")]);

  // The release zips we care about are the stripped runtime binaries:
  // bun-<os>-<arch>[-musl][-baseline].zip. Skip -profile (unstripped) and
  // anything that isn't a single-binary zip.
  const isBinaryZip = (n: string) => /^bun-[a-z0-9-]+\.zip$/.test(n) && !n.includes("-profile");
  const assetMap = (r: GithubRelease) =>
    new Map(r.assets.filter(a => isBinaryZip(a.name)).map(a => [a.name.replace(/\.zip$/, ""), a.browser_download_url]));

  const latestAssets = assetMap(latest);
  const canaryAssets = assetMap(canary);
  const triplets = [...latestAssets.keys()].filter(t => canaryAssets.has(t)).sort();

  process.stderr.write(`Reading ${triplets.length} zips from each of ${latest.tag_name} and canary…\n`);
  const [latestSizes, canarySizes] = await Promise.all([
    sizesFromZips(triplets, latestAssets),
    sizesFromZips(triplets, canaryAssets),
  ]);

  const w = Math.max(...triplets.map(t => t.length));
  console.log(
    `\n${"target".padEnd(w)}  ${latest.tag_name.padStart(11)}  ${"canary".padStart(11)}  ${"Δ".padStart(11)}`,
  );
  console.log("─".repeat(w + 39));
  let dTotal = 0;
  for (const t of triplets) {
    const a = latestSizes[t];
    const b = canarySizes[t];
    const d = b - a;
    dTotal += d;
    console.log(
      `${t.padEnd(w)}  ${fmtBytes(a).padStart(11)}  ${fmtBytes(b).padStart(11)}  ${fmtDelta(d).padStart(11)}`,
    );
  }
  console.log("─".repeat(w + 39));
  console.log(`${"average".padEnd(w)}  ${" ".repeat(24)}  ${fmtDelta(dTotal / triplets.length).padStart(11)}`);
}

async function sizesFromZips(triplets: string[], urls: Map<string, string>): Promise<Sizes> {
  const out: Sizes = {};
  await Promise.all(
    triplets.map(async t => {
      out[t] = await zipBinarySize(urls.get(t)!);
    }),
  );
  return out;
}

// Read the uncompressed size of the binary inside a release zip without
// downloading the whole archive. The central directory + EOCD live at the end
// of the file; a 64 KB Range request is more than enough for our two-entry
// (`<triplet>/` + `<triplet>/bun[.exe]`) zips.
async function zipBinarySize(url: string): Promise<number> {
  const head = await fetch(url, { method: "HEAD" });
  if (!head.ok) throw new Error(`HEAD ${url}: ${head.status}`);
  const total = Number(head.headers.get("content-length"));
  const tail = Math.min(65536, total);
  const res = await fetch(url, { headers: { Range: `bytes=${total - tail}-${total - 1}` } });
  if (!res.ok) throw new Error(`Range ${url}: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`no zip EOCD in ${url}`);

  let p = dv.getUint32(eocd + 16, true) - (total - tail);
  if (p < 0) throw new Error(`zip central directory not within tail for ${url}`);

  let size = 0;
  while (p + 46 <= eocd && dv.getUint32(p, true) === 0x02014b50) {
    const uncompressed = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    // The binary is the only non-directory entry; take the largest in case the
    // zip ever grows extra metadata files.
    if (!name.endsWith("/") && uncompressed > size) size = uncompressed;
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  if (size === 0) throw new Error(`no file entry in ${url}`);
  return size;
}
