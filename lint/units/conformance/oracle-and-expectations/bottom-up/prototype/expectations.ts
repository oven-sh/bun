// Prototype of the expectations file: parse, serialise, verify, report, update, comparison of two versions.
export type Kind = "E" | "C";
export type ComparisonLevel = "baseline" | "first-section";
export type Status = "pass" | "fail" | "provisional" | "error" | "unsupported";

export interface Expectations {
  level: ComparisonLevel;
  E: string[];
  C: string[];
}

export const levels: readonly ComparisonLevel[] = ["first-section", "baseline"];

export function emptyExpectations(level: ComparisonLevel): Expectations {
  return { level, E: [], C: [] };
}

// code unit order, the order of Array.prototype.sort without a comparator
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function serialize(e: Expectations): string {
  return JSON.stringify({ level: e.level, E: e.E, C: e.C }, null, 2) + "\n";
}

export class ExpectationsError extends Error {}

export function parse(text: string): Expectations {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new ExpectationsError("not JSON: " + (e as Error).message);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ExpectationsError("the top level is not an object");
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 3 || keys[0] !== "level" || keys[1] !== "E" || keys[2] !== "C") throw new ExpectationsError(`the keys are ${JSON.stringify(keys)}, expected ["level","E","C"]`);
  if (o.level !== "baseline" && o.level !== "first-section") throw new ExpectationsError(`level ${JSON.stringify(o.level)} is not "baseline" or "first-section"`);
  const seen = new Map<string, Kind>();
  for (const list of ["E", "C"] as const) {
    const names = o[list];
    if (!Array.isArray(names)) throw new ExpectationsError(`${list} is not a list`);
    let previous: string | undefined;
    for (const name of names) {
      if (typeof name !== "string" || name === "") throw new ExpectationsError(`${list} holds ${JSON.stringify(name)}, which is not a name`);
      if (seen.has(name)) throw new ExpectationsError(seen.get(name) === list ? `${list} holds ${name} twice` : `${name} is in both lists`);
      if (previous !== undefined && compareNames(previous, name) > 0) throw new ExpectationsError(`${list} is not sorted: ${name} follows ${previous}`);
      seen.set(name, list);
      previous = name;
    }
  }
  const e: Expectations = { level: o.level, E: o.E as string[], C: o.C as string[] };
  if (serialize(e) !== text) throw new ExpectationsError("the file is not in the form that the update command writes (two spaces, one name per line, one line feed at the end)");
  return e;
}

// What the expectations need to know about an instance of the enumeration.
export interface InstanceFacts {
  name: string;
  casePath: string;
  status: "run" | "skipped" | "invalid";
  reason: string;
  kind: Kind | undefined;
  tags: readonly string[];
  // reason why the instance cannot be written to disk the same way on every platform, undefined when it can
  platformLimited: string | undefined;
}

// What the expectations need to know about the run of an instance.
export interface ResultFacts {
  name: string;
  kind: Kind;
  level: ComparisonLevel;
  status: Status;
  detail: string;
}

export interface Failure {
  name: string;
  list: Kind;
  cause: "unknown-name" | "not-run" | "kind" | "platform-limited" | "not-selected" | "level" | "fail" | "provisional" | "error" | "unsupported";
  message: string;
}

function atLeast(level: ComparisonLevel, wanted: ComparisonLevel): boolean {
  return levels.indexOf(level) >= levels.indexOf(wanted);
}

// The listed names that the caller must run: every one that the enumeration can run.
export function listedNames(e: Expectations): { name: string; list: Kind }[] {
  return [...e.E.map(name => ({ name, list: "E" as const })), ...e.C.map(name => ({ name, list: "C" as const }))];
}

// A listed name fails when it is unknown, not run, of the other kind, limited to a platform, not run by the caller although selected, or does not pass.
export function verify(e: Expectations, instances: ReadonlyMap<string, InstanceFacts>, results: ReadonlyMap<string, ResultFacts>, selected: (name: string) => boolean = () => true): Failure[] {
  const failures: Failure[] = [];
  for (const { name, list } of listedNames(e)) {
    const fail = (cause: Failure["cause"], message: string) => failures.push({ name, list, cause, message });
    const i = instances.get(name);
    if (i === undefined) { fail("unknown-name", `${name} is listed in ${list} and is no instance of the corpus`); continue; }
    if (i.status !== "run") { fail("not-run", `${name} is listed in ${list} and is ${i.status}: ${i.reason}`); continue; }
    if (i.kind !== list) { fail("kind", `${name} is listed in ${list} and its oracle has kind ${i.kind}`); continue; }
    if (i.platformLimited !== undefined) { fail("platform-limited", `${name} is listed in ${list} and is limited to a platform: ${i.platformLimited}`); continue; }
    if (!selected(name)) continue;
    const r = results.get(name);
    if (r === undefined) { fail("not-selected", `${name} is listed in ${list} and was not run`); continue; }
    if (list === "E" && !atLeast(r.level, e.level)) { fail("level", `${name} was compared at level ${r.level}, the list stands for level ${e.level}`); continue; }
    if (r.status !== "pass") fail(r.status, `${name} is listed in ${list} and does not pass (${r.status}): ${r.detail}`);
  }
  return failures;
}

