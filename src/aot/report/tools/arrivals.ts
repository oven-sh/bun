// What arrived at the property accesses that went by name, against what the compiler expected there.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const usage = `usage: bun src/aot/report/tools/arrivals.ts <report.json> <counts.txt> [--top <n>] [--kinds <kind,..>]
  <report.json>  from bun build --compile --aot --aot-count-arrivals --aot-report=<path> --aot-report-detail=sites
  <counts.txt>   from the executable of that build, run with BUN_JSC_aotCountsPath=<path>
  --top <n>      how many sites to print, heaviest first (default 100). The table of verdicts covers all of them
  --kinds <..>   only sites of these kinds: read, store, define, has, call, construct (default all)`;

export interface SourcePosition {
  file: string;
  line: number;
  column: number;
}

export interface ArrivalSite extends SourcePosition {
  number: number;
  offset: number;
  function: number | null;
  operation: string;
  kind: string;
  level: string;
  cause: string;
  expected: number[];
  stamp: "none" | "open" | "complete";
}

export interface ReportedLayout {
  id: number;
  name: string;
  kind: string;
  base: number | null;
  isDerived: boolean;
  position: SourcePosition | null;
  fields: string[];
  optional: string[];
}

export interface ArrivalReport {
  functions: { name: string }[] | null;
  arrivalSites: ArrivalSite[] | null;
  layouts: ReportedLayout[] | null;
}

export interface ArrivalCount {
  site: number;
  what: string;
  count: number;
}

export type Arrival =
  | { kind: "layout"; layout: number; hasLeftShape: boolean }
  | { kind: "object"; names: string[]; hasMoreNames: boolean; isDictionary: boolean }
  | { kind: "other" };

// In the order in which one is preferred where an arrival compares to several expected layouts.
export const verdictKinds = [
  "expected",
  "expected, no fast arm",
  "left its shape",
  "below by class",
  "same fields, same order",
  "same fields, other order",
  "without optional",
  "plus",
  "foreign object",
  "unrelated",
  "nothing expected",
] as const;
export type VerdictKind = (typeof verdictKinds)[number];

export interface Verdict {
  kind: VerdictKind;
  layout: number | null;
  names: string[];
}

export interface JoinedArrival {
  what: string;
  arrival: Arrival;
  count: number;
  verdict: Verdict;
}

export interface JoinedSite {
  site: ArrivalSite;
  numbers: number[];
  functionName: string;
  count: number;
  arrivals: JoinedArrival[];
}

export interface JoinedArrivals {
  layouts: Layouts;
  sites: JoinedSite[];
  verdicts: { kind: VerdictKind; count: number }[];
  count: number;
  unlistedNumbers: number[];
  unlistedCount: number;
}

interface Candidate {
  verdict: Verdict;
  distance: number;
}

const maxNamesShown = 16;
const maxArrivalWidth = 72;

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const grouped = (count: number) => String(count).replace(/\B(?=(\d{3})+$)/g, ",");
const share = (part: number, whole: number) => (whole === 0 ? "0.0%" : ((100 * part) / whole).toFixed(1) + "%");
const siteOrSites = (count: number) => (count === 1 ? "site" : "sites");
const unrelated = (): Verdict => ({ kind: "unrelated", layout: null, names: [] });

export function parseCounts(text: string): ArrivalCount[] {
  const counts = new Map<string, ArrivalCount>();
  for (const line of text.split("\n")) {
    const found = /^(\d+)\tarrival:(\d+)\t(.*)\r?$/.exec(line);
    if (!found) continue;
    const [, count, site, what] = found;
    const key = site + "\t" + what;
    const known = counts.get(key);
    if (known) known.count += Number(count);
    else counts.set(key, { site: Number(site), what, count: Number(count) });
  }
  return [...counts.values()];
}

export function parseArrival(what: string): Arrival {
  const layout = /^layout:(\d+)(\+changed)?$/.exec(what);
  if (layout) return { kind: "layout", layout: Number(layout[1]), hasLeftShape: layout[2] !== undefined };
  const object = /^object\{(.*)\}(dict)?$/.exec(what);
  if (!object) return { kind: "other" };
  const names = object[1] === "" ? [] : object[1].split(",");
  const hasMoreNames = names.at(-1) === "..";
  if (hasMoreNames) names.pop();
  return { kind: "object", names, hasMoreNames, isDictionary: object[2] !== undefined };
}

function positionText({ file, line, column }: SourcePosition, offset?: number) {
  if (file === "") return "(no location)";
  if (line > 0) return `${file}:${line}:${column}`;
  return offset === undefined ? file : `${file}:+${offset}`;
}

export class Layouts {
  #byId = new Map<number, ReportedLayout>();
  #fields = new Map<number, Set<string>>();
  #optional = new Map<number, Set<string>>();

  constructor(layouts: readonly ReportedLayout[]) {
    for (const layout of layouts) this.#byId.set(layout.id, layout);
  }

  get(id: number) {
    return this.#byId.get(id);
  }

  fieldsOf(layout: ReportedLayout) {
    let fields = this.#fields.get(layout.id);
    if (!fields) this.#fields.set(layout.id, (fields = new Set(layout.fields)));
    return fields;
  }

  optionalOf(layout: ReportedLayout) {
    let optional = this.#optional.get(layout.id);
    if (!optional) this.#optional.set(layout.id, (optional = new Set(layout.optional)));
    return optional;
  }

  // A derived layout is its base plus names and has no class of its own: the step up from one leads to no parent class.
  isBelowByClass(layout: ReportedLayout, ancestor: number) {
    const seen = new Set([layout.id]);
    let leftAClass = false;
    for (let current = layout; current.base !== null;) {
      leftAClass ||= !current.isDerived;
      if (current.base === ancestor) return leftAClass;
      const base = this.#byId.get(current.base);
      if (!base || seen.has(base.id)) return false;
      seen.add(base.id);
      current = base;
    }
    return false;
  }

  labelOf(id: number) {
    const name = this.#byId.get(id)?.name;
    return name ? `L${id} ${name}` : `L${id}`;
  }

  describe(id: number) {
    const layout = this.#byId.get(id);
    if (!layout) return `L${id} (not in the report)`;
    const optional = this.optionalOf(layout);
    const names = layout.fields.slice(0, maxNamesShown).map(name => (optional.has(name) ? name + "?" : name));
    if (layout.fields.length > maxNamesShown) names.push(`.. ${layout.fields.length - maxNamesShown} more`);
    const position = layout.position ? "  " + positionText(layout.position) : "";
    return `${this.labelOf(id)} {${names.join(", ")}}${position}`;
  }
}

function compareLayouts(arrived: ReportedLayout, expected: ReportedLayout, layouts: Layouts): Candidate | null {
  const candidate = (kind: VerdictKind, names: string[]) => ({
    verdict: { kind, layout: expected.id, names },
    distance: names.length,
  });
  if (layouts.isBelowByClass(arrived, expected.id)) return candidate("below by class", []);

  const arrivedFields = layouts.fieldsOf(arrived);
  const expectedFields = layouts.fieldsOf(expected);
  const missing = expected.fields.filter(name => !arrivedFields.has(name));
  const added = arrived.fields.filter(name => !expectedFields.has(name));
  if (missing.length === 0 && added.length === 0) {
    const hasSameOrder = arrived.fields.every((name, index) => name === expected.fields[index]);
    return candidate(hasSameOrder ? "same fields, same order" : "same fields, other order", []);
  }
  const optional = layouts.optionalOf(expected);
  if (added.length === 0 && missing.every(name => optional.has(name))) return candidate("without optional", missing);
  const isDerivedFromExpected = arrived.isDerived && arrived.base === expected.id;
  if (missing.length === 0 && (expected.fields.length > 0 || isDerivedFromExpected)) return candidate("plus", added);
  return null;
}

function compareObject(
  object: Extract<Arrival, { kind: "object" }>,
  expected: ReportedLayout,
  layouts: Layouts,
): Candidate | null {
  const names = new Set(object.names);
  const fields = layouts.fieldsOf(expected);
  const optional = layouts.optionalOf(expected);
  const missing = expected.fields.filter(name => !names.has(name));
  const added = object.names.filter(name => !fields.has(name));
  if (added.length === object.names.length) return null;
  // Only the first names of a large object are printed: the rest of the layout's fields may be behind them.
  const mayHoldTheRest = object.hasMoreNames && added.length === 0;
  if (!mayHoldTheRest && !missing.every(name => optional.has(name))) return null;
  return {
    verdict: { kind: "foreign object", layout: expected.id, names: [] },
    distance: missing.length + added.length,
  };
}

function isCloser(a: Candidate, b: Candidate) {
  const rank = verdictKinds.indexOf(a.verdict.kind) - verdictKinds.indexOf(b.verdict.kind);
  return rank !== 0 ? rank < 0 : a.distance < b.distance;
}

function closestOf(
  expected: readonly number[],
  layouts: Layouts,
  compare: (layout: ReportedLayout) => Candidate | null,
): Verdict {
  let closest: Candidate | null = null;
  for (const id of expected) {
    const layout = layouts.get(id);
    const candidate = layout ? compare(layout) : null;
    if (candidate && (!closest || isCloser(candidate, closest))) closest = candidate;
  }
  return closest ? closest.verdict : unrelated();
}

// A site is graded "guarded" where the code has a fast arm for the access. At any other site everything goes by name.
export function verdictOf(
  arrival: Arrival,
  expected: readonly number[],
  layouts: Layouts,
  hasFastArm: boolean = true,
): Verdict {
  if (expected.length === 0) return { kind: "nothing expected", layout: null, names: [] };
  switch (arrival.kind) {
    case "layout": {
      if (expected.includes(arrival.layout)) {
        const kind = !hasFastArm ? "expected, no fast arm" : arrival.hasLeftShape ? "left its shape" : "expected";
        return { kind, layout: arrival.layout, names: [] };
      }
      // A layout that is not expected misses with or without its shape, so only how it differs counts.
      const arrived = layouts.get(arrival.layout);
      if (!arrived) return unrelated();
      return closestOf(expected, layouts, layout => compareLayouts(arrived, layout, layouts));
    }
    case "object": {
      const object = arrival;
      return closestOf(expected, layouts, layout => compareObject(object, layout, layouts));
    }
    case "other":
      return unrelated();
  }
}

export function describeVerdict({ kind, layout, names }: Verdict, layouts: Layouts): string {
  const label = layout === null ? "" : layouts.labelOf(layout);
  switch (kind) {
    case "expected":
    case "expected, no fast arm":
    case "left its shape":
    case "unrelated":
    case "nothing expected":
      return kind;
    case "below by class":
      return `below ${label} by class`;
    case "same fields, same order":
      return `same fields, same order as ${label}`;
    case "same fields, other order":
      return `same fields, other order than ${label}`;
    case "without optional":
      return `${label} without optional ${names.join(", ")}`;
    case "plus":
      return `${label} plus ${names.join(", ")}`;
    case "foreign object":
      return `foreign object with the fields of ${label}`;
  }
}

function compareSites(a: ArrivalSite, b: ArrivalSite) {
  return (
    compareText(a.file, b.file) ||
    a.line - b.line ||
    a.column - b.column ||
    a.offset - b.offset ||
    compareText(a.operation, b.operation) ||
    a.number - b.number
  );
}

export function joinArrivals(report: ArrivalReport, counts: readonly ArrivalCount[]): JoinedArrivals {
  const layouts = new Layouts(report.layouts ?? []);
  const siteByNumber = new Map((report.arrivalSites ?? []).map((site): [number, ArrivalSite] => [site.number, site]));
  const groups = new Map<string, { site: ArrivalSite; numbers: Set<number>; counts: Map<string, number> }>();
  const unlistedNumbers = new Set<number>();
  let unlistedCount = 0;

  for (const { site: number, what, count } of counts) {
    const site = siteByNumber.get(number);
    if (!site) {
      unlistedNumbers.add(number);
      unlistedCount += count;
      continue;
    }
    const { file, line, column, offset, operation, kind, level, cause, expected, stamp } = site;
    const key = JSON.stringify([file, line, column, offset, operation, kind, level, cause, expected, stamp]);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { site, numbers: new Set(), counts: new Map() }));
    if (number < group.site.number) group.site = site;
    group.numbers.add(number);
    group.counts.set(what, (group.counts.get(what) ?? 0) + count);
  }

  const countByVerdict = new Map<VerdictKind, number>();
  const sites = [...groups.values()].map(({ site, numbers, counts }): JoinedSite => {
    const arrivals = [...counts].map(([what, count]): JoinedArrival => {
      const arrival = parseArrival(what);
      const verdict = verdictOf(arrival, site.expected, layouts, site.level === "guarded");
      countByVerdict.set(verdict.kind, (countByVerdict.get(verdict.kind) ?? 0) + count);
      return { what, arrival, count, verdict };
    });
    arrivals.sort((a, b) => b.count - a.count || compareText(a.what, b.what));
    return {
      site,
      numbers: [...numbers].sort((a, b) => a - b),
      functionName: (site.function === null ? undefined : report.functions?.[site.function]?.name) ?? "",
      count: arrivals.reduce((sum, arrival) => sum + arrival.count, 0),
      arrivals,
    };
  });
  sites.sort((a, b) => b.count - a.count || compareSites(a.site, b.site));

  const verdicts = verdictKinds
    .map(kind => ({ kind, count: countByVerdict.get(kind) ?? 0 }))
    .sort((a, b) => b.count - a.count || verdictKinds.indexOf(a.kind) - verdictKinds.indexOf(b.kind));
  return {
    layouts,
    sites,
    verdicts,
    count: sites.reduce((sum, site) => sum + site.count, 0),
    unlistedNumbers: [...unlistedNumbers].sort((a, b) => a - b),
    unlistedCount,
  };
}

function arrivalText({ what, arrival }: JoinedArrival, layouts: Layouts) {
  if (arrival.kind !== "layout") return what;
  return layouts.describe(arrival.layout) + (arrival.hasLeftShape ? "  (changed)" : "");
}

function formatSite(joined: JoinedSite, rank: number, total: number, layouts: Layouts): string[] {
  const { site, numbers, functionName, count, arrivals } = joined;
  const rows = arrivals.map(arrival => [
    grouped(arrival.count),
    share(arrival.count, count),
    arrivalText(arrival, layouts),
    describeVerdict(arrival.verdict, layouts),
  ]);
  const countWidth = Math.max(...rows.map(([arrived]) => arrived.length));
  const whatWidth = Math.min(maxArrivalWidth, Math.max(...rows.map(([, , what]) => what.length)));
  return [
    `#${rank}  ${positionText(site, site.offset)}  ${site.operation}  ${site.kind}  ${site.level}` +
      (functionName ? `  in ${functionName}` : ""),
    `    ${grouped(count)} by name, ${share(count, total)} of all.` +
      ` cause ${site.cause}, stamp ${site.stamp}, ${siteOrSites(numbers.length)} ${numbers.join(" ")}`,
    site.expected.length === 0 ? "    expected nothing" : "    expected",
    ...site.expected.map(id => "      " + layouts.describe(id)),
    "    arrived",
    ...rows.map(([arrived, part, what, verdict]) =>
      ["    ", arrived.padStart(countWidth), part.padStart(6), what.padEnd(whatWidth), verdict].join("  "),
    ),
    "",
  ];
}

