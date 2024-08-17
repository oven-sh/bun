#!/usr/bin/env node

/**
 * This script builds bun and its dependencies.
 * It cannot use Bun APIs, since it's run using Node.js.
 */

import { isMacOS, isWindows, isVerbose, isColorTerminal, isCI, isBuildKite, getCpus } from "./util/env.mjs";
import { spawn, spawnSync } from "./util/spawn.mjs";
import { join, resolve, relative, basename, dirname, exists, isFile, isDirectory } from "./util/fs.mjs";
import { readFile, writeFile, rm, cp, mv, readdir, symlink, mkdir, mkdirTmp, chmod, zip, tar } from "./util/fs.mjs";
import { assertFile, assertDirectory, homedir, downloadFile } from "./util/fs.mjs";
import { getBuildId, getBuildStep } from "./util/ci.mjs";
import { build as dockerBuild, run as dockerRun, isInsideDocker } from "./util/docker.mjs";
import { clone as gitClone, getPullRequest, getSha, getHash } from "./util/git.mjs";
import { parseArch, parseOs, parseSemver, parseTarget } from "./util/format.mjs";
import { addToPath, getCommand, getOption, compareSemver, runTask, print } from "./util/util.mjs";
import {
  getMetadata as buildkiteGetMetadata,
  uploadArtifact as buildkiteUploadArtifact,
  downloadArtifact as buildkiteDownloadArtifact,
} from "./util/buildkite.mjs";

async function main() {
  const options = getBuildOptions();
  const jsonOptions = getOption({
    name: "json",
    description: "The build options as a JSON string",
    type: "string",
    parse: string => JSON.parse(string),
  });
  if (jsonOptions) {
    Object.assign(options, jsonOptions);
  }

  const args = process.argv.slice(2).filter(arg => !arg.startsWith("-"));

  const { docker } = options;
  if (docker && !isInsideDocker()) {
    await buildInDocker(options, ...args);
  } else {
    Object.assign(process.env, getBuildEnv(options));
    await build(options, ...args);
  }
}

/**
 * @typedef {Object} BuildOptions
 * @property {string} cwd
 * @property {string} buildPath
 * @property {"linux" | "darwin" | "windows"} os
 * @property {"x64" | "aarch64"} arch
 * @property {boolean} [baseline]
 * @property {string} [target]
 * @property {boolean} [docker]
 * @property {boolean} [webkit]
 * @property {boolean} [icu4c]
 * @property {boolean} [debug]
 * @property {boolean} [lto]
 * @property {boolean} [pic]
 * @property {boolean} [valgrind]
 * @property {string} [osxVersion]
 * @property {string} [llvmVersion]
 * @property {string} [cc]
 * @property {string} [cxx]
 * @property {string} [ar]
 * @property {string} [ld]
 * @property {string} [ranlib]
 * @property {string} [ccache]
 * @property {string} [clean]
 * @property {string} [artifact]
 * @property {string} [cachePath]
 * @property {"read-write" | "read" | "write" | "none"} [cacheStrategy]
 * @property {boolean} [ci]
 */

/**
 * Gets the default build options.
 * @returns {BuildOptions}
 */
export function getBuildOptions() {
  const cwd = getOption({
    name: "cwd",
    description: "The current working directory",
    parse: resolve,
    defaultValue: () => process.cwd(),
  });

  const ci = getOption({
    name: "ci",
    description: "If the build is running in CI, or if you want to mimic a CI build",
    type: "boolean",
    defaultValue: isCI,
  });

  const release = getOption({
    name: "release",
    description: "If the build is a non-canary release build",
    type: "boolean",
  });

  const canary = getOption({
    name: "canary",
    description: "The canary revision, if the build is a canary build",
    type: "number",
    defaultValue: () => {
      if (release) {
        return 0;
      }
      if (isBuildKite) {
        const canary = buildkiteGetMetadata("canary");
        if (canary) {
          return parseInt(canary);
        }
      }
      return 1;
    },
  });

  const customTarget = getOption({
    name: "target",
    description: "The target to build (e.g. darwin-aarch64, bun-windows-x64-baseline)",
    defaultValue: () => {
      if (ci) {
        return getBuildStep();
      }
    },
  });

  const machineOs = parseOs(process.platform);
  const os = getOption({
    name: "os",
    description: "The target operating system (e.g. linux, darwin, windows)",
    parse: parseOs,
    defaultValue: customTarget || machineOs,
  });

  const machineArch = parseArch(process.arch);
  const arch = getOption({
    name: "arch",
    description: "The target architecture (e.g. x64, aarch64)",
    parse: parseArch,
    defaultValue: customTarget || machineArch,
  });

  const docker = getOption({
    name: "docker",
    description: "If Docker should be used to build",
    type: "boolean",
  });

  const crossCompile = getOption({
    name: "cross-compile",
    description: "If the target should be cross-compiled",
    type: "boolean",
    defaultValue: docker,
  });

  const baseline = getOption({
    name: "baseline",
    description: "If the target should be built for baseline",
    type: "boolean",
    defaultValue: customTarget?.includes("-baseline"),
  });

  const target = parseTarget(baseline ? `${os}-${arch}-baseline` : `${os}-${arch}`);

  if (!crossCompile && (machineOs !== os || machineArch !== arch)) {
    throw new Error(`Cross-compilation is not enabled, use --cross-compile if you want to compile: ${target}`);
  }

  const webkit = getOption({
    name: "webkit",
    description: "If WebKit should be built, instead of using prebuilt binaries",
    type: "boolean",
  });

  const icu4c = getOption({
    name: "icu4c",
    description: "If icu4u should be built, instead of using the system-provided version",
    type: "boolean",
    defaultValue: webkit && os !== "darwin",
  });

  const assertions = getOption({
    name: "assertions",
    description: "If assertions should be enabled",
    type: "boolean",
  });

  const debug = getOption({
    name: "debug",
    description: "If the target should be built in debug mode",
    type: "boolean",
  });

  if (debug && release) {
    throw new Error(`Cannot build in debug mode with release enabled`);
  }

  const lto = getOption({
    name: "lto",
    description: "If the target should be built with link-time optimization (LTO)",
    type: "boolean",
    defaultValue: !debug && os === "linux",
  });

  const valgrind = getOption({
    name: "valgrind",
    description: "If mimalloc should be built with valgrind",
    type: "boolean",
  });

  if (valgrind && os !== "linux") {
    throw new Error(`Valgrind is not supported on target: ${target}`);
  }

  const profile = getOption({
    name: "profile",
    description: "The build profile (e.g. bun-darwin-x64-release)",
    type: "string",
    defaultValue: () => {
      return Object.entries({ release, debug, canary, lto, assertions, valgrind })
        .map(([name, value]) => (value ? `-${name}` : ""))
        .reduce((a, b) => a + b, `bun-${target}`);
    },
  });

  const version = getOption({
    name: "version",
    description: "The version of the build (e.g. 1.0.0)",
    type: "string",
    parse: string => parseSemver(string).join("."),
    defaultValue: () => {
      const filePath = join(cwd, "LATEST");
      if (!isFile(filePath)) {
        return "0.0.0";
      }
      const latest = readFile(filePath);
      const [major, minor, patch] = parseSemver(latest);
      return `${major}.${minor}.${patch + 1}`;
    },
  });

  const revision = getOption({
    name: "revision",
    description: "The revision of the build (e.g. git SHA)",
    type: "string",
    defaultValue: () => getSha(cwd),
  });

  const buildId = getOption({
    name: "build-id",
    description: "The unique build ID (e.g. build number from CI)",
    type: "string",
    defaultValue: getBuildId,
  });

  const pullRequest = getOption({
    name: "pull-request",
    description: "The pull request number, if a pull request.",
    type: "number",
    defaultValue: getPullRequest,
  });

  const clean = getOption({
    name: "clean",
    description: "If directories should be cleaned before building",
    type: "boolean",
  });

  const osxVersion = getOption({
    name: "min-macos-version",
    description: "The minimum version of macOS to target",
    defaultValue: () => {
      if (ci && os === "darwin") {
        return "13.0";
      }
    },
  });

  const llvmVersion = getOption({
    name: "llvm-version",
    description: "The LLVM version to use",
    defaultValue: os === "linux" ? "16.0.6" : "18.1.8",
  });

  const skipLlvmVersion = getOption({
    name: "skip-llvm-version",
    description: "If the LLVM version should be ignored (do not check LLVM version of CC, CXX, AR, etc)",
    type: "boolean",
    defaultValue: crossCompile,
  });

  const exactLlvmVersion = skipLlvmVersion ? undefined : llvmVersion;
  const majorLlvmVersion = llvmVersion.split(".")[0];

  const llvmPath = getLlvmPath(exactLlvmVersion);
  if (llvmPath) {
    addToPath(llvmPath);
  }

  const cc = getCommand({
    name: "cc",
    description: "The C compiler to use",
    command: os === "windows" ? "clang-cl" : "clang",
    aliases: os === "windows" ? [] : [`clang-${majorLlvmVersion}`, "cc"],
    exactVersion: exactLlvmVersion,
    throwIfNotFound: !skipLlvmVersion,
  });

  const cxx = getCommand({
    name: "cxx",
    description: "The C++ compiler to use",
    command: os === "windows" ? "clang-cl" : "clang++",
    aliases: os === "windows" ? [] : [`clang++-${majorLlvmVersion}`, "c++"],
    exactVersion: exactLlvmVersion,
    throwIfNotFound: !skipLlvmVersion,
  });

  const ar = getCommand({
    name: "ar",
    description: "The archiver to use",
    command: os === "windows" ? "llvm-lib" : "llvm-ar",
    aliases: os === "windows" ? [] : [`llvm-ar-${majorLlvmVersion}`],
    exactVersion: exactLlvmVersion,
    throwIfNotFound: !skipLlvmVersion,
  });

  const ranlib = getCommand({
    name: "ranlib",
    description: "The ranlib to use",
    command: "llvm-ranlib",
    aliases: [`llvm-ranlib-${majorLlvmVersion}`],
    exactVersion: exactLlvmVersion,
    throwIfNotFound: os !== "windows" && !skipLlvmVersion,
  });

  const ccache = getCommand({
    name: "ccache",
    description: "The ccache to use",
    throwIfNotFound: ci,
  });

  const jobs = getOption({
    name: "jobs",
    description: "The number of parallel jobs to use",
    env: ["NUMBER_OF_PROCESSORS", "CPUS", "JOBS"],
    type: "number",
    defaultValue: getCpus,
  });

  const buildPath = getOption({
    name: "build-path",
    description: "The build directory",
    parse: resolve,
    defaultValue: () => {
      return join(cwd, "build", profile);
    },
  });

  const cachePath = getOption({
    name: "cache-path",
    description: "The path to use for build caching",
    parse: resolve,
    defaultValue: () => {
      const basePath = ci ? homedir() : cwd;
      return join(basePath, ".cache", profile);
    },
  });

  const noCache = getOption({
    name: "no-cache",
    description: "If the build caching should be disabled",
    type: "boolean",
  });

  const cacheStrategy = getOption({
    name: "cache-strategy",
    description: "The strategy for build caching (e.g. read-write, read, write, none)",
    defaultValue: () => {
      if (noCache) {
        return "none";
      }
      if (release || clean) {
        return "write";
      }
      return "read-write";
    },
  });

  const dump = getOption({
    name: "dump",
    aliases: ["print"],
    description: "Dump the build options and exit",
    type: "boolean",
  });

  return {
    os,
    arch,
    baseline,
    target,
    profile,
    ci,
    canary,
    version,
    revision,
    buildId,
    pullRequest,
    docker,
    webkit,
    icu4c,
    lto,
    debug,
    valgrind,
    assertions,
    osxVersion,
    llvmVersion,
    cc,
    cxx,
    ar,
    ranlib,
    ccache,
    clean,
    jobs,
    cwd,
    buildPath,
    cachePath,
    cacheStrategy,
    dump,
  };
}

