/**
 * Environment Variable Configuration Parser
 *
 * Parses and validates OpenTelemetry environment variables following the spec:
 * https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/
 *
 * All parsing functions return undefined for invalid/missing values and log warnings.
 * This ensures graceful degradation and matches opentelemetry-js behavior.
 */

import { diag } from "@opentelemetry/api";
import { getNumberFromEnv, getStringFromEnv } from "@opentelemetry/core";

/**
 * Log levels supported by the OpenTelemetry SDK
 */
export type OtelLogLevel = "NONE" | "ERROR" | "WARN" | "INFO" | "DEBUG" | "VERBOSE" | "ALL";

/**
 * Supported trace exporters
 */
export type TraceExporterType = "otlp" | "zipkin" | "console" | "none";

/**
 * Supported metrics exporters
 */
export type MetricsExporterType = "otlp" | "prometheus" | "console" | "none";

/**
 * Supported log exporters
 */
export type LogsExporterType = "otlp" | "console" | "none";

/**
 * Supported propagators
 */
export type PropagatorType = "tracecontext" | "baggage" | "b3" | "b3multi" | "jaeger";

/**
 * Parsed environment configuration
 */
export interface OtelEnvConfig {
  // General SDK config
  sdkDisabled: boolean;
  logLevel?: OtelLogLevel;

  // Exporter selection
  traceExporter?: TraceExporterType;
  metricsExporter?: MetricsExporterType;
  logsExporter?: LogsExporterType;

  // Propagators
  propagators: PropagatorType[];

  // Batch Span Processor config
  bspScheduleDelay?: number;
  bspExportTimeout?: number;
  bspMaxQueueSize?: number;
  bspMaxExportBatchSize?: number;

  // Metric Reader config
  metricExportInterval?: number;
  metricExportTimeout?: number;
}

/**
 * Check if SDK is disabled via OTEL_SDK_DISABLED
 */
