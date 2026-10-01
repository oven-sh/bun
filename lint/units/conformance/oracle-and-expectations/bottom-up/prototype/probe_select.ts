// Research probe: the selection on a clone of the reference and on a simulated overlay, over the enumeration vectors.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { type Kind, type Suite, diffFixupOld, errorBaselineName, loadOracleSources, selectOracle } from "./baseline";
const GO = "/workspace/ref/typescript-go/testdata";
const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const rows = gunzipSync(readFileSync(import.meta.dir + "/../../../enumerator/vectors/instances.tsv.gz")).toString("utf8").split("\n").slice(1).filter(l => l !== "").map(l => { const f = l.split("\t"); return { name: f[0], suite: f[1] as Suite, casePath: f[2], status: f[4], kind: f[6] }; });
const run = rows.filter(r => r.status === "run");

// simulated overlay
const overlay = (process.argv[2] ?? "/tmp/oe-research") + "/corpus";
rmSync(overlay, { recursive: true, force: true });
let copied = 0;
const derived: string[] = [];
for (const suite of ["compiler", "conformance"] as const) {
  mkdirSync(`${overlay}/tsgo/${suite}`, { recursive: true });
  for (const f of readdirSync(`${GO}/baselines/reference/submodule/${suite}`)) {
    if (!f.endsWith(".errors.txt")) continue;
    const a = readFileSync(`${GO}/baselines/reference/submodule/${suite}/${f}`);
    const tsPath = `${TS}/${f}`;
    if (!existsSync(tsPath) || !a.equals(readFileSync(tsPath))) { writeFileSync(`${overlay}/tsgo/${suite}/${f}`, a); copied++; }
  }
  for (const root of ["submodule", "submoduleAccepted", "submoduleTriaged"]) {
    const dir = `${GO}/baselines/reference/${root}/${suite}`;
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".errors.txt.diff")) continue;
      const stem = f.slice(0, -".diff".length);
      if (!existsSync(`${GO}/baselines/reference/submodule/${suite}/${stem}`)) derived.push(`${suite}/${stem}`);
    }
  }
}
derived.sort();
writeFileSync(`${overlay}/tsgo.expects-no-errors.txt`, "# Baselines that typescript-go did not write although TypeScript has the file.\n" + derived.join("\n") + "\n");
console.log("overlay files", copied, "derived names", derived.length);

const complete = loadOracleSources({ tsBaselines: TS, tsgoBaselines: `${GO}/baselines/reference/submodule`, tsgoComplete: true, expectsNoErrors: undefined, accepted: `${GO}/submoduleAccepted.txt`, triaged: `${GO}/submoduleTriaged.txt` });
const corpus = loadOracleSources({ tsBaselines: TS, tsgoBaselines: `${overlay}/tsgo`, tsgoComplete: false, expectsNoErrors: `${overlay}/tsgo.expects-no-errors.txt`, accepted: `${GO}/submoduleAccepted.txt`, triaged: `${GO}/submoduleTriaged.txt` });
console.log("accepted set", complete.accepted.size, "triaged set", complete.triaged.size);

const count: Record<string, number> = {};
const bump = (k: string) => (count[k] = (count[k] ?? 0) + 1);
let disagree = 0, withVector = 0;
const literal = { E: 0, C: 0 };
const literalBySuite: Record<string, number> = {};
let differs = 0, differsFixupOnly = 0;
const differsBy: Record<string, number> = {};
let bytes = 0;
const vector = ["suite\tname\tkind\tsource\tliteralKind\ttags"];
for (const r of run) {
  const a = selectOracle(complete, r.suite, r.name);
  const b = selectOracle(corpus, r.suite, r.name);
  const ba = a.path === undefined ? undefined : readFileSync(a.path);
  const bb = b.path === undefined ? undefined : readFileSync(b.path);
  if (a.kind !== b.kind || (ba === undefined) !== (bb === undefined) || (ba !== undefined && !ba.equals(bb!))) { disagree++; console.log("disagree", r.suite, r.name, a.source, b.source); }
  if (a.kind !== r.kind) withVector++;
  if (ba !== undefined) bytes += ba.length;
  vector.push([r.suite, r.name, b.kind, b.source, b.literalKind, b.tags.join(",")].join("\t"));
  bump(`kind ${a.kind}`);
  bump(`kind ${a.kind} ${r.suite}`);
  bump(`source(corpus) ${b.source}`);
  bump(`source(complete) ${a.source}`);
  literal[b.literalKind]++;
  literalBySuite[`${b.literalKind} ${r.suite}`] = (literalBySuite[`${b.literalKind} ${r.suite}`] ?? 0) + 1;
  if (a.literalKind !== b.literalKind) console.log("literal differs between layouts", r.name);
  for (const t of a.tags) { bump(`tag ${t}`); bump(`tag ${t} ${a.kind}`); }
  // does typescript-go's result differ from TypeScript's after the fixup of the harness?
  const tsPath = `${TS}/${errorBaselineName(r.name)}`;
  const old = existsSync(tsPath) ? diffFixupOld(readFileSync(tsPath, "latin1")) : "<no content>";
  const neu = ba === undefined ? "<no content>" : ba.toString("latin1");
  if (old !== neu) {
    differs++;
    const cat = a.outRoot;
    differsBy[`${cat} ${a.kind}`] = (differsBy[`${cat} ${a.kind}`] ?? 0) + 1;
    const hasDiff = existsSync(`${GO}/baselines/reference/${cat}/${r.suite}/${errorBaselineName(r.name)}.diff`);
    if (!hasDiff) console.log("differs without a diff file in", cat, r.name);
  } else if (existsSync(tsPath) && ba !== undefined && !ba.equals(readFileSync(tsPath))) differsFixupOnly++;
}
console.log("run instances", run.length, "disagreements between the layouts", disagree, "disagreements with the vector", withVector);
console.log(JSON.stringify(count, null, 1));
console.log("literal rule", JSON.stringify(literal), JSON.stringify(literalBySuite));
console.log("differs from TypeScript after fixup", differs, JSON.stringify(differsBy), "equal after fixup only", differsFixupOnly);
console.log("bytes of all oracles", bytes);
writeFileSync(import.meta.dir + "/../vectors/oracle.tsv.gz", gzipSync(vector.join("\n") + "\n", { level: 9 }));