export interface Admission {
  name: string;
  list: Kind;
}
export interface Refusal {
  name: string;
  list: Kind;
  cause: "platform-limited" | "level" | "no-listed-variation";
  message: string;
}

export interface Candidates {
  admitted: Admission[];
  refused: Refusal[];
}

// The names that pass and are not listed, split by the rules of admission.
export function candidates(e: Expectations, instances: ReadonlyMap<string, InstanceFacts>, results: Iterable<ResultFacts>): Candidates {
  const listed = new Set([...e.E, ...e.C]);
  const admitted: Admission[] = [];
  const refused: Refusal[] = [];
  const passing: { i: InstanceFacts; r: ResultFacts }[] = [];
  for (const r of results) {
    if (r.status !== "pass" || listed.has(r.name)) continue;
    const i = instances.get(r.name);
    if (i === undefined || i.status !== "run" || i.kind !== r.kind) continue;
    passing.push({ i, r });
  }
  passing.sort((a, b) => compareNames(a.i.name, b.i.name));
  const casesInE = new Set<string>();
  for (const name of e.E) {
    const i = instances.get(name);
    if (i !== undefined) casesInE.add(i.casePath);
  }
  const check = (p: { i: InstanceFacts; r: ResultFacts }): Refusal | undefined => {
    const list = p.r.kind;
    if (p.i.platformLimited !== undefined) return { name: p.i.name, list, cause: "platform-limited", message: p.i.platformLimited };
    if (list === "E" && !atLeast(p.r.level, e.level)) return { name: p.i.name, list, cause: "level", message: `compared at level ${p.r.level}, the list stands for level ${e.level}` };
    return undefined;
  };
  for (const p of passing) {
    if (p.r.kind !== "E") continue;
    const refusal = check(p);
    if (refusal !== undefined) refused.push(refusal);
    else { admitted.push({ name: p.i.name, list: "E" }); casesInE.add(p.i.casePath); }
  }
  for (const p of passing) {
    if (p.r.kind !== "C") continue;
    const refusal = check(p);
    if (refusal !== undefined) refused.push(refusal);
    else if (!casesInE.has(p.i.casePath)) refused.push({ name: p.i.name, list: "C", cause: "no-listed-variation", message: `list E holds no instance of ${p.i.casePath}` });
    else admitted.push({ name: p.i.name, list: "C" });
  }
  return { admitted, refused };
}

// Adds names, removes none, keeps the order.
export function update(e: Expectations, admitted: readonly Admission[]): Expectations {
  const merge = (old: readonly string[], add: string[]) => {
    const have = new Set(old);
    return [...old, ...add.filter(n => !have.has(n))].sort(compareNames);
  };
  return {
    level: e.level,
    E: merge(e.E, admitted.filter(a => a.list === "E").map(a => a.name)),
    C: merge(e.C, admitted.filter(a => a.list === "C").map(a => a.name)),
  };
}

export interface Comparison {
  removed: { name: string; list: Kind; nowIn: Kind | undefined }[];
  added: { name: string; list: Kind }[];
  levelBefore: ComparisonLevel;
  levelNow: ComparisonLevel;
  levelLowered: boolean;
}

// The file of an earlier revision against the file of now: a name that left a list is a loss.
export function compare(before: Expectations, now: Expectations): Comparison {
  const removed: Comparison["removed"] = [];
  const added: Comparison["added"] = [];
  for (const list of ["E", "C"] as const) {
    const other = list === "E" ? "C" : "E";
    const n = new Set(now[list]);
    const o = new Set(before[list]);
    const otherNow = new Set(now[other]);
    for (const name of before[list]) if (!n.has(name)) removed.push({ name, list, nowIn: otherNow.has(name) ? other : undefined });
    for (const name of now[list]) if (!o.has(name)) added.push({ name, list });
  }
  return { removed, added, levelBefore: before.level, levelNow: now.level, levelLowered: levels.indexOf(now.level) < levels.indexOf(before.level) };
}

// The listed names that a run with a limit takes: all of them below the limit, else names at even distances of E followed by C.
export function selectForTest(e: Expectations, limit: number): { name: string; list: Kind }[] {
  const all = listedNames(e);
  if (all.length <= limit) return all;
  const out: { name: string; list: Kind }[] = [];
  for (let k = 0; k < limit; k++) out.push(all[Math.floor((k * all.length) / limit)]);
  return out;
}
