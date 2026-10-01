// Prototype of runner/expectations.ts: the two lists of passing instances, their checks, the report and the update.

export type Level = "baseline" | "first-section";
export type Kind = "E" | "C";
export type Status = "pass" | "fail" | "provisional" | "error" | "unsupported";

export interface Expectations {
  // the comparison that every name of list E passed
  level: Level;
  E: string[];
  C: string[];
}

// What the lists need to know of an instance: the enumerator, the oracle and the materialisation give it.
export interface InstanceFacts {
  name: string;
  // the suite and the directories of the case below it: "compiler", "conformance/types/tuple"
  directory: string;
  // path of the case below the cases directory: "conformance/types/tuple/castingTuple.ts"
  casePath: string;
  status: "run" | "skipped" | "invalid";
  reason: string;
  kind: Kind | undefined;
  tags: readonly string[];
  // why the instance cannot be written faithfully on one of the platforms of the test run, undefined when it can on all
  platformLimited: string | undefined;
}

export interface Outcome {
  name: string;
  status: Status;
  level: Level;
  // the first difference, the stand-ins or the failure
  detail: string;
}

export type FailureReason =
  | "not-an-instance"
  | "not-run"
  | "wrong-list"
  | "platform-limited"
  | "quota"
  | "level"
  | "fail"
  | "provisional"
  | "error"
  | "unsupported";

export interface Failure {
  name: string;
  list: Kind;
  reason: FailureReason;
  detail: string;
}

export class ExpectationsError extends Error {}

// Order of UTF-16 code units, the order of the operator < on strings.
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const levels: readonly string[] = ["baseline", "first-section"];
const rank = (l: Level) => (l === "baseline" ? 1 : 0);

// One name per line, two spaces of indentation, a line feed at the end.
export function formatExpectations(x: Expectations): string {
  return JSON.stringify({ level: x.level, E: x.E, C: x.C }, null, 2) + "\n";
}

export function parseExpectations(text: string): Expectations {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new ExpectationsError("not JSON: " + (e as Error).message);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ExpectationsError("the top level is not an object");
  const keys = Object.keys(value);
  if (keys.join(",") !== "level,E,C") throw new ExpectationsError(`the keys are ${keys.join(", ")}; they must be level, E, C in this order`);
  const { level, E, C } = value as Record<string, unknown>;
  if (typeof level !== "string" || !levels.includes(level)) throw new ExpectationsError(`level is ${JSON.stringify(level)}; it must be one of ${levels.join(", ")}`);
  for (const [key, list] of [["E", E], ["C", C]] as const) {
    if (!Array.isArray(list)) throw new ExpectationsError(`${key} is not a list`);
    for (let k = 0; k < list.length; k++) {
      const name = list[k];
      if (typeof name !== "string" || name === "") throw new ExpectationsError(`${key}[${k}] is not a name`);
      if (k > 0 && !(list[k - 1] < name)) {
        const what = list[k - 1] === name ? "is there twice" : `comes after ${JSON.stringify(list[k - 1])}`;
        throw new ExpectationsError(`${key}[${k}]: ${JSON.stringify(name)} ${what}; the order is the one of code units`);
      }
    }
  }
  const inE = new Set(E as string[]);
  for (const name of C as string[]) if (inE.has(name)) throw new ExpectationsError(`${JSON.stringify(name)} is in both lists`);
  const x: Expectations = { level: level as Level, E: E as string[], C: C as string[] };
  if (formatExpectations(x) !== text) throw new ExpectationsError("the file is not in the form that the update writes: two spaces, one name per line, a line feed at the end");
  return x;
}

function countBy(names: Iterable<string>, instances: ReadonlyMap<string, InstanceFacts>): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of names) {
    const d = instances.get(n)?.directory;
    if (d !== undefined) m.set(d, (m.get(d) ?? 0) + 1);
  }
  return m;
}

// Why a name may not be in a list, whatever a run gives; undefined when it may.
function refusal(i: InstanceFacts | undefined, list: Kind): { reason: FailureReason; detail: string } | undefined {
  if (i === undefined) return { reason: "not-an-instance", detail: "the corpus has no instance of this name" };
  if (i.status !== "run") return { reason: "not-run", detail: `the instance is ${i.status}: ${i.reason}` };
  if (i.kind !== list) return { reason: "wrong-list", detail: `the oracle of the instance has ${i.kind === "E" ? "errors" : "no error"}: its list is ${i.kind}` };
  if (i.platformLimited !== undefined) return { reason: "platform-limited", detail: i.platformLimited };
  return undefined;
}

// The checks that need no run: every name is an instance that runs, of the kind of its list, that every platform can hold.
export function checkLists(x: Expectations, instances: ReadonlyMap<string, InstanceFacts>): Failure[] {
  const out: Failure[] = [];
  for (const list of ["E", "C"] as const) {
    for (const name of x[list]) {
      const r = refusal(instances.get(name), list);
      if (r !== undefined) out.push({ name, list, ...r });
    }
  }
  return out;
}

// The names of list C above the quota of their directory. The quota is a rule of entry: a report shows this, no test fails on it.
export function overQuota(x: Expectations, instances: ReadonlyMap<string, InstanceFacts>): Failure[] {
  const out: Failure[] = [];
  const e = countBy(x.E, instances);
  const seen = new Map<string, number>();
  for (const name of x.C) {
    const d = instances.get(name)?.directory;
    if (d === undefined) continue;
    const n = (seen.get(d) ?? 0) + 1;
    seen.set(d, n);
    if (n > (e.get(d) ?? 0)) out.push({ name, list: "C", reason: "quota", detail: `list C has ${n} names of ${d} and list E has ${e.get(d) ?? 0}` });
  }
  return out;
}

