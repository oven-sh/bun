import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  formatAnnotationToHtml,
  getEnv,
  getSecret,
  isCI,
  isWindows,
  parseAnnotations,
  parseBoolean,
  printEnvironment,
  reportAnnotationToBuildKite,
  startGroup,
} from "./utils.mjs";

// Detect Windows ARM64 - bun may run under x64 emulation (WoW64), so check multiple indicators
const isWindowsARM64 =
  isWindows &&
  (process.env.PROCESSOR_ARCHITECTURE === "ARM64" ||
    process.env.VSCMD_ARG_HOST_ARCH === "arm64" ||
    process.env.MSYSTEM_CARCH === "aarch64" ||
    (process.env.PROCESSOR_IDENTIFIER || "").includes("ARMv8") ||
    process.arch === "arm64");

if (globalThis.Bun) {
  await import("./glob-sources.mjs");
}

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
  const startTime = Date.now();

  if (process.platform === "win32" && !process.env["VSINSTALLDIR"]) {
    const shellPath = join(import.meta.dirname, "vs-shell.ps1");
    const scriptPath = import.meta.filename;
    return spawn("pwsh", ["-NoProfile", "-NoLogo", "-File", shellPath, process.argv0, scriptPath, ...args]);
  }

  if (isCI) {
    printEnvironment();
  }

  const env = {
    ...process.env,
    FORCE_COLOR: "1",
    CLICOLOR_FORCE: "1",
  };

  const generateOptions = parseOptions(args, generateFlags);
  const buildOptions = parseOptions(args, buildFlags);
  const ciCppBuild = isCI && !!process.env.BUN_CPP_ONLY;

  const buildPath = resolve(generateOptions["-B"] || buildOptions["--build"] || "build");
  generateOptions["-B"] = buildPath;
  buildOptions["--build"] = buildPath;

  if (!generateOptions["-S"]) {
    generateOptions["-S"] = process.cwd();
  }

  if (!generateOptions["-DCACHE_STRATEGY"]) {
    generateOptions["-DCACHE_STRATEGY"] = parseBoolean(getEnv("RELEASE", false) || "false") ? "none" : "auto";
  }

  const toolchain = generateOptions["--toolchain"];
  if (toolchain) {
    const toolchainPath = resolve(import.meta.dirname, "..", "cmake", "toolchains", `${toolchain}.cmake`);
    generateOptions["--toolchain"] = toolchainPath;
  }

  // Windows ARM64: automatically set required options
  if (isWindowsARM64) {
    // Use clang-cl instead of MSVC cl.exe for proper ARM64 flag support
    if (!generateOptions["-DCMAKE_C_COMPILER"]) {
      generateOptions["-DCMAKE_C_COMPILER"] = "clang-cl";
    }
    if (!generateOptions["-DCMAKE_CXX_COMPILER"]) {
      generateOptions["-DCMAKE_CXX_COMPILER"] = "clang-cl";
    }
    // Skip codegen by default since x64 bun crashes under WoW64 emulation
    // Can be overridden with -DSKIP_CODEGEN=OFF once ARM64 bun is available
    if (!generateOptions["-DSKIP_CODEGEN"]) {
      generateOptions["-DSKIP_CODEGEN"] = "ON";
    }
    console.log("Windows ARM64 detected: using clang-cl and SKIP_CODEGEN=ON");
  }

  const generateArgs = Object.entries(generateOptions).flatMap(([flag, value]) =>
    flag.startsWith("-D") ? [`${flag}=${value}`] : [flag, value],
  );

  try {
    await Bun.file(buildPath + "/CMakeCache.txt").delete();
  } catch (e) {}
  await startGroup("CMake Configure", () => spawn("cmake", generateArgs, { env }));

  const envPath = resolve(buildPath, ".env");
  if (existsSync(envPath)) {
    const envFile = readFileSync(envPath, "utf8");
    for (const line of envFile.split(/\r\n|\n|\r/)) {
      const [key, value] = line.split("=");
      env[key] = value;
    }
  }

  const buildArgs = Object.entries(buildOptions)
    .sort(([a], [b]) => (a === "--build" ? -1 : a.localeCompare(b)))
    .flatMap(([flag, value]) => [flag, value]);

  await startGroup("CMake Build", () => spawn("cmake", buildArgs, { env }));

  if (ciCppBuild) {
    await startGroup("ccache stats", () => {
      spawn("ccache", ["--show-stats"], { env });
    });
  }

  printDuration("total", Date.now() - startTime);
}

