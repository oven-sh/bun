/**
 * WebKit commit — determines prebuilt download URL + what to checkout
 * for local mode. Override via `--webkit-version=<hash>` to test a branch.
 * From https://github.com/oven-sh/WebKit releases.
 */
export const WEBKIT_VERSION = "1600131e46b5af48bbda3559af8d8a3327230b6e";

/**
 * WebKit (JavaScriptCore) — the JS engine, with WTF and bmalloc.
 *
 * Two modes via `cfg.webkit`:
 *
 * **prebuilt** (CI and every profile but the `-local` ones): Download tarball
 *   from oven-sh/WebKit releases. Tarball name encodes {os, arch, musl,
 *   debug|lto, asan} — each is a separate ABI. ASAN MUST match bun's setting:
 *   WTF::Vector layout changes with ASAN (see WTF/Vector.h:682), so mixing →
 *   silent memory corruption.
 *
 * **local**: Source at `vendor/WebKit/`, or `$BUN_WEBKIT_PATH` if set. User
 *   clones manually (clone takes 10+ min — too slow for the build system
 *   to do). Set `BUN_WEBKIT_PATH` to share one clone across worktrees. It is
 *   compiled in our own ninja graph like every other dep, no cmake ("Local
 *   mode: direct build" below). Generated headers land in the BUILD dir.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { evaluateCMake, type CMakeEvaluation } from "../cmake.ts";
import type { Config } from "../config.ts";
import { assert, BuildError } from "../error.ts";
import { quote } from "../shell.ts";
import {
  depBuildDir,
  depSourceDir,
  groupCompileFlags,
  type Dependency,
  type DirectBuild,
  type DirectStep,
  type GenStep,
  type Source,
  type SourceGroup,
} from "../source.ts";

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
// Prebuilt lib paths — relative to destDir
// ───────────────────────────────────────────────────────────────────────────

/** JSC's testFFI executable: the prebuilt tarball ships one in bin/; local mode builds it next to bun on request (`--target=testFFI`, bun.ts). */
export function webkitTestFFIPath(cfg: Config): string {
  return cfg.webkit === "prebuilt"
    ? resolve(prebuiltDestDir(cfg), "bin", `testFFI${cfg.exeSuffix}`)
    : resolve(cfg.buildDir, `testFFI${cfg.exeSuffix}`);
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

/** ICU libs the prebuilt tarball bundles on linux/windows (macOS uses system ICU). */
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
// Local mode: cmakeconfig.h
//
// `cmakeconfig.h` for the direct WebKit build — the ENABLE_/USE_/HAVE_ matrix
// WebKit's cmake (WebKitFeatures.cmake + Options{Common,JSCOnly}.cmake + the
// header/function probes) writes for the JSCOnly port with bun's options.
// Platform.h reads it first thing, so every WebKit TU and every bun TU that
// includes JSC headers sees the same values. The same values decide the
// `if (ENABLE_X)` branches of WebKit's file lists (webkitLists).
//
// The table is the output of WebKit's cmake configure; the prebuilt tarball
// for a target has one in include/cmakeconfig.h to diff against. Entries whose
// value depends on the target are functions (`probe` rows are the
// header/function checks, which cmake does not run for Apple targets). An
// option WebKit adds is missing here until someone adds the row: it then reads
// as off, unless wtf/PlatformEnable.h defaults it on.
// ───────────────────────────────────────────────────────────────────────────

const on = (b: boolean): number => (b ? 1 : 0);
/** JSC allocates through bun's mimalloc, not libpas, like the prebuilt (ASAN wants the system allocator it intercepts). */
const usesMimalloc = (c: Config): boolean => !c.asan;
/**
 * A header/function probe row (WEBKIT_CHECK_HAVE_*). OptionsCommon.cmake
 * skips those on APPLE, so the row is absent there; under clang-cl against
 * the Windows SDK every one of these POSIX probes comes out 0.
 */
const probe =
  (v: number | ((c: Config) => number)) =>
  (c: Config): number | undefined =>
    c.darwin ? undefined : c.windows ? 0 : typeof v === "function" ? v(c) : v;
/** The two compile probes (int128, std::filesystem) are not run for Windows either. */
const compileProbe =
  (v: number) =>
  (c: Config): number | undefined =>
    c.darwin || c.windows ? undefined : v;

type Row = [name: string, value: number | undefined | ((c: Config) => number | undefined)];

const rows: Row[] = [
  ["ALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS", 1],
  ["BUN_SKIP_FAILING_ASSERTIONS", 1],
  ["BUSE_TZONE", 0],
  ["ENABLE_ACCESSIBILITY_ISOLATED_TREE", 0],
  ["ENABLE_API_TESTS", c => on(!c.windows)],
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
  ["ENABLE_FUZZILLI", c => (c.windows ? undefined : 0)],
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
  ["ENABLE_MAC_GESTURE_EVENTS", 0],
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
  ["ENABLE_TELEPHONE_NUMBER_DETECTION", 0],
  ["ENABLE_THUNDER", 0],
  ["ENABLE_TOUCH_EVENTS", 0],
  ["ENABLE_UIPROCESS_PERIODIC_MEMORY_MONITOR", 0],
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
  ["ENABLE_WEBGPU_SWIFT", 0],
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
  ["HAVE_ALIGNED_MALLOC", probe(0)],
  ["HAVE_ERRNO_H", probe(1)],
  ["HAVE_FEATURES_H", probe(c => on(c.linux))],
  ["HAVE_INT128_T", compileProbe(1)],
  ["HAVE_LANGINFO_H", probe(1)],
  ["HAVE_LINUX_MEMFD_H", probe(c => on(c.linux))],
  ["HAVE_LOCALTIME_R", probe(1)],
  ["HAVE_MALLOC_TRIM", probe(c => on(c.linux && c.abi === "gnu"))],
  ["HAVE_MAP_ALIGNED", probe(c => on(c.freebsd))],
  ["HAVE_MMAP", probe(1)],
  ["HAVE_PTHREAD_MAIN_NP", probe(c => on(c.freebsd))],
  ["HAVE_PTHREAD_NP_H", probe(c => on(c.freebsd))],
  ["HAVE_REGEX_H", probe(1)],
  ["HAVE_SHM_ANON", probe(c => on(c.freebsd))],
  ["HAVE_SIGNAL_H", probe(1)],
  ["HAVE_STATX", probe(c => on(c.linux && c.abi !== "android"))],
  ["HAVE_STAT_BIRTHTIME", probe(c => on(c.freebsd))],
  ["HAVE_STD_FILESYSTEM", compileProbe(1)],
  ["HAVE_SYS_PARAM_H", probe(1)],
  ["HAVE_SYS_TIMEB_H", probe(c => on(c.abi !== "android"))],
  ["HAVE_SYS_TIME_H", probe(1)],
  ["HAVE_TIMEGM", probe(1)],
  ["HAVE_TIMERFD", probe(1)],
  ["HAVE_TIMINGSAFE_BCMP", probe(c => on(c.freebsd))],
  ["HAVE_TM_GMTOFF", probe(1)],
  ["HAVE_TM_ZONE", probe(1)],
  ["HAVE_VASPRINTF", probe(1)],
  ["USE_64KB_PAGE_BLOCK", 0],
  ["USE_ALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS", 1],
  ["USE_AVIF", 1],
  ["USE_BUN_EVENT_LOOP", 1],
  ["USE_BUN_JSC_ADDITIONS", 1],
  ["USE_EXTERNAL_MIMALLOC", c => on(usesMimalloc(c))],
  ["USE_INSPECTOR_SOCKET_SERVER", 1],
  ["USE_ISO_MALLOC", c => on(!c.darwin)],
  ["USE_JPEGXL", 1],
  ["USE_LCMS", 1],
  ["USE_LIBBACKTRACE", 0],
  ["USE_MIMALLOC", c => on(usesMimalloc(c))],
  ["USE_PGO_PROFILE", 0],
  ["USE_SKIA", 0],
  ["USE_SKIA_ENCODERS", 0],
  ["USE_SYSTEM_MALLOC", 0],
  ["USE_SYSTEM_UNIFDEF", 0],
  ["USE_TZONE_MALLOC", 0],
  ["USE_UNIX_DOMAIN_SOCKETS", 1],
  ["USE_WOFF2", 1],
  ["WTF_DEFAULT_EVENT_LOOP", 0],
  // OptionsJSCOnly.cmake (WIN32 + ENABLE_STATIC_JSC): no dllexport/dllimport on the JS_EXPORT macros.
  ["JS_NO_EXPORT", c => (c.windows ? 1 : undefined)],
];

/** The table for one target: the rows it has, in order. */
function buildOptions(cfg: Config): Array<[name: string, value: number]> {
  return rows.flatMap(([name, value]) => {
    const v = typeof value === "function" ? value(cfg) : value;
    return v === undefined ? [] : [[name, v] as [string, number]];
  });
}

/**
 * No BUN_WEBKIT_VERSION, which the prebuilt's has: bun keys the bytecode cache
 * on it, and a checkout being edited has no version (ZigGlobalObject.cpp then
 * falls back to the time of the build).
 */
function cmakeConfigHeader(cfg: Config): string {
  const defines = buildOptions(cfg).map(([name, value]) => `#define ${name} ${value}\n`);
  return `#ifndef CMAKECONFIG_H\n#define CMAKECONFIG_H\n\n${defines.join("")}\n#endif /* CMAKECONFIG_H */\n`;
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
    "JS_NO_EXPORT",
  ]);
  // cmake snapshots this list before OptionsJSCOnly.cmake turns ENABLE_WEBGL
  // off, so the JSCOnly protocol has always carried the WebGL-conditioned
  // Canvas commands; keep it that way.
  const names: string[] = ["ENABLE_WEBGL"];
  for (const [name, value] of buildOptions(cfg)) {
    if (!name.startsWith("HAVE_") && !notOptions.has(name) && value !== 0) names.push(name);
  }
  // cmake builds the string as `"${list} ${name}"` starting from empty, so it
  // carries a leading space; CombinedDomains.json records it verbatim.
  return names
    .sort()
    .map(n => ` ${n}`)
    .join("");
}