/**
 * @param {BuildOptions} options
 * @param {...string} args
 */
export async function buildInDocker(options, ...args) {
  const { os, arch, cwd, buildPath, cachePath, llvmVersion } = options;

  if (os !== "linux") {
    throw new Error(`Docker is not supported on target: ${os}`);
  }

  const image = await dockerBuild({
    cwd,
    os,
    arch,
    filePath: join(cwd, "scripts", "resources", `Dockerfile.${os}`),
    env: {
      "LLVM_VERSION": llvmVersion?.split(".")[0],
    },
  });

  const dockerHomePath = "/home/debian";
  const dockerPath = join(dockerHomePath, "bun");
  const scriptPath = join(dockerPath, relative(cwd, process.argv[1]));
  const dockerBuildPath = join(dockerPath, "build");
  const dockerCachePath = join(dockerPath, "cache");

  const sanitizedOptions = {
    ...options,
    cc: undefined,
    cxx: undefined,
    ar: undefined,
    ld: undefined,
    ranlib: undefined,
    ccache: undefined,
    cwd: dockerPath,
    buildPath: dockerBuildPath,
    cachePath: dockerCachePath,
  };

  await dockerRun("node", [scriptPath, ...args, `--json=${JSON.stringify(sanitizedOptions)}`], {
    image,
    os,
    arch,
    cwd,
    env: {
      "BUILD_PATH": dockerBuildPath,
      "CACHE_PATH": dockerCachePath,
    },
    mounts: [
      [cwd, dockerPath],
      [buildPath, dockerBuildPath],
      [cachePath, dockerCachePath],
    ],
  });
}

/**
 * @param {BuildOptions} options
 * @param {...string} args
 */
export async function build(options, ...args) {
  const knownArtifacts = getArtifacts(options);

  /**
   * @type {Artifact[]}
   */
  const artifacts = [];
  /**
   * @type {Artifact[]}
   */
  const sources = [];

  /**
   * @param {string} label
   * @param {boolean} [sourceOnly]
   */
  function addArtifact(label, sourceOnly) {
    const results = knownArtifacts.filter(({ name, aliases }) => name === label || aliases?.includes(label));
    if (!results.length) {
      throw new Error(`Unknown artifact: ${label}`);
    }

    for (const artifact of results) {
      const { name, dependencies, sourceDependencies } = artifact;
      if (artifacts.some(({ name: label }) => label === name)) {
        return;
      }

      if (dependencies) {
        dependencies.forEach(dependency => addArtifact(dependency));
      }
      if (sourceDependencies) {
        sourceDependencies.forEach(dependency => addArtifact(dependency, true));
      }

      if (sourceOnly) {
        sources.push(artifact);
      } else {
        artifacts.push(artifact);
      }
    }
  }

  for (const arg of args) {
    addArtifact(arg);
  }

  if (!artifacts.length) {
    addArtifact("bun");
  }

  const { ci, clean, dump, cacheStrategy } = options;
  if (ci || dump) {
    await runTask("{dim}Artifacts{reset}", () => console.log(artifacts.map(({ name }) => name)));
    if (sources.length) {
      await runTask("{dim}Sources{reset}", () => console.log(sources.map(({ name }) => name)));
    }
    await runTask("{dim}Options{reset}", () => console.log(options));
    if (dump) {
      return;
    }
  }

  for (const source of sources) {
    const { name, cwd, repository, commit } = source;
    if (!repository) {
      continue;
    }

    await runTask(`Cloning ${name}`, async () => {
      await gitClone(repository, { cwd, commit });
    });
  }

  for (const artifact of artifacts) {
    const { name, cwd, buildPath, build, artifacts, artifactsPath, repository, commit, cacheKey } = artifact;
    const label = name.startsWith("bun") ? "bun" : name;
    const buildOptions = { ...options, cwd, buildPath, artifact: label };
    const cachePath = artifacts && cacheKey && getCachePath(buildOptions, join(label, cacheKey));

    /**
     * @param {string} artifact
     */
    async function cacheArtifact(artifact) {
      const filename = basename(artifact);
      const artifactPath = join(cachePath, filename);
      if (!isFile(artifactPath)) {
        return false;
      }

      if (artifactsPath) {
        cp(artifactPath, join(artifactsPath, filename));
      }
      if (isBuildKite) {
        await buildkiteUploadArtifact(artifactPath);
      }
      return true;
    }

    /**
     * @param {string} artifact
     */
    async function uploadArtifact(artifact) {
      const artifactPath = join(buildPath, artifact);
      if (!isFile(artifactPath)) {
        throw new Error(`No artifact found: ${artifact}`);
      }

      const filename = basename(artifact);
      if (cachePath && cacheStrategy?.includes("write")) {
        cp(artifactPath, join(cachePath, filename));
      }

      if (isBuildKite) {
        await buildkiteUploadArtifact(artifactPath);
      } else if (artifactsPath) {
        cp(artifactPath, join(artifactsPath, filename));
      }
    }

    await runTask(`Building ${name}`, async () => {
      if (cachePath && cacheStrategy?.includes("read")) {
        const cached = await Promise.all(artifacts.map(cacheArtifact));
        if (!cached.some(cached => !cached)) {
          return;
        }
      }

      if (repository) {
        await gitClone(repository, { cwd, commit });
      }

      if (clean) {
        rm(buildPath);
        if (artifacts && artifactsPath) {
          for (const artifact of artifacts) {
            rm(join(artifactsPath, artifact));
          }
        }
      }

      await build(buildOptions, artifact);

      if (artifacts) {
        await Promise.all(artifacts.map(uploadArtifact));
      }
    });
  }
}

/**
 * @typedef {Object} Artifact
 * @property {string} name
 * @property {(options: BuildOptions, artifact: Artifact) => Promise<void>} build
 * @property {string[]} [aliases]
 * @property {string[]} [artifacts]
 * @property {string[]} [dependencies]
 * @property {string[]} [sourceDependencies]
 * @property {string} [buildPath]
 * @property {string} [cwd]
 * @property {string} [repository]
 * @property {string} [commit]
 * @property {string} [cacheKey]
 */

/**
 * @param {BuildOptions} options
 * @returns {Artifact[]}
 */
