import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { BuildError, describeError } from "../error.ts";
import { readFeatureModel } from "./features.ts";
import { megabytes } from "./report.ts";
import { objectFormats, type FeatureModel, type ObjectFormat, type ProfileMeasurement } from "./types.ts";

interface Arguments {
  executable: string;
  featuresPath: string;
  format: ObjectFormat;
  warnsOnly: boolean;
}

type RunnerResult = { kind: "Measured"; measurements: ProfileMeasurement[] } | { kind: "Failed"; failure: string };

const usage = "usage: profiles.ts <executable> <removable-features.json> <elf | macho | coff> [--warn-only]";
const warnOnlyOption = "--warn-only";
const maxQuotedOutputLength = 400;

const isObjectFormat = (value: string): value is ObjectFormat => objectFormats.includes(value as ObjectFormat);
const isByteCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function cutPercent({ removedBytes, fileBytesSaved }: ProfileMeasurement): number | undefined {
  return removedBytes === 0 ? undefined : (100 * fileBytesSaved) / removedBytes;
}

export function findProfileFailures(
  model: FeatureModel,
  format: ObjectFormat,
  measurements: ProfileMeasurement[],
): string[] {
  const measurementOf = new Map(measurements.map(measurement => [measurement.profile, measurement]));
  const failures: string[] = [];
  for (const { name, minimumCutRatio } of model.profiles) {
    const measurement = measurementOf.get(name);
    if (measurement === undefined) {
      failures.push(`profile ${name} has no measurement`);
      continue;
    }
    const percent = cutPercent(measurement);
    const minimum = minimumCutRatio[format];
    if (percent === undefined) failures.push(`profile ${name} removes nothing`);
    else if (minimum !== undefined && percent < minimum) {
      failures.push(
        `profile ${name}: ${Math.floor(percent)}% of the removed bytes leave the file, ` +
          `and src/trim/features/profiles.def sets a minimum of ${minimum}% for ${format}`,
      );
    }
  }
  return failures;
}

export function describeMeasurement(measurement: ProfileMeasurement): string {
  const { profile, removedBytes, fileBytesSaved, uncutReason } = measurement;
  const percent = cutPercent(measurement);
  return (
    `${profile}: ${megabytes(removedBytes)} removed, ${megabytes(fileBytesSaved)} from the file` +
    (percent === undefined ? "" : ` (${Math.floor(percent)}%)`) +
    (uncutReason === undefined ? "" : ` (${uncutReason})`)
  );
}

function parseArguments(words: string[]): Arguments {
  const unknownOption = words.find(word => word.startsWith("--") && word !== warnOnlyOption);
  if (unknownOption !== undefined) throw new BuildError(`unknown option ${unknownOption}\n${usage}`);
  const positional = words.filter(word => !word.startsWith("--"));
  if (positional.length !== 3) throw new BuildError(usage);
  const [executable, featuresPath, format] = positional as [string, string, string];
  if (!isObjectFormat(format)) throw new BuildError(`unknown object format ${format}\n${usage}`);
  return {
    executable: resolve(executable),
    featuresPath: resolve(featuresPath),
    format,
    warnsOnly: words.includes(warnOnlyOption),
  };
}

function isMeasurement(value: unknown): value is ProfileMeasurement {
  if (typeof value !== "object" || value === null) return false;
  const { profile, removedBytes, fileBytesSaved, uncutReason } = value as Record<string, unknown>;
  return (
    typeof profile === "string" &&
    isByteCount(removedBytes) &&
    isByteCount(fileBytesSaved) &&
    (uncutReason === undefined || typeof uncutReason === "string")
  );
}

function parseMeasurements(text: string): ProfileMeasurement[] | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  return Array.isArray(json) && json.every(isMeasurement) ? json : undefined;
}

function measureProfiles(executable: string, featuresPath: string): RunnerResult {
  const runner = join(import.meta.dirname, "profile-runner.ts");
  const child = spawnSync(executable, ["run", runner, executable, featuresPath], {
    encoding: "utf8",
    env: {
      BUN_GARBAGE_COLLECTOR_LEVEL: "0",
      ...process.env,
      BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  if (child.error !== undefined) {
    return { kind: "Failed", failure: `${executable} could not run: ${describeError(child.error)}` };
  }
  if (child.status !== 0) {
    const exit = child.status === null ? `was killed by ${child.signal}` : `exited with code ${child.status}`;
    return { kind: "Failed", failure: `${executable} ${exit} in profile-runner.ts:\n${child.stderr.trimEnd()}` };
  }
  const measurements = parseMeasurements(child.stdout);
  if (measurements === undefined) {
    const printed = child.stdout.slice(0, maxQuotedOutputLength);
    return { kind: "Failed", failure: `profile-runner.ts printed no list of measurements:\n${printed}` };
  }
  return { kind: "Measured", measurements };
}

function checkProfiles({ executable, featuresPath, format }: Arguments): string[] {
  const model = readFeatureModel(featuresPath);
  const result = measureProfiles(executable, featuresPath);
  if (result.kind === "Failed") return [result.failure];
  for (const measurement of result.measurements) console.log(describeMeasurement(measurement));
  return findProfileFailures(model, format, result.measurements);
}

function main(): void {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    const failures = checkProfiles(arguments_);
    const severity = arguments_.warnsOnly ? "warning" : "error";
    for (const failure of failures) console.error(`trim: ${severity}: ${failure}`);
    if (failures.length > 0 && !arguments_.warnsOnly) process.exit(1);
  } catch (error) {
    if (!(error instanceof BuildError)) throw error;
    console.error(`trim: ${error.format().trimEnd()}`);
    process.exit(1);
  }
}

if (import.meta.main) main();