// ───────────────────────────────────────────────────────────────────────────
// Local mode: direct build
//
// WebKit (bmalloc + WTF + JavaScriptCore, JSCOnly port) built directly in our
// ninja graph — no cmake.
//
// What WebKit's cmake does, and where it lives here:
//
//   file lists              read from the checkout at configure (webkitLists):
//                           sources, include dirs, framework headers, codegen
//                           and generator-script inputs out of its CMake files,
//                           JSC's TUs out of Sources.txt. A file added to
//                           WebKit needs no change here.
//   cmakeconfig.h           cmakeConfigHeader table, a `headers` entry
//   framework headers       forwarding stubs as `headers` entries:
//                           <bmalloc/X.h>, <JavaScriptCore/X.h> flattened dirs
//   unified bundles         WebKit's generate-unified-source-bundles.py, run at
//                           configure like cmake does (it only writes #include
//                           lists, and only the ones that changed)
//   DerivedSources codegen  ~17 ruby/python/perl steps + one per .lut.h; each
//                           gen() restates an add_custom_command
//   LLInt                   settings extractor exe → offsets extractor exe →
//                           LLIntAssembly.h, each parsed by offlineasm (ruby)
//   compile                 source groups with dep flags, so target/cpu/lto/
//                           asan come from flags.ts like every dep; the objects
//                           go straight onto bun's link line. webkitFlags()
//                           restates WebKitCompilerFlags / Options*.cmake.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Paths and settings every part of the spec is written against. Everything
 * generated lives under `<buildDir>/deps/WebKit/` with cmake's layout, so
 * `<JavaScriptCore/X.h>` and DerivedSources paths read as in a WebKit build.
 */
interface WebKitBuild {
  cfg: Config;
  q: (p: string) => string;
  /** The WebKit checkout and its Source/{JavaScriptCore,WTF,bmalloc}. */
  W: string;
  JSC: string;
  WTF: string;
  BM: string;
  /** <buildDir>/deps/WebKit — cmakeconfig.h, framework header dirs, DerivedSources, bin/. */
  B: string;
  DS: string;
  WTF_DS: string;
  binDir: string;
  jscHeaders: string;
  jscPrivateHeaders: string;
  bmallocHeaders: string;
  python: string;
  /** The spec's generator and executable steps, accumulated by the functions below. */
  steps: DirectStep[];
  /** Directories filesIn() listed. */
  listedDirs: string[];
}

/** WebKit-wide compile flags, derived once (WebKitCompilerFlags / Options*.cmake equivalents), on top of the dep globals the emitter puts underneath every group. */
interface WebKitFlags {
  /** WebKit's additions for C and C++ TUs alike. */
  common: string[];
  /** C++-only additions (-std, the <iostream> ban). */
  cxx: string[];
  /** -D set every WebKit TU carries. */
  commonDefines: string[];
  icuFlags: string[];
  /** <bmalloc/X.h> and the bare "X.h" siblings bmalloc's own headers include. */
  bmallocConsumerIncludes: string[];
}

const ruby = "ruby";
const perl = "perl";

/** One generator step; cwd defaults to DerivedSources (several generators write there implicitly). */
function gen(wk: WebKitBuild, opts: Omit<GenStep, "cwd"> & { cwd?: string }): void {
  wk.steps.push({ cwd: wk.DS, ...opts });
}
/** A generator that prints its output. */
const genStdout = (wk: WebKitBuild, out: string, cmd: string[], inputs: string[], desc: string): void =>
  gen(wk, { outputs: [out], cmd, inputs, desc, stdout: true });

function webkitLayout(cfg: Config): WebKitBuild {
  const hostWin = cfg.host.os === "windows";
  const W = depSourceDir(cfg, "WebKit");
  const B = depBuildDir(cfg, "WebKit");
  const SRC = join(W, "Source");
  return {
    cfg,
    q: p => quote(p, hostWin),
    W,
    JSC: join(SRC, "JavaScriptCore"),
    WTF: join(SRC, "WTF"),
    BM: join(SRC, "bmalloc"),
    B,
    DS: join(B, "JavaScriptCore", "DerivedSources"),
    WTF_DS: join(B, "WTF", "DerivedSources"),
    binDir: join(B, "bin"),
    jscHeaders: join(B, "JavaScriptCore", "Headers"),
    jscPrivateHeaders: join(B, "JavaScriptCore", "PrivateHeaders"),
    bmallocHeaders: join(B, "bmalloc", "Headers"),
    python: hostWin ? "python" : "python3",
    steps: [],
    listedDirs: [],
  };
}

/**
 * The files directly in `dir` with one of the extensions: a generator's own
 * modules and data, inputs of its step. (cmake names them in a flattened copy
 * of the scripts it makes; the steps here run them in place.)
 */
