#!/usr/bin/env node

import { spawn as nodeSpawn } from "node:child_process";
import { rmSync } from "node:fs";
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

const extraFlags = [
  ["--clean", "boolean", "clean the build directory before building"],
  ["--toolchain", "string", "the toolchain to use"],
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
  const generateArgs = Object.entries(generateOptions).flatMap(([flag, value]) =>
    flag.startsWith("-D") ? [`${flag}=${value}`] : [flag, value],
  );

  const buildPath = generateOptions["-B"] || "build";
  const extraOptions = parseOptions(args, extraFlags);
  if ("--clean" in extraOptions) {
    rmSync(buildPath, { recursive: true, force: true });
  }
  if ("--toolchain" in extraOptions) {
    const toolchain = extraOptions["--toolchain"];
    const toolchainPath = resolve(import.meta.dirname, "..", "cmake", "toolchains", `${toolchain}.cmake`);
    generateArgs.push("--toolchain", toolchainPath);
  }
  await spawn("cmake", generateArgs, { env });

  const buildOptions = parseOptions(args, buildFlags);
  const buildArgs = Object.entries(buildOptions).flatMap(([flag, value]) => [flag, value]);
  await spawn("cmake", ["--build", buildPath, ...buildArgs], { env });
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
