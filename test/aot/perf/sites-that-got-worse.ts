// bun sites-that-got-worse.ts <report of the build that knows less> <report of the build that knows more> [--list=40] [--sources=<folder>] [--statistics]
//
// Both reports come from `--aot-report=<path> --aot-report-detail=sites` on the same program. A compiler may not do worse for knowing
// more, so every site this lists is a fault of the compiler.
//
// The class of a site is that of its nearest copy. Where a call is inlined or a read removed in one build alone, what is left as the nearest copy is the
// slow half of a test, or a copy in a caller: that compares two different pieces of code. Such sites are counted as moved, and not judged.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AccessCost, type AccessSite, type BuildReport, type Level, readBuildReport } from "../harness/build-report";

export type SiteClass = AccessCost | Level;

const accessClasses: readonly SiteClass[] = ["free", "testsSlot", "testsReceiver", "byName"];
const callClasses: readonly SiteClass[] = ["proven", "guarded", "unknown"];

const isCall = (site: AccessSite) => site.kind === "call" || site.kind === "construct";
const classOf = (site: AccessSite): SiteClass => (isCall(site) ? site.level : site.cost);
const rankOf = (site: AccessSite) => (isCall(site) ? callClasses : accessClasses).indexOf(classOf(site));
const keyOf = (site: AccessSite) => `${site.file}:${site.line}:${site.column} ${site.kind}`;

export interface Change {
  withLess: AccessSite;
  withMore: AccessSite;
}

export interface Comparison {
  worse: Change[];
  better: Change[];
  same: number;
  moved: Change[];
  onlyWithLess: AccessSite[];
  onlyWithMore: AccessSite[];
}

function worstBySite(report: BuildReport): Map<string, AccessSite> {
  if (!report.accessSites) throw new Error("the report has no sites: build with --aot-report-detail=sites");
  const sites = new Map<string, AccessSite>();
  for (const site of report.accessSites) {
    const key = keyOf(site);
    const known = sites.get(key);
    if (!known || rankOf(site) > rankOf(known)) sites.set(key, site);
  }
  return sites;
}

export function compareReports(withLess: BuildReport, withMore: BuildReport): Comparison {
  const less = worstBySite(withLess);
  const more = worstBySite(withMore);
  const comparison: Comparison = { worse: [], better: [], same: 0, moved: [], onlyWithLess: [], onlyWithMore: [] };
  for (const [key, before] of less) {
    const after = more.get(key);
    if (!after) comparison.onlyWithLess.push(before);
    else if (rankOf(after) === rankOf(before)) comparison.same++;
    else if (after.distance !== before.distance) comparison.moved.push({ withLess: before, withMore: after });
    else if (rankOf(after) > rankOf(before)) comparison.worse.push({ withLess: before, withMore: after });
    else comparison.better.push({ withLess: before, withMore: after });
  }
  for (const [key, after] of more) if (!less.has(key)) comparison.onlyWithMore.push(after);
  return comparison;
}

export const describeChange = ({ withLess, withMore }: Change) =>
  `${keyOf(withMore)}: ${classOf(withLess)} > ${classOf(withMore)}${withMore.cause ? ` (${withMore.cause})` : ""}`;

function tally<T>(items: T[], nameOf: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(nameOf(item), (counts.get(nameOf(item)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

function printTally(title: string, rows: [string, number][], limit = 25) {
  console.log(`\n${title}`);
  for (const [name, count] of rows.slice(0, limit)) console.log(`${String(count).padStart(8)}  ${name}`);
  if (rows.length > limit) console.log(`          .. and ${rows.length - limit} more rows`);
}

const step = ({ withLess, withMore }: Change) => `${withMore.kind}: ${classOf(withLess)} > ${classOf(withMore)}`;

const nameOfCause = (site: AccessSite) => (site.cause ? `${site.cause}${site.limit ? ` ${site.limit}` : ""}` : "none");
const causes = ({ withLess, withMore }: Change) => `${nameOfCause(withLess)} > ${nameOfCause(withMore)}`;

function witnessOf({ withMore }: Change): string {
  const { witness } = withMore;
  return `${nameOfCause(withMore)} at ${witness ? `${witness.file}:${witness.line}:${witness.column}` : "no place"}`;
}

function sourceLine(root: string | undefined, site: AccessSite, texts: Map<string, string[]>): string {
  if (!root) return "";
  const path = join(root, site.file);
  if (!texts.has(path)) texts.set(path, existsSync(path) ? readFileSync(path, "utf8").split("\n") : []);
  const line = texts.get(path)![site.line - 1] ?? "";
  return `   ${line.slice(Math.max(0, site.column - 31), site.column + 50).trim()}`;
}

function printStatistics(withLess: BuildReport, withMore: BuildReport) {
  console.log("\nstatistics that moved by 2% or more (less > more)");
  for (const [name, before] of Object.entries(withLess.statistics)) {
    const after = withMore.statistics[name] ?? 0;
    if (Math.abs(after - before) >= Math.max(10, 0.02 * Math.max(before, after))) console.log(`  ${name}: ${before} > ${after}`);
  }
}

if (import.meta.main) {
  const paths = process.argv.slice(2).filter(word => !word.startsWith("--"));
  const option = (name: string) => process.argv.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (paths.length !== 2) {
    console.error("usage: sites-that-got-worse.ts <report that knows less> <report that knows more> [--list=40] [--sources=<folder>] [--statistics]");
    process.exit(2);
  }
  const [withLess, withMore] = paths.map(readBuildReport);
  const comparison = compareReports(withLess, withMore);
  const { worse, better, same, moved, onlyWithLess, onlyWithMore } = comparison;
  console.log(
    `${worse.length} sites worse, ${better.length} better, ${same} the same, ${moved.length} moved; ${onlyWithLess.length} only in the first report, ${onlyWithMore.length} only in the second`,
  );
  printTally("worse for knowing more, by step", tally(worse, step));
  printTally("better for knowing more, by step", tally(better, step));
  printTally("worse, by the causes the two reports give", tally(worse, causes));
  printTally("worse, by where the second report says the cause begins", tally(worse, witnessOf), 15);
  printTally("worse, by the type of the receiver", tally(worse, change => change.withMore.layout ?? "none"), 15);
  printTally("worse, by file", tally(worse, change => change.withMore.file), 15);
  const texts = new Map<string, string[]>();
  console.log("\nthe sites, the largest step first");
  const bySize = worse.toSorted(
    (a, b) => rankOf(b.withMore) - rankOf(b.withLess) - (rankOf(a.withMore) - rankOf(a.withLess)) || (keyOf(a.withMore) < keyOf(b.withMore) ? -1 : 1),
  );
  for (const change of bySize.slice(0, Number(option("list") ?? 40)))
    console.log(`  ${describeChange(change)}${sourceLine(option("sources"), change.withMore, texts)}`);
  if (process.argv.includes("--statistics")) printStatistics(withLess, withMore);
}
