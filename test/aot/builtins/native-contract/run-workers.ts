import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TargetReport } from "./check-target";
import type { Unreachable } from "./targets";
import type { WorkerRequest } from "./worker";

export type Report = TargetReport | Unreachable;
export type Results = {
  reports: Map<string, Report>;
  // The targets during which a process ended or stopped making progress.
  ended: string[];
  howEnded: string[];
};
export type RunOptions = {
  executable: string;
  environment: Record<string, string | undefined>;
  folder: string;
  filter: string;
  workerCount: number;
  /** The workers take part `part` of `parts`: every `parts`-th function. */
  part: number;
  parts: number;
};

const maxAttempts = 60;
const secondsWithoutProgress = 45;

function readReports(path: string, reports: Map<string, Report>): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line === "") continue;
    const report: Report = JSON.parse(line);
    reports.set(report.name, report);
  }
}

function readCurrent(path: string): string | null | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function waitFor(worker: Bun.Subprocess, currentPath: string): Promise<void> {
  let last: string | null | undefined;
  let lastChange = Date.now();
  const watch = setInterval(() => {
    const current = readCurrent(currentPath);
    if (current !== last) {
      last = current;
      lastChange = Date.now();
    } else if (Date.now() - lastChange > secondsWithoutProgress * 1000) {
      worker.kill("SIGKILL");
    }
  }, 1000);
  await worker.exited;
  clearInterval(watch);
}

// A target that twice ends its process or does not come back is left out of the next attempt, which goes on behind it. Once can be the
// machine: under load a call may starve.
async function runWorker(options: RunOptions, index: number, results: Results): Promise<void> {
  const { executable, environment, folder, filter, workerCount, part, parts } = options;
  const requestPath = join(folder, `request.${index}.json`);
  const reportsPath = join(folder, `reports.${index}.jsonl`);
  const currentPath = `${reportsPath}.current`;
  const ended: string[] = [];
  const endedOnce = new Set<string>();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const reports = new Map<string, Report>();
    readReports(reportsPath, reports);
    writeFileSync(requestPath, JSON.stringify({ filter, index: index * parts + part - 1, count: workerCount * parts, finished: [...reports.keys(), ...ended] } satisfies WorkerRequest));
    writeFileSync(currentPath, '""');
    // What a function does to the files that its operands name stays in a folder that nothing else uses.
    const workingFolder = join(folder, `work.${index}.${attempt}`);
    mkdirSync(workingFolder);
    const worker = Bun.spawn({
      cmd: [executable, "--expose-internals", join(import.meta.dir, "worker.ts"), requestPath, reportsPath],
      cwd: workingFolder,
      env: { ...environment, AWS_ENDPOINT: "http://127.0.0.1:1", S3_ENDPOINT: "http://127.0.0.1:1" },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    await waitFor(worker, currentPath);
    const current = readCurrent(currentPath);
    if (current === null) break;
    if (current && !endedOnce.has(current)) {
      endedOnce.add(current);
      continue;
    }
    ended.push(current || `worker ${index} before its first target`);
    results.howEnded.push(`${ended.at(-1)}: ${worker.signalCode ?? `exit ${worker.exitCode}`}`);
    if (!current) break;
  }
  readReports(reportsPath, results.reports);
  results.ended.push(...ended);
}

export async function runWorkers(options: RunOptions): Promise<Results> {
  const results: Results = { reports: new Map(), ended: [], howEnded: [] };
  await Promise.all(Array.from({ length: options.workerCount }, (_, index) => runWorker(options, index, results)));
  return results;
}
