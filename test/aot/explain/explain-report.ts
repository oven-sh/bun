import type { AccessCounts, LevelCounts } from "../harness/build-report";

export interface ExplainNumbers {
  accesses: AccessCounts;
  dependencyAccesses: AccessCounts;
  calls: LevelCounts;
  causes: number;
}

export interface ExplainCause {
  rank: number;
  reason: string;
  limit: string | null;
  file: string;
  line: number;
  column: number;
  inDependency: boolean;
  source: string;
  message: string;
  fix: string;
  url: string;
  accesses: number;
  dependencyAccesses: number;
  calls: number;
  operators: number;
  fixedByThisAlone: number;
  estimatedPercent: number;
  function: string;
  types: string[];
  family: "unproven-type" | "unknown-code" | "mutation" | "limit";
}

export interface ExplainReport {
  numbers: ExplainNumbers;
  causes: ExplainCause[];
  summary: string[];
}

export function parseExplainLines(stdout: string): Pick<ExplainReport, "numbers" | "causes"> {
  const [numbers, ...causes] = stdout
    .split("\n")
    .filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line));
  return { numbers, causes };
}
