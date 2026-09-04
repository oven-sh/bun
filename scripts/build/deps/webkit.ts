/**
 * WebKit commit — determines prebuilt download URL + what to checkout
 * for local mode. Override via `--webkit-version=<hash>` to test a branch.
 * From https://github.com/oven-sh/WebKit releases.
 */
export const WEBKIT_VERSION = "40e43a82a755af3cc9eb4a4e025e4e020a7a3cfd";

/**
 * WebKit (JavaScriptCore) — the JS engine.
 *
 * Three modes via `cfg.webkit`:
 *
 * **prebuilt**: Download tarball from oven-sh/WebKit releases. Tarball name
 *   encodes {os, arch, musl, debug|lto, asan} — each is a separate ABI.
 *   ASAN MUST match bun's setting: WTF::Vector layout changes with ASAN
 *   (see WTF/Vector.h:682), so mixing → silent memory corruption.
 *
 * **source**: The build fetches WEBKIT_VERSION into `vendor/WebKit/` like any
 *   other dep — a sparse git fetch of just Source/{bmalloc,WTF,JavaScriptCore}
 *   (~35 MB over the wire instead of a 12 GB clone) — and compiles it in our
 *   own ninja graph, no cmake ("Source mode: direct build" below).
 *   Generated headers land in the BUILD dir.
 *
 * **local**: WebKit's own cmake build (nested) over a checkout you manage:
 *   `$BUN_WEBKIT_PATH` if set, else `vendor/WebKit/`. Never fetched or
 *   stamped; the inner build re-runs every time so your edits are picked up.
 *   For working on JSC itself with WebKit's own tooling.
 *
 * ## Implementation notes
 *
 * - Build dir is `buildDir/deps/webkit/` (generic path), NOT CMake's
 *   `vendor/WebKit/WebKitBuild/`. Better: consistent, cleaned by `rm -rf
 *   build/`, separate per-profile.
 *
 * - Flags: WebKit's own cmake machinery sets -O/-g/sanitizer flags. We
 *   override `CMAKE_C_FLAGS` to drop the global dep flags (which would
 *   conflict) but DO forward -march/-mcpu + LTO/PGO, which WebKit never
 *   sets. Dep args go LAST in source.ts, so they override.
 *
 * - Windows local mode: ICU built from source via preBuild hook
 *   (build-icu.ps1 → msbuild) before cmake configure. Output goes in
 *   the per-profile build dir, not shared vendor/WebKit/WebKitBuild/icu/
 *   like the old cmake — avoids debug/release mixing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { cmakeVars, evaluateCMake, type CMakeVars } from "../cmake-lists.ts";
import { ar, cc, cxx, link, pch } from "../compile.ts";
import type { Config } from "../config.ts";
import { BuildError, assert } from "../error.ts";
import { computeCpuTargetFlags, computeDepFlags, computeTargetLinkFlags, systemLibs } from "../flags.ts";
import { writeIfChanged } from "../fs.ts";
import type { Ninja } from "../ninja.ts";
import { quote, quoteArgs, slash } from "../shell.ts";
import {
  depBuildDir,
  depSourceDir,
  type CustomBuildContext,
  type Dependency,
  type NestedCmakeBuild,
  type Source,
} from "../source.ts";
import { buildsIcu, icuIncludes } from "./icu.ts";

// ───────────────────────────────────────────────────────────────────────────
// Prebuilt URL computation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Tarball suffix encoding ABI-affecting flags. MUST match the WebKit
 * release workflow naming in oven-sh/WebKit's CI. There is no -baseline
 * variant: every x64 WebKit is built at the nehalem floor.
 */
function prebuiltSuffix(cfg: Config): string {
  let s = "";
  if (cfg.linux && cfg.abi === "musl") s += "-musl";
  if (cfg.linux && cfg.abi === "android") s += "-android";
  if (cfg.debug) s += "-debug";
  else if (cfg.lto) s += "-lto";
  if (cfg.asan) s += "-asan";
  return s;
}

function prebuiltUrl(cfg: Config): string {
  const os = cfg.windows ? "windows" : cfg.darwin ? "macos" : cfg.freebsd ? "freebsd" : "linux";
  const arch = cfg.arm64 ? "arm64" : "amd64";
  const name = `bun-webkit-${os}-${arch}${prebuiltSuffix(cfg)}`;
  const version = cfg.webkitVersion;
  const tag = version.startsWith("autobuild-") ? version : `autobuild-${version}`;
  return `https://github.com/oven-sh/WebKit/releases/download/${tag}/${name}.tar.gz`;
}

/**
 * Prebuilt extraction dir. Suffix in the key so switching debug ↔ release
 * doesn't reuse a wrong-ABI extraction.
 */
