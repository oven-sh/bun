import type { BuildReport } from "./build-report";
import type { ReportDetail } from "./flags";

export const measureLinePattern = /^measure (\w+) (-?\d+(?:\.\d+)?)$/;

export type Environment = Record<string, string | undefined>;

export interface Spawned {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CompileRequest {
  cwd: string;
  entryPoints: string[];
  flags?: string[];
  environment?: Environment;
  outputFolder?: string;
  reportDetail?: ReportDetail;
  measures?: boolean;
  timeout?: number;
}

export interface CompiledProgram extends Spawned, Disposable {
  command: string[];
  executable: string;
  report: BuildReport | undefined;
  measurement: ProcessMeasurement | undefined;
}

export interface RunRequest {
  cwd: string;
  arguments?: string[];
  environment?: Environment;
  countsRuntime?: boolean;
  measures?: boolean;
  timeout?: number;
}

export interface ProgramRun extends Spawned {
  result: RunResult;
  measures: Map<string, number>;
  counts: RuntimeCounts | undefined;
  measurement: ProcessMeasurement | undefined;
}

export interface RuntimeCounts {
  counters: Map<string, number>;
  operations: Map<string, number>;
  exits: Map<string, number>;
}

export interface MeasureRequest {
  command: string[];
  cwd: string;
  environment: Environment;
  readyPattern?: RegExp;
  timeout?: number;
}

export interface ProcessMeasurement extends Spawned {
  wallMilliseconds: number;
  readyMilliseconds: number | undefined;
  userMilliseconds: number;
  systemMilliseconds: number;
  instructions: number | undefined;
  peakResidentBytes: number;
  peakFootprintBytes: number | undefined;
}