function filesIn(wk: WebKitBuild, dir: string, ...exts: string[]): string[] {
  wk.listedDirs.push(dir);
  return readdirSync(dir)
    .filter(f => exts.length === 0 || exts.some(e => f.endsWith(e)))
    .sort()
    .map(f => join(dir, f));
}

// ─── File lists ───

/** One library's CMake variables, its relative entries resolved against the directory of its CMakeLists.txt. */
interface LibraryLists {
  paths(variable: string): string[];
  files: string[];
}

interface WebKitLists {
  bmalloc: LibraryLists;
  wtf: LibraryLists;
  jsc: LibraryLists;
}

/**
 * The lists WebKit's own CMake files hold, for this target: each library's
 * CMakeLists.txt and the PlatformJSCOnly.cmake it includes, evaluated
 * (../cmake.ts) with the variables the rest of WebKit's cmake would have set.
 * Those are the platform switches, the build options (the cmakeconfig.h table)
 * and the directories, which point into the layout above.
 */
function webkitLists(wk: WebKitBuild): WebKitLists {
  const { cfg } = wk;
  const flag = (name: string, set: boolean): Record<string, string> => (set ? { [name]: "ON" } : {});
  const variables: Record<string, string> = {
    PORT: "JSCOnly",
    CMAKE_SYSTEM_NAME: cfg.windows ? "Windows" : cfg.darwin ? "Darwin" : cfg.freebsd ? "FreeBSD" : "Linux",
    CMAKE_BUILD_TYPE: cfg.buildType,
    ...flag("WIN32", cfg.windows),
    ...flag("MSVC", cfg.windows),
    ...flag("UNIX", cfg.unix),
    ...flag("APPLE", cfg.darwin),
    ...flag("ANDROID", cfg.abi === "android"),
    ...flag("WTF_CPU_X86_64", cfg.x64),
    ...flag("WTF_CPU_ARM64", cfg.arm64),
    COMPILER_IS_GCC_OR_CLANG: "ON",
    LOWERCASE_EVENT_LOOP_TYPE: "bun",
    ...Object.fromEntries(buildOptions(cfg).map(([name, value]) => [name, String(value)])),
    CMAKE_BINARY_DIR: wk.B,
    BMALLOC_DIR: wk.BM,
    WTF_DIR: wk.WTF,
    WTF_DERIVED_SOURCES_DIR: wk.WTF_DS,
    JAVASCRIPTCORE_DIR: wk.JSC,
    JavaScriptCore_LIBRARY_TYPE: "STATIC",
    JavaScriptCore_DERIVED_SOURCES_DIR: wk.DS,
    JavaScriptCore_FRAMEWORK_HEADERS_DIR: wk.jscHeaders,
    JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS_DIR: wk.jscPrivateHeaders,
  };
  const library = (dir: string): LibraryLists => {
    const evaluated: CMakeEvaluation = evaluateCMake(join(dir, "CMakeLists.txt"), {
      variables: { ...variables, CMAKE_CURRENT_SOURCE_DIR: dir },
      includeMacros: { webkit_include_config_files_if_exists: "PlatformJSCOnly.cmake" },
    });
    // A set: cmake takes a file a list names twice (bmalloc's TZoneLog.cpp on macOS) once.
    return {
      paths: variable => [...new Set(evaluated.list(variable).map(p => resolve(dir, p)))],
      files: evaluated.files,
    };
  };
  return { bmalloc: library(wk.BM), wtf: library(join(wk.WTF, "wtf")), jsc: library(wk.JSC) };
}

// ─── The spec ───

function webkitBuildSpec(cfg: Config): DirectBuild {
  const wk = webkitLayout(cfg);
  assert(existsSync(join(wk.JSC, "Sources.txt")), `local WebKit checkout not found at ${wk.W}`, {
    hint: process.env.BUN_WEBKIT_PATH
      ? `$BUN_WEBKIT_PATH is set to '${process.env.BUN_WEBKIT_PATH}' but that path does not contain a WebKit checkout`
      : "Clone oven-sh/WebKit to vendor/WebKit/, or set $BUN_WEBKIT_PATH to an existing clone (useful for worktrees)",
  });
  const lists = webkitLists(wk);
  const flags = webkitFlags(wk);
  const icu = icuBuild(wk);
  const codegen = jscCodegenSteps(wk, lists.jsc);
  // All codegen must exist before any JSC TU compiles; after that the
  // depfiles know exactly which TU reads which header.
  const codegenReady = [...codegen.headers, ...codegen.sources, ...icu.outputs];
  const jsc = jscCompileFlags(wk, flags, lists.jsc);
  const wtf = wtfGroup(wk, flags, lists.wtf, icu.outputs);
  const llint = llintSteps(wk, jsc, lists.jsc, codegenReady);
  const jscSources = jscSourceList(wk, lists.jsc);

  return {
    kind: "direct",
    sources: [],
    headers: { "cmakeconfig.h": cmakeConfigHeader(cfg), ...frameworkHeaders(wk, lists) },
    groups: [
      bmallocGroup(wk, flags, lists.bmalloc),
      wtf.group,
      ...llint.groups,
      jscGroup(wk, jsc, jscSources.sources, codegenReady, llint.assembly),
    ],
    steps: wk.steps,
    libs: icu.libs,
    // What a consumer's compile waits for: JSC's generated headers (bun
    // includes them through the PrivateHeaders stubs), WTF's MIG stubs, and
    // ICU's headers where a step produces them.
    consumerOutputs: [...codegen.headers, ...wtf.migHeaders, ...icu.outputs],
    // A directory's mtime moves when a file is added to or removed from it.
    configureInputs: [
      ...lists.bmalloc.files,
      ...lists.wtf.files,
      ...lists.jsc.files,
      ...jscSources.listFiles,
      ...wk.listedDirs,
    ],
  };
}

/** Include dirs bun compiles against — the same set the prebuilt's include/ flattens together. */
function webkitLocalIncludes(cfg: Config): string[] {
  const wk = webkitLayout(cfg);
  return [
    wk.B,
    wk.jscHeaders,
    join(wk.jscHeaders, "JavaScriptCore"),
    wk.jscPrivateHeaders,
    join(wk.jscPrivateHeaders, "JavaScriptCore"),
    wk.bmallocHeaders,
    join(wk.bmallocHeaders, "bmalloc"),
    wk.WTF,
    ...icuIncludes(wk),
  ];
}

// ─── ICU ───
//
// Not built here. Linux uses the system's (headers on the default search
// path, -licu* in bun.ts). macOS links the SDK's libicucore, whose
// headers Apple does not ship: WebKit carries a matching set in Source/WTF/icu,
// used with symbol renaming off (OptionsJSCOnly.cmake / FindICU.cmake). Android
// has none: $BUN_ANDROID_ICU_ROOT names a static cross-built one (the NDK
// sysroot's unicode/ headers are __INTRODUCED_IN(31)-gated and unusable at API
// 28). Windows has none either: WebKit's build-icu.ps1 downloads ICU's source
// and runs msbuild, into the per-profile build dir.

const androidIcuRoot = (): string => process.env.BUN_ANDROID_ICU_ROOT ?? "/tmp/icu-android";
const windowsIcuDir = (wk: WebKitBuild): string => join(wk.B, "icu");

