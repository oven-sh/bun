export type MetricSource = "session" | "executable" | "build";
export type MetricUnit = "milliseconds" | "seconds" | "megabytes" | "millionInstructions" | "percent" | "bytes" | "count";

export interface Metric {
  id: string;
  label: string;
  unit: MetricUnit;
  source: MetricSource;
}

export const metrics = [
  { id: "wall", label: "wall", unit: "milliseconds", source: "session" },
  { id: "ready", label: "time to ready", unit: "milliseconds", source: "session" },
  { id: "cpu", label: "CPU", unit: "milliseconds", source: "session" },
  { id: "user", label: "user time", unit: "milliseconds", source: "session" },
  { id: "instructions", label: "instructions", unit: "millionInstructions", source: "session" },
  { id: "peakFootprint", label: "peak footprint", unit: "megabytes", source: "session" },
  { id: "peakResident", label: "peak RSS", unit: "megabytes", source: "session" },
  { id: "binarySize", label: "binary size, stripped", unit: "megabytes", source: "executable" },
  { id: "compileTime", label: "compile time", unit: "seconds", source: "build" },
  { id: "provenAccesses", label: "accesses proven", unit: "percent", source: "build" },
  { id: "writtenAccesses", label: "accesses written", unit: "percent", source: "build" },
  { id: "predictedAccesses", label: "accesses predicted", unit: "percent", source: "build" },
  { id: "unknownAccesses", label: "accesses unknown", unit: "percent", source: "build" },
  { id: "directCalls", label: "direct calls", unit: "percent", source: "build" },
  { id: "codeBytesPerLine", label: "code bytes per source line", unit: "bytes", source: "build" },
  { id: "fullClosures", label: "function objects, full", unit: "count", source: "build" },
  { id: "slimClosures", label: "function objects, slim", unit: "count", source: "build" },
  { id: "deferredClosures", label: "function objects, deferred", unit: "count", source: "build" },
  { id: "frameClosures", label: "function objects, in frame", unit: "count", source: "build" },
  { id: "removedClosures", label: "function objects, none", unit: "count", source: "build" },
  { id: "heapEnvironments", label: "environments in heap", unit: "count", source: "build" },
  { id: "frameEnvironments", label: "environments in frame", unit: "count", source: "build" },
  { id: "limitHits", label: "limit hits", unit: "count", source: "build" },
  { id: "idlePasses", label: "passes that changed nothing", unit: "count", source: "build" },
] as const satisfies readonly Metric[];

export type MetricId = (typeof metrics)[number]["id"];
export type MetricValues = Partial<Record<MetricId, number>>;

export interface CardColumn {
  label: string;
  program: string;
  stamp: string;
  sessions: number;
  values: MetricValues;
}

export const columnTitles = ["New", "Previous", "Stock", "Change"] as const;
export const notMeasured = "not measured";
