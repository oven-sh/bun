/**
 * Unit tests for environment variable configuration parsing
 */

import { describe, expect, test } from "bun:test";
import {
  isSDKDisabled,
  parseBspExportTimeout,
  parseBspMaxExportBatchSize,
  parseBspMaxQueueSize,
  parseBspScheduleDelay,
  parseLogLevel,
  parseLogsExporter,
  parseMetricExportInterval,
  parseMetricExportTimeout,
  parseMetricsExporter,
  parseOtelEnvConfig,
  parsePropagators,
  parseTraceExporter,
} from "../src/env-config";

// Helper to set env vars for tests
function withEnv(vars: Record<string, string>, fn: () => void) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
}

describe("isSDKDisabled", () => {
  test("returns false when not set", () => {
    withEnv({}, () => {
      expect(isSDKDisabled()).toBe(false);
    });
  });

  test("returns true for 'true'", () => {
    withEnv({ OTEL_SDK_DISABLED: "true" }, () => {
      expect(isSDKDisabled()).toBe(true);
    });
  });

  test("returns true for 'TRUE'", () => {
    withEnv({ OTEL_SDK_DISABLED: "TRUE" }, () => {
      expect(isSDKDisabled()).toBe(true);
    });
  });

  test("returns true for '1'", () => {
    withEnv({ OTEL_SDK_DISABLED: "1" }, () => {
      expect(isSDKDisabled()).toBe(true);
    });
  });

  test("returns false for 'false'", () => {
    withEnv({ OTEL_SDK_DISABLED: "false" }, () => {
      expect(isSDKDisabled()).toBe(false);
    });
  });

  test("returns false for invalid values", () => {
    withEnv({ OTEL_SDK_DISABLED: "invalid" }, () => {
      expect(isSDKDisabled()).toBe(false);
    });
  });
});

describe("parseLogLevel", () => {
  test("returns undefined when not set", () => {
    withEnv({}, () => {
      expect(parseLogLevel()).toBeUndefined();
    });
  });

  test("parses valid log levels", () => {
    const levels = ["NONE", "ERROR", "WARN", "INFO", "DEBUG", "VERBOSE", "ALL"];
    for (const level of levels) {
      withEnv({ OTEL_LOG_LEVEL: level }, () => {
        expect(parseLogLevel()).toBe(level);
      });
    }
  });

  test("handles lowercase input", () => {
    withEnv({ OTEL_LOG_LEVEL: "info" }, () => {
      expect(parseLogLevel()).toBe("INFO");
    });
  });

  test("returns undefined for invalid level", () => {
    withEnv({ OTEL_LOG_LEVEL: "INVALID" }, () => {
      expect(parseLogLevel()).toBeUndefined();
    });
  });
});

describe("parseTraceExporter", () => {
  test("returns 'otlp' by default", () => {
    withEnv({}, () => {
      expect(parseTraceExporter()).toBe("otlp");
    });
  });

  test("parses valid exporters", () => {
    const exporters = ["otlp", "zipkin", "console", "none"];
    for (const exporter of exporters) {
      withEnv({ OTEL_TRACES_EXPORTER: exporter }, () => {
        expect(parseTraceExporter()).toBe(exporter);
      });
    }
  });

  test("handles uppercase input", () => {
    withEnv({ OTEL_TRACES_EXPORTER: "ZIPKIN" }, () => {
      expect(parseTraceExporter()).toBe("zipkin");
    });
  });

  test("takes first value from comma-separated list", () => {
    withEnv({ OTEL_TRACES_EXPORTER: "zipkin,otlp" }, () => {
      expect(parseTraceExporter()).toBe("zipkin");
    });
  });

  test("returns default for invalid exporter", () => {
    withEnv({ OTEL_TRACES_EXPORTER: "invalid" }, () => {
      expect(parseTraceExporter()).toBe("otlp");
    });
  });
});

describe("parseMetricsExporter", () => {
  test("returns 'otlp' by default", () => {
    withEnv({}, () => {
      expect(parseMetricsExporter()).toBe("otlp");
    });
  });

  test("parses valid exporters", () => {
    const exporters = ["otlp", "prometheus", "console", "none"];
    for (const exporter of exporters) {
      withEnv({ OTEL_METRICS_EXPORTER: exporter }, () => {
        expect(parseMetricsExporter()).toBe(exporter);
      });
    }
  });
});

describe("parseLogsExporter", () => {
  test("returns 'otlp' by default", () => {
    withEnv({}, () => {
      expect(parseLogsExporter()).toBe("otlp");
    });
  });

  test("parses valid exporters", () => {
    const exporters = ["otlp", "console", "none"];
    for (const exporter of exporters) {
      withEnv({ OTEL_LOGS_EXPORTER: exporter }, () => {
        expect(parseLogsExporter()).toBe(exporter);
      });
    }
  });
});