function icuIncludes(wk: WebKitBuild): string[] {
  const { cfg } = wk;
  if (cfg.darwin) return [join(wk.WTF, "icu")];
  if (cfg.windows) return [join(windowsIcuDir(wk), "include")];
  if (cfg.abi === "android") return [join(androidIcuRoot(), "include")];
  return [];
}

/** `libs` join bun's link; `outputs` are the ones a step of this graph produces, with ICU's headers as a side effect. */
function icuBuild(wk: WebKitBuild): { libs: string[]; outputs: string[] } {
  const { cfg } = wk;
  if (cfg.abi === "android") {
    return {
      libs: ["libicui18n.a", "libicuuc.a", "libicudata.a"].map(l => join(androidIcuRoot(), "lib", l)),
      outputs: [],
    };
  }
  if (!cfg.windows) return { libs: [], outputs: [] };
  const dir = windowsIcuDir(wk);
  const script = join(wk.W, "build-icu.ps1");
  const libs = ["sicudt.lib", "icuin.lib", "icuuc.lib"].map(l => join(dir, "lib", l));
  gen(wk, {
    outputs: libs,
    inputs: [script],
    cwd: wk.W,
    cmd: [
      // pwsh, which build.ts already runs under on Windows: Windows PowerShell
      // started from it inherits its PSModulePath and cannot load its own modules.
      "pwsh",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-Platform",
      cfg.x64 ? "x64" : "ARM64",
      "-BuildType",
      cfg.debug ? "Debug" : "Release",
      "-OutputDir",
      dir,
    ],
    desc: "ICU (build-icu.ps1)",
  });
  return { libs, outputs: libs };
}

// ─── Flags ───

/**
 * WebKitCompilerFlags.cmake's warning set for clang (COMPILER_IS_GCC_OR_CLANG,
 * clang-cl included): what it enables, what it turns off, and the two it
 * makes errors. -Wno-character-conversion is upstream's answer to clang 21's
 * new diagnostic pending https://bugs.webkit.org/show_bug.cgi?id=299689.
 */
const webkitWarningFlags: readonly string[] = [
  "-Wcast-align",
  "-Wformat-security",
  "-Wmissing-format-attribute",
  "-Wpointer-arith",
  "-Wundef",
  "-Qunused-arguments",
  "-Wno-parentheses-equality",
  "-Wno-misleading-indentation",
  "-Wno-psabi",
  "-Wno-nullability-completeness",
  "-Wno-tautological-compare",
  "-Werror=undefined-inline",
  "-Werror=undefined-internal",
  "-Wno-character-conversion",
];

function webkitFlags(wk: WebKitBuild): WebKitFlags {
  const { cfg, q, WTF } = wk;
  // WebKit's own additions on top of the dep-global flags
  // (WebKitCompilerFlags.cmake). The global -fno-[asynchronous-]unwind-tables
  // stand: the prebuilt is compiled that way too (its CMAKE_CXX_FLAGS come
  // last and carry them). The DWARF flags are WebKit's debug-info size
  // reductions; JSC's templates make them matter.
  const common = cfg.windows
    ? // clang-cl (OptionsMSVC.cmake): AT&T inline asm for the LLInt, no
      // buffer-security cookie opt-out, all EH off, no FP exceptions, no RTTI,
      // big object tables (unified sources), UTF-8 source, COMDAT folding
      // helpers (/Gw /Gy /GF come with the dep flags), inline dllexport off.
      [
        "-fno-strict-aliasing",
        "/clang:-fwrapv",
        "/clang:-masm=att",
        "/Zc:dllexportInlines-",
        "/GS",
        "/EHa-",
        "/EHc-",
        "/EHs-",
        "/fp:except-",
        "/GR-",
        "/analyze-",
        "/bigobj",
        "/utf-8",
        "/validate-charset",
        ...(cfg.release ? ["/Ob2"] : ["/Ob0", "/FS"]),
        // OptionsMSVC.cmake: /W4, before any -Wno-*. (Its /Wmicrosoft-include
        // fails cmake's flag probe under clang-cl and is dropped there, so it
        // is not part of the build.)
        "/W4",
        ...webkitWarningFlags,
        // config.h's `#include "JSExportMacros.h"` (and a few like it) name a
        // header in another JSC directory that the -I list resolves. clang-cl
        // tries MSVC's rule first — the directories of every file on the
        // include stack — and when the including .cpp happens to live in that
        // directory it finds the same file there and warns, once per TU.
        // JSC header names are unique (they flatten into one framework
        // directory), so the MSVC rule can never pick a different file here.
        "-Wno-microsoft-include",
      ]
    : [
        "-fno-strict-aliasing",
        "-fwrapv",
        // WebKitCompilerFlags.cmake's diagnostics for gcc/clang (-Wall -Wextra
        // first: enables precede the -Wno-* that trim them).
        "-Wall",
        "-Wextra",
        ...webkitWarningFlags,
        "-gsimple-template-names",
        "-mllvm",
        "-dwarf-linkage-names=Abstract",
        ...(cfg.darwin ? [] : ["-fdebug-types-section"]),
        // ASAN: keep tail-call frames (WebKitCompilerFlags.cmake does the same),
        // so LeakSanitizer's allocation stacks — and test/leaksan.supp, which
        // matches JSC frames by name — see every caller.
        ...(cfg.asan ? ["-fno-optimize-sibling-calls"] : []),
        // musl: optimized for size (-Os wins over the dep-global -O level), as
        // the Alpine builds have always shipped JSC.
        ...(cfg.abi === "musl" && cfg.release ? ["-Os"] : []),
      ];
  // Release: WebKit's <iostream> ban (an #error stub found before the real
  // header — OptionsJSCOnly.cmake), so no TU drags std::ios_base::Init in.
  const bannedIncludes = cfg.debug ? [] : [`-I${q(join(WTF, "wtf", "bun", "BannedIncludes"))}`];
  // -Wno-noexcept-type: WebKitCompilerFlags.cmake, C++ only.
  const cxx = [...bannedIncludes, cfg.windows ? "/clang:-std=c++23" : "-std=c++23", "-Wno-noexcept-type"];
  const icuFlags = [
    ...(cfg.darwin ? ["-DU_DISABLE_RENAMING=1"] : cfg.windows ? ["-DU_STATIC_IMPLEMENTATION=1"] : []),
    ...icuIncludes(wk).map(i => `-I${q(i)}`),
  ];
  const commonDefines = [
    "-DBUILDING_JSCONLY__",
    "-DBUILDING_WEBKIT",
    "-DBUILDING_WITH_CMAKE",
    "-DHAVE_CONFIG_H",
    "-DPAS_BMALLOC=1",
    // bmalloc's BEXPORT is __declspec(dllexport) on Windows even in a static
    // build (BPlatform.h lacks the !USE(BUN_JSC_ADDITIONS) carve-out WTF's
    // ExportMacros.h has), which leaked bmalloc::api::* and libpas' g_config
    // out of bun.exe's export table. BExport.h honours a predefined BEXPORT.
    ...(cfg.windows ? ["-DBEXPORT="] : []),
    // WebKit's USE_CXX_STDLIB_ASSERTIONS default: the standard library's own
    // hardening (libstdc++ on gnu/musl, libc++ on the other unixes).
    ...(cfg.windows
      ? []
      : cfg.linux && cfg.abi !== "android"
        ? ["-D_GLIBCXX_ASSERTIONS=1"]
        : ["-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE"]),
    // Windows (OptionsMSVC.cmake / OptionsJSCOnly.cmake): Win10 API level,
    // wide-char APIs, lean windows.h (no wincrypt, no min/max, no winsock1),
    // MSVC STL without exceptions, CRT deprecation noise off.
    ...(cfg.windows
      ? [
          "-DUNICODE",
          "-D_UNICODE",
          "-D_WINDOWS",
          "-DNOMINMAX",
          "-DNOCRYPT",
          "-D_WINSOCKAPI_=",
          "-D_WIN32_WINNT=0x0A00",
          "-DNTDDI_VERSION=0x0A000006",
          "-D_HAS_EXCEPTIONS=0",
          "-D_ENABLE_EXTENDED_ALIGNED_STORAGE",
          "-D_CRT_SECURE_NO_WARNINGS",
          "-D_CRT_NONSTDC_NO_DEPRECATE",
          "-D_SILENCE_CXX23_DENORM_DEPRECATION_WARNING",
        ]
      : []),
    ...(cfg.assertions ? ["-DASSERT_ENABLED=1"] : []),
  ];
  // Consumers see both <bmalloc/X.h> and the bare "X.h" siblings bmalloc's
  // own headers include (libpas headers, mimalloc.h) — cmake gets the latter
  // from physically flattening copies into one dir.
  const bmallocConsumerIncludes = [wk.bmallocHeaders, join(wk.bmallocHeaders, "bmalloc")];
  return { common, cxx, commonDefines, icuFlags, bmallocConsumerIncludes };
}

