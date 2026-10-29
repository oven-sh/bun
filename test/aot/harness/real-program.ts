export interface ServerRequest {
  method: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
}

export type Session =
  | { kind: "run"; arguments: string[]; readyPattern?: string }
  | { kind: "serve"; arguments: string[]; readyPattern: string; requests: ServerRequest[]; rounds: number }
  | { kind: "driver"; command: string[] };

export interface RealProgram {
  name: string;
  root: string;
  entryPoints: string[];
  buildFlags: string[];
  stockBuildFlags: string[];
  editableFiles: string[];
  installs: boolean;
  session: Session;
}

export interface SessionMeasurement {
  wallMilliseconds: number;
  readyMilliseconds: number | null;
  cpuMilliseconds: number;
  userMilliseconds: number;
  instructions: number | null;
  peakFootprintBytes: number | null;
  peakResidentBytes: number;
}

export const executablePlaceholder = "{executable}";
export const programFileSuffix = ".program.json";
export const externalProgramsVariable = "AOT_REAL_PROGRAMS";
