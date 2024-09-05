#!/usr/bin/env node

import { spawn as nodeSpawn } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// https://cmake.org/cmake/help/latest/manual/cmake.1.html#generate-a-project-buildsystem
const generateFlags = [
  ["-S", "string", "path to source directory"],
  ["-B", "string", "path to build directory"],
  ["-D", "string", "define a build option (e.g. -DCMAKE_BUILD_TYPE=Release)"],
  ["-G", "string", "build generator (e.g. -GNinja)"],
  ["-W", "string", "enable warnings (e.g. -Wno-dev)"],
  ["--fresh", "boolean", "force a fresh build"],
  ["--log-level", "string", "set the log level"],
  ["--debug-output", "boolean", "print debug output"],
  ["--toolchain", "string", "the toolchain to use"],
];

// https://cmake.org/cmake/help/latest/manual/cmake.1.html#generate-a-project-buildsystem
const buildFlags = [
  ["--config", "string", "build configuration (e.g. --config Release)"],
  ["--target", "string", "build target"],
  ["-t", "string", "same as --target"],
  ["--parallel", "number", "number of parallel jobs"],
  ["-j", "number", "same as --parallel"],
  ["--verbose", "boolean", "enable verbose output"],
  ["-v", "boolean", "same as --verbose"],
];

async function build(args) {
  if (process.platform === "win32" && !process.env["VSINSTALLDIR"]) {
    const shellPath = join(import.meta.dirname, "vs-shell.ps1");
    const scriptPath = import.meta.filename;
    return spawn("pwsh", ["-NoProfile", "-NoLogo", "-File", shellPath, process.argv0, scriptPath, ...args]);
  }

  const env = {
    ...process.env,
    FORCE_COLOR: "1",
    CLICOLOR_FORCE: "1",
  };

  const generateOptions = parseOptions(args, generateFlags);
  const buildOptions = parseOptions(args, buildFlags);

  const buildPath = resolve(generateOptions["-B"] || buildOptions["--build"] || "build");
  generateOptions["-B"] = buildPath;
  buildOptions["--build"] = buildPath;

  const toolchain = generateOptions["--toolchain"];
  if (toolchain) {
    const toolchainPath = resolve(import.meta.dirname, "..", "cmake", "toolchains", `${toolchain}.cmake`);
    generateOptions["--toolchain"] = toolchainPath;
  }

  if (isCacheReadEnabled()) {
    try {
      const cachePath = getCachePath();
      if (existsSync(cachePath)) {
        cpSync(cachePath, buildPath, { recursive: true, force: true });
        generateOptions["--fresh"] = undefined;
        console.log(`Copied branch cache from ${cachePath} to ${buildPath}`);
      }
    } catch (error) {
      try {
        const mainCachePath = getCachePath(getDefaultBranch());
        if (existsSync(mainCachePath)) {
          cpSync(mainCachePath, buildPath, { recursive: true, force: true });
          generateOptions["--fresh"] = undefined;
          console.log(`Copied main cache from ${mainCachePath} to ${buildPath}`);
        }
      } catch (error) {
        console.warn("Failed to read cache", error);
      }
    }
  }

  const generateArgs = Object.entries(generateOptions).flatMap(([flag, value]) =>
    flag.startsWith("-D") ? [`${flag}=${value}`] : [flag, value],
  );
  await spawn("cmake", generateArgs, { env });

  const buildArgs = Object.entries(buildOptions)
    .sort(([a], [b]) => (a === "--build" ? -1 : a.localeCompare(b)))
    .flatMap(([flag, value]) => [flag, value]);
  await spawn("cmake", buildArgs, { env });

  if (isCacheWriteEnabled()) {
    try {
      const cachePath = getCachePath();
      rmSync(cachePath, { recursive: true, force: true });
      cpSync(buildPath, cachePath, { recursive: true, force: true });
      console.log(`Saved cache to ${cachePath}`);
    } catch (error) {
      console.warn("Failed to save cache", error);
    }
  }
}

function getCachePath(branch) {
  const repository = process.env.BUILDKITE_REPO;
  const fork = process.env.BUILDKITE_PULL_REQUEST_REPO;
  const repositoryKey = (fork || repository).replace(/[^a-z0-9]/i, "-");
  const branchKey = (branch || process.env.BUILDKITE_BRANCH).replace(/[^a-z0-9]/i, "-");
  const stepKey = process.env.BUILDKITE_STEP_KEY.replace(/[^a-z0-9]/i, "-");
  return join(homedir(), "cache", repositoryKey, branchKey, stepKey);
}

function isCacheReadEnabled() {
  return (
    process.env.BUILDKITE === "true" &&
    process.env.BUILDKITE_CLEAN_CHECKOUT !== "true" &&
    process.env.BUILDKITE_BRANCH !== getDefaultBranch()
  );
}

function isCacheWriteEnabled() {
  return process.env.BUILDKITE === "true";
}

function getDefaultBranch() {
  return process.env.BUILDKITE_PIPELINE_DEFAULT_BRANCH || "main";
}

function parseOptions(args, flags = []) {
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    for (const [flag, type] of flags) {
      if (arg === flag) {
        if (type === "boolean") {
          options[arg] = undefined;
        } else {
          options[arg] = args[++i];
        }
      } else if (arg.startsWith(flag)) {
        const delim = arg.indexOf("=");
        if (delim === -1) {
          options[flag] = arg.slice(flag.length);
        } else {
          options[arg.slice(0, delim)] = arg.slice(delim + 1);
        }
      }
    }
  }

  return options;
}

async function spawn(command, args, options) {
  const effectiveArgs = args.filter(Boolean);
  const description = [command, ...effectiveArgs].map(arg => (arg.includes(" ") ? JSON.stringify(arg) : arg)).join(" ");
  console.log("$", description);

  const subprocess = nodeSpawn(command, effectiveArgs, {
    stdio: "pipe",
    ...options,
  });

  let timestamp;
  subprocess.on("spawn", () => {
    timestamp = Date.now();
  });

  const stdout = new Promise(resolve => {
    subprocess.stdout.on("end", resolve);
    subprocess.stdout.on("data", data => process.stdout.write(data));
  });

  const stderr = new Promise(resolve => {
    subprocess.stderr.on("end", resolve);
    subprocess.stderr.on("data", data => process.stderr.write(data));
  });

  const done = Promise.all([stdout, stderr]);

  const { error, exitCode, signalCode } = await new Promise(resolve => {
    subprocess.on("error", error => resolve({ error }));
    subprocess.on("exit", (exitCode, signalCode) => resolve({ exitCode, signalCode }));
  });

  await done;

  const duration = Date.now() - timestamp;
  if (duration > 60000) {
    console.log(`Took ${(duration / 60000).toFixed(2)} minutes`);
  } else {
    console.log(`Took ${(duration / 1000).toFixed(2)} seconds`);
  }

  if (exitCode === 0) {
    return;
  }

  if (error) {
    console.error(error);
  } else if (signalCode) {
    console.error(`Command killed: ${signalCode}`);
  } else {
    console.error(`Command exited: code ${exitCode}`);
  }

  process.exit(exitCode ?? 1);
}

build(process.argv.slice(2));
