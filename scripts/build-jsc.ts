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
const IS_WINDOWS = OS_NAME === "win32";
// On Windows, use PROCESSOR_ARCHITECTURE env var to get native arch (Bun may run under x64 emulation)
const NATIVE_ARCH = IS_WINDOWS ? (process.env.PROCESSOR_ARCHITECTURE || ARCH_NAME_RAW).toUpperCase() : ARCH_NAME_RAW;
const IS_ARM64 = NATIVE_ARCH === "ARM64" || NATIVE_ARCH === "AARCH64" || ARCH_NAME_RAW === "arm64";

// Paths
const ROOT_DIR = resolve(import.meta.dir, "..");
const WEBKIT_DIR = resolve(ROOT_DIR, "vendor/WebKit");
const WEBKIT_BUILD_DIR = join(WEBKIT_DIR, "WebKitBuild");
const WEBKIT_RELEASE_DIR = join(WEBKIT_BUILD_DIR, "Release");
const WEBKIT_DEBUG_DIR = join(WEBKIT_BUILD_DIR, "Debug");
const WEBKIT_RELEASE_DIR_LTO = join(WEBKIT_BUILD_DIR, "ReleaseLTO");

// Windows ICU paths - use vcpkg static build
// Auto-detect triplet: prefer arm64 if it exists, otherwise x64
const VCPKG_ARM64_PATH = join(WEBKIT_DIR, "vcpkg_installed", "arm64-windows-static");
const VCPKG_X64_PATH = join(WEBKIT_DIR, "vcpkg_installed", "x64-windows-static");
const VCPKG_ROOT = existsSync(VCPKG_ARM64_PATH) ? VCPKG_ARM64_PATH : VCPKG_X64_PATH;
const ICU_INCLUDE_DIR = join(VCPKG_ROOT, "include");

// Get ICU library paths based on build config (debug uses 'd' suffix libraries)
function getICULibraryPaths(config: BuildConfig) {
  const isDebug = config === "debug";
  // vcpkg static ICU libraries: release in lib/, debug in debug/lib/ with 'd' suffix
  const libDir = isDebug ? join(VCPKG_ROOT, "debug", "lib") : join(VCPKG_ROOT, "lib");
  const suffix = isDebug ? "d" : "";
  return {
    ICU_LIBRARY: libDir,
    ICU_DATA_LIBRARY: join(libDir, `sicudt${suffix}.lib`),
    ICU_I18N_LIBRARY: join(libDir, `sicuin${suffix}.lib`),
    ICU_UC_LIBRARY: join(libDir, `sicuuc${suffix}.lib`),
  };
}

// Homebrew prefix detection
const HOMEBREW_PREFIX = IS_ARM64 ? "/opt/homebrew/" : "/usr/local/";

// Compiler detection
function findExecutable(names: string[]): string | null {
  for (const name of names) {
    const path = Bun.which(name);
    if (path) return path;
  }
  return null;
}

// Detect ccache
const CCACHE = findExecutable(["ccache"]);
const HAS_CCACHE = CCACHE !== null;

// Configure compilers with ccache if available
// On Windows, use clang-cl for MSVC compatibility
const CC_BASE = IS_WINDOWS
  ? findExecutable(["clang-cl.exe", "clang-cl"]) || "clang-cl"
  : findExecutable(["clang-19", "clang"]) || "clang";
const CXX_BASE = IS_WINDOWS
  ? findExecutable(["clang-cl.exe", "clang-cl"]) || "clang-cl"
  : findExecutable(["clang++-19", "clang++"]) || "clang++";

