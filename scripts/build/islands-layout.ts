import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const pageSize = 16384;
const mostStretches = 256;
const mostHoles = 48;

export interface Layout {
  address: number[];
  size: number[];
  alignment: number[];
  output: string[];
}

export interface Needs {
  core: Set<number>;
  neededBy: Map<number, string>;
}

export interface Plan {
  doors: string[];
  islands: { features: string; names: string[] }[];
}

const planHeader = "bun-islands-plan 1";

export function readPlan(path: string | undefined, features: string[]): Plan | undefined {
  if (path === undefined || !existsSync(path)) return undefined;
  const lines = readFileSync(path, "latin1").split("\n");
  if (lines[0] !== planHeader) return undefined;
  const known = new Set(features);
  const plan: Plan = { doors: [], islands: [] };
  for (const line of lines.slice(1)) {
    if (line.startsWith("island ")) plan.islands.push({ features: line.slice(7), names: [] });
    else if (line.startsWith("door ")) plan.doors.push(line.slice(5));
    else if (line !== "") plan.islands.at(-1)?.names.push(line);
  }
  plan.islands = plan.islands.filter(island => island.features.split(",").every(feature => known.has(feature)));
  return plan.islands.length > 0 ? plan : undefined;
}

export function writePlan(path: string, plan: Plan): void {
  const lines = [
    planHeader,
    ...plan.doors.map(name => "door " + name),
    ...plan.islands.flatMap(island => ["island " + island.features, ...island.names]),
  ];
  writeFileSync(path, lines.join("\n") + "\n", "latin1");
}

export interface Range {
  start: number;
  end: number;
  features: string;
}

export function rangesThatCanGo(graph: Layout, analysis: Needs, isMovable: (output: string) => boolean): Range[] {
  const runs: Range[][] = [];
  let run: Range[] = [];
  const length = (run: Range[]) => run.at(-1)!.end - run[0]!.start;
  const close = () => {
    if (run.length > 0 && length(run) >= pageSize) runs.push(run);
    run = [];
  };
  for (let node = 0; node < graph.address.length; node++) {
    const features =
      isMovable(graph.output[node]!) && !analysis.core.has(node) ? analysis.neededBy.get(node) : undefined;
    if (features === undefined) {
      close();
      continue;
    }
    const start = graph.address[node]!;
    const isNextToTheLast =
      node > 0 &&
      graph.output[node - 1] === graph.output[node] &&
      start - (graph.address[node - 1]! + graph.size[node - 1]!) < graph.alignment[node]!;
    if (!isNextToTheLast) close();
    const last = run.at(-1);
    if (last?.features === features) last.end = start + graph.size[node]!;
    else {
      if (last !== undefined) last.end = start;
      run.push({ start, end: start + graph.size[node]!, features });
    }
  }
  close();
  const kept: Range[][] = [];
  let stretches = 0;
  for (const run of runs.sort((a, b) => length(b) - length(a))) {
    if ((stretches += run.length) > mostStretches) break;
    kept.push(run);
  }
  return kept.flat().sort((a, b) => a.start - b.start);
}

export function misplaced(graph: Layout, analysis: Needs, ranges: Range[]): number {
  let faults = 0;
  let at = 0;
  for (let node = 0; node < graph.address.length; node++) {
    const start = graph.address[node]!;
    while (at < ranges.length && ranges[at]!.end <= start) at++;
    const range = ranges[at];
    if (range === undefined || start + graph.size[node]! <= range.start) continue;
    if (analysis.core.has(node) || analysis.neededBy.get(node) !== range.features) faults++;
  }
  return faults;
}

export function wholePages(ranges: Range[]): number {
  const holes: number[] = [];
  let start = -1;
  let end = -1;
  const close = () =>
    void holes.push(Math.max(0, Math.floor(end / pageSize) * pageSize - Math.ceil(start / pageSize) * pageSize));
  for (const range of ranges) {
    if (range.start === end) end = range.end;
    else {
      close();
      ({ start, end } = range);
    }
  }
  close();
  return holes
    .sort((a, b) => b - a)
    .slice(0, mostHoles)
    .reduce((sum, bytes) => sum + bytes, 0);
}