export function isSDKDisabled(): boolean {
  const value = getStringFromEnv("OTEL_SDK_DISABLED");
  if (value === undefined) return false;

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

/**
 * Parse OTEL_LOG_LEVEL
 */
export function parseLogLevel(): OtelLogLevel | undefined {
  const value = getStringFromEnv("OTEL_LOG_LEVEL");
  if (value === undefined) return undefined;

  const normalized = value.trim().toUpperCase() as OtelLogLevel;
  const validLevels: OtelLogLevel[] = ["NONE", "ERROR", "WARN", "INFO", "DEBUG", "VERBOSE", "ALL"];

  if (validLevels.includes(normalized)) {
    return normalized;
  }

  diag.warn(`Invalid OTEL_LOG_LEVEL: "${value}", expected one of: ${validLevels.join(", ")}`);
  return undefined;
}

/**
 * Parse comma-separated exporter list
 */
function parseExporterList<T extends string>(envVar: string, validExporters: readonly T[]): T | undefined {
  const value = getStringFromEnv(envVar);
  if (value === undefined) return undefined;

  // Take first exporter from comma-separated list (NodeSDK behavior)
  const first = value.split(",")[0]?.trim().toLowerCase() as T;

  if (first && validExporters.includes(first)) {
    return first;
  }

  diag.warn(`Invalid ${envVar}: "${value}", expected one of: ${validExporters.join(", ")}`);
  return undefined;
}

/**
 * Parse OTEL_TRACES_EXPORTER
 * Default: "otlp"
 */
export function parseTraceExporter(): TraceExporterType {
  const validExporters = ["otlp", "zipkin", "console", "none"] as const;
  return parseExporterList("OTEL_TRACES_EXPORTER", validExporters) ?? "otlp";
}

/**
 * Parse OTEL_METRICS_EXPORTER
 * Default: "otlp"
 */
export function parseMetricsExporter(): MetricsExporterType {
  const validExporters = ["otlp", "prometheus", "console", "none"] as const;
  return parseExporterList("OTEL_METRICS_EXPORTER", validExporters) ?? "otlp";
}

/**
 * Parse OTEL_LOGS_EXPORTER
 * Default: "otlp"
 */
export function parseLogsExporter(): LogsExporterType {
  const validExporters = ["otlp", "console", "none"] as const;
  return parseExporterList("OTEL_LOGS_EXPORTER", validExporters) ?? "otlp";
}

/**
 * Parse OTEL_PROPAGATORS
 * Default: ["tracecontext", "baggage"]
 */
export function parsePropagators(): PropagatorType[] {
  const value = getStringFromEnv("OTEL_PROPAGATORS");
  if (value === undefined) {
    return ["tracecontext", "baggage"]; // Default per spec
  }

  const validPropagators: PropagatorType[] = ["tracecontext", "baggage", "b3", "b3multi", "jaeger"];
  const parts = value.split(",").map(s => s.trim().toLowerCase());
  const result: PropagatorType[] = [];

  for (const part of parts) {
    if (validPropagators.includes(part as PropagatorType)) {
      result.push(part as PropagatorType);
    } else {
      diag.warn(`Invalid propagator in OTEL_PROPAGATORS: "${part}", expected one of: ${validPropagators.join(", ")}`);
    }
  }

  // Fall back to default if no valid propagators
  return result.length > 0 ? result : ["tracecontext", "baggage"];
}

/**
 * Parse and validate a positive number from environment
 */
function parsePositiveNumber(envVar: string): number | undefined {
  const value = getNumberFromEnv(envVar);
  if (value === undefined) return undefined;

  if (Number.isFinite(value) && value > 0) {
    return value;
  }

  diag.warn(`Invalid ${envVar}: ${value}, expected positive number`);
  return undefined;
}

/**
 * Parse OTEL_BSP_SCHEDULE_DELAY (milliseconds)
 * Default: 5000
 */
export function parseBspScheduleDelay(): number | undefined {
  return parsePositiveNumber("OTEL_BSP_SCHEDULE_DELAY");
}

/**
 * Parse OTEL_BSP_EXPORT_TIMEOUT (milliseconds)
 * Default: 30000
 */
export function parseBspExportTimeout(): number | undefined {
  return parsePositiveNumber("OTEL_BSP_EXPORT_TIMEOUT");
}

/**
 * Parse OTEL_BSP_MAX_QUEUE_SIZE
 * Default: 2048
 */
export function parseBspMaxQueueSize(): number | undefined {
  return parsePositiveNumber("OTEL_BSP_MAX_QUEUE_SIZE");
}

/**
 * Parse OTEL_BSP_MAX_EXPORT_BATCH_SIZE
 * Default: 512
 */
export function parseBspMaxExportBatchSize(): number | undefined {
  return parsePositiveNumber("OTEL_BSP_MAX_EXPORT_BATCH_SIZE");
}

/**
 * Parse OTEL_METRIC_EXPORT_INTERVAL (milliseconds)
 * Default: 60000
 */
export function parseMetricExportInterval(): number | undefined {
  return parsePositiveNumber("OTEL_METRIC_EXPORT_INTERVAL");
}

/**
 * Parse OTEL_METRIC_EXPORT_TIMEOUT (milliseconds)
 * Default: 30000
 */
export function parseMetricExportTimeout(): number | undefined {
  return parsePositiveNumber("OTEL_METRIC_EXPORT_TIMEOUT");
}

/**
 * Parse all environment variables into a single config object
 */
export function parseOtelEnvConfig(): OtelEnvConfig {
  return {
    sdkDisabled: isSDKDisabled(),
    logLevel: parseLogLevel(),
    traceExporter: parseTraceExporter(),
    metricsExporter: parseMetricsExporter(),
    logsExporter: parseLogsExporter(),
    propagators: parsePropagators(),
    bspScheduleDelay: parseBspScheduleDelay(),
    bspExportTimeout: parseBspExportTimeout(),
    bspMaxQueueSize: parseBspMaxQueueSize(),
    bspMaxExportBatchSize: parseBspMaxExportBatchSize(),
    metricExportInterval: parseMetricExportInterval(),
    metricExportTimeout: parseMetricExportTimeout(),
  };
}