function isBuildkite() {
  return process.env.BUILDKITE === "true";
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

async function spawn(command, args, options, label) {
  const effectiveArgs = args.filter(Boolean);
  const description = [command, ...effectiveArgs].map(arg => (arg.includes(" ") ? JSON.stringify(arg) : arg)).join(" ");
  let env = options?.env;

  console.log("$", description);

  label ??= basename(command);

  const pipe = process.env.CI === "true";

  if (isBuildkite()) {
    if (process.env.BUN_LINK_ONLY && isWindows) {
      env ||= options?.env || { ...process.env };

      // Pass signing secrets directly to the build process
      // The PowerShell signing script will handle certificate decoding
      env.SM_CLIENT_CERT_PASSWORD = getSecret("SM_CLIENT_CERT_PASSWORD", {
        redact: true,
        required: true,
      });
      env.SM_CLIENT_CERT_FILE = getSecret("SM_CLIENT_CERT_FILE", {
        redact: true,
        required: true,
      });
      env.SM_API_KEY = getSecret("SM_API_KEY", {
        redact: true,
        required: true,
      });
      env.SM_KEYPAIR_ALIAS = getSecret("SM_KEYPAIR_ALIAS", {
        redact: true,
        required: true,
      });
      env.SM_HOST = getSecret("SM_HOST", {
        redact: true,
        required: true,
      });
    }
  }

  const subprocess = nodeSpawn(command, effectiveArgs, {
    stdio: pipe ? "pipe" : "inherit",
    ...options,
    env,
  });

  let killedManually = false;

  function onKill() {
    clearOnKill();
    if (!subprocess.killed) {
      killedManually = true;
      subprocess.kill?.();
    }
  }

  function clearOnKill() {
    process.off("beforeExit", onKill);
    process.off("SIGINT", onKill);
    process.off("SIGTERM", onKill);
  }

  // Kill the entire process tree so everything gets cleaned up. On Windows, job
  // control groups make this haappen automatically so we don't need to do this
  // on Windows.
  if (process.platform !== "win32") {
    process.once("beforeExit", onKill);
    process.once("SIGINT", onKill);
    process.once("SIGTERM", onKill);
  }

  let timestamp;
  subprocess.on("spawn", () => {
    timestamp = Date.now();
  });

  let stdoutBuffer = "";

  let done;
  if (pipe) {
    const stdout = new Promise(resolve => {
      subprocess.stdout.on("end", resolve);
      subprocess.stdout.on("data", data => {
        stdoutBuffer += data.toString();
        process.stdout.write(data);
      });
    });

    const stderr = new Promise(resolve => {
      subprocess.stderr.on("end", resolve);
      subprocess.stderr.on("data", data => {
        stdoutBuffer += data.toString();
        process.stderr.write(data);
      });
    });

    done = Promise.all([stdout, stderr]);
  }

  const { error, exitCode, signalCode } = await new Promise(resolve => {
    subprocess.on("error", error => {
      clearOnKill();
      resolve({ error });
    });
    subprocess.on("exit", (exitCode, signalCode) => {
      clearOnKill();
      resolve({ exitCode, signalCode });
    });
  });

  if (done) {
    await done;
  }

  printDuration(label, Date.now() - timestamp);

  if (exitCode === 0) {
    return;
  }

  if (isBuildkite()) {
    let annotated;
    try {
      const { annotations } = parseAnnotations(stdoutBuffer);
      for (const annotation of annotations) {
        const content = formatAnnotationToHtml(annotation);
        reportAnnotationToBuildKite({
          priority: 10,
          label: annotation.title || annotation.filename,
          content,
        });
        annotated = true;
      }
    } catch (error) {
      console.error(`Failed to parse annotations:`, error);
    }

    if (!annotated) {
      const content = formatAnnotationToHtml({
        filename: relative(process.cwd(), import.meta.filename),
        title: "build failed",
        content: stdoutBuffer,
        source: "build",
        level: "error",
      });
      reportAnnotationToBuildKite({
        priority: 10,
        label: "build failed",
        content,
      });
    }
  }

  if (signalCode) {
    if (!killedManually) {
      console.error(`Command killed: ${signalCode}`);
    }
  } else {
    console.error(`Command exited: code ${exitCode}`);
  }

  process.exit(exitCode ?? 1);
}

function printDuration(label, duration) {
  if (duration > 60000) {
    console.log(`${label} took ${(duration / 60000).toFixed(2)} minutes`);
  } else {
    console.log(`${label} took ${(duration / 1000).toFixed(2)} seconds`);
  }
}

build(process.argv.slice(2));
