#!/usr/bin/env node

// Build and test Bun on macOS, Linux, and Windows.
// https://buildkite.com/docs/pipelines/defining-steps
// - https://buildkite.com/docs/pipelines/command-step
// - https://buildkite.com/docs/pipelines/block-step

import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * @typedef BuildOptions
 * @property {"darwin" | "linux" | "windows"} os
 * @property {"aarch64" | "x64"} arch
 * @property {boolean} baseline
 * @property {boolean} [noLto]
 */

/**
 * @param {BuildOptions} options
 * @returns {GroupStep}
 */
function getBuildStep(options) {
  const { os, arch, baseline, noLto } = options;
  const target = getTarget(options); // "{os}-{arch}-[baseline]"
  const label = getLabel(options); // "{emoji} {arch}"
  const env = {
    CPU_TARGET: getCpuTarget(options),
    CCACHE_DIR: "$$HOME/.cache/ccache",
    SCCACHE_DIR: "$$HOME/.cache/sccache",
    ZIG_LOCAL_CACHE_DIR: "$$HOME/.cache/zig-cache",
    BUN_DEPS_CACHE_DIR: "$$HOME/.cache/bun-deps",
  };
  const agents = {
    queue: `build-${os}`,
    os,
    arch,
  };
  /**
   * @param {string[]} args
   * @returns {string}
   */
  const toCommand = (...args) => {
    if (os === "windows") {
      return args
        .flatMap(arg => {
          if (!arg) {
            return [];
          }
          if (arg.startsWith("--")) {
            const [first, second] = arg.split("=");
            return [
              first.startsWith("--") ? "--" + first.substring(2, 3).toUpperCase() + first.substring(3) : first,
              second || "$$True",
            ];
          }
          return arg.replace(/\.sh$/, ".ps1").replace(/\//g, "\\");
        })
        .join(" ");
    }
    return args
      .filter(Boolean)
      .flatMap(arg => (arg.includes("=") ? arg.split("=") : arg))
      .join(" ");
  };
  /**
   * @param {string} path
   * @returns {string}
   */
  const toPath = path => {
    return os === "windows" ? path.replace(/\//g, "\\") : path;
  };
  return {
    key: `${target}-build`,
    label,
    steps: [
      {
        key: `${target}-build-deps`,
        label: `${label} - build-deps`,
        artifact_paths: toPath("build/bun-deps/**/*"),
        command: toCommand("./scripts/all-dependencies.sh"),
        agents,
        env,
      },
      {
        key: `${target}-build-zig`,
        label: `${label} - build-zig`,
        artifact_paths: ["build/bun-zig.o"],
        command: ["./scripts/build-bun-zig.sh", os, arch],
        // `zig build` is much faster on macOS aarch64 than on Linux or Windows.
        agents: {
          queue: "build-darwin",
          os: "darwin",
          arch: "aarch64",
        },
        env,
      },
      {
        key: `${target}-build-cpp`,
        label: `${label} - build-cpp`,
        artifact_paths: toPath("build/bun-cpp-objects.a"),
        command: toCommand("./scripts/build-bun-cpp.sh", baseline && "--baseline", noLto && "--fast"),
        agents,
        env,
      },
      noLto && {
        key: `${target}-build-bun-nolto`,
        label: `${label} - build-bun (no-lto)`,
        artifact_paths: [`${target}-nolto.zip`, `${target}-nolto-profile.zip`],
        command: toCommand("./scripts/buildkite-link-bun.sh", `--tag=${target}`, baseline && "--baseline", "--fast"),
        depends_on: [`${target}-build-deps`, `${target}-build-zig`, `${target}-build-cpp`],
        agents,
        env,
      },
      {
        key: `${target}-build-bun`,
        label: `${label} - build-bun`,
        artifact_paths: [`${target}.zip`, `${target}-profile.zip`],
        command: toCommand("./scripts/buildkite-link-bun.sh", `--tag=${target}`, baseline && "--baseline"),
        depends_on: noLto
          ? [`${target}-build-bun-nolto`]
          : [`${target}-build-deps`, `${target}-build-zig`, `${target}-build-cpp`],
        agents,
        env,
      },
    ],
  };
}

/**
 * @param {BuildOptions} options
 * @returns {string}
 */
function getTarget(options) {
  const { os, arch, baseline } = options;
  let target = `${os}-${arch}`;
  if (baseline) {
    target += "-baseline";
  }
  return target;
}

/**
 * @param {BuildOptions} options
 */
function getLabel(options) {
  const { os, arch, baseline } = options;
  const emoji = `:${os}:`;
  const label = baseline ? "x64-baseline" : arch;
  return `${emoji} ${label}`;
}

/**
 * @link https://buildkite.com/docs/pipelines/group-step
 * @typedef GroupStep
 * @property {string} key
 * @property {string} label
 * @property {string | string[]} [depends_on]
 * @property {boolean | string} [skip]
 * @property {CommandStep[]} steps
 */

/**
 * @link https://buildkite.com/docs/pipelines/command-step
 * @typedef CommandStep
 * @property {string} key
 * @property {string} label
 * @property {string | string[]} [command]
 * @property {string | string[]} [artifact_paths]
 * @property {Record<string, string>} [env]
 * @property {Record<string, string>} [agents]
 * @property {string | string[]} [depends_on]
 * @property {number} [parallelism]
 * @property {boolean} [soft_fail]
 * @property {{automatic?: RetryOptions[]}} [retry]
 * @property {boolean | string} [skip]
 * @property {number} [timeout_in_minutes]
 * @property {number} [priority]
 */

/**
 * @link https://buildkite.com/docs/pipelines/command-step#retry-attributes
 * @typedef RetryOptions
 * @property {number | string} [exit_status]
 * @property {string} [signal]
 * @property {string} [signal_reason]
 * @property {number} [limit]
 */

/**
 * @param {Options}
 * @returns {string}
 */
function getCpuTarget({ arch, baseline }) {
  if (arch === "x64") {
    return baseline ? "nehalem" : "haswell";
  }
  return "native";
}

/**
 * @param {unknown} object
 * @param {number} level
 * @returns {string}
 */
function toYaml(object, level = 0) {
  if (typeof object === "undefined" || object === null) {
    return "~";
  }
  if (typeof object === "string" || typeof object === "number" || typeof object === "boolean") {
    return JSON.stringify(object);
  }
  if (typeof object !== "object") {
    throw new Error(`Invalid YAML: ${object} is a ${typeof object}`);
  }
  const indent = level ? " ".repeat(level * 2) : "";
  const isPresent = value => typeof value !== "undefined" && value !== null;
  if (Array.isArray(object) || object instanceof Set) {
    const items = [...object].filter(isPresent);
    if (items.length === 0) {
      return "[]";
    }
    return items
      .map(item => {
        const value = toYaml(item, level + 1);
        if (typeof item === "object") {
          return indent + "- " + value.substring(2 + 2);
        }
        return indent + "- " + value;
      })
      .join("\n");
  }
  const entries = Object.entries(object).filter(([_, value]) => isPresent(value));
  if (entries.length === 0) {
    return "{}";
  }
  return entries
    .map(([key, value]) => {
      if (typeof key !== "string") {
        throw new Error(`Invalid YAML: ${key} in object key is a ${typeof key}`);
      }
      if (typeof value === "object") {
        return indent + key + ":" + "\n" + toYaml(value, level + 1);
      }
      return indent + key + ": " + toYaml(value);
    })
    .join("\n");
}

const steps = [
  getBuildStep({
    os: "darwin",
    arch: "aarch64",
    noLto: true,
  }),
];

const pipelinePath = join(import.meta.dirname, "ci.yml");
const pipeline = {
  steps,
};

const pipelineContent = `# Build and test Bun on macOS, Linux, and Windows.
# https://buildkite.com/docs/pipelines/defining-steps

${toYaml(pipeline)}
`;
writeFileSync(pipelinePath, pipelineContent);

console.log("Wrote pipeline:", relative(process.cwd(), pipelinePath));