export function formatArrivals(joined: JoinedArrivals, top: number): string {
  const { layouts, sites, verdicts, count, unlistedNumbers, unlistedCount } = joined;
  const hidden = Math.max(0, sites.length - top);
  const lines = [`${grouped(count)} arrivals by name at ${grouped(sites.length)} ${siteOrSites(sites.length)}`, ""];
  sites.slice(0, top).forEach((site, index) => lines.push(...formatSite(site, index + 1, count, layouts)));
  if (hidden > 0) lines.push(`${grouped(hidden)} more ${siteOrSites(hidden)} not shown (--top)`, "");

  const countWidth = Math.max(...verdicts.map(verdict => grouped(verdict.count).length));
  lines.push("Verdicts over all sites");
  for (const { kind, count: arrived } of verdicts) {
    lines.push(["", grouped(arrived).padStart(countWidth), share(arrived, count).padStart(6), kind].join("  "));
  }
  if (unlistedCount > 0) {
    const unlisted = unlistedNumbers.length;
    lines.push(
      "",
      `${grouped(unlistedCount)} arrivals at ${grouped(unlisted)} ${siteOrSites(unlisted)} outside the report:` +
        " the counts and the report are from different builds",
    );
  }
  return lines.join("\n") + "\n";
}

function main(argv: string[]): number {
  let options;
  try {
    options = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: { top: { type: "string", default: "100" }, kinds: { type: "string" } },
    });
  } catch (error) {
    console.error(`error: ${(error as Error).message}\n${usage}`);
    return 1;
  }
  const top = Number(options.values.top);
  if (options.positionals.length !== 2 || !Number.isInteger(top) || top < 0) {
    console.error(usage);
    return 1;
  }

  const [reportPath, countsPath] = options.positionals;
  const report: ArrivalReport = JSON.parse(readFileSync(reportPath, "utf8"));
  if (!report.arrivalSites?.length) {
    console.error(`error: ${reportPath} lists no arrival sites\n${usage}`);
    return 1;
  }
  let joined = joinArrivals(report, parseCounts(readFileSync(countsPath, "utf8")));
  const kinds = options.values.kinds?.split(",");
  if (kinds) {
    const sites = joined.sites.filter(({ site }) => kinds.includes(site.kind));
    joined = { ...joined, sites, count: sites.reduce((sum, site) => sum + site.count, 0) };
  }
  process.stdout.write(formatArrivals(joined, top));
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
