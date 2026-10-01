// Research probe: the oracle of every run instance under the four-step rule and under the literal rule.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const P = "/workspace/notes/lint/units/conformance/enumerator/prototype/";
const { enumerateInstances } = await import(P + "compiler_runner.ts");

const GO = "/workspace/ref/typescript-go/testdata";
const REF = GO + "/baselines/reference";
const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests";
const suites = ["compiler", "conformance"] as const;
const roots = ["submodule", "submoduleAccepted", "submoduleTriaged"] as const;

// baseline.go:108 readFileNameSet, with Go's TrimSpace
const goSpace = /^[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
function readFileNameSet(path: string): { set: Set<string>; entries: string[] } {
  const set = new Set<string>();
  const entries: string[] = [];
  for (let line of readFileSync(path, "utf8").split("\n")) {
    line = line.replace(goSpace, "");
    if (line === "" || line.charCodeAt(0) === 0x23) continue;
    set.add(line);
    entries.push(line);
  }
  return { set, entries };
}
const accepted = readFileNameSet(GO + "/submoduleAccepted.txt");
const triaged = readFileNameSet(GO + "/submoduleTriaged.txt");

const e = enumerateInstances({ casesRoot: TS + "/cases" });
const tsgoErr = new Map<string, Set<string>>();
const diffIn = new Map<string, Map<string, string[]>>();
for (const s of suites) {
  tsgoErr.set(s, new Set(readdirSync(`${REF}/submodule/${s}`).filter(f => f.endsWith(".errors.txt"))));
  const m = new Map<string, string[]>();
  for (const r of roots) {
    const dir = `${REF}/${r}/${s}`;
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".errors.txt.diff")) continue;
      const k = f.slice(0, -5);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
  }
  diffIn.set(s, m);
}
const tsErr = new Set(readdirSync(`${TS}/baselines/reference`).filter(f => f.endsWith(".errors.txt")));
console.log("tsgo error baselines", [...tsgoErr].map(([s, v]) => `${s} ${v.size}`).join(", "), "TypeScript error baselines (flat, all runners)", tsErr.size);
console.log("error diff files", suites.map(s => `${s} ${diffIn.get(s)!.size}`).join(", "));

const fixupOld = (old: Buffer): Buffer => {
  // compiler_runner.go:393 DiffFixupOld on bytes
  const parts: Buffer[] = [];
  let start = 0;
  const prefix = Buffer.from("==== ./");
  for (;;) {
    const nl = old.indexOf(0x0a, start);
    const line = old.subarray(start, nl < 0 ? old.length : nl);
    if (line.subarray(0, 7).equals(prefix)) parts.push(Buffer.from("==== "), line.subarray(7));
    else parts.push(line);
    if (nl < 0) break;
    parts.push(Buffer.from("\n"));
    start = nl + 1;
  }
  return Buffer.concat(parts);
};

const errName = (n: string) => n.replace(/\.tsx?$/, ".errors.txt");
type Row = { name: string; suite: string; tsgo: boolean; ts: boolean; same: boolean; sameFixed: boolean; diffRoots: string[]; acc: boolean; tri: boolean };
const rows: Row[] = [];
const seenTsgo = new Map<string, Set<string>>([["compiler", new Set()], ["conformance", new Set()]]);
const seenDiff = new Map<string, Set<string>>([["compiler", new Set()], ["conformance", new Set()]]);
const skippedWith: string[] = [];
for (const i of e.instances) {
  const f = errName(i.name);
  const tsgo = tsgoErr.get(i.suite)!.has(f);
  const diffRoots = diffIn.get(i.suite)!.get(f) ?? [];
  if (i.status !== "run") {
    if (tsgo || diffRoots.length > 0) skippedWith.push(`${i.suite}/${f} tsgo=${tsgo} diff=${diffRoots}`);
    continue;
  }
  if (tsgo) seenTsgo.get(i.suite)!.add(f);
  if (diffRoots.length > 0) seenDiff.get(i.suite)!.add(f);
  const ts = tsErr.has(f);
  let same = false, sameFixed = false;
  if (tsgo && ts) {
    const a = readFileSync(`${REF}/submodule/${i.suite}/${f}`);
    const b = readFileSync(`${TS}/baselines/reference/${f}`);
    same = a.equals(b);
    sameFixed = same || a.equals(fixupOld(b));
  }
  const key = `${i.suite}/${f}.diff`;
  rows.push({ name: i.name, suite: i.suite, tsgo, ts, same, sameFixed, diffRoots, acc: accepted.set.has(key), tri: triaged.set.has(key) });
}
console.log("run instances", rows.length);
console.log("skipped instances that have a tsgo baseline or a diff:", skippedWith.length, skippedWith.slice(0, 10));
for (const s of suites) {
  const stale = [...tsgoErr.get(s)!].filter(f => !seenTsgo.get(s)!.has(f));
  const staleDiff = [...diffIn.get(s)!.keys()].filter(f => !seenDiff.get(s)!.has(f));
  console.log(s, "tsgo error baselines of no run instance:", stale.length, stale.slice(0, 5), "diff files of no run instance:", staleDiff.length, staleDiff.slice(0, 5));
}