// ─── Framework headers ───

/**
 * The flattened <bmalloc/X.h> / <JavaScriptCore/X.h> directories cmake fills
 * by copying or symlinking each framework header, so `<JavaScriptCore/X.h>`
 * works from any subdirectory; here one-line `#include` forwarding stubs into
 * the source tree (and, for the generated headers cmake lists in
 * JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS, into DerivedSources), so
 * <JavaScriptCore/X.h> resolves the same set of names as against the
 * prebuilt's include/JavaScriptCore. Returned as `headers` entries (paths
 * relative to the dep build dir); the compiler's depfile then names the real
 * header too.
 */
function frameworkHeaders(wk: WebKitBuild, lists: WebKitLists): Record<string, string> {
  const entries: Record<string, string> = {};
  const forward = (dir: string, headers: string[]): void => {
    for (const h of headers) {
      entries[relative(wk.B, join(dir, basename(h)))] = `#include "${h.replaceAll("\\", "/")}"\n`;
    }
  };
  forward(
    join(wk.bmallocHeaders, "bmalloc"),
    [...lists.bmalloc.paths("bmalloc_PUBLIC_HEADERS"), ...lists.bmalloc.paths("bmalloc_PRIVATE_HEADERS")].map(h =>
      bunMimalloc(wk, h),
    ),
  );
  forward(join(wk.jscHeaders, "JavaScriptCore"), lists.jsc.paths("JavaScriptCore_PUBLIC_FRAMEWORK_HEADERS"));
  forward(join(wk.jscPrivateHeaders, "JavaScriptCore"), lists.jsc.paths("JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS"));
  return entries;
}

// ─── bmalloc ───

/** bmalloc's lists name WebKit's vendored copy of mimalloc; JSC is linked with bun's (USE_EXTERNAL_MIMALLOC), so that one's headers stand in. */
function bunMimalloc(wk: WebKitBuild, path: string): string {
  const vendored = join(wk.BM, "mimalloc", "mimalloc");
  return path.startsWith(vendored) ? join(depSourceDir(wk.cfg, "mimalloc"), relative(vendored, path)) : path;
}

function bmallocGroup(wk: WebKitBuild, flags: WebKitFlags, lists: LibraryLists): SourceGroup {
  const { cfg, B } = wk;
  return {
    name: "bmalloc",
    // bmalloc_SOURCES lists a few libpas .c files that cmake compiles as C++;
    // the rest of libpas is C.
    sources: [
      ...lists.paths("bmalloc_SOURCES").map(path => (path.endsWith(".c") ? { path, lang: "cxx" as const } : path)),
      ...lists.paths("bmalloc_C_SOURCES"),
    ],
    includes: [B, ...lists.paths("bmalloc_PRIVATE_INCLUDE_DIRECTORIES").map(dir => bunMimalloc(wk, dir))],
    cflags: [
      ...flags.common,
      ...flags.commonDefines,
      "-DBUILDING_bmalloc",
      "-D_GNU_SOURCE",
      // bmalloc's own TUs never see cmakeconfig.h (BPlatform.h reads -D's).
      ...(usesMimalloc(cfg) ? ["-DUSE_MIMALLOC=1"] : []),
      "-Wno-cast-align",
      "-Wno-missing-field-initializers",
      // libpas' 16-byte CAS on x64 (bmalloc/CMakeLists.txt, MSVC branch; the
      // unix -march levels already imply it).
      ...(cfg.windows && cfg.x64 ? ["-mcx16"] : []),
    ],
    cxxflags: flags.cxx,
  };
}

// ─── WTF ───

function wtfGroup(
  wk: WebKitBuild,
  flags: WebKitFlags,
  lists: LibraryLists,
  icuOutputs: string[],
): { group: SourceGroup; migHeaders: string[] } {
  const { cfg, WTF, WTF_DS } = wk;
  // macOS: WTF's signal handling (wasm fault trapping, VM traps) speaks Mach
  // exceptions through MIG-generated RPC stubs (PlatformJSCOnly.cmake's APPLE
  // branch, which also puts the two .c files in WTF_SOURCES).
  const migOutputs: string[] = [];
  if (cfg.darwin) {
    assert(cfg.osxSysroot !== undefined, "darwin target without a macOS SDK path");
    const defs = join(WTF, "wtf", "mac", "MachExceptions.defs");
    migOutputs.push(
      join(WTF_DS, "MachExceptionsServer.h"),
      join(WTF_DS, "mach_exc.h"),
      join(WTF_DS, "mach_excServer.c"),
      join(WTF_DS, "mach_excUser.c"),
    );
    gen(wk, {
      outputs: migOutputs,
      inputs: [defs],
      cwd: WTF_DS,
      cmd: [
        "xcrun",
        "mig",
        "-header",
        "mach_exc.h",
        "-user",
        "mach_excUser.c",
        "-sheader",
        "MachExceptionsServer.h",
        "-server",
        "mach_excServer.c",
        "-DMACH_EXC_SERVER_TASKIDTOKEN_STATE",
        "-isysroot",
        cfg.osxSysroot,
        defs,
      ],
      desc: "mig MachExceptions.defs",
    });
  }
  return {
    group: {
      name: "WTF",
      // Without the Objective-C++ (darwin/OSLogPrintStream.mm): only code under
      // PLATFORM(COCOA) refers to it, never the JSCOnly port. In libWTF.a it is a
      // member nothing pulls in; a native macOS link takes every object, and this
      // one is ARC, so it would need the Objective-C runtime for nothing.
      sources: lists.paths("WTF_SOURCES").filter(s => !s.endsWith(".mm")),
      includes: [...lists.paths("WTF_PRIVATE_INCLUDE_DIRECTORIES"), ...flags.bmallocConsumerIncludes],
      cflags: [
        ...flags.common,
        ...flags.commonDefines,
        "-DBUILDING_WTF",
        "-DSTATICALLY_LINKED_WITH_bmalloc",
        ...flags.icuFlags,
      ],
      cxxflags: flags.cxx,
      orderOnly: [...migOutputs, ...icuOutputs],
    },
    migHeaders: migOutputs.filter(f => f.endsWith(".h")),
  };
}

