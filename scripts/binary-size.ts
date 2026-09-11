// Measure stripped binary sizes for every release platform and compare them
// against the newest `main` build that recorded its own ("canary").
//
// CI mode (invoked from .buildkite/ci.mjs after all *-build-bun jobs finish):
//   bun scripts/binary-size.ts \
//     --targets '[{"triplet":"bun-darwin-aarch64"},...]' \
//     --threshold-mb 0.5 \
//     [--no-fail] [--release]
//
//   Always posts an annotation with sizes and deltas. On PR builds it fails if
//   any binary grew by more than --threshold-mb vs canary, and also if no
//   canary baseline could be found: this step is the only size gate, so a run
//   that compared nothing must not pass as if it had. On main it never fails
//   (--no-fail) but still shows the comparison against the previous main
//   build. Escape hatch: put `[skip size check]` in the commit message, which
//   makes ci.mjs set soft_fail on this step (it still runs and annotates).
//
//   The baseline comes from Buildkite alone: the pipeline's public build list
//   names the recent main builds, and buildkite-agent downloads the
//   binary-sizes.json this step uploaded on the newest usable one. (It used to
//   map main commits to builds through the GitHub API; CI shares that token,
//   and every time it was rate limited this step had nothing to compare
//   against and passed anyway.)
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
// https://buildkite.com/<org>/<pipeline>/builds/<n> -> https://buildkite.com/<org>/<pipeline>
const pipelineUrl =
  process.env.BUILDKITE_BUILD_URL?.replace(/\/builds\/.*$/, "") || `https://buildkite.com/${org}/${pipeline}`;