const cnt = (f: (r: Row) => boolean) => rows.filter(f).length;
const classes = {
  a_both_bytes_equal: cnt(r => r.tsgo && r.ts && r.same),
  a2_both_equal_after_fixup_only: cnt(r => r.tsgo && r.ts && !r.same && r.sameFixed),
  b_both_differ: cnt(r => r.tsgo && r.ts && !r.sameFixed),
  c_tsgo_only: cnt(r => r.tsgo && !r.ts),
  d_ts_only: cnt(r => !r.tsgo && r.ts),
  e_neither: cnt(r => !r.tsgo && !r.ts),
};
console.log("classes", JSON.stringify(classes));
// consistency of diff files with the classes
console.log("diff present by class", JSON.stringify({
  a: cnt(r => r.tsgo && r.ts && r.same && r.diffRoots.length > 0),
  a2: cnt(r => r.tsgo && r.ts && !r.same && r.sameFixed && r.diffRoots.length > 0),
  b: cnt(r => r.tsgo && r.ts && !r.sameFixed && r.diffRoots.length > 0),
  c: cnt(r => r.tsgo && !r.ts && r.diffRoots.length > 0),
  d: cnt(r => !r.tsgo && r.ts && r.diffRoots.length > 0),
  e: cnt(r => !r.tsgo && !r.ts && r.diffRoots.length > 0),
}));
console.log("instances with a diff file in more than one root", cnt(r => r.diffRoots.length > 1));
// root of the diff against the lists (baseline.go:64-79)
let rootOk = 0;
const rootBad: string[] = [];
for (const r of rows) {
  if (r.diffRoots.length === 0) continue;
  const want = r.acc ? "submoduleAccepted" : r.tri ? "submoduleTriaged" : "submodule";
  if (r.diffRoots.length === 1 && r.diffRoots[0] === want) rootOk++; else rootBad.push(`${r.name}: in ${r.diffRoots}, lists say ${want}`);
}
console.log("diff file in the root that the lists select:", rootOk, "not:", rootBad.length, rootBad.slice(0, 5));
console.log("listed accepted without a diff file", rows.filter(r => r.acc && r.diffRoots.length === 0).map(r => r.name));
console.log("listed triaged without a diff file", rows.filter(r => r.tri && r.diffRoots.length === 0).map(r => r.name));
console.log("in both lists", rows.filter(r => r.acc && r.tri).map(r => r.name));

// keys of the lists against the instances
const byKey = new Map<string, any>();
for (const i of e.instances) byKey.set(`${i.suite}/${errName(i.name)}.diff`, i);
for (const [label, l] of [["accepted", accepted], ["triaged", triaged]] as const) {
  const keys = [...l.set].filter(k => k.endsWith(".errors.txt.diff"));
  const entries = l.entries.filter(k => k.endsWith(".errors.txt.diff"));
  const run = keys.filter(k => byKey.get(k)?.status === "run");
  const skipped = keys.filter(k => byKey.has(k) && byKey.get(k).status !== "run");
  const none = keys.filter(k => !byKey.has(k));
  console.log(label, "entries", l.entries.length, "unique", l.set.size, "error entries", entries.length, "unique error keys", keys.length, "on run instances", run.length, "on skipped", skipped.length, skipped, "on no instance", none.length, none);
}

