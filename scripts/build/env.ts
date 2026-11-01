/**
 * The environment the build runs in.
 *
 * Tools read variables nobody passes them. clang takes include directories from CPATH, arguments from
 * CCC_OVERRIDE_OPTIONS and `__DATE__` from SOURCE_DATE_EPOCH; its linker step takes library directories from
 * LIBRARY_PATH; rustc takes a deployment target from MACOSX_DEPLOYMENT_TARGET; a build script reads what it likes. So
 * what a shell happens to export can change what gets built, and nothing records that it did.
 *
 * `inheritedVariables` is all of the caller's environment the build looks at. build.ts drops the rest from its own
 * environment before it does anything (`restrictEnvironment`), so configure and the tools it asks questions of see
 * the list, and it starts ninja with the list and nothing else (`edgeEnvironment`), so every edge does, the `regen`
 * edge that configures again included. A variable an edge needs beyond these belongs in its command or its manifest,
 * where ninja sees it change.
 *
 * PATH is not on the list. build.ts keeps the caller's, for configure to look for tools on; an edge gets the part of
 * it configure found tools in (`edgeSearchPath` in tools.ts).
 */

/** A name here is a promise that it cannot change what is built, or a way the build is told what to build with. */
export const inheritedVariables = [
  // ─── Running a program ───
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",

  // ─── Running a program on Windows ───
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",

  // ─── The Visual Studio shell build.ts enters on Windows: what clang-cl, lld-link, rustc and cmake read of it ───
  "VSINSTALLDIR",
  "VCINSTALLDIR",
  "VCToolsInstallDir",
  "VCToolsVersion",
  "VCToolsRedistDir",
  "VisualStudioVersion",
  "VSCMD_VER",
  "VSCMD_ARG_HOST_ARCH",
  "VSCMD_ARG_TGT_ARCH",
  "INCLUDE",
  "EXTERNAL_INCLUDE",
  "LIB",
  "LIBPATH",
  "WindowsSdkDir",
  "WindowsSdkBinPath",
  "WindowsSdkVerBinPath",
  "WindowsSDKVersion",
  "WindowsSDKLibVersion",
  "WindowsLibPath",
  "UniversalCRTSdkDir",
  "UCRTVersion",

  // ─── What is printed, and how ───
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "CLICOLOR_FORCE",
  "NINJA_STATUS",
  "BUN_BUILD_TRACE",
  "CLAUDECODE",
  "VERBOSE",

  // ─── Reaching the network: the fetch edges, cargo, rustup ───
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "CARGO_HTTP_CAINFO",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",

  // ─── Where things are: read by configure ───
  "BUN_TOOLCHAIN_LLVM",
  "BUN_TOOLCHAIN_RUST",
  "BUN_TOOLCHAIN_CARGO",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "BUN_INSTALL",
  "BUN_INSTALL_CACHE_DIR",
  "BUN_BUILD_CACHE_DIR",
  "BUN_BUILD_PREFETCH_DIR",
  "BUN_WEBKIT_PATH",
  "BUN_ANDROID_ICU_ROOT",
  "ANDROID_NDK_ROOT",
  "ANDROID_NDK_HOME",
  "ANDROID_NDK",
  "FREEBSD_SYSROOT",
  "LINUX_GLIBC_SYSROOT",
  "LINUX_MUSL_SYSROOT",
  "WINDOWS_SYSROOT",
  "MACOS_SDK_PATH",
  "DEVELOPER_DIR",

  // ─── Which commit, and whether this is CI: read by configure ───
  "CI",
  "BUILDKITE",
  "GITHUB_ACTIONS",
  "BUILDKITE_COMMIT",
  "GITHUB_SHA",
  "GIT_SHA",

  // ─── Read to say that it is not used (rust.ts) ───
  "RUSTC_WRAPPER",
  "CARGO_BUILD_RUSTC_WRAPPER",

  // ─── `nix develop`: with `inheritedPrefixes`, how its compiler wrappers find their libraries ───
  "LD_LIBRARY_PATH",
] as const;

/** `nix develop`'s clang is a wrapper that takes its flags from NIX_CFLAGS_COMPILE, NIX_LDFLAGS and their like. */
export const inheritedPrefixes = ["NIX_"] as const;

/**
 * What build.ts keeps for itself besides: it reports to the CI service that started it (ci.ts, annotations.ts, and
 * the `buildkite-agent` they run, which authenticates with these). No edge sees them.
 */
export const ciServicePrefixes = ["BUILDKITE_", "GITHUB_"] as const;

type Environment = Record<string, string | undefined>;

/** What configure adds to an edge's environment. */
export type EdgeAdditions = Record<string, string> & { PATH: string };

// Windows spells a name any way it likes (`Path`), and matches it whatever the case.
const sameName: (a: string, b: string) => boolean =
  process.platform === "win32" ? (a, b) => a.toUpperCase() === b.toUpperCase() : (a, b) => a === b;
const hasPrefix: (name: string, prefix: string) => boolean =
  process.platform === "win32"
    ? (name, prefix) => name.toUpperCase().startsWith(prefix.toUpperCase())
    : (name, prefix) => name.startsWith(prefix);

/** Whether an edge sees the caller's `name`. */
export function isInherited(name: string): boolean {
  return inheritedVariables.some(v => sameName(v, name)) || inheritedPrefixes.some(p => hasPrefix(name, p));
}

/** Drop from `env`, in place, what neither the build nor build.ts's reports to the CI service look at. */
export function restrictEnvironment(env: Environment): void {
  for (const name of Object.keys(env)) {
    if (isInherited(name) || sameName(name, "PATH") || ciServicePrefixes.some(p => hasPrefix(name, p))) continue;
    delete env[name];
  }
}

/** What ninja is started with: the inherited part of `env`, then what configure adds. */
export function edgeEnvironment(env: Environment, added: EdgeAdditions): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && isInherited(name)) result[name] = value;
  }
  return { ...result, ...added };
}