function agent(args: string[], opts: { quiet?: boolean } = {}): string | undefined {
  const { exitCode, stdout } = Bun.spawnSync(["buildkite-agent", ...args], {
    stderr: opts.quiet ? "ignore" : "inherit",
  });
  return exitCode === 0 ? stdout.toString().trim() : undefined;
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

// ─── Baseline: the newest main build with a usable binary-sizes.json ───

type Baseline = { label: string; href: string; sizes: Sizes };

// A main build superseded by the next push is canceled before its build-bun
// jobs finish and records nothing; merge bursts produce 20+ such builds in a
// row, so look well past one page of the build list. Without credentials the
// list ends after page 4 (80 builds; HTTP 403 beyond that).
const MAX_MAIN_BUILDS_TO_TRY = 60;

// Numbers of the recent main builds, newest first, from the pipeline's public
// build list (HTML, 20 builds per page, no credentials). Ends after the last
// page, or sooner if the list stops linking to builds.
async function* recentMainBuilds(): AsyncGenerator<number> {
  const buildLink = new RegExp(`${RegExp.escape(new URL(pipelineUrl).pathname)}/builds/(\\d+)`, "g");
  const seen = new Set<number>();
  for (let page = 1; ; page++) {
    const url = `${pipelineUrl}/builds?branch=main&page=${page}`;
    const res = await fetch(url, { headers: { Accept: "text/html" } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const linked = Array.from((await res.text()).matchAll(buildLink), m => parseInt(m[1], 10));
    const numbers = [...new Set(linked)].filter(n => !seen.has(n));
    if (numbers.length === 0) return;
    for (const n of numbers) seen.add(n);
    yield* numbers.sort((a, b) => b - a);
  }
}

// The sizes this step recorded on main build `n`, or undefined (with the reason
// logged) if that build has nothing this build can be compared against.
async function baselineSizes(n: number): Promise<Sizes | undefined> {
  const skip = (why: string) => {
    console.log(`  main #${n} ${why}`);
    return undefined;
  };
  const res = await fetch(`${pipelineUrl}/builds/${n}.json`);
  if (!res.ok) return skip(`could not be read: HTTP ${res.status}`);
  const { id, branch_name } = (await res.json()) as { id: string; branch_name?: string };
  // The list was filtered by branch; this only matters if its markup changes.
  if (branch_name !== "main") return skip(`is not a main build (branch: ${branch_name})`);
  const dir = "binary-size-tmp";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (agent(["artifact", "download", "binary-sizes.json", dir, "--build", id], { quiet: true }) === undefined) {
    return skip("has no binary-sizes.json (its binary-size step did not run)");
  }
  const record = (await Bun.file(`${dir}/binary-sizes.json`).json()) as { sizes?: Sizes; release?: boolean };
  // Only compare like-for-like: canary builds against canary baselines, release
  // against release. Windows binaries differ by several MB between the two, so
  // a release build on main would otherwise trip every PR's threshold.
  if ((record.release ?? false) !== isRelease) return skip(`is a ${record.release ? "release" : "canary"} build`);
  // An all-targets build failure on main uploads a record with no sizes;
  // comparing against it would compare nothing.
  if (!targets.some(({ triplet }) => record.sizes?.[triplet])) return skip("recorded no sizes for these targets");
  return record.sizes;
}

console.log(`--- Looking for the newest main build with ${buildKind} sizes`);
let baseline: Baseline | undefined;
let baselineNote = "";
try {
  let unusable = 0;
  for await (const n of recentMainBuilds()) {
    if (String(n) === buildNumber) continue;
    const sizes = await baselineSizes(n);
    if (sizes) {
      baseline = { label: `main #${n}`, href: `${pipelineUrl}/builds/${n}`, sizes };
      break;
    }
    if (++unusable === MAX_MAIN_BUILDS_TO_TRY) break;
  }
  if (!baseline) {
    baselineNote =
      unusable === 0
        ? `no main builds listed at ${pipelineUrl}/builds?branch=main`
        : `the last ${unusable} main build(s) recorded no ${buildKind} sizes`;
  }
} catch (e: any) {
  baselineNote = String(e?.message || e);
}
console.log(baseline ? `  ${baseline.label}: ${baseline.href}` : `  none: ${baselineNote}`);

// ─── Compare & annotate ───

console.log("--- Results");

type Delta = { base: number; bytes: number };
type Row = { triplet: string; now: number; delta?: Delta };

function delta(now: number, base: number | undefined): Delta | undefined {
  if (!base) return undefined;
  return { base, bytes: now - base };
}

// Preserve --targets order (buildPlatforms in ci.mjs) so OS families stay grouped.
const rows: Row[] = targets
  .filter(t => sizes[t.triplet] !== undefined)
  .map(({ triplet }) => ({
    triplet,
    now: sizes[triplet],
    delta: delta(sizes[triplet], baseline?.sizes[triplet]),
  }));

const overThreshold = rows.filter(r => r.delta && r.delta.bytes > thresholdBytes);
// Built binaries with nothing to compare them against fail the step (see the
// header comment), with two exceptions: a release baseline only exists for a
// while after a release ran on main, and a build that produced no binaries is
// already red from its build-bun jobs.
const blind = !baseline && rows.length > 0 && !isRelease;
const failed = !noFail && (overThreshold.length > 0 || blind);

const deltaCells = (d: Delta | undefined, over: boolean) => {
  if (!d) return `<td align="right">—</td><td align="right">—</td>`;
  return (
    `<td align="right">${fmtBytes(d.base)}</td>` +
    `<td align="right">${over ? "<b>" : ""}${fmtDelta(d.bytes)}${over ? "</b>" : ""}</td>`
  );
};

const tableRows = rows
  .map(r => {
    const over = !!r.delta && r.delta.bytes > thresholdBytes;
    return (
      `<tr><td>${over ? "❌ " : ""}<code>${r.triplet}</code></td>` +
      `<td align="right">${fmtBytes(r.now)}</td>` +
      deltaCells(r.delta, over) +
      `</tr>`
    );
  })
  .join("\n");

const limit = fmtBytes(thresholdBytes);
const header =
  overThreshold.length > 0
    ? `<b>${overThreshold.length}</b> over ${limit}`
    : rows.length === 0
      ? "nothing to measure, no build-bun job recorded a size"
      : baseline
        ? `all within ${limit}`
        : `no ${buildKind} baseline, nothing compared (${Bun.escapeHTML(baselineNote)})`;
const style = failed ? "error" : baseline && rows.length > 0 ? "info" : "warning";

const advice = !failed
  ? ""
  : blind
    ? `<p>This step fails rather than pass without comparing anything. Retry it if buildkite.com was unavailable; ` +
      `otherwise its log lists the main builds it tried.</p>`
    : `<p>Add <code>[skip size check]</code> to the commit message if this increase is intentional.</p>`;

const annotation = `
<details${failed ? " open" : ""}>
<summary>📦 Binary size — ${header}</summary>
<table>
<tr>
  <th rowspan="2">target</th><th rowspan="2">this build</th>
  <th colspan="2">${buildKind}: ${baseline ? `<a href="${baseline.href}">${baseline.label}</a>` : "main (n/a)"}</th>
</tr>
<tr><th>size</th><th>Δ</th></tr>
${tableRows}
</table>
${advice}
</details>`;

Bun.spawnSync(
  ["buildkite-agent", "annotate", "--style", style, "--context", "binary-size", "--priority", failed ? "5" : "2"],
  { stdin: new Blob([annotation]), stderr: "inherit" },
);

for (const r of rows) {
  const c = r.delta ? `  ${buildKind} ${fmtDelta(r.delta.bytes).padStart(10)}` : "";
  console.log(`  ${r.triplet.padEnd(30)} ${fmtBytes(r.now).padStart(10)}${c}`);
}

if (failed) {
  console.error(
    blind
      ? `\nerror: nothing to compare against: ${baselineNote}`
      : `\nerror: ${overThreshold.length} target(s) exceeded ${limit} vs ${buildKind}`,
  );
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