// the derived list
const derived = rows.filter(r => !r.tsgo && r.diffRoots.length > 0).map(r => `${r.suite}/${errName(r.name)}`).sort();
const prior = readFileSync("/workspace/notes/lint/units/conformance/corpus-layout-and-sync/top-down/vectors/tsgo.expects-no-errors.txt", "utf8").split("\n").filter(x => x !== "");
console.log("derived list", derived.length, "equal to the vector of the corpus research:", JSON.stringify(derived) === JSON.stringify(prior));
console.log("derived by tag", JSON.stringify({
  accepted: rows.filter(r => !r.tsgo && r.diffRoots.length > 0 && r.acc).map(r => r.name),
  triaged: rows.filter(r => !r.tsgo && r.diffRoots.length > 0 && r.tri).map(r => r.name),
  none: rows.filter(r => !r.tsgo && r.diffRoots.length > 0 && !r.acc && !r.tri).map(r => r.name),
}, null, 1));

// the four-step rule on the corpus layout: overlay = tsgo's file where the bytes differ from TypeScript's or it has none
const derivedSet = new Set(derived);
let E = 0, C = 0, litE = 0, litC = 0, wrong = 0, overlay = 0;
const per: Record<string, { E: number; C: number; litE: number; litC: number }> = { compiler: { E: 0, C: 0, litE: 0, litC: 0 }, conformance: { E: 0, C: 0, litE: 0, litC: 0 } };
const steps = { overlay: 0, derived: 0, typescript: 0, none: 0 };
for (const r of rows) {
  const inOverlay = r.tsgo && (!r.ts || !r.same);
  if (inOverlay) overlay++;
  let k: "E" | "C";
  let source: string;
  if (inOverlay) { k = "E"; source = "overlay"; }
  else if (derivedSet.has(`${r.suite}/${errName(r.name)}`)) { k = "C"; source = "derived"; }
  else if (r.ts) { k = "E"; source = "typescript"; }
  else { k = "C"; source = "none"; }
  (steps as any)[source]++;
  // truth: tsgo's own directory
  const truth = r.tsgo ? "E" : "C";
  if (truth !== k) wrong++;
  if (source === "typescript" && !(r.tsgo && r.same)) wrong++;
  if (k === "E") { E++; per[r.suite].E++; } else { C++; per[r.suite].C++; }
  const lit = r.tsgo || r.ts ? "E" : "C";
  if (lit === "E") { litE++; per[r.suite].litE++; } else { litC++; per[r.suite].litC++; }
}
console.log("four-step rule: E", E, "C", C, JSON.stringify(per), "steps", JSON.stringify(steps), "overlay files", overlay, "disagreements with typescript-go's directory", wrong);
console.log("literal rule: E", litE, "C", litC);

// tags over run instances
console.log("tags", JSON.stringify({
  accepted: cnt(r => r.acc), acceptedE: cnt(r => r.acc && r.tsgo), acceptedC: cnt(r => r.acc && !r.tsgo),
  triaged: cnt(r => r.tri), triagedE: cnt(r => r.tri && r.tsgo), triagedC: cnt(r => r.tri && !r.tsgo),
  uncategorised: cnt(r => r.diffRoots.length > 0 && !r.acc && !r.tri),
  uncategorisedE: cnt(r => r.diffRoots.length > 0 && !r.acc && !r.tri && r.tsgo),
  uncategorisedC: cnt(r => r.diffRoots.length > 0 && !r.acc && !r.tri && !r.tsgo),
  anyDiff: cnt(r => r.diffRoots.length > 0),
}));
writeFileSync("/tmp/oe/rows.json", JSON.stringify(rows));
