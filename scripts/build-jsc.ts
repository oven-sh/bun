#!/usr/bin/env bun
import { spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { arch, platform } from "os";
import { join, resolve } from "path";

// Build configurations
type BuildConfig = "debug" | "release" | "lto";

// Parse command line arguments
const args = process.argv.slice(2);
const buildConfig: BuildConfig = (args[0] as BuildConfig) || "debug";
const validConfigs = ["debug", "release", "lto"];

if (!validConfigs.includes(buildConfig)) {
  console.error(`Invalid build configuration: ${buildConfig}`);
  console.error(`Valid configurations: ${validConfigs.join(", ")}`);
  process.exit(1);
}

// Detect platform
const OS_NAME = platform().toLowerCase();
const ARCH_NAME_RAW = arch();
const IS_MAC = OS_NAME === "darwin";
const IS_LINUX = OS_NAME === "linux";
const IS_ARM64 = ARCH_NAME_RAW === "arm64" || ARCH_NAME_RAW === "aarch64";

// Paths
const ROOT_DIR = resolve(import.meta.dir, "..");
const WEBKIT_DIR = resolve(ROOT_DIR, "vendor/WebKit");
const WEBKIT_BUILD_DIR = join(WEBKIT_DIR, "WebKitBuild");
const WEBKIT_RELEASE_DIR = join(WEBKIT_BUILD_DIR, "Release");
const WEBKIT_DEBUG_DIR = join(WEBKIT_BUILD_DIR, "Debug");
const WEBKIT_RELEASE_DIR_LTO = join(WEBKIT_BUILD_DIR, "ReleaseLTO");

// Homebrew prefix detection
const HOMEBREW_PREFIX = IS_ARM64 ? "/opt/homebrew/" : "/usr/local/";

// Compiler detection
function findExecutable(names: string[]): string | null {
  for (const name of names) {
    const result = spawnSync("which", [name], { encoding: "utf8" });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  }
  return null;
}

const CC = findExecutable(["clang-19", "clang"]) || "clang";
const CXX = findExecutable(["clang++-19", "clang++"]) || "clang++";

// Build directory based on config
const getBuildDir = (config: BuildConfig) => {
  switch (config) {
    case "debug":
      return WEBKIT_DEBUG_DIR;
    case "lto":
      return WEBKIT_RELEASE_DIR_LTO;
    default:
      return WEBKIT_RELEASE_DIR;
  }
};

// Common CMake flags
const getCommonFlags = () => {
  const flags = [
    "-DPORT=JSCOnly",
    "-DENABLE_STATIC_JSC=ON",
    "-DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON",
    "-DUSE_THIN_ARCHIVES=OFF",
    "-DUSE_BUN_JSC_ADDITIONS=ON",
    "-DUSE_BUN_EVENT_LOOP=ON",
    "-DENABLE_FTL_JIT=ON",
    "-G",
    "Ninja",
    `-DCMAKE_C_COMPILER=${CC}`,
    `-DCMAKE_CXX_COMPILER=${CXX}`,
  ];

  if (IS_MAC) {
    flags.push(
      "-DENABLE_SINGLE_THREADED_VM_ENTRY_SCOPE=ON",
      "-DBUN_FAST_TLS=ON",
      "-DPTHREAD_JIT_PERMISSIONS_API=1",
      "-DUSE_PTHREAD_JIT_PERMISSIONS_API=ON",
    );
  } else if (IS_LINUX) {
    flags.push(
      "-DJSEXPORT_PRIVATE=WTF_EXPORT_DECLARATION",
      "-DUSE_VISIBILITY_ATTRIBUTE=1",
      "-DENABLE_REMOTE_INSPECTOR=ON",
    );
  }

  return flags;
};

// Build-specific CMake flags
const getBuildFlags = (config: BuildConfig) => {
  const flags = [...getCommonFlags()];

  switch (config) {
    case "debug":
      flags.push(
        "-DCMAKE_BUILD_TYPE=Debug",
        "-DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON",
        "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
        "-DENABLE_REMOTE_INSPECTOR=ON",
        "-DUSE_VISIBILITY_ATTRIBUTE=1",
      );

      if (IS_MAC) {
        // Enable address sanitizer by default on Mac debug builds
        flags.push("-DENABLE_SANITIZERS=address");
        // To disable asan, comment the line above and uncomment:
        // flags.push("-DENABLE_MALLOC_HEAP_BREAKDOWN=ON");
      }
      break;

    case "lto":
      flags.push("-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_C_FLAGS=-flto=full", "-DCMAKE_CXX_FLAGS=-flto=full");
      break;

    default: // release
      flags.push("-DCMAKE_BUILD_TYPE=RelWithDebInfo");
      break;
  }

  return flags;
};

// Environment variables for the build
const getBuildEnv = () => {
  const env = { ...process.env };

  const cflags = ["-ffat-lto-objects"];
  const cxxflags = ["-ffat-lto-objects"];

  if (IS_LINUX && buildConfig !== "lto") {
    cflags.push("-Wl,--whole-archive");
    cxxflags.push("-Wl,--whole-archive", "-DUSE_BUN_JSC_ADDITIONS=ON", "-DUSE_BUN_EVENT_LOOP=ON");
  }

  env.CFLAGS = (env.CFLAGS || "") + " " + cflags.join(" ");
  env.CXXFLAGS = (env.CXXFLAGS || "") + " " + cxxflags.join(" ");

  if (IS_MAC) {
    env.ICU_INCLUDE_DIRS = `${HOMEBREW_PREFIX}opt/icu4c/include`;
  }

  return env;
};

// Run a command with proper error handling
function runCommand(command: string, args: string[], options: any = {}) {
  console.log(`Running: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    console.error(`Failed to execute command: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`Command failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

// Main build function
function buildJSC() {
  const buildDir = getBuildDir(buildConfig);
  const cmakeFlags = getBuildFlags(buildConfig);
  const env = getBuildEnv();

  console.log(`Building JSC with configuration: ${buildConfig}`);
  console.log(`Build directory: ${buildDir}`);

  // Create build directories
  if (!existsSync(buildDir)) {
    mkdirSync(buildDir, { recursive: true });
  }

  if (!existsSync(WEBKIT_DIR)) {
    mkdirSync(WEBKIT_DIR, { recursive: true });
  }

  // Configure with CMake
  console.log("\n📦 Configuring with CMake...");
  runCommand("cmake", [...cmakeFlags, WEBKIT_DIR, buildDir], {
    cwd: buildDir,
    env,
  });

  // Build with CMake
  console.log("\n🔨 Building JSC...");
  const buildType = buildConfig === "debug" ? "Debug" : buildConfig === "lto" ? "Release" : "RelWithDebInfo";

  runCommand("cmake", ["--build", buildDir, "--config", buildType, "--target", "jsc"], {
    cwd: buildDir,
    env,
  });

  console.log(`\n✅ JSC build completed successfully!`);
  console.log(`Build output: ${buildDir}`);
}

// Entry point
if (import.meta.main) {
  buildJSC();
}