const CC = HAS_CCACHE ? CCACHE : CC_BASE;
const CXX = HAS_CCACHE ? CCACHE : CXX_BASE;

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
const getCommonFlags = (config: BuildConfig) => {
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
  ];

  // Configure compiler with ccache if available
  if (HAS_CCACHE) {
    flags.push(
      `-DCMAKE_C_COMPILER_LAUNCHER=${CCACHE}`,
      `-DCMAKE_CXX_COMPILER_LAUNCHER=${CCACHE}`,
      `-DCMAKE_C_COMPILER=${CC_BASE}`,
      `-DCMAKE_CXX_COMPILER=${CXX_BASE}`,
    );
  } else {
    flags.push(`-DCMAKE_C_COMPILER=${CC}`, `-DCMAKE_CXX_COMPILER=${CXX}`);
  }

  if (IS_MAC) {
    flags.push(
      "-DENABLE_SINGLE_THREADED_VM_ENTRY_SCOPE=ON",
      "-DBUN_FAST_TLS=ON",
      "-DPTHREAD_JIT_PERMISSIONS_API=1",
      "-DUSE_PTHREAD_JIT_PERMISSIONS_API=ON",
      "-DENABLE_REMOTE_INSPECTOR=ON",
    );
  } else if (IS_LINUX) {
    flags.push(
      "-DJSEXPORT_PRIVATE=WTF_EXPORT_DECLARATION",
      "-DUSE_VISIBILITY_ATTRIBUTE=1",
      "-DENABLE_REMOTE_INSPECTOR=ON",
    );
  } else if (IS_WINDOWS) {
    // Find lld-link for Windows builds
    const lldLink = findExecutable(["lld-link.exe", "lld-link"]) || "lld-link";
    // Get ICU library paths for this build config (debug uses 'd' suffix libraries)
    const icuPaths = getICULibraryPaths(config);

    flags.push(
      "-DENABLE_REMOTE_INSPECTOR=ON",
      "-DUSE_VISIBILITY_ATTRIBUTE=1",
      "-DUSE_SYSTEM_MALLOC=ON",
      `-DCMAKE_LINKER=${lldLink}`,
      `-DICU_ROOT=${VCPKG_ROOT}`,
      `-DICU_LIBRARY=${icuPaths.ICU_LIBRARY}`,
      `-DICU_INCLUDE_DIR=${ICU_INCLUDE_DIR}`,
      // Explicitly set ICU library paths to use vcpkg static libs (debug has 'd' suffix)
      `-DICU_DATA_LIBRARY_RELEASE=${icuPaths.ICU_DATA_LIBRARY}`,
      `-DICU_I18N_LIBRARY_RELEASE=${icuPaths.ICU_I18N_LIBRARY}`,
      `-DICU_UC_LIBRARY_RELEASE=${icuPaths.ICU_UC_LIBRARY}`,
      "-DCMAKE_C_FLAGS=/DU_STATIC_IMPLEMENTATION",
      "-DCMAKE_CXX_FLAGS=/DU_STATIC_IMPLEMENTATION /clang:-fno-c++-static-destructors",
    );
  }

  return flags;
};

// Build-specific CMake flags
const getBuildFlags = (config: BuildConfig) => {
  const flags = [...getCommonFlags(config)];

  switch (config) {
    case "debug":
      flags.push(
        "-DCMAKE_BUILD_TYPE=Debug",
        "-DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON",
        "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
        "-DUSE_VISIBILITY_ATTRIBUTE=1",
      );

      if (IS_MAC || IS_LINUX) {
        // Enable address sanitizer by default on Mac/Linux debug builds
        flags.push("-DENABLE_SANITIZERS=address");
        // To disable asan, comment the line above and uncomment:
        // flags.push("-DENABLE_MALLOC_HEAP_BREAKDOWN=ON");
      }

      if (IS_WINDOWS) {
        flags.push("-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDebug");
      }
      break;

    case "lto":
      flags.push("-DCMAKE_BUILD_TYPE=Release");
      if (IS_WINDOWS) {
        // On Windows, append LTO flags to existing Windows-specific flags
        flags.push(
          "-DCMAKE_C_FLAGS=/DU_STATIC_IMPLEMENTATION -flto=full",
          "-DCMAKE_CXX_FLAGS=/DU_STATIC_IMPLEMENTATION /clang:-fno-c++-static-destructors -flto=full",
          "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded",
        );
      } else {
        flags.push("-DCMAKE_C_FLAGS=-flto=full", "-DCMAKE_CXX_FLAGS=-flto=full");
      }
      break;

    default: // release
      flags.push("-DCMAKE_BUILD_TYPE=RelWithDebInfo");
      if (IS_WINDOWS) {
        flags.push("-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded");
      }
      break;
  }

  return flags;
};

// Environment variables for the build
const getBuildEnv = () => {
  const env = { ...process.env };

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
  if (HAS_CCACHE) {
    console.log(`Using ccache for faster builds: ${CCACHE}`);
  }

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