function prebuiltDestDir(cfg: Config): string {
  // For 40-hex shas, 16 chars is plenty. For autobuild-preview-* tags, the
  // meaningful sha is at the end, so use the whole thing.
  const v = cfg.webkitVersion;
  const version16 = v.startsWith("autobuild-") ? v.slice("autobuild-".length) : v.slice(0, 16);
  // Cross-compiled targets share a host (and cache dir) with native builds,
  // so include os+arch in the key — otherwise a FreeBSD/arm64, macOS/x64, or
  // Windows-cross extraction collides with a Linux/x64 one at the same WebKit
  // version. Windows is keyed only when cross-compiling so native Windows
  // dev machines keep their existing cache dirs.
  const osKey =
    cfg.windows && cfg.host.os !== "windows"
      ? "-windows"
      : cfg.freebsd
        ? "-freebsd"
        : cfg.darwin
          ? "-macos"
          : cfg.abi === "android"
            ? "-android"
            : "";
  const archKey = cfg.arm64 ? "-arm64" : "";
  return resolve(cfg.cacheDir, `webkit-${version16}${osKey}${archKey}${prebuiltSuffix(cfg)}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Lib paths — relative to destDir (prebuilt) or buildDir (local)
// ───────────────────────────────────────────────────────────────────────────

export function webkitTestFFIPath(cfg: Config): string {
  const root = cfg.webkit === "prebuilt" ? prebuiltDestDir(cfg) : depBuildDir(cfg, "WebKit");
  return resolve(root, "bin", cfg.windows ? "testFFI.exe" : "testFFI");
}

/** Build a lib path under the WebKit install's lib/ dir. */
function wkLib(cfg: Config, name: string): string {
  return `lib/${cfg.libPrefix}${name}${cfg.libSuffix}`;
}

/**
 * Core libs (WTF, JSC) — always present.
 */
function coreLibs(cfg: Config): string[] {
  return [wkLib(cfg, "WTF"), wkLib(cfg, "JavaScriptCore")];
}

function bmallocLib(cfg: Config): string {
  return wkLib(cfg, "bmalloc");
}

/**
 * ICU libs — prebuilt bundles them on linux/windows. macOS uses system ICU.
 * Local mode: system ICU on posix (linked via -licu* in bun.ts); built from
 * source on Windows (see icuDir/icuLibs).
 */
function prebuiltIcuLibs(cfg: Config): string[] {
  if (cfg.windows) {
    const d = cfg.debug ? "d" : "";
    return [`lib/sicudt${d}.lib`, `lib/sicuin${d}.lib`, `lib/sicuuc${d}.lib`];
  }
  if (cfg.linux || cfg.freebsd) {
    return ["lib/libicudata.a", "lib/libicui18n.a", "lib/libicuuc.a"];
  }
  return []; // darwin: system ICU
}

// ───────────────────────────────────────────────────────────────────────────
// Windows local mode: ICU built from source via build-icu.ps1
//
// No system ICU on Windows. The script (in vendor/WebKit/) downloads ICU
// source, patches .vcxproj files for static+/MT, runs msbuild. Output goes
// under the WebKit build dir (NOT vendor/WebKit/WebKitBuild/icu/ like the
// old cmake did) — per-profile, so debug/release don't conflate.
// ───────────────────────────────────────────────────────────────────────────

/** Where build-icu.ps1 writes its output. Per-profile via buildDir. */
function icuDir(cfg: Config): string {
  return resolve(depBuildDir(cfg, "WebKit"), "icu");
}

/**
 * Libs produced by build-icu.ps1. Names are from the script's output
 * (sicudt.lib, icuin.lib, icuuc.lib) — no `d` suffix needed since the
 * per-profile dir already isolates debug/release.
 */
function localIcuLibs(cfg: Config): string[] {
  const dir = icuDir(cfg);
  return [resolve(dir, "lib", "sicudt.lib"), resolve(dir, "lib", "icuin.lib"), resolve(dir, "lib", "icuuc.lib")];
}

/**
 * The part of the WebKit tree `source` mode fetches (git sparse-checkout
 * patterns, anchored at the repo root): the three libraries source mode
 * builds, whose CMakeLists.txt/Sources.txt it also reads for file lists.
 */
const sourceSparse = ["/Source/bmalloc/", "/Source/WTF/", "/Source/JavaScriptCore/"];

/**
 * WebKit source dir for source/local mode. vendor/WebKit, except local mode
 * follows $BUN_WEBKIT_PATH so one clone can serve every worktree.
 */
function webkitSrcDir(cfg: Config): string {
  const env = cfg.webkit === "local" ? process.env.BUN_WEBKIT_PATH : undefined;
  if (!env) return depSourceDir(cfg, "WebKit");
  // Shells don't expand ~ inside quotes; handle it here so a quoted export works.
  if (env === "~" || env.startsWith("~/") || env.startsWith("~\\")) return join(homedir(), env.slice(1));
  // Anchor relative paths to the repo root so ninja's regen rule (which runs
  // from buildDir) resolves the same path as the initial configure.
  return resolve(cfg.cwd, env);
}

// ───────────────────────────────────────────────────────────────────────────
// Source mode: cmakeconfig.h
//
// `cmakeconfig.h` for the direct WebKit build — the ENABLE_/USE_/HAVE_ matrix
// WebKit's cmake (WebKitFeatures.cmake + Options{Common,JSCOnly}.cmake + the
// header/function probes) writes for the JSCOnly port with bun's options.
// Platform.h reads it first thing, so every WebKit TU and every bun TU that
// includes JSC headers sees the same values.
//
// The table is the output of WebKit's cmake configure, checked against the
// cmakeconfig.h in the prebuilt tarballs for linux x64/arm64 (gnu), musl,
// android and freebsd; entries whose value depends on the target are
// functions. macOS and Windows differ in more rows and are not encoded yet
// (the direct build only targets ELF so far). When adding a platform, diff
// its prebuilt's cmakeconfig.h against this and make the differing rows
// conditional — do not fork the table.
// ───────────────────────────────────────────────────────────────────────────

const on = (b: boolean): number => (b ? 1 : 0);
const mimalloc = (c: Config): number => on(!c.asan);

type Row = [name: string, value: number | ((c: Config) => number)];

const rows: Row[] = [
  ["ALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS", 1],
  ["BUN_SKIP_FAILING_ASSERTIONS", 1],
  ["BUSE_TZONE", 0],
  ["ENABLE_ACCESSIBILITY_ISOLATED_TREE", 0],
  ["ENABLE_API_TESTS", 1],
  ["ENABLE_APPLE_PAY", 0],
  ["ENABLE_APPLE_PAY_AUTOMATIC_RELOAD_LINE_ITEM", 0],
  ["ENABLE_APPLE_PAY_AUTOMATIC_RELOAD_PAYMENTS", 0],
  ["ENABLE_APPLE_PAY_COUPON_CODE", 0],
  ["ENABLE_APPLE_PAY_DEFERRED_LINE_ITEM", 0],
  ["ENABLE_APPLE_PAY_DEFERRED_PAYMENTS", 0],
  ["ENABLE_APPLE_PAY_DELEGATED_REQUEST", 0],
  ["ENABLE_APPLE_PAY_DISBURSEMENTS", 0],
  ["ENABLE_APPLE_PAY_INSTALLMENTS", 0],
  ["ENABLE_APPLE_PAY_LATER", 0],
  ["ENABLE_APPLE_PAY_LATER_AVAILABILITY", 0],
  ["ENABLE_APPLE_PAY_MERCHANT_CATEGORY_CODE", 0],
  ["ENABLE_APPLE_PAY_MULTI_MERCHANT_PAYMENTS", 0],
  ["ENABLE_APPLE_PAY_PAYMENT_ORDER_DETAILS", 0],
  ["ENABLE_APPLE_PAY_RECURRING_LINE_ITEM", 0],
  ["ENABLE_APPLE_PAY_RECURRING_PAYMENTS", 0],
  ["ENABLE_APPLE_PAY_SELECTED_SHIPPING_METHOD", 0],
  ["ENABLE_APPLE_PAY_SHIPPING_CONTACT_EDITING_MODE", 0],
  ["ENABLE_APPLE_PAY_SHIPPING_METHOD_DATE_COMPONENTS_RANGE", 0],
  ["ENABLE_APPLICATION_MANIFEST", 0],
  ["ENABLE_ASYNC_SCROLLING", 0],
  ["ENABLE_ATTACHMENT_ELEMENT", 0],
  ["ENABLE_AUTOCAPITALIZE", 0],
  ["ENABLE_AV1", 0],
  ["ENABLE_AVF_CAPTIONS", 0],
  ["ENABLE_BACK_FORWARD_LIST_SWIFT", 0],
  ["ENABLE_BREAKPAD", 0],
  ["ENABLE_BUBBLEWRAP_SANDBOX", 0],
  ["ENABLE_BUN_SKIP_FAILING_ASSERTIONS", 1],
  ["ENABLE_CACHE_PARTITIONING", 0],
  ["ENABLE_CONTENT_EXTENSIONS", 0],
  ["ENABLE_CONTENT_FILTERING", 0],
  ["ENABLE_CONTEXT_MENUS", 1],
  ["ENABLE_CSS_TAP_HIGHLIGHT_COLOR", 0],
  ["ENABLE_CURSOR_VISIBILITY", 0],
  ["ENABLE_C_LOOP", 0],
  ["ENABLE_DARK_MODE_CSS", 0],
  ["ENABLE_DATACUE_VALUE", 0],
  ["ENABLE_DEVICE_ORIENTATION", 0],
  ["ENABLE_DFG_JIT", 1],
  ["ENABLE_DRAG_SUPPORT", 0],
  ["ENABLE_ENCRYPTED_MEDIA", 0],
  ["ENABLE_EXPERIMENTAL_FEATURES", 0],
  ["ENABLE_FTL_JIT", 1],
  ["ENABLE_FULLSCREEN_API", 1],
  ["ENABLE_FUZZILLI", 0],
  ["ENABLE_GAMEPAD", 0],
  ["ENABLE_GEOLOCATION", 1],
  ["ENABLE_GPU_PROCESS", 0],
  ["ENABLE_IMAGE_DIFF", 1],
  ["ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS", 1],
  ["ENABLE_INSPECTOR_EXTENSIONS", 0],
  ["ENABLE_INSPECTOR_TELEMETRY", 0],
  ["ENABLE_IOS_GESTURE_EVENTS", 0],
  ["ENABLE_IOS_TOUCH_EVENTS", 0],
  ["ENABLE_IPC_TESTING_SWIFT", 0],
  ["ENABLE_JAVASCRIPT_SHELL", 1],
  ["ENABLE_JIT", 1],
  ["ENABLE_JSC_GLIB_API", 0],
  ["ENABLE_LAYOUT_TESTS", 0],
  ["ENABLE_LEGACY_CUSTOM_PROTOCOL_MANAGER", 0],
  ["ENABLE_LEGACY_ENCRYPTED_MEDIA", 0],
  ["ENABLE_LLVM_PROFILE_GENERATION", 0],
  ["ENABLE_MALLOC_HEAP_BREAKDOWN", 0],
  ["ENABLE_MATHML", 1],
  ["ENABLE_MEDIA_CAPTURE", 0],
  ["ENABLE_MEDIA_CONTROLS_CONTEXT_MENUS", 0],
  ["ENABLE_MEDIA_RECORDER", 0],
  ["ENABLE_MEDIA_SESSION", 0],
  ["ENABLE_MEDIA_SESSION_COORDINATOR", 0],
  ["ENABLE_MEDIA_SESSION_PLAYLIST", 0],
  ["ENABLE_MEDIA_SOURCE", 0],
  ["ENABLE_MEDIA_SOURCE_IN_WORKERS", 0],
  ["ENABLE_MEDIA_STATISTICS", 0],
  ["ENABLE_MEDIA_STREAM", 0],
  ["ENABLE_MEMORY_SAMPLER", 0],
  ["ENABLE_MHTML", 0],
  ["ENABLE_MINIBROWSER", 0],
  ["ENABLE_MODEL_ELEMENT", 0],
  ["ENABLE_MOUSE_CURSOR_SCALE", 0],
  ["ENABLE_NAVIGATOR_STANDALONE", 0],
  ["ENABLE_NOTIFICATIONS", 1],
  ["ENABLE_OFFSCREEN_CANVAS", 0],
  ["ENABLE_OFFSCREEN_CANVAS_IN_WORKERS", 0],
  ["ENABLE_ORIENTATION_EVENTS", 0],
  ["ENABLE_PAYMENT_REQUEST", 0],
  ["ENABLE_PDFJS", 0],
  ["ENABLE_PDFKIT_PLUGIN", 0],
  ["ENABLE_PDF_HUD", 0],
  ["ENABLE_PDF_PLUGIN", 0],
  ["ENABLE_PERIODIC_MEMORY_MONITOR", 0],
  ["ENABLE_PICTURE_IN_PICTURE_API", 0],
  ["ENABLE_POINTER_LOCK", 0],
  ["ENABLE_PREDEFINED_COLOR_SPACE_DISPLAY_P3", 0],
  ["ENABLE_REFTRACKER", 0],
  ["ENABLE_RELEASE_LOG", 0],
  ["ENABLE_REMOTE_INSPECTOR", 1],
  ["ENABLE_RESOURCE_USAGE", 1],
  ["ENABLE_SAMPLING_PROFILER", 1],
  ["ENABLE_SANDBOX_EXTENSIONS", 0],
  ["ENABLE_SERVICE_CONTROLS", 0],
  ["ENABLE_SHAREABLE_RESOURCE", 0],
  ["ENABLE_SMOOTH_SCROLLING", 1],
  ["ENABLE_SPATIAL_PORTAL", 0],
  ["ENABLE_SPEECH_SYNTHESIS", 0],
  ["ENABLE_SPELLCHECK", 0],
  ["ENABLE_STATIC_JSC", 1],
  ["ENABLE_STREAMING_IPC_IN_LOG_FORWARDING", 0],
  ["ENABLE_SWIFT_DEMO_URI_SCHEME", 0],
  ["ENABLE_TELEPHONE_NUMBER_DETECTION", 0],
  ["ENABLE_TEXT_AUTOSIZING", 0],
  ["ENABLE_THUNDER", 0],
  ["ENABLE_TOUCH_EVENTS", 0],
  ["ENABLE_UNIFIED_BUILDS", 1],
  ["ENABLE_UNIFIED_PDF", 0],
  ["ENABLE_USER_MESSAGE_HANDLERS", 1],
  ["ENABLE_VARIATION_FONTS", 0],
  ["ENABLE_VIDEO", 1],
  ["ENABLE_VIDEO_PRESENTATION_MODE", 0],
  ["ENABLE_VIDEO_USES_ELEMENT_FULLSCREEN", 1],
  ["ENABLE_WEBASSEMBLY", 1],
  ["ENABLE_WEBASSEMBLY_BBQJIT", 1],
  ["ENABLE_WEBASSEMBLY_OMGJIT", 1],
  ["ENABLE_WEBDRIVER", 0],
  ["ENABLE_WEBDRIVER_BIDI", 0],
  ["ENABLE_WEBDRIVER_KEYBOARD_GRAPHEME_CLUSTERS", 0],
  ["ENABLE_WEBDRIVER_KEYBOARD_INTERACTIONS", 0],
  ["ENABLE_WEBDRIVER_MOUSE_INTERACTIONS", 0],
  ["ENABLE_WEBDRIVER_TOUCH_INTERACTIONS", 0],
  ["ENABLE_WEBDRIVER_WHEEL_INTERACTIONS", 0],
  ["ENABLE_WEBGL", 0],
  ["ENABLE_WEBGPU", 0],
  ["ENABLE_WEBKIT_OVERFLOW_SCROLLING_CSS_PROPERTY", 0],
  ["ENABLE_WEBKIT_TOUCH_CALLOUT_CSS_PROPERTY", 0],
  ["ENABLE_WEBXR", 0],
  ["ENABLE_WEBXR_HIT_TEST", 0],
  ["ENABLE_WEBXR_LAYERS", 0],
  ["ENABLE_WEB_API_STATISTICS", 0],
  ["ENABLE_WEB_AUDIO", 1],
  ["ENABLE_WEB_AUTHN", 0],
  ["ENABLE_WEB_CODECS", 0],
  ["ENABLE_WEB_RTC", 0],
  ["ENABLE_WIRELESS_PLAYBACK_TARGET", 0],
  ["ENABLE_WK_WEB_EXTENSIONS", 0],
  ["ENABLE_WRITING_TOOLS", 0],
  ["ENABLE_XSLT", 1],
  ["HAVE_ALIGNED_MALLOC", 0],
  ["HAVE_ERRNO_H", 1],
  ["HAVE_FEATURES_H", c => on(c.linux)],
  ["HAVE_INT128_T", 1],
  ["HAVE_LANGINFO_H", 1],
  ["HAVE_LINUX_MEMFD_H", c => on(c.linux)],
  ["HAVE_LOCALTIME_R", 1],
  ["HAVE_MALLOC_TRIM", c => on(c.linux && c.abi === "gnu")],
  ["HAVE_MAP_ALIGNED", c => on(c.freebsd)],
  ["HAVE_MMAP", 1],
  ["HAVE_PTHREAD_MAIN_NP", c => on(c.freebsd)],
  ["HAVE_PTHREAD_NP_H", c => on(c.freebsd)],
  ["HAVE_REGEX_H", 1],
  ["HAVE_SHM_ANON", c => on(c.freebsd)],
  ["HAVE_SIGNAL_H", 1],
  ["HAVE_STATX", c => on(c.linux && c.abi !== "android")],
  ["HAVE_STAT_BIRTHTIME", c => on(c.freebsd)],
  ["HAVE_STD_FILESYSTEM", 1],
  ["HAVE_SYS_PARAM_H", 1],
  ["HAVE_SYS_TIMEB_H", c => on(c.abi !== "android")],
  ["HAVE_SYS_TIME_H", 1],
  ["HAVE_TIMEGM", 1],
  ["HAVE_TIMERFD", 1],
  ["HAVE_TIMINGSAFE_BCMP", c => on(c.freebsd)],
  ["HAVE_TM_GMTOFF", 1],
  ["HAVE_TM_ZONE", 1],
  ["HAVE_VASPRINTF", 1],
  ["USE_64KB_PAGE_BLOCK", 0],
  ["USE_ALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS", 1],
  ["USE_AVIF", 1],
  ["USE_BUN_EVENT_LOOP", 1],
  ["USE_BUN_JSC_ADDITIONS", 1],
  ["USE_EXTERNAL_MIMALLOC", c => mimalloc(c)],
  ["USE_INSPECTOR_SOCKET_SERVER", 1],
  ["USE_ISO_MALLOC", 1],
  ["USE_JPEGXL", 1],
  ["USE_LCMS", 1],
  ["USE_LIBBACKTRACE", 0],
  ["USE_MIMALLOC", c => mimalloc(c)],
  ["USE_PGO_PROFILE", 0],
  ["USE_SKIA", 0],
  ["USE_SKIA_ENCODERS", 0],
  ["USE_SYSTEM_MALLOC", 0],
  ["USE_SYSTEM_UNIFDEF", 0],
  ["USE_TZONE_MALLOC", 0],
  ["USE_UNIX_DOMAIN_SOCKETS", 1],
  ["USE_WOFF2", 1],
  ["WTF_DEFAULT_EVENT_LOOP", 0],
];

function cmakeConfigHeader(cfg: Config): string {
  let out = "#ifndef CMAKECONFIG_H\n#define CMAKECONFIG_H\n\n";
  for (const [name, value] of rows) {
    out += `#define ${name} ${typeof value === "function" ? value(cfg) : value}\n`;
  }
  // The prebuilt release workflow appends this; bun keys the bytecode cache
  // on it (ZigGlobalObject.cpp) and reports it in process.versions.
  out += `#define BUN_WEBKIT_VERSION "${cfg.webkitVersion}"\n`;
  out += "\n#endif /* CMAKECONFIG_H */\n";
  return out;
}