describe("parsePropagators", () => {
  test("returns default ['tracecontext', 'baggage'] when not set", () => {
    withEnv({}, () => {
      expect(parsePropagators()).toEqual(["tracecontext", "baggage"]);
    });
  });

  test("parses single propagator", () => {
    withEnv({ OTEL_PROPAGATORS: "b3" }, () => {
      expect(parsePropagators()).toEqual(["b3"]);
    });
  });

  test("parses multiple propagators", () => {
    withEnv({ OTEL_PROPAGATORS: "tracecontext,baggage,b3" }, () => {
      expect(parsePropagators()).toEqual(["tracecontext", "baggage", "b3"]);
    });
  });

  test("handles uppercase input", () => {
    withEnv({ OTEL_PROPAGATORS: "B3,JAEGER" }, () => {
      expect(parsePropagators()).toEqual(["b3", "jaeger"]);
    });
  });

  test("filters out invalid propagators", () => {
    withEnv({ OTEL_PROPAGATORS: "tracecontext,invalid,baggage" }, () => {
      expect(parsePropagators()).toEqual(["tracecontext", "baggage"]);
    });
  });

  test("returns default when all propagators are invalid", () => {
    withEnv({ OTEL_PROPAGATORS: "invalid1,invalid2" }, () => {
      expect(parsePropagators()).toEqual(["tracecontext", "baggage"]);
    });
  });

  test("handles whitespace", () => {
    withEnv({ OTEL_PROPAGATORS: " b3 , jaeger " }, () => {
      expect(parsePropagators()).toEqual(["b3", "jaeger"]);
    });
  });
});

describe("batch span processor config", () => {
  test("parseBspScheduleDelay returns undefined when not set", () => {
    withEnv({}, () => {
      expect(parseBspScheduleDelay()).toBeUndefined();
    });
  });

  test("parseBspScheduleDelay parses valid number", () => {
    withEnv({ OTEL_BSP_SCHEDULE_DELAY: "3000" }, () => {
      expect(parseBspScheduleDelay()).toBe(3000);
    });
  });

  test("parseBspScheduleDelay returns undefined for negative", () => {
    withEnv({ OTEL_BSP_SCHEDULE_DELAY: "-100" }, () => {
      expect(parseBspScheduleDelay()).toBeUndefined();
    });
  });

  test("parseBspScheduleDelay returns undefined for zero", () => {
    withEnv({ OTEL_BSP_SCHEDULE_DELAY: "0" }, () => {
      expect(parseBspScheduleDelay()).toBeUndefined();
    });
  });

  test("parseBspExportTimeout parses valid number", () => {
    withEnv({ OTEL_BSP_EXPORT_TIMEOUT: "20000" }, () => {
      expect(parseBspExportTimeout()).toBe(20000);
    });
  });

  test("parseBspMaxQueueSize parses valid number", () => {
    withEnv({ OTEL_BSP_MAX_QUEUE_SIZE: "4096" }, () => {
      expect(parseBspMaxQueueSize()).toBe(4096);
    });
  });

  test("parseBspMaxExportBatchSize parses valid number", () => {
    withEnv({ OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "1024" }, () => {
      expect(parseBspMaxExportBatchSize()).toBe(1024);
    });
  });
});

describe("metric reader config", () => {
  test("parseMetricExportInterval returns undefined when not set", () => {
    withEnv({}, () => {
      expect(parseMetricExportInterval()).toBeUndefined();
    });
  });

  test("parseMetricExportInterval parses valid number", () => {
    withEnv({ OTEL_METRIC_EXPORT_INTERVAL: "30000" }, () => {
      expect(parseMetricExportInterval()).toBe(30000);
    });
  });

  test("parseMetricExportTimeout parses valid number", () => {
    withEnv({ OTEL_METRIC_EXPORT_TIMEOUT: "15000" }, () => {
      expect(parseMetricExportTimeout()).toBe(15000);
    });
  });
});

describe("parseOtelEnvConfig", () => {
  test("returns full config object with defaults", () => {
    withEnv({}, () => {
      const config = parseOtelEnvConfig();
      expect(config).toEqual({
        sdkDisabled: false,
        logLevel: undefined,
        traceExporter: "otlp",
        metricsExporter: "otlp",
        logsExporter: "otlp",
        propagators: ["tracecontext", "baggage"],
        bspScheduleDelay: undefined,
        bspExportTimeout: undefined,
        bspMaxQueueSize: undefined,
        bspMaxExportBatchSize: undefined,
        metricExportInterval: undefined,
        metricExportTimeout: undefined,
      });
    });
  });

  test("returns full config with all env vars set", () => {
    withEnv(
      {
        OTEL_SDK_DISABLED: "true",
        OTEL_LOG_LEVEL: "DEBUG",
        OTEL_TRACES_EXPORTER: "zipkin",
        OTEL_METRICS_EXPORTER: "prometheus",
        OTEL_LOGS_EXPORTER: "console",
        OTEL_PROPAGATORS: "b3,jaeger",
        OTEL_BSP_SCHEDULE_DELAY: "2000",
        OTEL_BSP_EXPORT_TIMEOUT: "25000",
        OTEL_BSP_MAX_QUEUE_SIZE: "1024",
        OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "256",
        OTEL_METRIC_EXPORT_INTERVAL: "45000",
        OTEL_METRIC_EXPORT_TIMEOUT: "20000",
      },
      () => {
        const config = parseOtelEnvConfig();
        expect(config).toEqual({
          sdkDisabled: true,
          logLevel: "DEBUG",
          traceExporter: "zipkin",
          metricsExporter: "prometheus",
          logsExporter: "console",
          propagators: ["b3", "jaeger"],
          bspScheduleDelay: 2000,
          bspExportTimeout: 25000,
          bspMaxQueueSize: 1024,
          bspMaxExportBatchSize: 256,
          metricExportInterval: 45000,
          metricExportTimeout: 20000,
        });
      },
    );
  });
});
