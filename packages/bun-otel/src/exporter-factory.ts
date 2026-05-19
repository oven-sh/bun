/**
 * Exporter Factory
 *
 * Creates OpenTelemetry exporters from environment configuration.
 * Supports auto-instantiation of exporters based on OTEL_*_EXPORTER env vars.
 */

import { diag } from "@opentelemetry/api";
import type { MetricReader } from "@opentelemetry/sdk-metrics";
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import type { MetricsExporterType, TraceExporterType } from "./env-config";

/**
 * Create a trace exporter from environment configuration
 * Returns undefined for "none" or on error
 */
export function createTraceExporterFromEnv(type: TraceExporterType): SpanExporter | undefined {
  if (type === "none") {
    diag.debug("Trace exporter disabled (none)");
    return undefined;
  }

  try {
    switch (type) {
      case "otlp": {
        // Dynamic import to avoid loading if not used
        const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
        diag.debug("Creating OTLP trace exporter from environment");
        // OTLPTraceExporter automatically reads OTEL_EXPORTER_OTLP_* env vars
        return new OTLPTraceExporter();
      }

      case "zipkin": {
        const { ZipkinExporter } = require("@opentelemetry/exporter-zipkin");
        diag.debug("Creating Zipkin trace exporter from environment");
        // ZipkinExporter automatically reads OTEL_EXPORTER_ZIPKIN_* env vars
        return new ZipkinExporter();
      }

      case "console": {
        diag.debug("Creating Console trace exporter");
        return new ConsoleSpanExporter();
      }

      default: {
        diag.warn(`Unknown trace exporter type: ${type}`);
        return undefined;
      }
    }
  } catch (error) {
    diag.error(`Failed to create trace exporter (${type}):`, error);
    return undefined;
  }
}

/**
 * Create a metric reader from environment configuration
 * Returns undefined for "none" or on error
 */
export function createMetricReaderFromEnv(
  type: MetricsExporterType,
  exportInterval?: number,
  exportTimeout?: number,
): MetricReader | undefined {
  if (type === "none") {
    diag.debug("Metrics exporter disabled (none)");
    return undefined;
  }

  try {
    switch (type) {
      case "otlp": {
        const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-http");
        diag.debug("Creating OTLP metric exporter from environment");
        // OTLPMetricExporter automatically reads OTEL_EXPORTER_OTLP_* env vars
        const exporter = new OTLPMetricExporter();
        return new PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: exportInterval,
          exportTimeoutMillis: exportTimeout,
        });
      }

      case "prometheus": {
        const { PrometheusExporter } = require("@opentelemetry/exporter-prometheus");
        diag.debug("Creating Prometheus metric exporter from environment");
        // PrometheusExporter automatically reads OTEL_EXPORTER_PROMETHEUS_* env vars
        // Note: Prometheus exporter is a MetricReader itself (pull-based)
        return new PrometheusExporter();
      }

      case "console": {
        diag.debug("Creating Console metric exporter");
        const exporter = new ConsoleMetricExporter();
        return new PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: exportInterval,
          exportTimeoutMillis: exportTimeout,
        });
      }

      default: {
        diag.warn(`Unknown metrics exporter type: ${type}`);
        return undefined;
      }
    }
  } catch (error) {
    diag.error(`Failed to create metrics exporter (${type}):`, error);
    return undefined;
  }
}