/**
 * cmake's FEATURE_DEFINES_WITH_SPACE_SEPARATOR: the WEBKIT_OPTION names that
 * are ON, which the inspector generator uses to drop protocol domains/commands
 * whose `condition` is off. Derived from the table so the two never disagree
 * (HAVE_* probes and non-option SET_AND_EXPOSE_TO_BUILD values are not options).
 */
function inspectorFeatureDefines(cfg: Config): string {
  const notOptions = new Set([
    "BUN_SKIP_FAILING_ASSERTIONS",
    "ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS",
    "USE_BUN_EVENT_LOOP",
    "USE_INSPECTOR_SOCKET_SERVER",
    "USE_UNIX_DOMAIN_SOCKETS",
    "USE_ALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS",
    "ENABLE_API_TESTS",
    "ENABLE_RESOURCE_USAGE",
  ]);
  // cmake snapshots this list before OptionsJSCOnly.cmake turns ENABLE_WEBGL
  // off, so the JSCOnly protocol has always carried the WebGL-conditioned
  // Canvas commands; keep it that way.
  const names: string[] = ["ENABLE_WEBGL"];
  for (const [name, value] of rows) {
    if (name.startsWith("HAVE_") || notOptions.has(name)) continue;
    if ((typeof value === "function" ? value(cfg) : value) !== 0) names.push(name);
  }
  return names.sort().join(" ");
}

// ───────────────────────────────────────────────────────────────────────────
// Source mode: direct build
//
// WebKit (bmalloc + WTF + JavaScriptCore, JSCOnly port) built directly in our
// ninja graph — no cmake. This is what `--webkit=source` uses.
//
// What WebKit's cmake does, and where it lives here:
//
//   source lists            read from WebKit's own CMakeLists.txt / Sources.txt
//                           at configure time (cmake-lists.ts), so a WebKit bump
//                           never needs a list edited here
//   cmakeconfig.h           cmakeConfigHeader table (writeIfChanged)
//   framework headers       forwarding stubs written at configure time:
//                           <bmalloc/X.h>, <JavaScriptCore/X.h> flattened dirs
//   DerivedSources codegen  ~17 ruby/python/perl edges + one per .lut.h
//   unified bundles         WebKit's generate-unified-source-bundles.py, run at
//                           configure time (it only writes #include lists)
//   LLInt                   settings extractor exe → offsets extractor exe →
//                           LLIntAssembly.h, each parsed by offlineasm (ruby)
//   compile/archive         cc/cxx/pch/ar from compile.ts with dep flags, so
//                           target/cpu/lto/asan come from flags.ts like every dep
//
// Configure needs the WebKit tree on disk (it reads Sources.txt etc.), so the
// fetch for this dep runs at configure time when the tree is missing or stale
// (source.ts prefetchConfigureSources) instead of as the first ninja edge.
// ───────────────────────────────────────────────────────────────────────────

