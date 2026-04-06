// Measure stripped binary sizes for every release platform and compare them
// against (a) the latest finished `main` build ("canary") and (b) a pinned
// release baseline hardcoded below.
//
// Run by the `binary-size` step in .buildkite/ci.mjs after all *-build-bun
// jobs finish. Always posts an annotation with sizes and deltas. On PR builds
// it fails if any binary grew by more than --threshold-mb vs canary; on main
// it never fails (--no-fail) but still shows the comparison against the
// previous main build and the last release.
//
// Escape hatch: put `[skip size check]` in the commit message, which makes
// ci.mjs set soft_fail on this step (it still runs and annotates).
//
// Usage (invoked from ci.mjs — not meant to be run by hand):
//   bun scripts/binary-size.ts \
//     --targets '[{"triplet":"bun-darwin-aarch64"},...]' \
//     --threshold-mb 0.5 \
//     [--no-fail]

import { mkdirSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";

type Target = { triplet: string };
type Sizes = Record<string, number>;

const { values } = parseArgs({
  options: {
    targets: { type: "string" },
    "threshold-mb": { type: "string", default: "0.5" },
    "no-fail": { type: "boolean", default: false },
  },
});

const targets: Target[] = JSON.parse(values.targets!);
const thresholdBytes = parseFloat(values["threshold-mb"]!) * 1024 * 1024;
const noFail = values["no-fail"];

const org = process.env.BUILDKITE_ORGANIZATION_SLUG || "bun";
const pipeline = process.env.BUILDKITE_PIPELINE_SLUG || "bun";
const buildNumber = process.env.BUILDKITE_BUILD_NUMBER;
const branch = process.env.BUILDKITE_BRANCH;

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
  const v = agent(["meta-data", "get", `binary-size:${triplet}`, "--default", ""]);
  if (!v) {
    console.log(`  ${triplet}: not set (build may have failed), skipping`);
    continue;
  }
  sizes[triplet] = parseInt(v, 10);
  console.log(`  ${triplet.padEnd(30)} ${fmtBytes(sizes[triplet]).padStart(10)}`);
}

await Bun.write("binary-sizes.json", JSON.stringify({ build: buildNumber, branch, sizes }, null, 2));
agent(["artifact", "upload", "binary-sizes.json"]);

// ─── Baselines ───

type Baseline = { label: string; href?: string; sizes: Sizes };

const ghToken = (await getSecret("GITHUB_TOKEN")) ?? process.env.GITHUB_TOKEN;
const ghHeaders: Record<string, string> = ghToken ? { Authorization: `Bearer ${ghToken}` } : {};

async function githubJson<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/oven-sh/bun/${path}`, { headers: ghHeaders });
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

async function sizesFromBuild(n: number): Promise<Sizes | undefined> {
  const res = await fetch(`https://buildkite.com/${org}/${pipeline}/builds/${n}.json`);
  if (!res.ok) return;
  const { id } = (await res.json()) as { id: string };
  const dir = "binary-size-tmp";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ok = agent(["artifact", "download", "binary-sizes.json", dir, "--build", id], { quiet: true });
  if (ok === undefined) return;
  return ((await Bun.file(`${dir}/binary-sizes.json`).json()) as { sizes: Sizes }).sizes;
}

async function baselineFromCommit(sha: string, label: (n: number) => string): Promise<Baseline | undefined> {
  const n = await buildNumberForCommit(sha);
  if (!n || String(n) === String(buildNumber)) return;
  const sizes = await sizesFromBuild(n);
  if (!sizes) return;
  return { label: label(n), href: `https://buildkite.com/${org}/${pipeline}/builds/${n}`, sizes };
}

// Canary: walk recent main commits until one whose build has binary-sizes.json.
console.log("--- Fetching canary baseline");
let canaryNote = "";
const canary: Baseline | undefined = await (async () => {
  const commits = await githubJson<{ sha: string }[]>("commits?sha=main&per_page=15");
  for (const { sha } of commits) {
    const b = await baselineFromCommit(sha, n => `main #${n}`);
    if (b) return b;
  }
  canaryNote = "no recent main build has binary-sizes.json yet";
})().catch(e => ((canaryNote = String(e?.message || e)), undefined));
console.log(canary ? `  ${canary.label}` : `  unavailable: ${canaryNote}`);

