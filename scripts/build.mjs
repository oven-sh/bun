#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join } from "node:path";

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

function build(args) {
  if (process.platform === "win32" && !process.env["VSINSTALLDIR"]) {
    const shellPath = join(import.meta.dirname, "vs-shell.ps1");
    const scriptPath = import.meta.filename;
    spawn("pwsh", ["-NoProfile", "-NoLogo", "-File", shellPath, scriptPath, ...args], {
      stdio: "inherit",
    });
    return;
  }

  const env = {
    ...process.env,
    FORCE_COLOR: "1",
    CLICOLOR_FORCE: "1",
  };

  const generateOptions = parseOptions(args, generateFlags);
  const generateArgs = Object.entries(generateOptions).flatMap(([flag, value]) =>
    flag.startsWith("-D") ? [`${flag}=${value}`] : [flag, value],
  );
  spawn("cmake", generateArgs, { stdio: "inherit", env });

  const buildOptions = parseOptions(args, buildFlags);
  const buildArgs = Object.entries(buildOptions).flatMap(([flag, value]) => [flag, value]);
  const buildPath = generateOptions["-B"] || "build";
  spawn("cmake", ["--build", buildPath, ...buildArgs], { stdio: "inherit", env });
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

function spawn(command, args, options) {
  const description = [command, ...args]
    .filter(Boolean)
    .map(arg => (arg.includes(" ") ? JSON.stringify(arg) : arg))
    .join(" ");
  console.log("$", description);

  const timestamp = Date.now();
  const { status, signal, error, stdout } = spawnSync(command, args.filter(Boolean), options);

  const duration = Date.now() - timestamp;
  if (duration > 60000) {
    console.log(`Took ${(duration / 60000).toFixed(2)} minutes`);
  } else {
    console.log(`Took ${(duration / 1000).toFixed(2)} seconds`);
  }

  if (status === 0) {
    return stdout?.toString()?.trim();
  }

  if (error) {
    // console.error(error);
  } else if (signal) {
    console.error(`Command killed: ${signal}`);
  } else {
    console.error(`Command exited: code ${status}`);
  }

  process.exit(status ?? 1);
}

build(process.argv.slice(2));