interface WebKitDirectResult {
  libs: string[];
  includes: string[];
  /** testFFI — shipped in the CI artifact for jsc-stress/testFFI.test.ts. */
  extras: string[];
  /**
   * What a bun TU that includes JSC headers must wait for: the source tree
   * and every generated header — all declared outputs with restat, so this
   * is exact and bun's C++ compiles alongside JSC's instead of after the
   * archives (nested-cmake mode has to hand over the libs here, because its
   * headers are undeclared side effects of the lib edge).
   */
  outputs: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// Platform description → the variables WebKit's CMakeLists branch on
// ───────────────────────────────────────────────────────────────────────────

function offlineAsmBackend(cfg: Config): string {
  return cfg.x64 ? "X86_64" : "ARM64";
}

function platformVars(cfg: Config, W: string, B: string): CMakeVars {
  const systemName = cfg.darwin ? "Darwin" : cfg.windows ? "Windows" : cfg.freebsd ? "FreeBSD" : "Linux";
  const JSC = join(W, "Source", "JavaScriptCore");
  return cmakeVars({
    PORT: "JSCOnly",
    WIN32: cfg.windows,
    MSVC: cfg.windows,
    APPLE: cfg.darwin,
    UNIX: !cfg.windows,
    ANDROID: cfg.abi === "android",
    CMAKE_SYSTEM_NAME: systemName,
    CMAKE_SYSTEM_PROCESSOR: cfg.x64 ? "x86_64" : "aarch64",
    CMAKE_BUILD_TYPE: cfg.buildType,
    CMAKE_C_COMPILER_ID: "Clang",
    CMAKE_CXX_COMPILER_ID: "Clang",
    COMPILER_IS_GCC_OR_CLANG: true,
    COMPILER_IS_CLANG: true,
    WTF_CPU_X86_64: cfg.x64,
    WTF_CPU_ARM64: cfg.arm64,
    WTF_CPU_ARM: false,
    WTF_CPU_MIPS: false,
    WTF_CPU_RISCV64: false,
    WTF_CPU_LOONGARCH64: false,
    WTF_OS_LINUX: cfg.linux,
    WTF_OS_UNIX: !cfg.windows,
    WTF_OS_WINDOWS: cfg.windows,
    WTF_OS_MAC_OS_X: cfg.darwin,
    WTF_OS_DARWIN: cfg.darwin,
    WTF_OS_FUCHSIA: false,
    EVENT_LOOP_TYPE: "Bun",
    LOWERCASE_EVENT_LOOP_TYPE: "bun",
    ENABLE_REMOTE_INSPECTOR: true,
    USE_INSPECTOR_SOCKET_SERVER: true,
    USE_BUN_JSC_ADDITIONS: true,
    USE_BUN_EVENT_LOOP: true,
    USE_MIMALLOC: !cfg.asan,
    USE_EXTERNAL_MIMALLOC: !cfg.asan,
    USE_SYSTEM_MALLOC: false,
    USE_LIBPAS: true,
    USE_CAPSTONE: false,
    USE_GLIB: false,
    USE_LIBBACKTRACE: false,
    USE_APPLE_INTERNAL_SDK: false,
    ENABLE_STATIC_JSC: true,
    ENABLE_JIT: true,
    ENABLE_DFG_JIT: true,
    ENABLE_FTL_JIT: true,
    ENABLE_C_LOOP: false,
    ENABLE_WEBASSEMBLY: true,
    ENABLE_SAMPLING_PROFILER: true,
    ENABLE_JSC_GLIB_API: false,
    ENABLE_MALLOC_HEAP_BREAKDOWN: false,
    ENABLE_JAVASCRIPT_SHELL: true,
    ATOMICS_REQUIRE_LIBATOMIC: false,
    DEVELOPER_MODE: false,
    CMAKE_SOURCE_DIR: W,
    CMAKE_BINARY_DIR: B,
    WTF_DIR: join(W, "Source", "WTF"),
    JAVASCRIPTCORE_DIR: JSC,
    BMALLOC_DIR: join(W, "Source", "bmalloc"),
    THIRDPARTY_DIR: join(W, "Source", "ThirdParty"),
    JavaScriptCore_DERIVED_SOURCES_DIR: join(B, "JavaScriptCore", "DerivedSources"),
    WTF_DERIVED_SOURCES_DIR: join(B, "WTF", "DerivedSources"),
    JavaScriptCore_FRAMEWORK_HEADERS_DIR: join(B, "JavaScriptCore", "Headers"),
    JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS_DIR: join(B, "JavaScriptCore", "PrivateHeaders"),
    WTF_FRAMEWORK_HEADERS_DIR: join(B, "WTF", "Headers"),
    bmalloc_FRAMEWORK_HEADERS_DIR: join(B, "bmalloc", "Headers"),
    // Scripts run from the source tree here; cmake copies them first.
    JavaScriptCore_SCRIPTS_DIR: join(JSC, "Scripts"),
    WTF_SCRIPTS_DIR: join(W, "Source", "WTF", "Scripts"),
  });
}

/** Evaluate one component's CMakeLists.txt (+ PlatformJSCOnly.cmake, + include()d .cmake files). */
function readLists(cfg: Config, W: string, B: string, cmakeLists: string): CMakeVars {
  const vars = platformVars(cfg, W, B);
  const dir = dirname(cmakeLists);
  vars.set("CMAKE_CURRENT_SOURCE_DIR", [dir]);
  vars.set("CMAKE_CURRENT_LIST_DIR", [dir]);
  vars.set("CMAKE_CURRENT_BINARY_DIR", [join(B, relative(join(W), dir))]);
  const opts = {
    resolveInclude: (arg: string, from: string) => (arg.endsWith(".cmake") ? resolve(dirname(from), arg) : undefined),
    onCommand: (name: string, _args: string[], file: string) => {
      if (name === "webkit_include_config_files_if_exists") {
        const platform = resolve(dirname(file), "PlatformJSCOnly.cmake");
        if (existsSync(platform)) evaluateCMake(platform, vars, opts);
      }
    },
  };
  evaluateCMake(cmakeLists, vars, opts);
  return vars;
}

function list(vars: CMakeVars, name: string, base: string): string[] {
  const v = vars.get(name);
  assert(v !== undefined, `WebKit CMakeLists no longer sets ${name} — update deps/webkit.ts`);
  return v.map(p => resolve(base, p));
}

// ───────────────────────────────────────────────────────────────────────────
// Forwarding headers
// ───────────────────────────────────────────────────────────────────────────

/**
 * cmake copies (bmalloc, WTF) or symlinks (JSC) each framework header into a
 * flat `<Framework>/Headers/<framework>/` dir so `<JavaScriptCore/X.h>` works
 * from any subdirectory. A one-line `#include` stub does the same job on every
 * host OS, and the compiler's depfile then names the real header too.
 */
function writeForwardingHeaders(dir: string, headers: string[]): void {
  mkdirSync(dir, { recursive: true });
  const wanted = new Set<string>();
  for (const h of headers) {
    wanted.add(basename(h));
    writeStub(join(dir, basename(h)), h);
  }
  // Drop stubs for headers WebKit deleted, or a stale include would still
  // resolve. Only one-line stubs are ours to remove.
  for (const entry of readdirSync(dir)) {
    if (wanted.has(entry) || !lstatSync(join(dir, entry)).isFile()) continue;
    const text = readFileSync(join(dir, entry), "utf8");
    if (text.startsWith('#include "') && text.split("\n").length <= 2) rmSync(join(dir, entry));
  }
}

/**
 * One stub. If something other than a regular file sits at `path` (a symlink
 * left by a `--webkit=local` cmake build in the same build dir points INTO the
 * source tree), remove it first — writing through it would overwrite the real
 * header with a stub that includes itself.
 */
function writeStub(path: string, target: string): void {
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (st !== undefined && !st.isFile()) rmSync(path, { recursive: true, force: true });
  writeIfChanged(path, `#include "${target.replaceAll("\\", "/")}"\n`);
}

// ───────────────────────────────────────────────────────────────────────────
// The emitter
// ───────────────────────────────────────────────────────────────────────────

/** The three archives, in link order (users before providers). */
function webKitDirectLibs(cfg: Config): string[] {
  const libDir = join(depBuildDir(cfg, "WebKit"), "lib");
  return ["JavaScriptCore", "WTF", "bmalloc"].map(name => join(libDir, `${cfg.libPrefix}${name}${cfg.libSuffix}`));
}

function emitWebKitDirect(n: Ninja, cfg: Config, ctx: CustomBuildContext): WebKitDirectResult {
  const { srcDir: W, ready, resolved } = ctx;
  assert(!cfg.windows && !cfg.darwin, "webkit=source direct build: only ELF targets are wired up so far", {
    hint: "Use --webkit=prebuilt (default) or --webkit=local on this platform for now.",
  });

  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  const B = depBuildDir(cfg, "WebKit");
  const SRC = join(W, "Source");
  const JSC = join(SRC, "JavaScriptCore");
  const WTF = join(SRC, "WTF");
  const BM = join(SRC, "bmalloc");
  const DS = join(B, "JavaScriptCore", "DerivedSources");
  const jscHeaders = join(B, "JavaScriptCore", "Headers");
  const jscPrivateHeaders = join(B, "JavaScriptCore", "PrivateHeaders");
  const bmallocHeaders = join(B, "bmalloc", "Headers");
  const binDir = join(B, "bin");
  const libDir = join(B, "lib");

  assert(existsSync(join(JSC, "Sources.txt")), `WebKit source tree not present at ${W}`, {
    hint: "configure fetches it before emitting the graph — this is a bug in prefetchConfigureSources",
  });

  for (const d of [DS, join(DS, "yarr"), join(DS, "inspector"), join(DS, "runtime"), binDir, libDir]) {
    mkdirSync(d, { recursive: true });
  }

  n.comment("─── WebKit (direct: bmalloc + WTF + JavaScriptCore) ───");

  // ─── Source lists from WebKit's cmake ───
  const bmVars = readLists(cfg, W, B, join(BM, "CMakeLists.txt"));
  const wtfVars = readLists(cfg, W, B, join(WTF, "wtf", "CMakeLists.txt"));
  const jscVars = readLists(cfg, W, B, join(JSC, "CMakeLists.txt"));

  // ─── cmakeconfig.h ───
  writeIfChanged(join(B, "cmakeconfig.h"), cmakeConfigHeader(cfg));

  // ─── Forwarding headers ───
  // bmalloc.h includes "mimalloc.h" as a flattened sibling; cmake copies it in
  // from WebKit's vendored mimalloc, here it is the mimalloc bun links.
  const useMimalloc = !cfg.asan;
  const mimallocInclude = join(depSourceDir(cfg, "mimalloc"), "include");
  writeForwardingHeaders(join(bmallocHeaders, "bmalloc"), [
    ...list(bmVars, "bmalloc_PUBLIC_HEADERS", BM).filter(h => basename(h) !== "mimalloc.h"),
    ...(bmVars.get("bmalloc_PRIVATE_HEADERS") ?? []).map(p => resolve(BM, p)),
    ...(useMimalloc ? [join(mimallocInclude, "mimalloc.h")] : []),
  ]);
  // Consumers see both <bmalloc/X.h> and the bare "X.h" siblings bmalloc's
  // own headers include (libpas headers, mimalloc.h) — cmake gets the latter
  // from physically flattening copies into one dir.
  const bmallocConsumerIncludes = [bmallocHeaders, join(bmallocHeaders, "bmalloc")];
  writeForwardingHeaders(
    join(jscHeaders, "JavaScriptCore"),
    list(jscVars, "JavaScriptCore_PUBLIC_FRAMEWORK_HEADERS", JSC),
  );
  writeForwardingHeaders(
    join(jscPrivateHeaders, "JavaScriptCore"),
    list(jscVars, "JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS", JSC),
  );

  // ─── Flags ───
  const depFlags = computeDepFlags(cfg);
  // WebKit's own additions on top of the dep-global flags
  // (WebKitCompilerFlags.cmake). The global -fno-[asynchronous-]unwind-tables
  // stand: the prebuilt is compiled that way too (its CMAKE_CXX_FLAGS come
  // last and carry them). The DWARF flags are WebKit's debug-info size
  // reductions; JSC's templates make them matter.
  const webkitCommon = [
    "-fno-strict-aliasing",
    ...(cfg.windows ? [] : ["-gsimple-template-names", "-mllvm", "-dwarf-linkage-names=Abstract"]),
    ...(cfg.windows || cfg.darwin ? [] : ["-fdebug-types-section"]),
  ];
  const webkitCxx = [...depFlags.cxxflags, ...webkitCommon, "-std=c++23"];
  const webkitC = [...depFlags.cflags, ...webkitCommon];
  // Same PIC policy as bun's own objects (bunOnlyFlags): non-PIE executable
  // everywhere but Android, whose loader requires PIE.
  const pic = cfg.abi === "android" ? ["-fPIC"] : cfg.unix ? ["-fno-pic", "-fno-pie"] : [];
  webkitCxx.push(...pic);
  webkitC.push(...pic);
  // ICU: ours (deps/icu.ts) everywhere but macOS; static, so consumers
  // define U_STATIC_IMPLEMENTATION like the prebuilt build does.
  const icuFlags = buildsIcu(cfg)
    ? ["-DU_STATIC_IMPLEMENTATION=1", ...icuIncludes(cfg, depSourceDir(cfg, "icu")).map(i => `-I${q(i)}`)]
    : [];
  const commonDefines = [
    "-DBUILDING_JSCONLY__",
    "-DBUILDING_WEBKIT",
    "-DBUILDING_WITH_CMAKE",
    "-DHAVE_CONFIG_H",
    "-DPAS_BMALLOC=1",
    // WebKit's USE_CXX_STDLIB_ASSERTIONS default: the standard library's own
    // hardening (libstdc++ on gnu/musl, libc++ elsewhere).
    ...(cfg.linux && cfg.abi !== "android"
      ? ["-D_GLIBCXX_ASSERTIONS=1"]
      : ["-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE"]),
    ...(cfg.assertions ? ["-DASSERT_ENABLED=1"] : []),
  ];
  // Everything below waits for the tree and for mimalloc's headers
  // (order-only: depfiles track real header edits; stamps only say "fetched").
  const treeReady = ready;

  // ─── bmalloc ───
  const bmIncludes = [
    B,
    BM,
    join(BM, "bmalloc"),
    join(BM, "libpas", "src", "libpas"),
    ...(useMimalloc ? [mimallocInclude] : []),
  ];
  const bmFlagsCommon = [
    ...commonDefines,
    "-DBUILDING_bmalloc",
    "-D_GNU_SOURCE",
    ...(useMimalloc ? ["-DUSE_MIMALLOC=1"] : []),
    ...bmIncludes.map(i => `-I${q(i)}`),
    "-Wno-cast-align",
    "-Wno-missing-field-initializers",
  ];
  const bmObjects: string[] = [];
  for (const src of list(bmVars, "bmalloc_SOURCES", BM)) {
    // bmalloc_SOURCES' .c members are set LANGUAGE CXX in cmake.
    const flags = src.endsWith(".c") ? ["-x", "c++", ...webkitCxx, ...bmFlagsCommon] : [...webkitCxx, ...bmFlagsCommon];
    bmObjects.push(
      src.endsWith(".c")
        ? cc(n, cfg, src, { flags, orderOnlyInputs: treeReady })
        : cxx(n, cfg, src, { flags, orderOnlyInputs: treeReady }),
    );
  }
  for (const src of list(bmVars, "bmalloc_C_SOURCES", BM)) {
    bmObjects.push(cc(n, cfg, src, { flags: [...webkitC, ...bmFlagsCommon], orderOnlyInputs: treeReady }));
  }
  const [libJSCPath, libWTFPath, libbmallocPath] = webKitDirectLibs(cfg) as [string, string, string];
  const libbmalloc = ar(n, cfg, libbmallocPath, bmObjects);
  n.phony("bmalloc", [libbmalloc]);

  // ─── WTF ───
  const wtfIncludes = [
    B,
    ...list(wtfVars, "WTF_PRIVATE_INCLUDE_DIRECTORIES", join(WTF, "wtf")),
    ...bmallocConsumerIncludes,
  ];
  const wtfFlags = [
    ...webkitCxx,
    ...commonDefines,
    "-DBUILDING_WTF",
    "-DSTATICALLY_LINKED_WITH_bmalloc",
    ...wtfIncludes.map(i => `-I${q(i)}`),
    ...icuFlags,
  ];
  const wtfObjects = list(wtfVars, "WTF_SOURCES", join(WTF, "wtf")).map(src =>
    cxx(n, cfg, src, { flags: wtfFlags, orderOnlyInputs: treeReady }),
  );
  const libWTF = ar(n, cfg, libWTFPath, wtfObjects);
  n.phony("WTF", [libWTF]);

  // ─── JavaScriptCore: codegen ───
  const ruby = "ruby";
  const python = hostWin ? "python" : "python3";
  const perl = "perl";
  const gen = (opts: {
    outputs: string[];
    cmd: string[];
    inputs: string[];
    desc: string;
    cwd?: string;
    env?: Record<string, string>;
    implicitOutputs?: string[];
  }): void => {
    const envPrefix = Object.entries(opts.env ?? {})
      .map(([k, v]) => `${k}=${q(v)}`)
      .join(" ");
    n.build({
      outputs: opts.outputs,
      ...(opts.implicitOutputs !== undefined && { implicitOutputs: opts.implicitOutputs }),
      rule: "webkit_gen",
      inputs: opts.inputs,
      orderOnlyInputs: treeReady,
      vars: {
        desc: opts.desc,
        cwd: q(opts.cwd ?? DS),
        cmd: (envPrefix ? `env ${envPrefix} ` : "") + quoteArgs(opts.cmd, hostWin),
      },
    });
  };
  /** `cmd > out` — for generators that print to stdout. */
  const genStdout = (out: string, cmd: string[], inputs: string[], desc: string): void => {
    n.build({
      outputs: [out],
      rule: "webkit_gen_stdout",
      inputs,
      orderOnlyInputs: treeReady,
      vars: { desc, cmd: quoteArgs(cmd, hostWin) },
    });
  };

  const generatedHeaders: string[] = [];
  /**
   * Generated .cpp files. They are compiled by being #included from unified
   * bundles (or listed in JavaScriptCore_SOURCES), so like the headers they
   * must exist before any JSC TU compiles.
   */
  const generatedSources: string[] = [];

  // LUT tables (create_hash_table, perl).
  const hashLut = join(JSC, "create_hash_table");
  for (const src of list(jscVars, "JavaScriptCore_OBJECT_LUT_SOURCES", JSC)) {
    const out = join(DS, `${basename(src).replace(/\.[^.]+$/, "")}.lut.h`);
    genStdout(out, [perl, hashLut, src], [hashLut, src], `lut ${basename(out)}`);
    generatedHeaders.push(out);
  }
  {
    const out = join(DS, "Lexer.lut.h");
    const table = join(JSC, "parser", "Keywords.table");
    genStdout(out, [perl, hashLut, table], [hashLut, table], "lut Lexer.lut.h");
    generatedHeaders.push(out);
  }

  // Bytecodes.
  const bytecodeOutputs = [
    "Bytecodes.h",
    "InitBytecodes.asm",
    "BytecodeStructs.h",
    "BytecodeIndices.h",
    "BytecodeDumperGenerated.cpp",
  ].map(f => join(DS, f));
  gen({
    outputs: bytecodeOutputs,
    cmd: [
      ruby,
      join(JSC, "generator", "main.rb"),
      "--bytecodes_h",
      join(DS, "Bytecodes.h"),
      "--init_bytecodes_asm",
      join(DS, "InitBytecodes.asm"),
      "--bytecode_structs_h",
      join(DS, "BytecodeStructs.h"),
      "--bytecode_indices_h",
      join(DS, "BytecodeIndices.h"),
      join(JSC, "bytecode", "BytecodeList.rb"),
      "--wasm_json",
      join(JSC, "wasm", "wasm.json"),
      "--bytecode_dumper",
      join(DS, "BytecodeDumperGenerated.cpp"),
    ],
    inputs: [
      join(JSC, "bytecode", "BytecodeList.rb"),
      join(JSC, "wasm", "wasm.json"),
      ...readdirSync(join(JSC, "generator"))
        .filter(f => f.endsWith(".rb"))
        .map(f => join(JSC, "generator", f)),
    ],
    desc: "Bytecodes",
  });
  generatedHeaders.push(join(DS, "Bytecodes.h"), join(DS, "BytecodeStructs.h"), join(DS, "BytecodeIndices.h"));
  generatedSources.push(join(DS, "BytecodeDumperGenerated.cpp"));

  // Air opcodes (writes into cwd).
  gen({
    outputs: [join(DS, "AirOpcode.h"), join(DS, "AirOpcodeGenerated.h")],
    implicitOutputs: [join(DS, "AirOpcodeUtils.h")],
    cmd: [ruby, join(JSC, "b3", "air", "opcode_generator.rb"), join(JSC, "b3", "air", "AirOpcode.opcodes")],
    inputs: [join(JSC, "b3", "air", "opcode_generator.rb"), join(JSC, "b3", "air", "AirOpcode.opcodes")],
    desc: "AirOpcode",
  });
  generatedHeaders.push(join(DS, "AirOpcode.h"), join(DS, "AirOpcodeGenerated.h"), join(DS, "AirOpcodeUtils.h"));

  // Keyword lookup, lexer/yarr unicode tables, regex tables.
  genStdout(
    join(DS, "KeywordLookup.h"),
    [python, join(JSC, "KeywordLookupGenerator.py"), join(JSC, "parser", "Keywords.table")],
    [join(JSC, "KeywordLookupGenerator.py"), join(JSC, "parser", "Keywords.table")],
    "KeywordLookup.h",
  );
  generatedHeaders.push(join(DS, "KeywordLookup.h"));
  {
    const script = join(JSC, "parser", "generateLexerUnicodePropertyTables.py");
    const out = join(DS, "LexerUnicodePropertyTables.h");
    gen({
      outputs: [out],
      cmd: [python, script, join(JSC, "ucd", "UnicodeData.txt"), out],
      inputs: [script, join(JSC, "ucd", "UnicodeData.txt")],
      desc: "LexerUnicodePropertyTables.h",
    });
    generatedHeaders.push(out);
  }
  {
    const script = join(JSC, "yarr", "create_regex_tables");
    const out = join(DS, "yarr", "RegExpJitTables.h");
    gen({ outputs: [out], cmd: [python, script, out], inputs: [script], desc: "RegExpJitTables.h" });
    generatedHeaders.push(out);
  }
  {
    const script = join(JSC, "yarr", "generateYarrUnicodePropertyTables.py");
    const out = join(DS, "yarr", "UnicodePatternTables.h");
    const ucd = join(JSC, "ucd");
    gen({
      outputs: [out],
      cmd: [python, script, ucd, out],
      inputs: [script, join(JSC, "yarr", "hasher.py"), ...readdirSync(ucd).map(f => join(ucd, f))],
      desc: "UnicodePatternTables.h",
    });
    generatedHeaders.push(out);
  }
  {
    const script = join(JSC, "yarr", "generateYarrCanonicalizeUnicode");
    const out = join(DS, "yarr", "YarrCanonicalizeUnicode.cpp");
    gen({
      outputs: [out],
      cmd: [python, script, join(JSC, "ucd", "CaseFolding.txt"), out],
      inputs: [script, join(JSC, "ucd", "CaseFolding.txt")],
      desc: "YarrCanonicalizeUnicode.cpp",
    });
    generatedSources.push(out);
  }

  // Wasm generators.
  for (const [scriptName, outName] of [
    ["generateWasmOpsHeader.py", "WasmOps.h"],
    ["generateWasmOMGIRGeneratorInlinesHeader.py", "WasmOMGIRGeneratorInlines.h"],
  ] as const) {
    const script = join(JSC, "wasm", scriptName);
    const out = join(DS, outName);
    gen({
      outputs: [out],
      cmd: [python, script, join(JSC, "wasm", "wasm.json"), out],
      inputs: [script, join(JSC, "wasm", "generateWasm.py"), join(JSC, "wasm", "wasm.json")],
      desc: outName,
    });
    generatedHeaders.push(out);
  }

  // JS builtins.
  {
    const scriptsDir = join(JSC, "Scripts");
    const script = join(scriptsDir, "generate-js-builtins.py");
    const builtins = list(jscVars, "JavaScriptCore_BUILTINS_SOURCES", JSC);
    const generatorScripts = [
      ...readdirSync(scriptsDir)
        .filter(f => f.endsWith(".py"))
        .map(f => join(scriptsDir, f)),
      ...readdirSync(join(scriptsDir, "wkbuiltins"))
        .filter(f => f.endsWith(".py"))
        .map(f => join(scriptsDir, "wkbuiltins", f)),
    ];
    gen({
      outputs: [join(DS, "JSCBuiltins.cpp"), join(DS, "JSCBuiltins.h")],
      cmd: [python, script, "--framework", "JavaScriptCore", "--output-directory", DS, "--combined", ...builtins],
      inputs: [...builtins, ...generatorScripts],
      desc: "JSCBuiltins",
    });
    generatedHeaders.push(join(DS, "JSCBuiltins.h"));
    // JSCBuiltins.cpp is compiled via JavaScriptCore_SOURCES (cmake appends it there).
    generatedSources.push(join(DS, "JSCBuiltins.cpp"));
  }

  // Inspector protocol.
  {
    const scriptsDir = join(JSC, "Scripts");
    const combined = join(DS, "CombinedDomains.json");
    const domains = list(jscVars, "JavaScriptCore_INSPECTOR_DOMAINS", JSC);
    gen({
      outputs: [combined],
      cmd: [
        python,
        join(scriptsDir, "generate-combined-inspector-json.py"),
        ...domains,
        inspectorFeatureDefines(cfg),
        combined,
      ],
      inputs: [join(scriptsDir, "generate-combined-inspector-json.py"), ...domains],
      desc: "CombinedDomains.json",
    });
    const inspectorScripts = join(JSC, "inspector", "scripts");
    const outDir = join(DS, "inspector");
    const outputs = [
      "InspectorAlternateBackendDispatchers.h",
      "InspectorBackendDispatchers.cpp",
      "InspectorBackendDispatchers.h",
      "InspectorFrontendDispatchers.cpp",
      "InspectorFrontendDispatchers.h",
      "InspectorProtocolObjects.cpp",
      "InspectorProtocolObjects.h",
      "InspectorBackendCommands.js",
    ].map(f => join(outDir, f));
    gen({
      outputs,
      cmd: [
        python,
        join(inspectorScripts, "generate-inspector-protocol-bindings.py"),
        "--outputDir",
        outDir,
        "--framework",
        "JavaScriptCore",
        combined,
      ],
      inputs: [
        combined,
        ...readdirSync(inspectorScripts)
          .filter(f => f.endsWith(".py"))
          .map(f => join(inspectorScripts, f)),
        ...readdirSync(join(inspectorScripts, "codegen"))
          .filter(f => f.endsWith(".py"))
          .map(f => join(inspectorScripts, "codegen", f)),
      ],
      desc: "InspectorProtocolBindings",
    });
    generatedHeaders.push(...outputs.filter(f => f.endsWith(".h")));
    generatedSources.push(...outputs.filter(f => f.endsWith(".cpp")));
  }

  // JSCWebPreferenceOptions.h (from WTF's unified preferences yaml).
  {
    const script = join(WTF, "Scripts", "GeneratePreferences.rb");
    const yaml = join(WTF, "Scripts", "Preferences", "UnifiedWebPreferences.yaml");
    const template = join(JSC, "Scripts", "PreferencesTemplates", "JSCWebPreferenceOptions.h.erb");
    const out = join(DS, "JSCWebPreferenceOptions.h");
    gen({
      outputs: [out],
      cmd: [ruby, script, "--frontend", "JavaScriptCore", "--outputDir", DS, "--template", template, yaml],
      inputs: [script, yaml, template],
      desc: "JSCWebPreferenceOptions.h",
    });
    generatedHeaders.push(out);
  }

  // Generated headers that cmake also exposes as <JavaScriptCore/X.h>.
  writeForwardingStubsInto(join(jscPrivateHeaders, "JavaScriptCore"), [
    join(DS, "Bytecodes.h"),
    join(DS, "JSCBuiltins.h"),
    join(DS, "JSCWebPreferenceOptions.h"),
    join(DS, "WasmOps.h"),
    join(DS, "inspector", "InspectorAlternateBackendDispatchers.h"),
    join(DS, "inspector", "InspectorBackendDispatchers.h"),
    join(DS, "inspector", "InspectorFrontendDispatchers.h"),
    join(DS, "inspector", "InspectorProtocolObjects.h"),
  ]);

  // ─── JavaScriptCore: LLInt ───
  const offlineasm = join(JSC, "offlineasm");
  const llintAsm = list(jscVars, "LLINT_ASM", JSC);
  const offlineAsmRb = list(jscVars, "OFFLINE_ASM", JSC);
  const lowLevelInterpreterAsm = join(JSC, "llint", "LowLevelInterpreter.asm");
  const backend = offlineAsmBackend(cfg);
  // asm.rb only (OFFLINE_ASM_FORMAT_ARGS); the two extractor generators take just the backend.
  const offlineAsmFormatArgs =
    cfg.linux || cfg.freebsd ? ["--binary-format=ELF"] : cfg.windows ? ["--platform=Windows"] : [];
  const buildVariants = "normal";

  const llintDesiredSettings = join(DS, "LLIntDesiredSettings.h");
  gen({
    outputs: [llintDesiredSettings],
    cmd: [
      ruby,
      join(offlineasm, "generate_settings_extractor.rb"),
      `-I${DS}/`,
      lowLevelInterpreterAsm,
      llintDesiredSettings,
      backend,
    ],
    inputs: [...llintAsm, ...offlineAsmRb, join(DS, "InitBytecodes.asm")],
    desc: "LLIntDesiredSettings.h",
  });

  // ─── JavaScriptCore: compile flags ───
  const jscIncludes = [
    jscHeaders,
    jscPrivateHeaders,
    B,
    join(jscPrivateHeaders, "JavaScriptCore"),
    ...list(jscVars, "JavaScriptCore_PRIVATE_INCLUDE_DIRECTORIES", JSC),
    DS,
    join(DS, "inspector"),
    join(DS, "runtime"),
    join(DS, "yarr"),
    WTF, // <wtf/X.h> straight from the source tree (cmake copies to WTF/Headers)
    ...bmallocConsumerIncludes,
  ];
  const jscFlagsNoTarget = [
    ...webkitCxx,
    "-ffp-contract=off",
    "-fno-slp-vectorize",
    ...commonDefines,
    "-DSTATICALLY_LINKED_WITH_WTF",
    "-DSTATICALLY_LINKED_WITH_bmalloc",
    ...[...new Set(jscIncludes)].map(i => `-I${q(i)}`),
    ...icuFlags,
  ];
  const jscFlags = [...jscFlagsNoTarget, "-DBUILDING_JavaScriptCore"];

  // All codegen must exist before any JSC TU compiles; after that the
  // depfiles know exactly which TU reads which header.
  const codegenReady = [...treeReady, ...generatedHeaders, ...generatedSources];

  // The extractors are real executables for the TARGET (offlineasm parses
  // them, nothing runs them), so they link with the same toolchain flags bun
  // does: triple/sysroot, lld, C++ runtime, PIE policy.
  const exeLinkFlags = [
    ...computeTargetLinkFlags(cfg),
    ...(cfg.asan ? ["-fsanitize=address"] : []),
    ...(cfg.windows ? [] : ["-Wl,--gc-sections"]),
  ];

  // LLIntSettingsExtractor: target executable, parsed (not run) by offlineasm.
  const settingsObj = cxx(n, cfg, join(JSC, "llint", "LLIntSettingsExtractor.cpp"), {
    flags: [...jscFlagsNoTarget, "-DBUILDING_LLIntSettingsExtractor"],
    implicitInputs: [llintDesiredSettings],
    orderOnlyInputs: codegenReady,
  });
  const settingsExe = link(n, cfg, join(binDir, "LLIntSettingsExtractor"), [settingsObj], {
    libs: [],
    flags: exeLinkFlags,
  });

  const llintDesiredOffsets = join(DS, "LLIntDesiredOffsets.h");
  gen({
    outputs: [llintDesiredOffsets],
    cmd: [
      ruby,
      join(offlineasm, "generate_offset_extractor.rb"),
      `-I${DS}/`,
      lowLevelInterpreterAsm,
      settingsExe,
      llintDesiredOffsets,
      backend,
      buildVariants,
    ],
    inputs: [
      settingsExe,
      ...llintAsm,
      ...offlineAsmRb,
      join(DS, "InitBytecodes.asm"),
      join(DS, "AirOpcode.h"),
      join(DS, "WasmOps.h"),
    ],
    desc: "LLIntDesiredOffsets.h",
  });

  const offsetsObj = cxx(n, cfg, join(JSC, "llint", "LLIntOffsetsExtractor.cpp"), {
    flags: [...jscFlagsNoTarget, "-DBUILDING_LLIntOffsetsExtractor"],
    implicitInputs: [llintDesiredOffsets],
    orderOnlyInputs: codegenReady,
  });
  const offsetsExe = link(n, cfg, join(binDir, "LLIntOffsetsExtractor"), [offsetsObj], {
    libs: [],
    flags: exeLinkFlags,
  });

  const llintAssembly = join(DS, "LLIntAssembly.h");
  gen({
    outputs: [llintAssembly],
    cmd: [
      ruby,
      join(offlineasm, "asm.rb"),
      `-I${DS}/`,
      lowLevelInterpreterAsm,
      offsetsExe,
      llintAssembly,
      buildVariants,
      ...offlineAsmFormatArgs,
    ],
    inputs: [offsetsExe, ...llintAsm, ...offlineAsmRb, join(DS, "InitBytecodes.asm")],
    env: { CMAKE_CXX_COMPILER_ID: "Clang", GCC_OFFLINEASM_SOURCE_MAP: "OFF" },
    desc: "LLIntAssembly.h",
  });

  // ─── JavaScriptCore: sources (unified bundles) ───
  const unifiedListFiles = list(jscVars, "JavaScriptCore_UNIFIED_SOURCE_LIST_FILES", JSC);
  const bundleScript = join(WTF, "Scripts", "generate-unified-source-bundles.py");
  const bundled = spawnSync(
    python,
    [
      bundleScript,
      "--derived-sources-path",
      DS,
      "--source-tree-path",
      JSC,
      "--ignore-header-groups",
      ...unifiedListFiles,
    ],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  if (bundled.error)
    throw new BuildError("Failed to run python for WebKit unified source bundling", {
      cause: bundled.error,
      hint: `Is ${python} in PATH?`,
    });
  if (bundled.status !== 0) {
    throw new BuildError(`generate-unified-source-bundles.py failed:\n${bundled.stderr}`, { file: bundleScript });
  }
  // Output is a cmake list: bundle files (absolute) plus the @no-unify
  // members (relative to the source tree, or bare names of generated sources
  // in DerivedSources), headers included — same disambiguation as
  // WEBKIT_COMPUTE_SOURCES.
  const jscSources = [
    ...bundled.stdout
      .split(/[;\r\n]+/)
      .map(s => s.trim())
      .filter(s => /\.(cpp|c|cc)$/.test(s))
      .map(s => (s.startsWith("/") ? s : !s.includes("/") && !existsSync(join(JSC, s)) ? join(DS, s) : join(JSC, s))),
    ...list(jscVars, "JavaScriptCore_SOURCES", JSC),
  ];

  const prefixHeader = join(JSC, "JavaScriptCorePrefix.h");
  const jscPch = pch(n, cfg, prefixHeader, {
    flags: jscFlags,
    orderOnlyInputs: codegenReady,
    implicitInputs: [join(B, "cmakeconfig.h")],
  });

  const jscObjects: string[] = [];
  for (const src of jscSources) {
    const isC = src.endsWith(".c");
    jscObjects.push(
      isC
        ? cc(n, cfg, src, {
            flags: [
              ...webkitC,
              ...commonDefines,
              "-DBUILDING_JavaScriptCore",
              ...jscIncludes.map(i => `-I${q(i)}`),
              ...icuFlags,
            ],
            orderOnlyInputs: codegenReady,
          })
        : cxx(n, cfg, src, {
            flags: jscFlags,
            pch: jscPch.pch,
            pchHeader: jscPch.wrapperHeader,
            orderOnlyInputs: codegenReady,
          }),
    );
  }
  // LowLevelInterpreter.cpp: the inline-asm interpreter (includes
  // LLIntAssembly.h). Its own edge, like cmake's LowLevelInterpreterLib: no
  // PCH, and an implicit dep on the generated assembly.
  jscObjects.push(
    cxx(n, cfg, join(JSC, "llint", "LowLevelInterpreter.cpp"), {
      flags: jscFlags,
      implicitInputs: [llintAssembly],
      orderOnlyInputs: codegenReady,
    }),
  );

  const libJSC = ar(n, cfg, libJSCPath, jscObjects);
  n.phony("JavaScriptCore", [libJSC]);

  // testFFI: JSC's bun:ffi C++/ABI test executable (ffi/tests/testFFI.cpp),
  // run by test/js/bun/jsc-stress/testFFI.test.ts. Linking it also proves the
  // three archives + ICU + mimalloc resolve standalone before bun does.
  const testFFIObj = cxx(n, cfg, join(JSC, "ffi", "tests", "testFFI.cpp"), {
    flags: [...jscFlagsNoTarget, "-DBUILDING_testFFI", "-DSTATICALLY_LINKED_WITH_JavaScriptCore"],
    pch: jscPch.pch,
    pchHeader: jscPch.wrapperHeader,
    orderOnlyInputs: codegenReady,
  });
  const depLink = (name: string): string[] => {
    const r = resolved.get(name);
    return r === undefined ? [] : [...r.libs, ...r.objects];
  };
  const testFFI = link(n, cfg, join(binDir, "testFFI"), [testFFIObj, ...depLink("mimalloc")], {
    libs: [libJSC, libWTF, libbmalloc, ...depLink("icu")],
    flags: [...exeLinkFlags, ...systemLibs(cfg)],
  });
  n.phony("testFFI", [testFFI]);
  n.phony("jsc-codegen", [...generatedHeaders, ...generatedSources]);

  const libs = [libJSC, libWTF, libbmalloc];
  n.phony("WebKit", [...libs, testFFI]);

  return {
    libs,
    extras: [testFFI],
    outputs: [...treeReady, ...generatedHeaders],
    includes: [
      B,
      jscHeaders,
      join(jscHeaders, "JavaScriptCore"),
      jscPrivateHeaders,
      join(jscPrivateHeaders, "JavaScriptCore"),
      ...bmallocConsumerIncludes,
      WTF,
    ],
  };
}

/** Forwarding stubs for generated headers into an existing framework dir (no stale-stub sweep). */
function writeForwardingStubsInto(dir: string, headers: string[]): void {
  mkdirSync(dir, { recursive: true });
  for (const h of headers) writeStub(join(dir, basename(h)), h);
}

/**
 * Ninja rules for the edges above. Registered from registerDepRules so they
 * exist before any dep emits.
 */
export function registerWebKitDirectRules(n: Ninja, cfg: Config): void {
  const hostWin = cfg.host.os === "windows";
  // Generators write several outputs and are deterministic; restat prunes
  // downstream when a re-run produces identical bytes (offlineasm and the
  // python generators only rewrite on change).
  n.rule("webkit_gen", {
    command: hostWin ? `cmd /c "cd /d $cwd && $cmd"` : `cd $cwd && $cmd`,
    description: "gen $desc",
    restat: true,
  });
  n.rule("webkit_gen_stdout", {
    command: hostWin
      ? `cmd /c "$cmd > $out"`
      : `$cmd > $out.tmp && { cmp -s $out.tmp $out && rm $out.tmp || mv $out.tmp $out; }`,
    description: "gen $desc",
    restat: true,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// The Dependency
// ───────────────────────────────────────────────────────────────────────────

export const webkit: Dependency = {
  name: "WebKit",
  versionMacro: "WEBKIT",
  // source mode compiles against the mimalloc bun links (USE_EXTERNAL_MIMALLOC)
  // and, off macOS, the ICU built by deps/icu.ts.
  fetchDeps: cfg => (cfg.webkit === "source" ? ["mimalloc", ...(buildsIcu(cfg) ? ["icu"] : [])] : []),

  source: cfg => {
    if (cfg.webkit === "prebuilt") {
      const src: Source = {
        kind: "prebuilt",
        url: prebuiltUrl(cfg),
        // Identity = version + suffix. Suffix ensures profile switches
        // (debug ↔ release, asan toggle) trigger re-download. Without it,
        // same version stamp would skip, leaving the wrong ABI on disk.
        identity: `${cfg.webkitVersion}${prebuiltSuffix(cfg)}`,
        destDir: prebuiltDestDir(cfg),
      };
      // macOS: bundled ICU headers conflict with system ICU.
      if (cfg.darwin) {
        src.rmAfterExtract = ["include/unicode"];
      }
      return src;
    }

    if (cfg.webkit === "source") {
      return { kind: "github", repo: "oven-sh/WebKit", commit: cfg.webkitVersion, sparse: sourceSparse };
    }

    // Local: resolveDep()'s local-mode assert gives a clear "clone it
    // yourself" error if missing.
    const env = process.env.BUN_WEBKIT_PATH;
    return {
      kind: "local",
      path: webkitSrcDir(cfg),
      hint: env
        ? `$BUN_WEBKIT_PATH is set to '${env}' but that path does not contain a WebKit checkout`
        : "Clone oven-sh/WebKit to vendor/WebKit/ or set $BUN_WEBKIT_PATH to an existing clone — or pass --webkit=source to have the build fetch the pinned commit",
    };
  },

  build: cfg => {
    if (cfg.webkit === "prebuilt") {
      return { kind: "none" };
    }

    if (cfg.webkit === "source") {
      return { kind: "custom", needsSourceAtConfigure: true, libs: webKitDirectLibs, emit: emitWebKitDirect };
    }

    // Local: nested cmake over the user's checkout, target=jsc.
    //
    // CMAKE_C_FLAGS/CMAKE_CXX_FLAGS: overrides the global dep flags source.ts
    // would otherwise pass — WebKit's cmake sets its own -O/-g/sanitizer
    // flags; ours would conflict. Dep args go LAST so they override. We DO
    // forward:
    //   - CPU target (-march/-mcpu): WebKit never sets this — without it,
    //     local builds target generic x86-64 while bun + prebuilt WebKit
    //     target nehalem.
    //   - LTO/PGO: WebKit's cmake doesn't set those itself.
    //
    // Windows: ICU built from source via preBuild before cmake configure.
    // WebKit's cmake finds it via ICU_ROOT. On posix, system ICU is used
    // (macOS: Homebrew headers + system libs; Linux: libicu-dev) — cmake
    // auto-detects.
    const optFlags: string[] = computeCpuTargetFlags(cfg);
    // -fno-pic: match bun's own C++ (flags.ts) so JSC/WTF const-pointer
    // tables land in .rodata instead of .data.rel.ro. We link -no-pie, so
    // PIC codegen here is pure overhead (GOT indirections + ~550 KB of
    // RW-segment vtables that would otherwise be shared RO). Android stays
    // PIC because bionic mandates PIE.
    // -no-pie rides along in CMAKE_C_FLAGS so try_compile() probes link on
    // PIE-default distros — without it the driver still passes -pie and the
    // -fno-pic probe object fails R_X86_64_32S relocation, killing FindThreads.
    if (cfg.unix && cfg.abi !== "android") optFlags.push("-fno-pic", "-fno-pie", "-no-pie");
    if (cfg.lto) optFlags.push("-flto=thin");
    if (cfg.pgoGenerate) optFlags.push(`-fprofile-generate=${cfg.pgoGenerate}`);
    if (cfg.pgoUse) {
      optFlags.push(
        `-fprofile-use=${cfg.pgoUse}`,
        "-Wno-profile-instr-out-of-date",
        "-Wno-profile-instr-unprofiled",
        "-Wno-backend-plugin",
      );
    }
    // Android local mode: NOT using CMAKE_SYSTEM_NAME=Android because that
    // module force-selects the NDK's bundled clang, overriding our
    // CMAKE_{C,CXX}_COMPILER. Instead, treat it as a generic Linux
    // cross-compile (CMAKE_SYSTEM_NAME=Linux + CMAKE_CROSSCOMPILING) and
    // pass --target/--sysroot in CFLAGS. WebKit's source detects Android
    // via __ANDROID__ (set by clang --target=*-android*); we set the cmake
    // ANDROID variable manually so `if (ANDROID)` blocks trigger too.
    if (cfg.abi === "android") {
      const icuRoot = process.env.BUN_ANDROID_ICU_ROOT ?? "/tmp/icu-android";
      optFlags.push(`--target=${cfg.crossTarget!}`, `--sysroot=${cfg.sysroot!}`, `-isystem`, join(icuRoot, "include"));
    }
    if (cfg.freebsd && cfg.crossTarget !== undefined) {
      optFlags.push(`--target=${cfg.crossTarget}`, `--sysroot=${cfg.sysroot!}`);
    }
    const optFlagStr = optFlags.join(" ");
    let cxxOptFlagStr = optFlagStr;
    if (cfg.abi === "android") {
      const inc = join(cfg.sysroot!, "usr", "include");
      const triple = `${cfg.x64 ? "x86_64" : "aarch64"}-linux-android`;
      cxxOptFlagStr += ` -nostdlibinc -isystem ${join(inc, "c++", "v1")} -isystem ${join(inc, triple)} -isystem ${inc}`;
    } else if (cfg.freebsd && cfg.sysroot !== undefined) {
      const inc = join(cfg.sysroot, "usr", "include");
      cxxOptFlagStr += ` -nostdlibinc -isystem ${join(inc, "c++", "v1")} -isystem ${inc}`;
    }
    const args: Record<string, string> = {
      CMAKE_C_FLAGS: optFlagStr,
      CMAKE_CXX_FLAGS: cxxOptFlagStr,
      ...(cfg.abi === "android"
        ? {
            CMAKE_SYSTEM_NAME: "Linux",
            CMAKE_SYSTEM_PROCESSOR: cfg.arm64 ? "aarch64" : "x86_64",
            CMAKE_SYSROOT: cfg.sysroot!,
            ANDROID: "ON",
            ENABLE_API_TESTS: "OFF",
            // No system ICU on Android. Point at a static cross-built ICU
            // (see Dockerfile.android for the recipe). FindICU also probes
            // CMAKE_FIND_ROOT_PATH so we whitelist the prefix. ICU_INCLUDE_DIR
            // explicit: the NDK sysroot ships annotated headers that mark
            // most ICU functions __INTRODUCED_IN(31), so FindICU picking
            // those up makes everything unavailable at API 28.
            ICU_ROOT: process.env.BUN_ANDROID_ICU_ROOT ?? "/tmp/icu-android",
            ICU_INCLUDE_DIR: join(process.env.BUN_ANDROID_ICU_ROOT ?? "/tmp/icu-android", "include"),
            CMAKE_FIND_ROOT_PATH_MODE_PACKAGE: "BOTH",
            CMAKE_FIND_ROOT_PATH_MODE_LIBRARY: "BOTH",
            CMAKE_FIND_ROOT_PATH_MODE_INCLUDE: "BOTH",
          }
        : {}),
      ...(cfg.freebsd && cfg.crossTarget !== undefined
        ? {
            CMAKE_SYSTEM_NAME: "FreeBSD",
            CMAKE_SYSTEM_PROCESSOR: cfg.arm64 ? "aarch64" : "x86_64",
            CMAKE_SYSROOT: cfg.sysroot!,
            CMAKE_FIND_ROOT_PATH_MODE_PACKAGE: "BOTH",
            CMAKE_FIND_ROOT_PATH_MODE_LIBRARY: "BOTH",
            CMAKE_FIND_ROOT_PATH_MODE_INCLUDE: "BOTH",
          }
        : {}),
      // Match bun's -fno-pic: WebKit's CMake defaults POSITION_INDEPENDENT_CODE
      // to ON for static-archive targets, which puts ~550 KB of vtables into
      // .data.rel.ro. We link -no-pie so this is dead weight in the RW
      // PT_LOAD. Android (PIE) overrides via the -fPIC in optFlags above
      // never being suppressed there.
      ...(cfg.abi !== "android" ? { CMAKE_POSITION_INDEPENDENT_CODE: "OFF" } : {}),
      PORT: "JSCOnly",
      // Tools/ is TestWebKitAPI and friends — nothing the jsc target needs.
      ENABLE_TOOLS: "OFF",
      ENABLE_STATIC_JSC: "ON",
      USE_THIN_ARCHIVES: "OFF",
      ENABLE_FTL_JIT: "ON",
      CMAKE_EXPORT_COMPILE_COMMANDS: "ON",
      USE_BUN_JSC_ADDITIONS: "ON",
      USE_BUN_EVENT_LOOP: "ON",
      // Match the prebuilt: JSC allocates through Bun's mimalloc, not libpas.
      ...(cfg.asan ? {} : { USE_MIMALLOC: "ON", USE_EXTERNAL_MIMALLOC: "ON" }),
      ENABLE_BUN_SKIP_FAILING_ASSERTIONS: "ON",
      ALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS: "ON",
      ENABLE_REMOTE_INSPECTOR: "ON",
      ENABLE_MEDIA_SOURCE: "OFF",
      ENABLE_MEDIA_STREAM: "OFF",
      ENABLE_WEB_RTC: "OFF",
      ...(cfg.asan ? { ENABLE_SANITIZERS: "address" } : {}),
    };

    const spec: NestedCmakeBuild = {
      kind: "nested-cmake",
      targets: ["jsc"],
      args,
      // Release local WebKit keeps debug info so JSC crashes symbolicate.
      // LTO stays plain Release (debug info + LTO bloats significantly).
      buildType: cfg.release && !cfg.lto ? "RelWithDebInfo" : cfg.buildType,
    };

    if (cfg.windows) {
      const icu = icuDir(cfg);
      const srcDir = webkitSrcDir(cfg);
      // slash(): cmake -D values — see shell.ts.
      args.ICU_ROOT = slash(icu);
      args.ICU_LIBRARY = slash(resolve(icu, "lib"));
      args.ICU_INCLUDE_DIR = slash(resolve(icu, "include"));
      // U_STATIC_IMPLEMENTATION: ICU headers default to dllimport; we
      // link statically. Matches what the old cmake's SetupWebKit did.
      args.CMAKE_C_FLAGS = `/DU_STATIC_IMPLEMENTATION ${optFlagStr}`.trim();
      args.CMAKE_CXX_FLAGS = `/DU_STATIC_IMPLEMENTATION /clang:-fno-c++-static-destructors ${optFlagStr}`.trim();
      // Static CRT to match bun + all other deps (we build everything
      // with /MTd or /MT). Without this, cmake defaults to /MDd →
      // RuntimeLibrary mismatch at link.
      args.CMAKE_MSVC_RUNTIME_LIBRARY = cfg.debug ? "MultiThreadedDebug" : "MultiThreaded";
      spec.preBuild = {
        command: [
          "powershell",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve(srcDir, "build-icu.ps1"),
          "-Platform",
          cfg.x64 ? "x64" : "ARM64",
          "-BuildType",
          cfg.debug ? "Debug" : "Release",
          "-OutputDir",
          icu,
        ],
        cwd: srcDir,
        outputs: localIcuLibs(cfg),
      };
    }

    return spec;
  },

  provides: cfg => {
    if (cfg.webkit === "prebuilt") {
      // Paths relative to prebuilt destDir — emitPrebuilt resolves them.
      //
      // bmalloc: some historical prebuilts rolled it into JSC. Current
      // versions ship it separately on all platforms. Listed here so
      // emitPrebuilt declares it as an output — ninja knows fetch creates
      // it. If a future version drops libbmalloc.a, you'll get a clear
      // "file not found" at link time (not silent omission + cryptic
      // undefined symbols).
      const libs = [...coreLibs(cfg), ...prebuiltIcuLibs(cfg), bmallocLib(cfg)];

      const includes = ["include"];
      // Linux/windows: ICU headers under wtf/unicode. macOS: deleted by
      // postExtract.
      if (!cfg.darwin) includes.push("include/wtf/unicode");

      return { libs, includes };
    }

    if (cfg.webkit === "source") {
      // emitWebKitDirect reports libs and include dirs itself (CustomBuild).
      return { libs: [], includes: [] };
    }

    // Local: paths relative to BUILD dir (headers generated during build).
    // includes uses ABSOLUTE paths via depBuildDir() — source.ts's
    // resolve-against-srcDir would point at vendor/WebKit/ (wrong).
    const buildDir = depBuildDir(cfg, "WebKit");

    // Lib paths: emitNestedCmake resolves these relative to the build dir's
    // libSubdir — we set none, so it's buildDir root. But WebKit's libs are
    // in lib/. So include the lib/ prefix.
    //
    // Windows ICU libs are NOT listed here — they're preBuild.outputs,
    // which source.ts appends to the resolved libs automatically. Listing
    // them here would make dep_build also claim to produce them (dup error).
    // Posix uses system ICU (linked via -licu* in bun.ts). Android has no
    // system ICU — link the static cross-built libs from BUN_ANDROID_ICU_ROOT.
    const libs = [...coreLibs(cfg), bmallocLib(cfg)];
    if (cfg.abi === "android") {
      const icuRoot = process.env.BUN_ANDROID_ICU_ROOT ?? "/tmp/icu-android";
      libs.push(
        resolve(icuRoot, "lib", "libicui18n.a"),
        resolve(icuRoot, "lib", "libicuuc.a"),
        resolve(icuRoot, "lib", "libicudata.a"),
      );
    }

    const includes = [
      // ABSOLUTE — resolved here because they're in the build dir, not src.
      buildDir,
      resolve(buildDir, "JavaScriptCore", "Headers"),
      resolve(buildDir, "JavaScriptCore", "Headers", "JavaScriptCore"),
      resolve(buildDir, "JavaScriptCore", "PrivateHeaders"),
      resolve(buildDir, "bmalloc", "Headers"),
      resolve(buildDir, "WTF", "Headers"),
      resolve(buildDir, "JavaScriptCore", "PrivateHeaders", "JavaScriptCore"),
    ];
    // Windows: ICU headers from preBuild output.
    if (cfg.windows) includes.push(resolve(icuDir(cfg), "include"));
    // Android: ICU headers from BUN_ANDROID_ICU_ROOT (the NDK sysroot's
    // unicode/ headers are __INTRODUCED_IN(31)-gated and unusable at API 28).
    if (cfg.abi === "android") {
      includes.push(resolve(process.env.BUN_ANDROID_ICU_ROOT ?? "/tmp/icu-android", "include"));
    }

    return { libs, includes };
  },
};
