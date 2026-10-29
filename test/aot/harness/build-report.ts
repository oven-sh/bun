import { readFileSync } from "node:fs";

export const levels = ["unknown", "guarded", "proven"] as const;
export type Level = (typeof levels)[number];
export type LevelCounts = Record<Level, number>;

/** What the code of a property access does where it stands. The three add up to every access. */
export const accessColumns = ["byName", "tested", "free"] as const;
export type AccessColumn = (typeof accessColumns)[number];
export const accessCountKeys = [...accessColumns, "testedSlotOnly", "provenWithoutAnyTest"] as const;
/** testedSlotOnly: the tested accesses whose receiver is known. provenWithoutAnyTest: those that no test anywhere stands behind. */
export type AccessCounts = Record<(typeof accessCountKeys)[number], number>;
export type AccessCost = "byName" | "testsReceiver" | "testsSlot" | "free";

export const allocationOutcomes = ["heap", "slim", "deferred", "frame", "removed"] as const;
export type AllocationOutcome = (typeof allocationOutcomes)[number];

export type AccessKind = "read" | "store" | "define" | "has" | "delete" | "call" | "construct";

export interface SourcePosition {
  file: string;
  line: number;
  column: number;
}

export interface AccessSite extends SourcePosition {
  kind: AccessKind;
  level: Level;
  cost: AccessCost;
  function: number | null;
  /** Where the copy lies that decides the class. 0 to 2: in the function itself, in a block that is normal, unlikely, rare. 3 to 5: pasted into a caller. From 6 on: in a generic version. 255: nowhere. */
  distance: number;
  /** Why the access is not free, where that begins, and the type the compiler takes the receiver for. */
  cause: string | null;
  limit: string | null;
  layout: string | null;
  witness: SourcePosition | null;
}

export interface TypeTestSite extends SourcePosition {
  canThrow: boolean;
  function: number | null;
}

export interface FunctionRecord extends SourcePosition {
  endLine: number;
  name: string;
  role: string;
  isInDependency: boolean;
  codeBytes: number;
  /** How many values the function had when the front end sent it. `null`: the engine made the function. */
  valuesAsRead: number | null;
  accesses: AccessCounts;
  calls: LevelCounts;
  operations: Record<string, number>;
}

export interface PassRecord {
  name: string;
  runs: number;
  changes: number;
  nanoseconds: number;
  wallNanoseconds: number;
}

export interface StageRecord {
  name: string;
  nanoseconds: number;
}

export interface LimitRecord {
  name: string;
  value: number;
  hits: number;
}

export interface UnseenCodeRecord {
  cause: string;
  builtin: string | null;
  location: SourcePosition | null;
}

export interface ReportSummary {
  accesses: AccessCounts;
  dependencyAccesses: AccessCounts;
  calls: LevelCounts;
  closures: Record<AllocationOutcome, number>;
  environments: { heap: number; frame: number };
  typeTests: number;
  sitesWithoutOrigin: number;
  sourceLines: number;
  codeBytes: number;
  dataBytes: number;
  functions: number;
}

export interface BuildReport {
  schemaHash: string;
  buildId: string | null;
  summary: ReportSummary;
  statistics: Record<string, number>;
  limits: LimitRecord[];
  passes: PassRecord[];
  stages: StageRecord[];
  retainedFeatures: string[] | null;
  unseenCode: UnseenCodeRecord[];
  functions: FunctionRecord[] | null;
  accessSites: AccessSite[] | null;
  typeTestSites: TypeTestSite[] | null;
}

export function readBuildReport(path: string): BuildReport {
  return JSON.parse(readFileSync(path, "utf8"));
}

export const levelRank = (level: Level) => levels.indexOf(level);
export const outcomeRank = (outcome: AllocationOutcome) => allocationOutcomes.indexOf(outcome);

export const emptyLevelCounts = (): LevelCounts => ({ unknown: 0, guarded: 0, proven: 0 });
export const emptyAccessCounts = (): AccessCounts => ({ byName: 0, tested: 0, free: 0, testedSlotOnly: 0, provenWithoutAnyTest: 0 });

export function addLevelCounts(total: LevelCounts, counts: LevelCounts): LevelCounts {
  for (const level of levels) total[level] += counts[level];
  return total;
}

export function addAccessCounts(total: AccessCounts, counts: AccessCounts): AccessCounts {
  for (const key of accessCountKeys) total[key] += counts[key];
  return total;
}

export const countAll = (counts: LevelCounts) => levels.reduce((sum, level) => sum + counts[level], 0);
export const countAccesses = (counts: AccessCounts) => accessColumns.reduce((sum, column) => sum + counts[column], 0);

export function countAtLeast(counts: LevelCounts, level: Level): number {
  return levels.slice(levelRank(level)).reduce((sum, each) => sum + counts[each], 0);
}

export function shareOf(counts: LevelCounts, level: Level): number {
  const all = countAll(counts);
  return all === 0 ? 0 : counts[level] / all;
}

export const positionKey = ({ file, line, column }: SourcePosition) => `${file}:${line}:${column}`;

export function functionsNamed(report: BuildReport, name: string): FunctionRecord[] {
  return (report.functions ?? []).filter(record => record.name === name);
}

export function countOperations(records: FunctionRecord[], operations: readonly string[]): number {
  return records.reduce((sum, record) => sum + operations.reduce((count, operation) => count + (record.operations[operation] ?? 0), 0), 0);
}