// ─── JavaScriptCore: codegen ───

/**
 * Every DerivedSources generator except the LLInt chain (which needs the
 * compiled extractors). `headers` and `sources` are what any JSC TU may
 * include — generated .cpp files are #included from unified bundles too —
 * so both gate the JSC compiles.
 */
function jscCodegenSteps(wk: WebKitBuild, lists: LibraryLists): { headers: string[]; sources: string[] } {
  const { cfg, JSC, WTF, DS, python } = wk;
  const headers: string[] = [];
  const sources: string[] = [];

  // LUT tables (create_hash_table, perl).
  const hashLut = join(JSC, "create_hash_table");
  for (const src of lists.paths("JavaScriptCore_OBJECT_LUT_SOURCES")) {
    const out = join(DS, `${basename(src).replace(/\.[^.]+$/, "")}.lut.h`);
    genStdout(wk, out, [perl, hashLut, src], [hashLut, src], `lut ${basename(out)}`);
    headers.push(out);
  }
  {
    const out = join(DS, "Lexer.lut.h");
    const table = join(JSC, "parser", "Keywords.table");
    genStdout(wk, out, [perl, hashLut, table], [hashLut, table], "lut Lexer.lut.h");
    headers.push(out);
  }

  // Bytecodes.
  gen(wk, {
    outputs: [
      "Bytecodes.h",
      "InitBytecodes.asm",
      "BytecodeStructs.h",
      "BytecodeIndices.h",
      "BytecodeDumperGenerated.cpp",
    ].map(f => join(DS, f)),
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
    inputs: [join(JSC, "bytecode", "BytecodeList.rb"), join(JSC, "wasm", "wasm.json"), ...lists.paths("GENERATOR")],
    desc: "Bytecodes",
  });
  headers.push(join(DS, "Bytecodes.h"), join(DS, "BytecodeStructs.h"), join(DS, "BytecodeIndices.h"));
  sources.push(join(DS, "BytecodeDumperGenerated.cpp"));

  // Air opcodes (writes into cwd).
  gen(wk, {
    outputs: [join(DS, "AirOpcode.h"), join(DS, "AirOpcodeGenerated.h")],
    implicitOutputs: [join(DS, "AirOpcodeUtils.h")],
    cmd: [ruby, join(JSC, "b3", "air", "opcode_generator.rb"), join(JSC, "b3", "air", "AirOpcode.opcodes")],
    inputs: [join(JSC, "b3", "air", "opcode_generator.rb"), join(JSC, "b3", "air", "AirOpcode.opcodes")],
    desc: "AirOpcode",
  });
  headers.push(join(DS, "AirOpcode.h"), join(DS, "AirOpcodeGenerated.h"), join(DS, "AirOpcodeUtils.h"));

  // Keyword lookup, lexer/yarr unicode tables, regex tables.
  genStdout(
    wk,
    join(DS, "KeywordLookup.h"),
    [python, join(JSC, "KeywordLookupGenerator.py"), join(JSC, "parser", "Keywords.table")],
    [join(JSC, "KeywordLookupGenerator.py"), join(JSC, "parser", "Keywords.table")],
    "KeywordLookup.h",
  );
  headers.push(join(DS, "KeywordLookup.h"));
  {
    const script = join(JSC, "parser", "generateLexerUnicodePropertyTables.py");
    const out = join(DS, "LexerUnicodePropertyTables.h");
    gen(wk, {
      outputs: [out],
      cmd: [python, script, join(JSC, "ucd", "UnicodeData.txt"), out],
      inputs: [script, join(JSC, "ucd", "UnicodeData.txt")],
      desc: "LexerUnicodePropertyTables.h",
    });
    headers.push(out);
  }
  {
    const script = join(JSC, "yarr", "create_regex_tables");
    const out = join(DS, "yarr", "RegExpJitTables.h");
    gen(wk, { outputs: [out], cmd: [python, script, out], inputs: [script], desc: "RegExpJitTables.h" });
    headers.push(out);
  }
  {
    const script = join(JSC, "yarr", "generateYarrUnicodePropertyTables.py");
    const out = join(DS, "yarr", "UnicodePatternTables.h");
    const ucd = join(JSC, "ucd");
    gen(wk, {
      outputs: [out],
      cmd: [python, script, ucd, out],
      inputs: [script, join(JSC, "yarr", "hasher.py"), ...filesIn(wk, ucd)],
      desc: "UnicodePatternTables.h",
    });
    headers.push(out);
  }
  {
    const script = join(JSC, "yarr", "generateYarrCanonicalizeUnicode");
    const out = join(DS, "yarr", "YarrCanonicalizeUnicode.cpp");
    gen(wk, {
      outputs: [out],
      cmd: [python, script, join(JSC, "ucd", "CaseFolding.txt"), out],
      inputs: [script, join(JSC, "ucd", "CaseFolding.txt")],
      desc: "YarrCanonicalizeUnicode.cpp",
    });
    sources.push(out);
  }

  // Wasm generators.
  for (const [scriptName, outName] of [
    ["generateWasmOpsHeader.py", "WasmOps.h"],
    ["generateWasmOMGIRGeneratorInlinesHeader.py", "WasmOMGIRGeneratorInlines.h"],
  ] as const) {
    const script = join(JSC, "wasm", scriptName);
    const out = join(DS, outName);
    gen(wk, {
      outputs: [out],
      cmd: [python, script, join(JSC, "wasm", "wasm.json"), out],
      inputs: [script, join(JSC, "wasm", "generateWasm.py"), join(JSC, "wasm", "wasm.json")],
      desc: outName,
    });
    headers.push(out);
  }

  // JS builtins.
  {
    const scriptsDir = join(JSC, "Scripts");
    const builtins = lists.paths("JavaScriptCore_BUILTINS_SOURCES");
    gen(wk, {
      outputs: [join(DS, "JSCBuiltins.cpp"), join(DS, "JSCBuiltins.h")],
      cmd: [
        python,
        join(scriptsDir, "generate-js-builtins.py"),
        "--framework",
        "JavaScriptCore",
        "--output-directory",
        DS,
        "--combined",
        ...builtins,
      ],
      inputs: [...builtins, ...filesIn(wk, scriptsDir, ".py"), ...filesIn(wk, join(scriptsDir, "wkbuiltins"), ".py")],
      desc: "JSCBuiltins",
    });
    headers.push(join(DS, "JSCBuiltins.h"));
    // JSCBuiltins.cpp is compiled via JavaScriptCore_SOURCES (cmake appends it there).
    sources.push(join(DS, "JSCBuiltins.cpp"));
  }

  // Inspector protocol.
  {
    const scriptsDir = join(JSC, "Scripts");
    const combined = join(DS, "CombinedDomains.json");
    const domains = lists.paths("JavaScriptCore_INSPECTOR_DOMAINS");
    gen(wk, {
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
    gen(wk, {
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
      inputs: [combined, ...lists.paths("JavaScriptCore_INSPECTOR_PROTOCOL_SCRIPTS")],
      desc: "InspectorProtocolBindings",
    });
    headers.push(...outputs.filter(f => f.endsWith(".h")));
    sources.push(...outputs.filter(f => f.endsWith(".cpp")));
  }

  // JSCWebPreferenceOptions.h (from WTF's unified preferences yaml).
  {
    const script = join(WTF, "Scripts", "GeneratePreferences.rb");
    const yaml = join(WTF, "Scripts", "Preferences", "UnifiedWebPreferences.yaml");
    const template = join(JSC, "Scripts", "PreferencesTemplates", "JSCWebPreferenceOptions.h.erb");
    const out = join(DS, "JSCWebPreferenceOptions.h");
    gen(wk, {
      outputs: [out],
      cmd: [ruby, script, "--frontend", "JavaScriptCore", "--outputDir", DS, "--template", template, yaml],
      inputs: [script, yaml, template],
      desc: "JSCWebPreferenceOptions.h",
    });
    headers.push(out);
  }

  return { headers, sources };
}

// ─── JavaScriptCore: compile flags ───

interface JSCCompileFlags {
  includes: string[];
  /** C-and-C++ flags for JSC TUs, without the BUILDING_ define — the extractors and testFFI name their own target. */
  targetFlags: string[];
  cxx: string[];
}

function jscCompileFlags(wk: WebKitBuild, flags: WebKitFlags, lists: LibraryLists): JSCCompileFlags {
  const { cfg, WTF } = wk;
  // clang-cl only maps a subset of GNU -f options; the rest go through /clang:.
  const clangOpt = (f: string) => (cfg.windows ? `/clang:${f}` : f);
  return {
    includes: [
      ...lists.paths("JavaScriptCore_INCLUDE_DIRECTORIES"),
      ...lists.paths("JavaScriptCore_PRIVATE_INCLUDE_DIRECTORIES"),
      WTF, // <wtf/X.h> straight from the source tree (cmake copies to WTF/Headers)
      ...flags.bmallocConsumerIncludes,
    ],
    // What JSC's CMakeLists adds for every TU of the JavaScriptCore target,
    // C and C++ alike: no FP contraction (a*b+c must round twice, as the JIT
    // and every other platform do, never fuse into an FMA), no SLP vectorizer
    // (clang workaround WebKit carries), the static-link export-macro
    // switches. Spelled through /clang: for clang-cl, which otherwise ignores
    // both with a warning (cmake's flag probe dropped them there, so the
    // Windows prebuilt never had them; on arm64 that meant FMA contraction).
    targetFlags: [
      ...flags.common,
      clangOpt("-ffp-contract=off"),
      clangOpt("-fno-slp-vectorize"),
      ...flags.commonDefines,
      "-DSTATICALLY_LINKED_WITH_WTF",
      "-DSTATICALLY_LINKED_WITH_bmalloc",
      ...flags.icuFlags,
    ],
    cxx: flags.cxx,
  };
}

/** ld flags for WebKit's own executables that reference bun-provided hooks. */
function standaloneExeLinkFlags(cfg: Config): string[] {
  // Hooks bun's runtime provides to WTF/JSC. WebKit's own executables leave them undefined: ld64 needs
  // that spelled out per symbol (WebKitCompilerFlags.cmake, USE_BUN_EVENT_LOOP).
  const bunHooks = [
    "WTFTimer__create",
    "WTFTimer__update",
    "WTFTimer__deinit",
    "WTFTimer__isActive",
    "WTFTimer__secondsUntilTimer",
    "WTFTimer__cancel",
    "Bun__thisThreadHasVM",
    "Bun__reportUnhandledError",
  ];
  // Windows: WTF's registry/shell/token calls (LanguageWin, FileSystemWin,
  // OSAllocatorWin) — bun's own link gets these through its delay-load set —
  // and /lld-allow-duplicate-weak for the hooks' COFF weak externals, same
  // as bun's own link (flags.ts has the explanation); with no definition at
  // all they resolve to the absolute-0 default, the hook-absent value a
  // standalone test binary wants.
  return cfg.darwin
    ? bunHooks.map(sym => `-Wl,-U,_${sym}`)
    : cfg.windows
      ? ["advapi32.lib", "shell32.lib", "user32.lib", "/lld-allow-duplicate-weak"]
      : [];
}

// ─── JavaScriptCore: LLInt ───

/**
 * settings extractor exe → LLIntDesiredOffsets.h → offsets extractor exe →
 * LLIntAssembly.h, each step parsed by offlineasm (ruby): three generator
 * steps, two single-file source groups and two target executables. Returns
 * the groups and LLIntAssembly.h, the implicit input of LowLevelInterpreter.cpp.
 */
function llintSteps(
  wk: WebKitBuild,
  jsc: JSCCompileFlags,
  lists: LibraryLists,
  codegenReady: string[],
): { groups: SourceGroup[]; assembly: string } {
  const { cfg, JSC, DS, binDir } = wk;
  const offlineasm = join(JSC, "offlineasm");
  const llintAsmFiles = lists.paths("LLINT_ASM");
  const offlineAsmRb = lists.paths("OFFLINE_ASM");
  const lowLevelInterpreterAsm = join(JSC, "llint", "LowLevelInterpreter.asm");
  const backend = cfg.x64 ? "X86_64" : "ARM64";
  // asm.rb only (OFFLINE_ASM_FORMAT_ARGS); the two extractor generators take
  // just the backend. --binary-format=ELF makes asm.rb emit .type/.size for
  // each opcode label; those pair with the plain (non-.L) debug labels
  // LowLevelInterpreter.cpp only defines under OS(LINUX), so it is Linux/
  // Android only — as in JSC's CMakeLists (CMAKE_SYSTEM_NAME MATCHES Linux).
  const offlineAsmFormatArgs = cfg.linux ? ["--binary-format=ELF"] : cfg.windows ? ["--platform=Windows"] : [];
  const buildVariants = "normal";
  const extractorGroup = (name: string, src: string, header: string): SourceGroup => ({
    name: `${name}-obj`,
    sources: [{ path: src, implicitInputs: [header] }],
    includes: jsc.includes,
    cflags: [...jsc.targetFlags, `-DBUILDING_${name}`],
    cxxflags: jsc.cxx,
    orderOnly: codegenReady,
    link: false,
  });

  const llintDesiredSettings = join(DS, "LLIntDesiredSettings.h");
  gen(wk, {
    outputs: [llintDesiredSettings],
    cmd: [
      ruby,
      join(offlineasm, "generate_settings_extractor.rb"),
      `-I${DS}/`,
      lowLevelInterpreterAsm,
      llintDesiredSettings,
      backend,
    ],
    inputs: [...llintAsmFiles, ...offlineAsmRb, join(DS, "InitBytecodes.asm")],
    desc: "LLIntDesiredSettings.h",
  });
  // LLIntSettingsExtractor: target executable, parsed (not run) by offlineasm.
  const settingsExe = join(binDir, `LLIntSettingsExtractor${cfg.exeSuffix}`);
  wk.steps.push({
    kind: "exe",
    output: join(binDir, "LLIntSettingsExtractor"),
    objectsFrom: ["LLIntSettingsExtractor-obj"],
  });

  const llintDesiredOffsets = join(DS, "LLIntDesiredOffsets.h");
  gen(wk, {
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
      ...llintAsmFiles,
      ...offlineAsmRb,
      join(DS, "InitBytecodes.asm"),
      join(DS, "AirOpcode.h"),
      join(DS, "WasmOps.h"),
    ],
    desc: "LLIntDesiredOffsets.h",
  });
  const offsetsExe = join(binDir, `LLIntOffsetsExtractor${cfg.exeSuffix}`);
  wk.steps.push({
    kind: "exe",
    output: join(binDir, "LLIntOffsetsExtractor"),
    objectsFrom: ["LLIntOffsetsExtractor-obj"],
  });

  const llintAssembly = join(DS, "LLIntAssembly.h");
  gen(wk, {
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
    inputs: [offsetsExe, ...llintAsmFiles, ...offlineAsmRb, join(DS, "InitBytecodes.asm")],
    env: { CMAKE_CXX_COMPILER_ID: "Clang", GCC_OFFLINEASM_SOURCE_MAP: "OFF" },
    desc: "LLIntAssembly.h",
  });
  return {
    groups: [
      extractorGroup("LLIntSettingsExtractor", join(JSC, "llint", "LLIntSettingsExtractor.cpp"), llintDesiredSettings),
      extractorGroup("LLIntOffsetsExtractor", join(JSC, "llint", "LLIntOffsetsExtractor.cpp"), llintDesiredOffsets),
    ],
    assembly: llintAssembly,
  };
}

// ─── JavaScriptCore: sources ───

/**
 * JSC's translation units: WebKit's unified-source bundler run over the
 * Sources.txt lists (WEBKIT_COMPUTE_SOURCES), plus JavaScriptCore_SOURCES.
 */
function jscSourceList(wk: WebKitBuild, lists: LibraryLists): { sources: string[]; listFiles: string[] } {
  const { JSC, WTF, DS, python } = wk;
  const listFiles = lists.paths("JavaScriptCore_UNIFIED_SOURCE_LIST_FILES");
  const bundler = join(WTF, "Scripts", "generate-unified-source-bundles.py");
  mkdirSync(DS, { recursive: true });
  const bundled = spawnSync(
    python,
    [bundler, "--derived-sources-path", DS, "--source-tree-path", JSC, "--ignore-header-groups", ...listFiles],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  if (bundled.error) {
    throw new BuildError(`Could not run ${python} for WebKit's unified source bundling`, { cause: bundled.error });
  }
  if (bundled.status !== 0) {
    throw new BuildError(`generate-unified-source-bundles.py failed:\n${bundled.stderr}`, { file: bundler });
  }
  // It prints a cmake list: the bundle files (absolute) and the @no-unify
  // members, relative to the source tree or bare names of generated sources in
  // DerivedSources. Sources.txt carries a few headers too.
  const sources = bundled.stdout
    .split(";")
    .filter(s => /\.(cpp|c)$/.test(s))
    .map(s => (isAbsolute(s) ? s : !/[\\/]/.test(s) && !existsSync(join(JSC, s)) ? join(DS, s) : join(JSC, s)));
  return { sources: [...sources, ...lists.paths("JavaScriptCore_SOURCES")], listFiles: [...listFiles, bundler] };
}

function jscGroup(
  wk: WebKitBuild,
  jsc: JSCCompileFlags,
  sources: string[],
  codegenReady: string[],
  llintAssembly: string,
): SourceGroup {
  const { cfg, JSC } = wk;
  // Windows ARM64: the alignment directives in these files' inline asm break
  // LLVM's SEH unwind-info emission (llvm.org/pr47432), so JSC's CMakeLists
  // builds them without unwind tables. (ThunkGenerators.cpp is listed there
  // too but is always inside a unified bundle, where the property never
  // applied.)
  const noUnwindTables = (src: string): string[] =>
    cfg.windows && cfg.arm64 && ["MacroAssemblerARM64.cpp", "LowLevelInterpreter.cpp"].includes(basename(src))
      ? ["/clang:-fno-unwind-tables"]
      : [];
  return {
    name: "JavaScriptCore",
    sources: [
      ...sources.map(path => {
        const extra = noUnwindTables(path);
        return extra.length > 0 ? { path, cflags: extra } : path;
      }),
      // LowLevelInterpreter.cpp: the inline-asm interpreter (includes
      // LLIntAssembly.h). Its own settings, like cmake's LowLevelInterpreterLib:
      // no PCH, and an implicit dep on the generated assembly. Debug: -O1
      // (after the global -O0) keeps the IPInt instruction handlers within
      // their aligned slots, as JSC's CMakeLists does for this file under
      // COMPILER_IS_GCC_OR_CLANG (so not for clang-cl).
      {
        path: join(JSC, "llint", "LowLevelInterpreter.cpp"),
        cflags: [...(cfg.debug && !cfg.windows ? ["-O1"] : []), ...noUnwindTables("LowLevelInterpreter.cpp")],
        implicitInputs: [llintAssembly],
        noPch: true,
      },
    ],
    includes: jsc.includes,
    cflags: [...jsc.targetFlags, "-DBUILDING_JavaScriptCore"],
    cxxflags: jsc.cxx,
    pch: join(JSC, "JavaScriptCorePrefix.h"),
    orderOnly: codegenReady,
  };
}

// ─── Standalone programs ───

export interface JSCProgram {
  /** The executable's name, and its ninja target. */
  name: string;
  sources: string[];
  cxxflags: string[];
  ldflags: string[];
}

/**
 * WebKit's own executables worth having beside a local build
 * (shell/CMakeLists.txt): the `jsc` shell, and `testFFI`, JSC's bun:ffi C++/ABI
 * test program, which test/js/bun/jsc-stress/testFFI.test.ts runs. bun.ts links
 * them, from the same dep objects bun gets, so this only says how: the sources,
 * the flags a JSC-family TU compiles with, and what a standalone JSC executable
 * needs at link. Neither is a default target: `bun run build:local --target=jsc`.
 */
export function jscPrograms(cfg: Config): JSCProgram[] {
  if (cfg.webkit !== "local") return [];
  const wk = webkitLayout(cfg);
  const jsc = jscCompileFlags(wk, webkitFlags(wk), webkitLists(wk).jsc);
  const program = (name: string, sources: string[], ldflags: string[]): JSCProgram => ({
    name,
    sources: sources.map(s => join(wk.JSC, s)),
    cxxflags: groupCompileFlags(cfg, wk.W, {
      includes: jsc.includes,
      cflags: [...jsc.targetFlags, `-DBUILDING_${name}`, "-DSTATICALLY_LINKED_WITH_JavaScriptCore"],
      cxxflags: jsc.cxx,
    }).cxx,
    ldflags: [...standaloneExeLinkFlags(cfg), ...ldflags],
  });
  return [
    program("jsc", ["jsc.cpp", "tools/JSDollarVMShell.cpp"], cfg.darwin ? ["-ledit"] : []),
    program("testFFI", ["ffi/tests/testFFI.cpp"], []),
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// The Dependency
// ───────────────────────────────────────────────────────────────────────────

export const webkit: Dependency = {
  name: "WebKit",
  versionMacro: "WEBKIT",
  // Local mode compiles against the mimalloc bun links (USE_EXTERNAL_MIMALLOC).
  fetchDeps: ["mimalloc"],

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

    // Never fetched: config.ts gives local mode a `localDeps` entry, which
    // redirects this to the checkout like any `--local-deps` dep.
    return { kind: "github-archive", repo: "oven-sh/WebKit", commit: cfg.webkitVersion };
  },

  build: cfg => (cfg.webkit === "prebuilt" ? { kind: "none" } : webkitBuildSpec(cfg)),

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

    // The objects go straight on the link line; consumers see the framework
    // header dirs and generated headers under the dep build dir.
    return { libs: [], includes: webkitLocalIncludes(cfg) };
  },
};