// A listed name that a run did not pass. Names without an outcome were not selected and say nothing.
export function verify(x: Expectations, outcomes: ReadonlyMap<string, Outcome>): Failure[] {
  const out: Failure[] = [];
  for (const list of ["E", "C"] as const) {
    for (const name of x[list]) {
      const o = outcomes.get(name);
      if (o === undefined) continue;
      if (list === "E" && (rank(o.level) < rank(x.level) || (o.level !== x.level && o.status !== "pass"))) {
        out.push({ name, list, reason: "level", detail: `compared at level ${o.level}, the list records level ${x.level}: compare at that level` });
      } else if (o.status !== "pass") {
        out.push({ name, list, reason: o.status, detail: o.detail });
      }
    }
  }
  return out;
}

export interface Refused {
  name: string;
  list: Kind;
  reason: FailureReason;
  detail: string;
}

export interface Plan {
  next: Expectations;
  added: { E: string[]; C: string[] };
  // names that pass, are not listed and may not enter
  refused: Refused[];
}

// The names that pass and are not listed, and the lists with them. Removes nothing and keeps the order.
export function plan(x: Expectations, instances: ReadonlyMap<string, InstanceFacts>, outcomes: ReadonlyMap<string, Outcome>): Plan {
  const listed = new Set([...x.E, ...x.C]);
  const added = { E: [] as string[], C: [] as string[] };
  const refused: Refused[] = [];
  const candidatesC: InstanceFacts[] = [];
  const names = [...outcomes.keys()].sort(compareNames);
  for (const name of names) {
    const o = outcomes.get(name)!;
    if (o.status !== "pass" || listed.has(name)) continue;
    const i = instances.get(name);
    const list: Kind = i?.kind ?? "C";
    const r = refusal(i, list);
    if (r !== undefined) {
      refused.push({ name, list, ...r });
    } else if (list === "E") {
      if (rank(o.level) < rank(x.level)) refused.push({ name, list, reason: "level", detail: `passes at level ${o.level}, the list records level ${x.level}` });
      else added.E.push(name);
    } else {
      candidatesC.push(i!);
    }
  }
  const E = [...x.E, ...added.E].sort(compareNames);
  const quota = countBy(E, instances);
  for (const [d, n] of countBy(x.C, instances)) quota.set(d, (quota.get(d) ?? 0) - n);
  const casesInE = new Set(E.map(n => instances.get(n)?.casePath));
  // a case that list E knows first, then the order of the names
  candidatesC.sort((a, b) => Number(casesInE.has(b.casePath)) - Number(casesInE.has(a.casePath)) || compareNames(a.name, b.name));
  for (const i of candidatesC) {
    const left = quota.get(i.directory) ?? 0;
    if (left > 0) {
      quota.set(i.directory, left - 1);
      added.C.push(i.name);
    } else {
      refused.push({ name: i.name, list: "C", reason: "quota", detail: `list C may hold as many names of ${i.directory} as list E holds` });
    }
  }
  added.C.sort(compareNames);
  return { next: { level: x.level, E, C: [...x.C, ...added.C].sort(compareNames) }, added, refused };
}

export interface Shrink {
  removed: { name: string; list: Kind; stillAnInstance: boolean }[];
  moved: { name: string; from: Kind; to: Kind }[];
  levelLowered: boolean;
}

// The lists against the lists of another revision; old is undefined when that revision has no file.
export function compareWithRevision(current: Expectations, old: Expectations | undefined, instances: ReadonlyMap<string, InstanceFacts>): Shrink {
  const out: Shrink = { removed: [], moved: [], levelLowered: false };
  if (old === undefined) return out;
  out.levelLowered = old.E.length > 0 && rank(current.level) < rank(old.level);
  const now = { E: new Set(current.E), C: new Set(current.C) };
  for (const list of ["E", "C"] as const) {
    const other = list === "E" ? "C" : "E";
    for (const name of old[list]) {
      if (now[list].has(name)) continue;
      if (now[other].has(name)) out.moved.push({ name, from: list, to: other });
      else out.removed.push({ name, list, stillAnInstance: instances.has(name) });
    }
  }
  return out;
}

// The text that follows a sweep: what passes and is not listed, and the one command that adds it.
export function reportText(p: Plan, command: string): string {
  const lines: string[] = [];
  const n = p.added.E.length + p.added.C.length;
  if (n > 0) {
    lines.push(`${n} instances pass and are not listed (E ${p.added.E.length}, C ${p.added.C.length}):`);
    for (const name of p.added.E) lines.push("  E " + name);
    for (const name of p.added.C) lines.push("  C " + name);
    lines.push("Add them with:", "  " + command);
  }
  const by = new Map<string, number>();
  for (const r of p.refused) by.set(r.reason, (by.get(r.reason) ?? 0) + 1);
  if (p.refused.length > 0) {
    lines.push(`${p.refused.length} instances pass and may not enter a list: ` + [...by].map(([k, v]) => `${k} ${v}`).join(", "));
  }
  return lines.join("\n");
}

// The listed names that a run with a limit takes: all of them up to the limit, else names at even distances of E followed by C.
export function sampleListed(x: Expectations, limit: number): { name: string; list: Kind }[] {
  const all = [...x.E.map(name => ({ name, list: "E" as const })), ...x.C.map(name => ({ name, list: "C" as const }))];
  if (all.length <= limit) return all;
  const out: { name: string; list: Kind }[] = [];
  for (let k = 0; k < limit; k++) out.push(all[Math.floor((k * all.length) / limit)]);
  return out;
}
