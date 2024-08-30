#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join } from "node:path";

if (process.platform === "win32" && !process.env["VSINSTALLDIR"]) {
  const shellPath = join(import.meta.dirname, "vs-shell.ps1");
  const { status } = spawnSync("pwsh", ["-NoProfile", "-NoLogo", "-File", shellPath, ...process.argv], {
    stdio: "inherit",
  });
  process.exit(status ?? 1);
}

// https://cmake.org/cmake/help/latest/manual/cmake.1.html#generate-a-project-buildsystem
const generateFlags = [
  "-S", // path to source directory
  "-B", // path to build directory
  "-D", // define a build option (e.g. -DCMAKE_BUILD_TYPE=Release)
  "-G", // build generator (e.g. -GNinja)
  "-W", // enable warnings (e.g. -Wno-dev)
  "--fresh", // force a fresh build
  "--log-level", // set the log level
];

// https://cmake.org/cmake/help/latest/manual/cmake.1.html#generate-a-project-buildsystem
const buildFlags = [
  "--build", // path to build directory
  "--config", // build configuration (e.g. --config Release)
  "--target", // build target
  "-t", // same as --target
  "--parallel", // number of parallel jobs
  "-j", // same as --parallel
  "--verbose", // enable verbose output
  "-v", // same as --verbose
];

function readFlag(flag, args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      return args.splice(i, 2);
    }
    if (arg.startsWith(flag)) {
      return args.splice(i, 1);
    }
  }
  return [];
}

const args = process.argv.slice(2);

const generateArgs = [];
for (const flag of generateFlags) {
  generateArgs.push(...readFlag(flag, args));
}

if (!generateArgs.some(arg => arg.startsWith("-G"))) {
  generateArgs.push("-GNinja");
}

if (!generateArgs.some(arg => arg.startsWith("-B"))) {
  generateArgs.push("-B", "build");
}

if (!generateArgs.some(arg => arg.startsWith("-DCMAKE_BUILD_TYPE"))) {
  generateArgs.push("-DCMAKE_BUILD_TYPE=Debug");
}

const buildArgs = [];
for (const flag of buildFlags) {
  buildArgs.push(...readFlag(flag, args));
}

if (args.length) {
  buildArgs.push("--", ...args.splice(0));
}

for (const args of [generateArgs, buildArgs]) {
  console.log("$", "cmake", ...args);
  const timestamp = Date.now();

  const { status } = spawnSync("cmake", args, {
    stdio: "inherit",
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      CLICOLOR_FORCE: "1",
    },
  });

  const duration = Date.now() - timestamp;
  if (duration > 60000) {
    console.log(`Took ${(duration / 60000).toFixed(2)} minutes`);
  } else {
    console.log(`Took ${(duration / 1000).toFixed(2)} seconds`);
  }

  if (status !== 0) {
    process.exit(status ?? 1);
  }
}