function getArtifacts(options) {
  const { os, cwd, buildPath, webkit, icu4c } = options;

  /**
   * @type {Artifact[]}
   */
  const artifacts = [];

  /**
   * @param {Artifact} artifact
   */
  function addArtifact(artifact) {
    const { cwd, buildPath } = options;
    const { name, repository, cwd: artifactPath, commit } = artifact;

    if (repository) {
      const pwd = process.cwd();
      if (artifactPath === cwd || (!artifactPath && cwd === pwd)) {
        throw new Error(`Cannot add submodule in the current directory: ${name} in ${artifactPath || pwd}`);
      }
    }

    artifacts.push({
      cwd,
      buildPath: join(buildPath, name),
      build: () => {},
      cacheKey: commit || getHash(cwd),
      ...artifact,
    });
  }

  addArtifact({
    name: "bun",
    dependencies: ["bun-deps", "bun-old-js", "webkit"],
    sourceDependencies: ["zig", "picohttpparser", "bun-deps"],
    artifacts: getBunArtifacts(options),
    build: buildBun,
  });

  addArtifact({
    name: "bun-link",
    dependencies: ["webkit"],
    artifacts: getBunArtifacts(options),
    build: linkBun,
  });

  addArtifact({
    name: "bun-cpp",
    dependencies: ["webkit"],
    sourceDependencies: ["picohttpparser", "bun-deps"],
    artifacts: ["bun-cpp-objects.a"],
    build: buildBunCpp,
  });

  addArtifact({
    name: "bun-zig",
    dependencies: ["bun-old-js"],
    sourceDependencies: ["zig"],
    artifacts: ["bun-zig.o"],
    build: buildBunZig,
  });

  addArtifact({
    name: "bun-node-fallbacks",
    aliases: ["bun-old-js"],
    cwd: join(cwd, "src", "node-fallbacks"),
    build: buildBunNodeFallbacks,
  });

  addArtifact({
    name: "bun-error",
    aliases: ["bun-old-js"],
    cwd: join(cwd, "packages", "bun-error"),
    build: buildBunError,
  });

  addArtifact({
    name: "bun-fallback-decoder",
    aliases: ["bun-old-js"],
    build: buildBunFallbackDecoder,
  });

  addArtifact({
    name: "bun-runtime-js",
    aliases: ["bun-old-js"],
    build: buildBunRuntimeJs,
  });

  const depsPath = join(cwd, "src", "deps");
  const depsOutPath = join(buildPath, "bun-deps");

  /**
   * @param {Artifact} artifact
   */
  function addDependency(artifact) {
    const { name, aliases = [] } = artifact;

    addArtifact({
      cwd: join(depsPath, name),
      artifactsPath: depsOutPath,
      ...artifact,
      aliases: [...aliases, "bun-deps", "deps"],
    });
  }

  addDependency({
    name: "boringssl",
    repository: "https://github.com/oven-sh/boringssl.git",
    commit: "29a2cd359458c9384694b75456026e4b57e3e567",
    artifacts: getBoringSslArtifacts(options),
    build: buildBoringSsl,
  });

  addDependency({
    name: "brotli",
    repository: "https://github.com/google/brotli.git",
    commit: "ed738e842d2fbdf2d6459e39267a633c4a9b2f5d",
    artifacts: getBrotliArtifacts(options),
    build: buildBrotli,
  });

  addDependency({
    name: "c-ares",
    aliases: ["cares"],
    repository: "https://github.com/c-ares/c-ares.git",
    commit: "d1722e6e8acaf10eb73fa995798a9cd421d9f85e",
    artifacts: getCaresArtifacts(options),
    build: buildCares,
  });

  addDependency({
    name: "libarchive",
    repository: "https://github.com/libarchive/libarchive.git",
    commit: "898dc8319355b7e985f68a9819f182aaed61b53a",
    artifacts: getLibarchiveArtifacts(options),
    build: buildLibarchive,
  });

  addDependency({
    name: "libdeflate",
    repository: "https://github.com/ebiggers/libdeflate.git",
    commit: "dc76454a39e7e83b68c3704b6e3784654f8d5ac5",
    artifacts: getLibdeflateArtifacts(options),
    build: buildLibdeflate,
  });

  addDependency({
    name: "lol-html",
    aliases: ["lolhtml"],
    repository: "https://github.com/cloudflare/lol-html.git",
    commit: "8d4c273ded322193d017042d1f48df2766b0f88b",
    artifacts: getLolhtmlArtifacts(options),
    build: buildLolhtml,
  });

  addDependency({
    name: "ls-hpack",
    aliases: ["lshpack"],
    repository: "https://github.com/litespeedtech/ls-hpack.git",
    commit: "3d0f1fc1d6e66a642e7a98c55deb38aa986eb4b0",
    artifacts: getLshpackArtifacts(options),
    build: buildLshpack,
  });

  addDependency({
    name: "mimalloc",
    repository: "https://github.com/oven-sh/mimalloc.git",
    commit: "4c283af60cdae205df5a872530c77e2a6a307d43",
    artifacts: getMimallocArtifacts(options),
    build: buildMimalloc,
  });

  addDependency({
    name: "tinycc",
    repository: "https://github.com/oven-sh/tinycc.git",
    commit: "ab631362d839333660a265d3084d8ff060b96753",
    artifacts: getTinyccArtifacts(options),
    build: buildTinycc,
  });

  addDependency({
    name: "zlib",
    repository: "https://github.com/cloudflare/zlib.git",
    commit: "886098f3f339617b4243b286f5ed364b9989e245",
    artifacts: getZlibArtifacts(options),
    build: buildZlib,
  });

  addDependency({
    name: "zstd",
    repository: "https://github.com/facebook/zstd.git",
    commit: "794ea1b0afca0f020f4e57b6732332231fb23c70",
    artifacts: getZstdArtifacts(options),
    build: buildZstd,
  });

  if (os === "windows") {
    addDependency({
      name: "libuv",
      repository: "https://github.com/libuv/libuv.git",
      commit: "da527d8d2a908b824def74382761566371439003",
      artifacts: getLibuvArtifacts(options),
      build: buildLibuv,
    });
  }

  if (os !== "darwin") {
    addDependency({
      name: "sqlite",
      artifacts: getSqliteArtifacts(options),
      cwd: join(cwd, "src", "bun.js", "bindings", "sqlite"),
      build: buildSqlite,
    });
  }

  function addSubmodule(submodule) {
    addArtifact(submodule);
  }

  addSubmodule({
    name: "picohttpparser",
    repository: "https://github.com/h2o/picohttpparser.git",
    commit: "066d2b1e9ab820703db0837a7255d92d30f0c9f5",
    cwd: join(depsPath, "picohttpparser"),
  });

  addSubmodule({
    name: "zig",
    repository: "https://github.com/oven-sh/zig.git",
    commit: "131a009ba2eb127a3447d05b9e12f710429aa5ee",
    cwd: join(depsPath, "zig"),
  });

  if (icu4c) {
    addArtifact({
      name: "icu4c",
      aliases: ["icu"],
      repository: "https://github.com/unicode-org/icu.git",
      commit: "7750081bda4b3bc1768ae03849ec70f67ea10625",
      cwd: join(depsPath, "icu4c"),
      artifacts: getIcu4cArtifacts(options),
      build: buildIcu4c,
    });
  }

  if (webkit) {
    addArtifact({
      name: "webkit",
      aliases: ["custom-webkit"],
      dependencies: icu4c ? ["icu4c"] : undefined,
      repository: "https://github.com/oven-sh/WebKit.git",
      commit: "1cdc5e606ad7d451853f75a068a320148385f397",
      cwd: join(cwd, "src", "bun.js", "WebKit"),
      build: buildWebKit,
    });
  } else {
    addArtifact({
      name: "webkit",
      aliases: ["prebuilt-webkit"],
      commit: "1cdc5e606ad7d451853f75a068a320148385f397",
      buildPath: join(buildPath, "prebuilt-webkit"),
      build: downloadPrebuiltWebKit,
    });
  }

  return artifacts;
}

/**
 * Build WebKit.
 */

/**
 * @param {BuildOptions} options
 */
function getIcu4cArtifacts(options) {
  const { os, debug } = options;
  function getPaths(...names) {
    return names.map(name => join("lib", name));
  }
  if (os === "windows") {
    if (debug) {
      return getPaths("sicudtd.lib", "sicutud.lib", "sicuiod.lib", "sicuind.lib", "sicuucd.lib");
    }
    return getPaths("sicudt.lib", "sicutu.lib", "sicuio.lib", "sicuin.lib", "sicuuc.lib");
  }
  return getPaths("libicui18n.a", "libicuio.a", "libicuuc.a");
}

/**
 * @param {BuildOptions} options
 */
async function buildIcu4c(options) {
  const { cwd, buildPath, debug, cc, ccache, cxx, ar, ld, ranlib, clean, jobs } = options;

  const srcPath = join(cwd, "icu4c", "source");
  const configurePath = join(srcPath, "configure");
  const args = [
    "--enable-static",
    "--disable-shared",
    "--with-data-packaging=static",
    "--disable-samples",
    "--disable-tests",
    "--disable-tests",
    "--disable-extras",
    "--disable-tools",
  ];

  if (debug) {
    args.push("--enable-debug", "--disable-release");
  } else {
    args.push("--disable-debug", "--enable-release");
  }

  if (isVerbose) {
    args.push("--verbose");
  }

  const env = {
    ...process.env,
    CC: ccache ? `${ccache} ${cc}` : cc,
    CFLAGS: getCFlags(options).join(" "),
    CXX: ccache ? `${ccache} ${cxx}` : cxx,
    CXXFLAGS: getCxxFlags(options).join(" "),
    LD: ld,
    LDFLAGS: getLdFlags(options).join(" "),
    AR: ar,
    RANLIB: ranlib,
    VERBOSE: (isVerbose && "1") || undefined,
  };

  mkdir(buildPath, { clean });
  await spawn(configurePath, args, { env, cwd: buildPath });
  await spawn("make", ["-j", `${jobs}`], { env, cwd: buildPath });

  const includePath = join(buildPath, "include");
  const includePaths = [join("i18n", "unicode"), join("common", "unicode")].map(include =>
    assertDirectory(join(srcPath, include)),
  );
  for (const path of includePaths) {
    cp(path, includePath);
  }
}