// Release: latest bun-v* tag's commit. Falls back to the hardcoded table
// until a tagged commit's build carries binary-sizes.json.
const releaseFallback: Baseline = {
  label: "bun-v1.3.11",
  href: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.11",
  sizes: {
    "bun-darwin-aarch64": 61069216,
    "bun-darwin-x64": 66128448,
    "bun-linux-aarch64": 98736456,
    "bun-linux-x64": 99295408,
    "bun-linux-x64-baseline": 98451632,
    "bun-linux-aarch64-musl": 93164848,
    "bun-linux-x64-musl": 94162760,
    "bun-linux-x64-musl-baseline": 93626184,
    "bun-windows-x64": 115416576,
    "bun-windows-x64-baseline": 114743296,
    "bun-windows-aarch64": 112043008,
  },
};

async function fetchReleaseBaseline(): Promise<Baseline | undefined> {
  const out = Bun.spawnSync(["git", "ls-remote", "--tags", "--sort=-version:refname", "origin", "refs/tags/bun-v*"], {
    stderr: "inherit",
  })
    .stdout.toString()
    .split("\n")
    .find(l => l && !l.includes("^{}"));
  if (!out) return;
  const [sha, ref] = out.split("\t");
  const tag = ref.replace("refs/tags/", "");
  return baselineFromCommit(sha, n => `${tag} (#${n})`);
}

console.log("--- Fetching release baseline");
const release: Baseline = (await fetchReleaseBaseline().catch(() => undefined)) ?? releaseFallback;
console.log(`  ${release.label}`);

// ─── Compare & annotate ───

console.log("--- Results");

type Delta = { base: number; bytes: number };
type Row = { triplet: string; now: number; canary?: Delta; release?: Delta };

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
    canary: delta(sizes[triplet], canary?.sizes[triplet]),
    release: delta(sizes[triplet], release.sizes[triplet]),
  }));

const overThreshold = rows.filter(r => r.canary && r.canary.bytes > thresholdBytes);
const failed = !noFail && overThreshold.length > 0;

const link = (b: Baseline | undefined, fallback: string) =>
  b?.href ? `<a href="${b.href}">${b.label}</a>` : (b?.label ?? `${fallback} (n/a)`);

const deltaCells = (d: Delta | undefined, over: boolean) => {
  if (!d) return `<td align="right">—</td><td align="right">—</td>`;
  return (
    `<td align="right">${fmtBytes(d.base)}</td>` +
    `<td align="right">${over ? "<b>" : ""}${fmtDelta(d.bytes)}${over ? "</b>" : ""}</td>`
  );
};

const tableRows = rows
  .map(r => {
    const over = !!r.canary && r.canary.bytes > thresholdBytes;
    return (
      `<tr><td>${over ? "❌ " : ""}<code>${r.triplet}</code></td>` +
      `<td align="right">${fmtBytes(r.now)}</td>` +
      deltaCells(r.canary, over) +
      deltaCells(r.release, false) +
      `</tr>`
    );
  })
  .join("\n");

const limit = fmtDelta(thresholdBytes);
const header =
  overThreshold.length > 0
    ? `<b>${overThreshold.length}</b> over ${limit}`
    : canary
      ? `all within ${limit}`
      : `no canary comparison (${canaryNote})`;

const annotation = `
<details${failed ? " open" : ""}>
<summary>📦 Binary size — ${header}</summary>
<table>
<tr>
  <th rowspan="2">target</th><th rowspan="2">this build</th>
  <th colspan="2">canary: ${link(canary, "main")}</th>
  <th colspan="2">release: ${link(release, "latest")}</th>
</tr>
<tr><th>size</th><th>Δ</th><th>size</th><th>Δ</th></tr>
${tableRows}
</table>
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
  { stdin: new Blob([annotation]) },
);

for (const r of rows) {
  const c = r.canary ? `  canary ${fmtDelta(r.canary.bytes).padStart(10)}` : "";
  const rel = r.release ? `  release ${fmtDelta(r.release.bytes).padStart(10)}` : "";
  console.log(`  ${r.triplet.padEnd(30)} ${fmtBytes(r.now).padStart(10)}${c}${rel}`);
}

if (failed) {
  console.error(`\nerror: ${overThreshold.length} target(s) exceeded ${limit} vs canary`);
  process.exit(1);
}

// ─── helpers ───

function fmtBytes(n: number): string {
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function fmtDelta(n: number): string {
  return `${n >= 0 ? "+" : "-"}${(Math.abs(n) / 1024 / 1024).toFixed(2)} MB`;
}
