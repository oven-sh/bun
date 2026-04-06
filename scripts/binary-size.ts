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

function agent(args: string[]): string | undefined {
  const { exitCode, stdout } = Bun.spawnSync(["buildkite-agent", ...args], { stderr: "inherit" });
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

const bkToken = (await getSecret("BUILDKITE_API_TOKEN")) ?? process.env.BUILDKITE_API_TOKEN;
const api = `https://api.buildkite.com/v2/organizations/${org}/pipelines/${pipeline}`;
const bkHeaders = { Authorization: `Bearer ${bkToken}` };

async function findSizesArtifact(query: string, label: (n: number) => string): Promise<Baseline | undefined> {
  if (!bkToken) throw new Error("no BUILDKITE_API_TOKEN secret available");
  const builds = await fetch(`${api}/builds?${query}`, { headers: bkHeaders });
  if (!builds.ok) throw new Error(`builds API returned ${builds.status}`);
  for (const b of (await builds.json()) as { number: number }[]) {
    if (String(b.number) === String(buildNumber)) continue;
    const arts = await fetch(`${api}/builds/${b.number}/artifacts?per_page=100`, { headers: bkHeaders });
    if (!arts.ok) continue;
    const hit = ((await arts.json()) as { filename: string; download_url: string }[]).find(
      a => a.filename === "binary-sizes.json",
    );
    if (!hit) continue;
    const dl = await fetch(hit.download_url, { headers: bkHeaders, redirect: "follow" });
    if (!dl.ok) continue;
    const json = (await dl.json()) as { sizes: Sizes };
    return {
      label: label(b.number),
      href: `https://buildkite.com/${org}/${pipeline}/builds/${b.number}`,
      sizes: json.sizes,
    };
  }
}

// Canary: latest finished main build with a binary-sizes.json artifact.
console.log("--- Fetching canary baseline");
let canaryNote = "";
const canary: Baseline | undefined = await findSizesArtifact(
  "branch=main&state[]=passed&state[]=failed&per_page=10",
  n => `main #${n}`,
).catch(e => ((canaryNote = String(e?.message || e)), undefined));
if (!canary && !canaryNote) canaryNote = "no recent main build has binary-sizes.json yet";
console.log(canary ? `  ${canary.label}` : `  unavailable: ${canaryNote}`);

// Release: resolve the latest bun-v* tag to its commit, then find that
// commit's build. Falls back to the hardcoded table until a tagged release's
// build carries binary-sizes.json.
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
  return findSizesArtifact(`commit=${sha}&branch=main&per_page=5`, n => `${tag} (#${n})`);
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