/**
 * @param {BuildOptions} options
 * @param {Artifact} artifact
 */
async function downloadPrebuiltWebKit(options, artifact) {
  const { os, arch, assertions, lto, buildPath, clean } = options;
  const { commit } = artifact;

  function getDownloadUrl() {
    const webkitOs = os === "darwin" ? "macos" : os;
    const webkitArch = arch === "x64" ? "amd64" : "arm64";
    const suffix = assertions ? "-debug" : lto ? "-lto" : "";
    const artifact = `bun-webkit-${webkitOs}-${webkitArch}${suffix}.tar.gz`;
    return `https://github.com/oven-sh/WebKit/releases/download/autobuild-${commit}/${artifact}`;
  }

  const revisionPath = join(buildPath, "REVISION");
  const revision = readFile(revisionPath, { throwOnError: false });
  if (revision?.trim() === commit) {
    return;
  }

  if (!clean) {
    mkdir(buildPath, { clean: true });
  }

  const tarPath = join(buildPath, "webkit.tar.gz");
  await downloadFile(getDownloadUrl(), tarPath);

  const tmpBuildPath = dirname(buildPath);
  await tar(tarPath, tmpBuildPath);
  mv(join(tmpBuildPath, "bun-webkit"), buildPath);

  // Use the system-version of icucore on macOS
  if (os === "darwin") {
    rm(join(buildPath, "include", "unicode"));
  }

  writeFile(revisionPath, commit);
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getWebKitArtifacts(options) {
  const { os, debug } = options;

  if (os === "windows") {
    return ["jsc.lib"];
  }
  return ["libjsc.a"];
}

/**
 * @param {BuildOptions} options
 */
async function buildWebKit(options) {
  const { debug, os, assertions, icu4c, ci } = options;

  const flags = [
    "-DPORT=JSCOnly",
    "-DENABLE_STATIC_JSC=ON",
    "-DENABLE_SINGLE_THREADED_VM_ENTRY_SCOPE=ON",
    "-DENABLE_JIT=ON",
    "-DENABLE_DFG_JIT=ON",
    "-DENABLE_FTL_JIT=ON",
    "-DENABLE_WEBASSEMBLY=ON",
    "-DENABLE_WEBASSEMBLY_BBQJIT=ON",
    "-DENABLE_WEBASSEMBLY_OMGJIT=ON",
    "-DENABLE_REMOTE_INSPECTOR=ON",
    // "-DENABLE_RESOURCE_USAGE=ON", // ? extra
    "-DENABLE_SAMPLING_PROFILER=ON",
    "-DUSE_THIN_ARCHIVES=OFF",
    "-DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON",
    // Bun-specific flags
    "-DUSE_BUN_JSC_ADDITIONS=ON",
    "-DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON", // ?
  ];

  if (debug) {
    // flags.push("-DENABLE_DEVELOPER_MODE=ON"); // ? extra
  }

  if (assertions) {
    flags.push("-DENABLE_ASSERTS=ON");
  }

  if (os === "darwin") {
    if (debug || assertions) {
      flags.push("-DENABLE_MALLOC_HEAP_BREAKDOWN=ON");
    }

    flags.push("-DPTHREAD_JIT_PERMISSIONS_API=1", "-DENABLE_JIT_PERMISSIONS=ON");
  }

  if (os === "windows") {
    flags.push("-DUSE_SYSTEM_MALLOC=ON");
  }

  if (icu4c) {
    flags.push("-DUSE_SYSTEM_ICU=OFF");
  }

  await cmakeGenerateBuild(options, ...flags);
  await cmakeBuild(options, "jsc");

  if (ci) {
    await packageWebKit(options);
  }
}

/**
 * @param {BuildOptions} options
 */
async function packageWebKit(options) {
  const { cwd, buildPath, debug, os, arch, assertions, ci } = options;

  const libPath = join(buildPath, "lib");
  const libExt = os === "windows" ? ".lib" : ".a";
  const libPaths = ["libJavaScriptCore", "libWTF"].map(name => assertFile(join(libPath, `${name}${libExt}`)));
  const cmakeHeaderPath = assertFile(join(buildPath, "cmakeconfig.h"));
  const includePaths = [
    [join("WTF", "Headers", "wtf"), "wtf"],
    join("ICU", "Headers"),
    join("JavaScriptCore", "Headers"),
    join("JavaScriptCore", "PrivateHeaders"),
    os !== "windows" && join("bmalloc", "Headers", "bmalloc"),
  ]
    .filter(Boolean)
    .map(path => assertDirectory(join(buildPath, path)));

  const packagePath = join(buildPath, "webkit");
}

/**
 * Build bun.
 */

/**
 * Updates `src/generated_versions_list.zig` with the latest versions.
 * @param {BuildOptions} options
 */
function buildBunVersionsList(options) {
  const { cwd } = options;

  /**
   * @param {string} name
   * @returns {string}
   */
  function getName(name) {
    if (name === "lol-html") return "lolhtml";
    if (name === "ls-hpack") return "lshpack";
    return name.replace("-", "_");
  }

  const versions = getArtifacts(options)
    .filter(({ name, commit }) => !name.startsWith("bun") && commit)
    .map(({ name, commit }) => [getName(name), commit]);
  const versionsText = versions.map(([name, commit]) => `pub const ${name} = "${commit}";`).join("\n");

  const versionsPath = join(cwd, "src", "generated_versions_list.zig");
  const versionsFile = `// AUTO-GENERATED FILE. Created via scripts/build.mjs\n${versionsText}\n`;
  writeFile(versionsPath, versionsFile);
}

/**
 * @param {BuildOptions} options
 */
async function buildBunZig(options) {
  const { buildPath, jobs } = options;
  const zigObjectPath = join(buildPath, "bun-zig.o");
  const args = ["-j", `${jobs}`];
  if (isVerbose) {
    args.push("-v");
  }

  buildBunVersionsList(options);
  await cmakeGenerateBunBuild(options, "zig");
  await spawn("ninja", [zigObjectPath, ...args], {
    cwd: buildPath,
    env: {
      ONLY_ZIG: "1",
      ...process.env,
    },
  });
}

/**
 * @param {BuildOptions} options
 */
async function buildBunCpp(options) {
  const { buildPath, os, jobs } = options;

  const shell = os === "windows" ? "pwsh" : "bash";
  const scriptPath = os === "windows" ? "compile-cpp-only.ps1" : "compile-cpp-only.sh";
  const args = ["-j", `${jobs}`];
  if (isVerbose) {
    args.push("-v");
  }

  await cmakeGenerateBunBuild(options, "cpp");
  await spawn(shell, [scriptPath, ...args], { cwd: buildPath });
}

/**
 * @param {BuildOptions} options
 */
async function linkBun(options) {
  const { buildPath, jobs } = options;
  const args = ["-j", `${jobs}`];
  if (isVerbose) {
    args.push("-v");
  }

  if (isBuildKite) {
    const { target } = options;
    const basePath = dirname(buildPath);

    await Promise.all(
      ["zig", "cpp", "deps"].map(name =>
        buildkiteDownloadArtifact({
          // Defined in .buildkite/ci.yml
          step: `bun-${target}-build-${name}`,
          cwd: join(basePath, `bun-${name}`),
        }),
      ),
    );
  }

  await cmakeGenerateBunBuild(options, "link");
  await spawn("ninja", args, { cwd: buildPath });
  await packageBun(options);
}

/**
 * @param {BuildOptions} options
 */
async function buildBun(options) {
  const { buildPath, jobs } = options;
  const args = ["-j", `${jobs}`];
  if (isVerbose) {
    args.push("-v");
  }

  await cmakeGenerateBunBuild(options);
  await spawn("ninja", args, { cwd: buildPath });
  await packageBun(options);
}

/**
 * Creates a zip file for the given build.
 * @param {BuildOptions} options
 */
async function packageBun(options) {
  const { cwd, buildPath, debug, os, target, ci } = options;

  /**
   * @param {"bun" | "bun-profile" | "bun-debug"} label
   */
  async function packageBunZip(label) {
    // e.g. "bun" -> "bun-darwin-x64"
    //      "bun-profile" -> "bun-darwin-x64-baseline-profile"
    const name = label.replace("bun", `bun-${target}`);
    const packagePath = join(buildPath, name);
    mkdir(packagePath, { clean: true });

    // e.g. "bun-darwin-x64-profile" -> "bun-darwin-x64-profile/bun-profile"
    //      "windows-x64-debug" -> "windows-x64-debug/bun-debug.exe"
    const exe = os === "windows" ? `${label}.exe` : label;
    const exePath = join(packagePath, exe);
    const srcPath = join(buildPath, os === "windows" ? "bun.exe" : label);
    cp(srcPath, exePath);
    chmod(exePath, 0o755);

    // Sanity check the build by running it with --revision.
    await spawn(exePath, ["--revision"]);

    // For profile and debug builds, create a features.json file that contains
    // the features that were enabled at build time. This is downloaded by the bun.report
    // service to decode crash reports from this build.
    if (label !== "bun") {
      const featuresPath = join(buildPath, "features.json");
      const { stdout: featuresJson } = await spawn(
        exePath,
        ["--print", "JSON.stringify(require('bun:internal-for-testing').crash_handler.getFeatureData())"],
        {
          env: {
            ...process.env,
            NO_COLOR: "1",
            BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
          },
        },
      );
      try {
        JSON.parse(featuresJson);
      } catch (cause) {
        throw new Error(`Invalid features.json: ${featuresJson}`, { cause });
      }
      writeFile(featuresPath, featuresJson);
      cp(featuresPath, join(packagePath, "features.json"));
    }

    // For non-release Windows builds, copy the .pdb file for debug symbols.
    // This is also needed by the bun.report service to decode crash reports.
    if (os === "windows" && label !== "bun") {
      cp(join(buildPath, "bun.pdb"), join(packagePath, `${label}.pdb`));
    }

    if (os === "darwin" && label === "bun-profile") {
      cp(join(buildPath, "bun-profile.dSYM"), join(packagePath, `${label}.dSYM`));
    }

    // e.g. "bun-darwin-x64-profile.zip" that contains:
    //         "bun-darwin-x64-profile/bun-profile"
    //         "bun-darwin-x64-profile/features.json"
    const packageZipPath = join(buildPath, `${name}.zip`);
    await zip(packagePath, packageZipPath);
    rm(packagePath);
  }

  /**
   * @param {"bun" | "bun-profile" | "bun-debug"} label
   * @returns {string}
   */
  async function prepareBun(label) {
    const exePath = join(buildPath, os === "windows" ? "bun.exe" : label);
    if (!isFile(exePath)) {
      throw new Error(`Executable not found: ${exePath}`);
    }

    // Sanity check the build by running it with --revision
    chmod(exePath, 0o755);
    await spawn(exePath, ["--revision"]);

    // Create an easy-to-access symlink to the build
    // e.g. "build/bun-debug" -> "build/debug/bun-darwin-x64/bun/bun"
    //      "build/bun.exe" -> "build/release/bun-windows-x64-baseline/bun/bun.exe"
    const exe = os === "windows" ? `${label}.exe` : label;
    symlink(exePath, join(cwd, "build", exe));
  }

  const labels = debug ? ["bun-debug"] : ["bun", "bun-profile"];
  await Promise.all(labels.map(ci ? packageBunZip : prepareBun));
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getBunArtifacts(options) {
  const { os, debug, target, ci } = options;

  if (ci) {
    const names = debug ? ["bun-debug"] : ["bun", "bun-profile"];
    return names.map(name => `${name.replace("bun", `bun-${target}`)}.zip`);
  }

  if (os === "windows") {
    return ["bun.exe"];
  }

  if (debug) {
    return ["bun-debug"];
  }

  return ["bun", "bun-profile"];
}

/**
 * @param {BuildOptions} options
 * @param {"cpp" | "zig" | "link" | undefined} target
 */
async function cmakeGenerateBunBuild(options, target) {
  const { buildPath, canary, baseline, lto, debug, assertions, valgrind, webkit, icu4c } = options;
  const { version, revision, buildId, pullRequest } = options;
  const baseBuildPath = dirname(buildPath);

  const cpuTarget = getCpuTarget(options);
  const flags = [
    "-DNO_CONFIGURE_DEPENDS=ON",
    `-DCPU_TARGET=${cpuTarget}`,
    version && `-DBUN_VERSION=${version}`,
    revision && `-DGIT_SHA=${revision}`,
    buildId && `-DBUILD_ID=${buildId}`,
    pullRequest && `-DPULL_REQUEST=${pullRequest}`,
    canary && `-DCANARY=${canary}`,
    baseline && "-DUSE_BASELINE_BUILD=ON",
    lto && "-DUSE_LTO=ON",
    valgrind && "-DUSE_VALGRIND=ON",
    debug && assertions && "-DUSE_DEBUG_JSC=ON",
    assertions && "-DENABLE_LOGS=true",
    icu4c && "-DUSE_SYSTEM_ICU=OFF",
  ];

  if (target === "zig") {
    flags.push("-DWEBKIT_DIR=omit");
  } else if (webkit) {
    const webkitPath = join(dirname(buildPath), "webkit");
    flags.push(`-DWEBKIT_DIR=${getCmakePath(webkitPath)}`);
  } else {
    const webkitPath = join(dirname(buildPath), "prebuilt-webkit");
    flags.push("-DWEBKIT_PREBUILT=ON", `-DWEBKIT_DIR=${getCmakePath(webkitPath)}`);
  }

  if (target === "cpp") {
    flags.push("-DBUN_CPP_ONLY=ON");
  } else if (target === "zig") {
    flags.push("-DBUN_ZIG_ONLY=ON", "-DWEBKIT_DIR=omit");
  } else if (target === "link") {
    flags.push("-DBUN_LINK_ONLY=ON", "-DNO_CODEGEN=ON");
  }

  if (!target || target === "zig") {
    const zigTarget = getZigTarget(options);
    const zigOptimize = getZigOptimize(options);

    flags.push(`-DZIG_TARGET=${zigTarget}`, `-DZIG_OPTIMIZE=${zigOptimize}`);
  }

  if (target === "link" || target === "zig") {
    const zigPath = join(baseBuildPath, "bun-zig");
    const zigObjectPath = join(zigPath, "bun-zig.o");

    flags.push(`-DBUN_ZIG_OBJ=${getCmakePath(zigObjectPath)}`);
  }

  const cppPath = join(baseBuildPath, "bun-cpp");
  const cppArchivePath = join(cppPath, "bun-cpp-objects.a");

  if (target === "link") {
    flags.push(`-DBUN_CPP_ARCHIVE=${getCmakePath(cppArchivePath)}`);
  }

  const depsPath = join(baseBuildPath, "bun-deps");

  if (!target || target === "link") {
    flags.push(`-DBUN_DEPS_OUT_DIR=${getCmakePath(depsPath)}`);
  }

  await cmakeGenerateBuild(options, ...flags.filter(Boolean));
}

/**
 * @param {BuildOptions} options
 */
async function buildBunRuntimeJs(options) {
  const { cwd, clean } = options;
  const srcPath = join(cwd, "src", "runtime.bun.js");
  const outPath = join(cwd, "src", "runtime.out.js");

  if (clean || !isFile(outPath)) {
    await spawn(
      "bun",
      [
        "x",
        "esbuild",
        "--bundle",
        "--minify",
        "--target=esnext",
        "--format=esm",
        "--platform=node",
        "--external:/bun:*",
        `--outfile=${outPath}`,
        srcPath,
      ],
      { cwd },
    );
  }
}

/**
 * @param {BuildOptions} options
 */
async function buildBunFallbackDecoder(options) {
  const { cwd, clean } = options;
  const srcPath = join(cwd, "src", "fallback.ts");
  const outPath = join(cwd, "src", "fallback.out.js");

  if (clean || !isFile(outPath)) {
    await spawn("bun", ["install"], { cwd });
    await spawn(
      "bun",
      [
        "x",
        "esbuild",
        "--bundle",
        "--minify",
        "--target=esnext",
        "--format=iife",
        "--platform=browser",
        `--outfile=${outPath}`,
        srcPath,
      ],
      { cwd },
    );
  }
}

/**
 * @param {BuildOptions} options
 */
async function buildBunError(options) {
  const { cwd, clean } = options;
  const outPath = join(cwd, "dist");

  if (clean || !isDirectory(outPath)) {
    await spawn("bun", ["install"], { cwd });
    await spawn(
      "bun",
      [
        "x",
        "esbuild",
        "--bundle",
        "--minify",
        "--format=esm",
        "--platform=browser",
        "--define:process.env.NODE_ENV=\"'production'\"",
        `--outdir=${outPath}`,
        "index.tsx",
        "bun-error.css",
      ],
      { cwd },
    );
  }
}

/**
 * @param {BuildOptions} options
 */
async function buildBunNodeFallbacks(options) {
  const { cwd, clean } = options;
  const outPath = join(cwd, "out");

  if (clean || !isDirectory(outPath)) {
    const filenames = readdir(cwd).filter(filename => filename.endsWith(".js"));
    await spawn("bun", ["install"], { cwd });
    await spawn(
      "bun",
      [
        "x",
        "esbuild",
        "--bundle",
        "--minify",
        "--format=esm",
        "--platform=browser",
        `--outdir=${outPath}`,
        ...filenames,
      ],
      { cwd },
    );
  }
}

/**
 * Build dependencies.
 */

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getBoringSslArtifacts(options) {
  const { os } = options;
  if (os === "windows") {
    return ["crypto.lib", "ssl.lib", "decrepit.lib"];
  }
  return ["libcrypto.a", "libssl.a", "libdecrepit.a"];
}

/**
 * @param {BuildOptions} options
 */
async function buildBoringSsl(options) {
  await cmakeGenerateBuild(options);
  await cmakeBuild(options, ...getBoringSslArtifacts(options));
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getBrotliArtifacts(options) {
  const { os } = options;
  if (os === "windows") {
    return ["brotlicommon.lib", "brotlidec.lib", "brotlienc.lib"];
  }
  return ["libbrotlicommon.a", "libbrotlidec.a", "libbrotlienc.a"];
}

/**
 * @param {BuildOptions} options
 */
async function buildBrotli(options) {
  const { lto, target } = options;
  await cmakeGenerateBuild(
    { ...options, pic: true, lto: lto && target !== "linux-x64" },
    "-DBUILD_SHARED_LIBS=OFF",
    "-DBROTLI_BUILD_TOOLS=OFF",
    "-DBROTLI_DISABLE_TESTS=ON",
    "-DBROTLI_EMSCRIPTEN=OFF",
  );
  await cmakeBuild(options, "brotlicommon", "brotlidec", "brotlienc");
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getCaresArtifacts(options) {
  const libPath = "lib";
  const { os } = options;
  if (os === "windows") {
    return [join(libPath, "cares.lib")];
  }
  return [join(libPath, "libcares.a")];
}

/**
 * @param {BuildOptions} options
 */
async function buildCares(options) {
  await cmakeGenerateBuild(
    { ...options, pic: true },
    "-DCARES_STATIC=ON",
    "-DCARES_STATIC_PIC=ON",
    "-DCARES_SHARED=OFF",
  );
  await cmakeBuild(options, ...getCaresArtifacts(options));
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getLibarchiveArtifacts(options) {
  const { os } = options;
  const libPath = "libarchive";
  if (os === "windows") {
    return [join(libPath, "archive.lib")];
  }
  return [join(libPath, "libarchive.a")];
}

/**
 * @param {BuildOptions} options
 */
async function buildLibarchive(options) {
  await cmakeGenerateBuild(
    { ...options, pic: true },
    "-DBUILD_SHARED_LIBS=0",
    "-DENABLE_BZIP2=0",
    "-DENABLE_CAT=0",
    "-DENABLE_EXPAT=0",
    "-DENABLE_ICONV=0",
    "-DENABLE_INSTALL=0",
    "-DENABLE_LIBB2=0",
    "-DENABLE_LibGCC=0",
    "-DENABLE_LIBXML2=0",
    "-DENABLE_LZ4=0",
    "-DENABLE_LZMA=0",
    "-DENABLE_LZO=0",
    "-DENABLE_MBEDTLS=0",
    "-DENABLE_NETTLE=0",
    "-DENABLE_OPENSSL=0",
    "-DENABLE_PCRE2POSIX=0",
    "-DENABLE_PCREPOSIX=0",
    "-DENABLE_TEST=0",
    "-DENABLE_WERROR=0",
    "-DENABLE_ZLIB=0",
    "-DENABLE_ZSTD=0",
  );
  await cmakeBuild(options, "archive_static");
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getLibdeflateArtifacts(options) {
  const { os } = options;
  if (os === "windows") {
    return ["deflatestatic.lib"];
  }
  return ["libdeflate.a"];
}

/**
 * @param {BuildOptions} options
 */
async function buildLibdeflate(options) {
  await cmakeGenerateBuild(
    options,
    "-DLIBDEFLATE_BUILD_STATIC_LIB=ON",
    "-DLIBDEFLATE_BUILD_SHARED_LIB=OFF",
    "-DLIBDEFLATE_BUILD_GZIP=OFF",
  );
  await cmakeBuild(options, ...getLibdeflateArtifacts(options));
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getLibuvArtifacts(options) {
  const { os } = options;
  if (os === "windows") {
    return ["libuv.lib"];
  }
  return [];
}

/**
 * @param {BuildOptions} options
 */
async function buildLibuv(options) {
  await cmakeGenerateBuild(options, "-DCMAKE_C_FLAGS=/DWIN32 /D_WINDOWS -Wno-int-conversion");
  await cmakeBuild(options);
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getLolhtmlArtifacts(options) {
  const target = getRustTarget(options);
  const { os, debug } = options;
  const targetPath = join(target, debug ? "debug" : "release");
  if (os === "windows") {
    return [join(targetPath, "lolhtml.lib"), join(targetPath, "lolhtml.pdb")];
  }
  return [join(targetPath, "liblolhtml.a")];
}

/**
 * @param {BuildOptions} options
 */
async function buildLolhtml(options) {
  const { cwd } = options;
  const srcPath = join(cwd, "c-api");
  await cargoBuild({ ...options, cwd: srcPath });
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getLshpackArtifacts(options) {
  const { os } = options;
  if (os === "windows") {
    return ["ls-hpack.lib"];
  }
  return ["libls-hpack.a"];
}

/**
 * @param {BuildOptions} options
 */
async function buildLshpack(options) {
  // FIXME: There is a linking issue with lshpack built in debug mode or debug symbols
  await cmakeGenerateBuild({ ...options, debug: false, assertions: false }, "-DLSHPACK_XXH=ON", "-DSHARED=0");
  await cmakeBuild(options, ...getLshpackArtifacts(options));
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getMimallocArtifacts(options) {
  const { os, debug } = options;
  if (os === "windows") {
    return ["mimalloc-static.lib"];
  }
  const name = debug ? "libmimalloc-debug" : "libmimalloc";
  return [`${name}.a`, `${name}.o`];
}

/**
 * @param {BuildOptions} options
 */
async function buildMimalloc(options) {
  const { os, debug, valgrind, buildPath } = options;
  const flags = [
    "-DMI_SKIP_COLLECT_ON_EXIT=1",
    "-DMI_BUILD_SHARED=OFF",
    "-DMI_BUILD_STATIC=ON",
    "-DMI_BUILD_TESTS=OFF",
    "-DMI_OSX_ZONE=OFF",
    "-DMI_OSX_INTERPOSE=OFF",
    "-DMI_BUILD_OBJECT=ON",
    "-DMI_USE_CXX=ON",
    "-DMI_OVERRIDE=OFF",
    "-DMI_OSX_ZONE=OFF",
  ];
  if (debug) {
    flags.push("-DMI_DEBUG_FULL=1");
  }
  if (valgrind) {
    flags.push("-DMI_TRACK_VALGRIND=ON");
  }
  await cmakeGenerateBuild(options, ...flags);
  await cmakeBuild(options);
  if (os !== "windows") {
    const objectPath = join(buildPath, "CMakeFiles", "mimalloc-obj.dir", "src", "static.c.o");
    const name = debug ? "libmimalloc-debug" : "libmimalloc";
    cp(objectPath, join(buildPath, `${name}.o`));
  }
}

function getSqliteArtifacts(options) {
  const { os } = options;
  if (os === "windows") {
    return ["sqlite3.lib"];
  }
  return ["libsqlite3.a"];
}

async function buildSqlite(options) {
  await cmakeGenerateBuild(options);
  await cmakeBuild(options);
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getTinyccArtifacts(options) {
  const { os } = options;
  if (os === "windows") {
    return ["tcc.lib"];
  }
  return ["libtcc.a"];
}

/**
 * @param {BuildOptions} options
 */
async function buildTinycc(options) {
  const { os, cwd, buildPath, cc, ccache, ar, debug, clean, jobs } = options;

  // tinycc doesn't support out-of-source builds, so we need to copy the source
  // directory to the build directory.
  if (!isDirectory(buildPath) || clean) {
    rm(buildPath);
    cp(cwd, buildPath);
  }

  const cflags = getCFlags(options);
  const ldflags = getLdFlags(options);
  const ccOrCcache = ccache ? `${ccache} ${cc}` : cc;

  async function posixBuild() {
    const args = [
      "--config-predefs=yes",
      "--enable-static",
      `--cc=${ccOrCcache}`,
      `--extra-cflags=${cflags.join(" ")}`,
      `--ar=${ar}`,
      `--extra-ldflags=${ldflags.join(" ")}`,
    ];
    if (debug) {
      args.push("--debug");
    }
    await spawn("./configure", args, { cwd: buildPath });

    // There is a bug in configure that causes it to use the wrong compiler.
    // We need to patch the config.mak file to use the correct compiler.
    const configPath = join(buildPath, "config.mak");
    if (!isFile(configPath)) {
      throw new Error("Could not find file: config.mak");
    }
    const configText = readFile(configPath, "utf-8");
    if (!configText.includes(ccOrCcache)) {
      writeFile(configPath, configText.replace(/CC=[^\n]+/g, `CC=${ccOrCcache}`));
      print("Patched config.mak");
    }

    await spawn("make", ["libtcc.a", "-j", `${jobs}`], { cwd: buildPath });
  }

  async function windowsBuild() {
    const version = readFile(join(buildPath, "VERSION"));
    const revision = getSha(buildPath);
    const configText = `#define TCC_VERSION "${version.trim()}"
#define TCC_GITHASH "${revision.trim()}"
#define CONFIG_TCCDIR "${buildPath.replace(/\\/g, "/")}"
#define CONFIG_TCC_PREDEFS 1
#ifdef TCC_TARGET_X86_64
#define CONFIG_TCC_CROSSPREFIX "${process.env["PX"] || ""}%-"
#endif
`;
    writeFile(join(buildPath, "config.h"), configText);
    print("Generated config.h");
    await spawn(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        `
          ${cc} -DTCC_TARGET_PE -DTCC_TARGET_X86_64 config.h -DC2STR -o c2str.exe conftest.c
          .\\c2str.exe .\\include\\tccdefs.h tccdefs_.h
          ${cc} ${cflags.join(" ")} libtcc.c -o tcc.obj "-DTCC_TARGET_PE" "-DTCC_TARGET_X86_64" "-O2" "-W2" "-Zi" "-MD" "-GS-" "-c" "-MT"
          ${ar} "tcc.obj" "-OUT:tcc.lib"
        `,
      ],
      { cwd: buildPath },
    );
  }

  if (os === "windows") {
    await windowsBuild();
  } else {
    await posixBuild();
  }
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getZlibArtifacts(options) {
  const { os } = options;
  if (os === "windows") {
    return ["zlib.lib"];
  }
  return ["libz.a"];
}

/**
 * @param {BuildOptions} options
 */
async function buildZlib(options) {
  const { os, cwd } = options;

  // TODO: Make a patch to zlib for clang-cl, which implements `__builtin_ctzl` and `__builtin_expect`
  if (os === "windows") {
    const filePath = join(cwd, "deflate.h");
    const fileContent = readFile(filePath, "utf-8");
    const start = fileContent.lastIndexOf("#ifdef _MSC_VER");
    const end = fileContent.lastIndexOf("#else");
    if (start !== -1 && end !== -1) {
      writeFile(filePath, fileContent.slice(0, start) + "#ifdef FALSE\n" + fileContent.slice(end));
      print("Patched deflate.h");
    }
  }

  await cmakeGenerateBuild(options);
  await cmakeBuild(options, ...getZlibArtifacts(options));
}

/**
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getZstdArtifacts(options) {
  const { os } = options;
  const libPath = "lib";
  if (os === "windows") {
    return [join(libPath, "zstd_static.lib")];
  }
  return [join(libPath, "libzstd.a")];
}

/**
 * @param {BuildOptions} options
 */
async function buildZstd(options) {
  const { cwd } = options;
  const cmakePath = join(cwd, "build", "cmake");
  await cmakeGenerateBuild({ ...options, cwd: cmakePath }, "-DZSTD_BUILD_STATIC=ON");
  await cmakeBuild(options, ...getZstdArtifacts(options));
}

/**
 * C/C++ compiler flags.
 */

/**
 * Gets the C flags for the given options.
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getCFlags(options) {
  const { cwd, buildPath, debug, os, arch, baseline, lto, pic, osxVersion, llvmVersion, artifact } = options;
  const flags = [];

  // Relocates debug info from an absolute path to a relative path
  // https://ccache.dev/manual/4.8.2.html#_compiling_in_different_directories
  if (os !== "windows") {
    flags.push(`-ffile-prefix-map=${cwd}=.`, `-ffile-prefix-map=${buildPath}=build`);
  }

  if (isColorTerminal && os !== "windows") {
    flags.push("-fansi-escape-codes", "-fdiagnostics-color=always");
  }

  if (os === "windows") {
    flags.push("/Z7", "/MT", "/Ob2", "/DNDEBUG", "/U_DLL");
    if (!debug) {
      flags.push("/O2");
    }
  } else {
    flags.push(
      "-fno-exceptions",
      "-fvisibility=hidden",
      "-fvisibility-inlines-hidden",
      "-mno-omit-leaf-frame-pointer",
      "-fno-omit-frame-pointer",
      "-fno-asynchronous-unwind-tables",
      "-fno-unwind-tables",
    );
    if (!debug) {
      flags.push("-O3");
    }
  }

  if (arch === "x64") {
    if (baseline) {
      flags.push("-march=nehalem");
    } else {
      flags.push("-march=haswell");
    }
  } else if (arch === "aarch64") {
    if (os === "darwin") {
      flags.push("-mcpu=apple-m1");
    } else {
      flags.push("-march=armv8-a+crc", "-mtune=ampere1");
    }
  }

  if (os === "linux") {
    flags.push("-ffunction-sections", "-fdata-sections", "-faddrsig");
  } else if (os === "darwin") {
    if (osxVersion) {
      flags.push(`-mmacosx-version-min=${osxVersion}`);
    }

    // Clang 18 on macOS needs to have -fno-define-target-os-macros to fix a zlib build issue:
    // https://gitlab.kitware.com/cmake/cmake/-/issues/25755
    if (artifact === "zlib" && compareSemver(llvmVersion, "18") >= 0) {
      flags.push("-fno-define-target-os-macros");
    }

    flags.push("-D__DARWIN_NON_CANCELABLE=1");
  }

  if (lto) {
    if (os === "windows") {
      flags.push("-flto", "-Xclang", "-emit-llvm-bc");
      flags.push("-fuse-ld=lld");
    } else {
      flags.push("-flto=full");
    }
  }

  if (pic) {
    flags.push("-fPIC");
  } else if (os === "linux") {
    flags.push("-fno-pie", "-fno-pic");
  }

  if (artifact === "icu4c" || artifact === "webkit") {
    flags.push("-DU_STATIC_IMPLEMENTATION=1");
  }

  return flags;
}

/**
 * Gets the C++ flags for the given options.
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getCxxFlags(options) {
  const { os, lto, artifact } = options;
  const flags = getCFlags(options);

  if (os !== "windows") {
    flags.push("-fno-c++-static-destructors");

    // icu4c requires -frtti
    // normalizer2.cpp:384:41: error: use of dynamic_cast requires -frtti
    if (artifact === "icu4c") {
      flags.push("-frtti");
    } else {
      flags.push("-fno-rtti");
    }

    if (lto) {
      flags.push("-fwhole-program-vtables", "-fforce-emit-vtables");
    }
  }

  // Fixes build issue with libc++ on macOS 13.0
  // https://github.com/oven-sh/bun/pull/12860
  if (os === "darwin" && artifact !== "bun") {
    flags.push("-D_LIBCXX_ENABLE_ASSERTIONS=0", "-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_NONE");
  }

  return flags;
}

/**
 * Gets the linker flags for the given options.
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getLdFlags(options) {
  const { os, lto, ld } = options;
  const flags = [];

  if (ld) {
    if (exists(ld)) {
      flags.push(`--ld-path=${ld}`);
    } else {
      flags.push(`-fuse-ld=${ld}`);
    }
  }

  if (os === "linux") {
    flags.push("-Wl,-z,norelro");
  }

  if (lto && os !== "windows") {
    flags.push("-flto=full", "-fwhole-program-vtables", "-fforce-emit-vtables");
  }

  return flags;
}

/**
 * @param {string} path
 * @returns {string}
 */
function getCmakePath(path) {
  // clang-cl doesn't support unescaped backslashes, otherwise it fails with:
  // Invalid character escape '\U'
  if (isWindows) {
    return path.replace(/\\/g, "/");
  }
  return path;
}

/**
 * Gets the CMake flags for the given options.
 * @param {BuildOptions} options
 * @returns {string[]}
 */
function getCmakeFlags(options) {
  const { cwd, buildPath, debug, assertions, os, osxVersion, clean } = options;
  const { cc, cxx, ar, ranlib, ld, ccache } = options;

  const flags = [
    `-S${getCmakePath(cwd)}`,
    `-B${getCmakePath(buildPath)}`,
    "-GNinja",
    "-DCMAKE_C_STANDARD=17",
    "-DCMAKE_C_STANDARD_REQUIRED=ON",
    "-DCMAKE_CXX_STANDARD=20",
    "-DCMAKE_CXX_STANDARD_REQUIRED=ON",
  ];

  if (isColorTerminal) {
    flags.push("-DCMAKE_COLOR_DIAGNOSTICS=ON");
  }

  if (clean) {
    flags.push("--fresh");
  }

  if (debug) {
    flags.push("-DCMAKE_BUILD_TYPE=Debug");
  } else if (assertions) {
    flags.push("-DCMAKE_BUILD_TYPE=RelWithDebInfo");
  } else {
    flags.push("-DCMAKE_BUILD_TYPE=Release");
  }

  if (cc) {
    flags.push(`-DCMAKE_C_COMPILER=${getCmakePath(cc)}`, "-DCMAKE_C_COMPILER_WORKS=ON");
  }

  const cflags = getCFlags(options);
  if (cflags.length) {
    flags.push(`-DCMAKE_C_FLAGS=${cflags.join(" ")}`);
  }

  if (cxx) {
    flags.push(`-DCMAKE_CXX_COMPILER=${getCmakePath(cxx)}`, "-DCMAKE_CXX_COMPILER_WORKS=ON");
  }

  const cxxflags = getCxxFlags(options);
  if (cxxflags.length) {
    flags.push(`-DCMAKE_CXX_FLAGS=${cxxflags.join(" ")}`);
  }

  if (ld) {
    flags.push(`-DCMAKE_LINKER=${getCmakePath(ld)}`);
  }

  const ldflags = getLdFlags(options);
  if (ldflags.length) {
    flags.push(`-DCMAKE_LINKER_FLAGS=${ldflags.join(" ")}`, `-DCMAKE_EXE_LINKER_FLAGS=${ldflags.join(" ")}`);
  }

  if (ar) {
    flags.push(`-DCMAKE_AR=${getCmakePath(ar)}`);
  }

  if (ranlib) {
    flags.push(`-DCMAKE_RANLIB=${getCmakePath(ranlib)}`);
  }

  if (ccache) {
    flags.push(
      `-DCMAKE_C_COMPILER_LAUNCHER=${getCmakePath(ccache)}`,
      `-DCMAKE_CXX_COMPILER_LAUNCHER=${getCmakePath(ccache)}`,
    );
  }

  if (os === "darwin" && osxVersion) {
    flags.push(`-DCMAKE_OSX_DEPLOYMENT_TARGET=${osxVersion}`);
  }

  if (os === "linux") {
    // WebKit is built with -std=gnu++20 on Linux
    // If not specified, the build crashes on the first memory allocation
    flags.push("-DCMAKE_CXX_EXTENSIONS=ON");
  }

  if (os === "windows") {
    // Bug with cmake and clang-cl where "Note: including file:" is saved in the file path
    // https://github.com/ninja-build/ninja/issues/2280
    flags.push("-DCMAKE_CL_SHOWINCLUDES_PREFIX=Note: including file:");

    // Generates a .pdb file with debug symbols, only works with cmake 3.25+
    flags.push("-DCMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded", "-DCMAKE_POLICY_CMP0141=NEW");

    // Selects the MSVC runtime library that supports statically-linked and multi-threaded
    flags.push(`-DCMAKE_MSVC_RUNTIME_LIBRARY=${debug ? "MultiThreadedDebug" : "MultiThreaded"}`);
  }

  if (isVerbose) {
    // Generates a compile_commands.json file with a list of compiler commands
    flags.push("-DCMAKE_EXPORT_COMPILE_COMMANDS=ON");

    flags.push("--log-level=VERBOSE", "-DCMAKE_VERBOSE_MAKEFILE=ON");
  }

  // ?
  // CMAKE_APPLE_SILICON_PROCESSOR
  // CMAKE_<LANG>_CPPCHECK
  // CMAKE_<LANG>_CPPLINT
  // CMAKE_OSX_DEPLOYMENT_TARGET
  // CMAKE_OSX_SYSROOT

  return flags.filter(Boolean);
}

/**
 * @param {string} [llvmVersion]
 */
function getLlvmPath(llvmVersion) {
  const llvmMajorVersion = llvmVersion?.split(".")[0];

  if (isMacOS) {
    const brewName = llvmMajorVersion ? `llvm@${llvmMajorVersion}` : "llvm";
    const { exitCode, stdout } = spawnSync("brew", ["--prefix", brewName], { throwOnError: false });
    if (exitCode === 0) {
      const llvmPath = join(stdout.trim(), "bin");
      if (isDirectory(llvmPath)) {
        return llvmPath;
      }
    }
  }
}

/**
 * Build commands.
 */

/**
 * Runs CMake to generate the build files.
 * @param {BuildOptions} options
 * @param {...string} extraArgs
 */
async function cmakeGenerateBuild(options, ...extraArgs) {
  const args = getCmakeFlags(options);

  await spawn("cmake", [...args, ...extraArgs]);
}

/**
 * Runs CMake to build the project.
 * @param {BuildOptions} options
 * @param {string[]} [targets]
 */
async function cmakeBuild(options, ...targets) {
  const { cwd, buildPath, debug, assertions, clean, jobs } = options;
  const args = ["--build", buildPath, "--parallel", `${jobs}`];

  if (debug) {
    args.push("--config", "Debug");
  } else if (assertions) {
    args.push("--config", "RelWithDebInfo");
  } else {
    args.push("--config", "Release");
  }

  if (clean) {
    args.push("--clean-first");
  }

  for (const target of targets) {
    args.push("--target", basename(target));
  }

  await spawn("cmake", args, { cwd });
}

/**
 * Runs cargo to build a Rust project.
 * @param {BuildOptions} options
 * @param {string} [target]
 */
async function cargoBuild(options) {
  const { os, cwd, buildPath, debug, jobs } = options;

  const target = getRustTarget(options);
  const args = ["build", "--target-dir", buildPath, "--target", target, "--jobs", `${jobs}`];
  if (!debug) {
    args.push("--release");
  }
  if (isVerbose) {
    args.push("--verbose");
  }

  // FIXME: cargo is not set to PATH on Linux CI
  if (os === "linux") {
    addToPath(join(process.env["HOME"], ".cargo", "bin"));
  }

  await spawn("cargo", args, { cwd });
}

/**
 * @param {BuildOptions} options
 * @param {string} [label]
 * @returns {string}
 */
function getCachePath(options, label) {
  const { cwd, cachePath, cacheStrategy } = options;

  // If caching is disabled, create a throw-away temporary directory
  // to make sure that the cache is not re-used.
  if (cacheStrategy === "none") {
    return mkdirTmp(label);
  }

  return join(cachePath || join(cwd, ".cache"), label);
}

/**
 * Environment variables.
 */

/**
 * Gets the environment variables for building bun.
 * @param {BuildOptions} options
 */
function getBuildEnv(options) {
  const env = {
    ...getCcacheEnv(options),
    ...getZigEnv(options),
    ...getBunEnv(options),
  };

  const gitSha = getSha();
  if (gitSha) {
    env["GIT_SHA"] = gitSha;
  }

  return env;
}

/**
 * Gets the environment variables for ccache.
 * @param {BuildOptions} options
 * @returns {Record<string, string>}
 */
function getCcacheEnv(options) {
  const { cwd, cacheStrategy, artifact } = options;
  const ccachePath = getCachePath(options, "ccache");

  // https://ccache.dev/manual/4.8.2.html#_configuration_options
  const env = {
    "CCACHE_BASEDIR": cwd,
    "CCACHE_DIR": ccachePath,
    "CCACHE_NOHASHDIR": "1", // Do not hash the cwd
    "CCACHE_SLOPPINESS": "gcno_cwd,pch_defines,time_macros,include_file_mtime,include_file_ctime",
  };

  if (cacheStrategy === "read") {
    env["CCACHE_READONLY"] = "1";
  } else if (cacheStrategy === "write") {
    env["CCACHE_RECACHE"] = "1";
  } else if (cacheStrategy === "none") {
    env["CCACHE_DISABLE"] = "1";
  }

  // Use a different cache namespace for each artifact
  if (artifact) {
    env["CCACHE_NAMESPACE"] = artifact;
  }

  // Use clonefile() for faster copying, if available
  // However, this disabled compression, so we need to use a larger cache
  if (isCI) {
    env["CCACHE_FILECLONE"] = "1";
    env["CCACHE_MAXSIZE"] = "50G";
  }

  return env;
}

/**
 * Gets the environment variables for zig.
 * @param {BuildOptions} options
 * @returns {Record<string, string>}
 */
function getZigEnv(options) {
  let zigCachePath;
  if (isCI) {
    // TODO: Zig's cache is not realiable in CI due to concurrent access
    // For example, sometimes it will just hang the build forever.
    zigCachePath = getCachePath({ ...options, cacheStrategy: "none" }, "zig-cache");
  } else {
    zigCachePath = getCachePath(options, "zig-cache");
  }

  return {
    "ZIG_LOCAL_CACHE_DIR": zigCachePath,
    "ZIG_GLOBAL_CACHE_DIR": zigCachePath,
  };
}

/**
 * Gets the environment variables for bun.
 * @param {BuildOptions} options
 * @returns {Record<string, string>}
 */
function getBunEnv(options) {
  const bunCachePath = getCachePath(options, "bun-install");

  return {
    "BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING": "1",
    "BUN_DEBUG_QUIET_LOGS": "1",
    "BUN_GARBAGE_COLLECTOR_LEVEL": "1",
    "BUN_ENABLE_CRASH_REPORTING": "0",
    "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0",
    "BUN_INSTALL_CACHE_DIR": bunCachePath,
  };
}

/**
 * Miscellaneous utilities.
 */

/**
 * Gets the Rust target for the given options.
 * @param {BuildOptions} options
 * @returns {string}
 */
function getRustTarget(options) {
  const { os, arch } = options;
  const target = `${os}-${arch}`;
  switch (target) {
    case "windows-x64":
      return "x86_64-pc-windows-msvc";
    case "linux-x64":
      return "x86_64-unknown-linux-gnu";
    case "linux-aarch64":
      return "aarch64-unknown-linux-gnu";
    case "darwin-x64":
      return "x86_64-apple-darwin";
    case "darwin-aarch64":
      return "aarch64-apple-darwin";
    default:
      throw new Error(`Unsupported Rust target: ${target}`);
  }
}

/**
 * Gets the Zig target for the given options.
 * @param {BuildOptions} options
 * @returns {string}
 */
function getZigTarget(options) {
  const { os, arch } = options;
  const target = `${os}-${arch}`;
  switch (target) {
    case "windows-x64":
      return "x86_64-windows-msvc";
    case "linux-x64":
      return "x86_64-linux-gnu";
    case "linux-aarch64":
      return "aarch64-linux-gnu";
    case "darwin-x64":
      return "x86_64-macos-none";
    case "darwin-aarch64":
      return "aarch64-macos-none";
    default:
      throw new Error(`Unsupported Zig target: ${target}`);
  }
}

/**
 * Gets the zig optimize level for the given options.
 * @param {BuildOptions} options
 * @returns {string}
 */
function getZigOptimize(options) {
  const { debug, assertions, os } = options;

  if (debug) {
    return "Debug";
  }

  if (assertions) {
    return "ReleaseSafe";
  }

  // The release mode for Windows has historically been "ReleaseSafe"
  // since it was helpful to catch bugs when adding Bundows support.
  // We could revisit this in the future.
  if (os === "windows") {
    return "ReleaseSafe";
  }

  return "ReleaseFast";
}

/**
 * Gets the CPU target for the given options.
 * @param {BuildOptions} options
 * @returns {string}
 */
function getCpuTarget(options) {
  const { arch, baseline } = options;

  if (baseline) {
    return "nehalem";
  }

  if (arch === "x64") {
    return "haswell";
  }

  return "native";
}

await main();
