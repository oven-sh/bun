/**
 * WebKit commit — the tree the build fetches and compiles (and the
 * prebuilt tarball's release tag). Override via `--webkit-version=<hash>` to test a
 * branch. From https://github.com/oven-sh/WebKit releases.
 */
export const WEBKIT_VERSION = "2e2aa2290fac856d6f451ceacb58f7f5b44dd057";

/**
 * WebKit (JavaScriptCore) — the JS engine, with WTF and bmalloc.
 *
 * Two modes via `cfg.webkit`:
 *
 * **source** (the default, and what CI ships on every target): built like
 *   every other dep. The fetch edge downloads WEBKIT_VERSION
 *   into `vendor/WebKit/` — a sparse git fetch of just
 *   Source/{bmalloc,WTF,JavaScriptCore} (~35 MB over the wire instead of a
 *   12 GB clone) — and compiles it in our own ninja graph, no cmake ("Source
 *   mode: direct build" below). Generated headers land in the BUILD dir. To
 *   build your own WebKit clone instead of the pinned commit, point at it
 *   like any dep: `--local-deps=WebKit=<path>` (`bun run build:local` passes
 *   `--local-deps=WebKit`, shorthand for `$BUN_WEBKIT_PATH`).
 *
 * **prebuilt** (explicit `--webkit=prebuilt` only): download the tarball
 *   oven-sh/WebKit's release workflow publishes for WEBKIT_VERSION instead of
 *   compiling. Tarball name encodes {os, arch, musl, debug|lto, asan} — each
 *   is a separate ABI. ASAN MUST match bun's setting: WTF::Vector layout
 *   changes with ASAN (see WTF/Vector.h:682), so mixing → silent memory
 *   corruption.
 */

import { mkdirSync, rmSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { modeCompilesCpp, type Config } from "../config.ts";
import { assert } from "../error.ts";
import { writeIfChanged } from "../fs.ts";
import { quote } from "../shell.ts";
import {
  depBuildDir,
  depSourceDir,
  groupCompileFlags,
  type Dependency,
  type DirectBuild,
  type DirectStep,
  type Source,
  type SourceGroup,
} from "../source.ts";
import { migcomPath } from "./bootstrap-cmds.ts";
import { buildsIcu, icuIncludes } from "./icu.ts";
import { bmallocCSources, bmallocFrameworkHeaders, bmallocSources } from "./webkit-bmalloc-sources.ts";
import { watchedFiles as cmakeWatchedFiles } from "./webkit-check-cmake.ts";
import { jscExtraSourcesFor, jscInspectorDomains, jscInspectorScripts } from "./webkit-inspector-sources.ts";
import {
  jscBuiltinsScripts,
  jscBuiltinsSources,
  jscGeneratorRuby,
  jscIncludeDirs,
  jscLutSources,
  jscNonUnifiedSources,
  jscPrivateHeaders,
  jscPublicHeaders,
  jscUcdFiles,
  jscUnifiedBundles,
} from "./webkit-jsc-sources.ts";
import { jscOfflineasmRuby, llintAsm } from "./webkit-llint-sources.ts";
import { wtfIncludeDirs, wtfSourcesCommon, wtfSourcesFor } from "./webkit-wtf-sources.ts";

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

/**
 * WebKit's post-link canary that no two JSC ClassInfo (`s_info`) objects were
 * folded to one address by LTO/ICF — JSC compares types by s_info pointer, so
 * a fold is a silent miscompile. The fork's own build runs it on its `jsc`
 * shell; run on bun itself it checks the link that actually ships. Source
 * mode only (the script comes with the fetched tree).
 */
export function webkitClassInfoCheckScript(cfg: Config): string | undefined {
  // ELF/Mach-O symbol tables only (a PE keeps its symbols in the PDB), and
  // only in the modes that fetch and compile WebKit (the script is in its tree).
  if (cfg.webkit !== "source" || cfg.windows || !modeCompilesCpp(cfg.mode)) return undefined;
  return join(depSourceDir(cfg, "WebKit"), "Tools", "Scripts", "check-classinfo-uniqueness.py");
}

/** JSC's testFFI executable: built next to bun (bun.ts) in source mode; the prebuilt tarball ships one in bin/. */
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

/**
 * The part of the WebKit tree `source` mode fetches (git sparse-checkout
 * patterns, anchored at the repo root): the three libraries the direct build
 * compiles.
 */
const sourceSparse = [
  "/Source/bmalloc/",
  "/Source/WTF/",
  "/Source/JavaScriptCore/",
  // Not built from — read by webkit-check-cmake.ts, which guards this file's
  // transcription of WebKit's options and compiler flags.
  "/Source/cmake/",
  "/Tools/Scripts/check-classinfo-uniqueness.py",
  // The fork's Linux-hosted `mig` driver + the mach stub headers its host
  // migcom build needs (macOS targets: WTF's Mach exception RPC stubs).
  "/macos-cross/",
];

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
// android, freebsd, macOS and Windows; entries whose value depends on the target are
// functions (`probe` rows are the header/function checks, which cmake does
// not run for Apple targets). When adding a platform, diff its prebuilt's
// cmakeconfig.h against this and make the differing rows conditional — do
// not fork the table.
// ───────────────────────────────────────────────────────────────────────────

const on = (b: boolean): number => (b ? 1 : 0);
/** bmalloc/libpas on top of mimalloc: the fork's release configuration (Debug and ASAN prebuilts had it off). */
const usesMimalloc = (c: Config): boolean => !c.debug && !c.asan;
/**
 * macOS Debug (non-ASAN): the fork's mac build script turns on
 * ENABLE_MALLOC_HEAP_BREAKDOWN, and OptionsJSCOnly.cmake then forces system
 * malloc and libpas off ("to workaround ASSERT(cell->heap() != heap())").
 */
const usesMallocHeapBreakdown = (c: Config): boolean => c.darwin && c.debug && !c.asan;
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
  ["BENABLE_MALLOC_HEAP_BREAKDOWN", c => (usesMallocHeapBreakdown(c) ? 1 : undefined)],
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
  ["ENABLE_LIBPAS", c => (usesMallocHeapBreakdown(c) ? 0 : undefined)],
  ["ENABLE_LLVM_PROFILE_GENERATION", 0],
  ["ENABLE_MALLOC_HEAP_BREAKDOWN", c => on(usesMallocHeapBreakdown(c))],
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
  ["USE_SYSTEM_MALLOC", c => on(usesMallocHeapBreakdown(c))],
  ["USE_SYSTEM_UNIFDEF", 0],
  ["USE_TZONE_MALLOC", 0],
  ["USE_UNIX_DOMAIN_SOCKETS", 1],
  ["USE_WOFF2", 1],
  ["WTF_DEFAULT_EVENT_LOOP", 0],
  // OptionsJSCOnly.cmake (WIN32 + ENABLE_STATIC_JSC): no dllexport/dllimport on the JS_EXPORT macros.
  ["JS_NO_EXPORT", c => (c.windows ? 1 : undefined)],
];

function cmakeConfigHeader(cfg: Config): string {
  let out = "#ifndef CMAKECONFIG_H\n#define CMAKECONFIG_H\n\n";
  for (const [name, value] of rows) {
    const v = typeof value === "function" ? value(cfg) : value;
    if (v !== undefined) out += `#define ${name} ${v}\n`;
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
    "JS_NO_EXPORT",
  ]);
  // cmake snapshots this list before OptionsJSCOnly.cmake turns ENABLE_WEBGL
  // off, so the JSCOnly protocol has always carried the WebGL-conditioned
  // Canvas commands; keep it that way.
  const names: string[] = ["ENABLE_WEBGL"];
  for (const [name, value] of rows) {
    if (name.startsWith("HAVE_") || notOptions.has(name)) continue;
    const v = typeof value === "function" ? value(cfg) : value;
    if (v !== undefined && v !== 0) names.push(name);
  }
  // cmake builds the string as `"${list} ${name}"` starting from empty, so it
  // carries a leading space; CombinedDomains.json records it verbatim.
  return names
    .sort()
    .map(n => ` ${n}`)
    .join("");
}

// ───────────────────────────────────────────────────────────────────────────
// Source mode: direct build
//
// WebKit (bmalloc + WTF + JavaScriptCore, JSCOnly port) built directly in our
// ninja graph — no cmake. The default; `--webkit=prebuilt` skips it.
//
// What WebKit's cmake does, and where it lives here:
//
//   source lists            webkit-{bmalloc,wtf,jsc,llint,inspector}-sources.ts:
//                           sources, include dirs, framework header names,
//                           JSC's unified bundles and @no-unify TUs, codegen
//                           and generator-script inputs — kept by hand
//   cmakeconfig.h           cmakeConfigHeader table, a `headers` entry
//   framework headers       forwarding stubs as `headers` entries:
//                           <bmalloc/X.h>, <JavaScriptCore/X.h> flattened dirs
//   unified bundles         `headers` entries too: each bundle file is the
//                           #include list webkit-jsc-sources.ts records
//   DerivedSources codegen  ~17 ruby/python/perl steps + one per .lut.h
//   LLInt                   settings extractor exe → offsets extractor exe →
//                           LLIntAssembly.h, each parsed by offlineasm (ruby)
//   compile                 source groups with dep flags, so target/cpu/lto/
//                           asan come from flags.ts like every dep; the objects
//                           go straight onto bun's link line
//
// Nothing here reads the WebKit tree: it is fetched by its ninja edge like
// every other dep's.
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────
// Platform description → the variables WebKit's CMakeLists branch on
// ───────────────────────────────────────────────────────────────────────────

function offlineAsmBackend(cfg: Config): string {
  return cfg.x64 ? "X86_64" : "ARM64";
}

// ───────────────────────────────────────────────────────────────────────────
// The build: one DirectBuild spec — configure-time headers, the generator
// chain, the three libraries as source groups, WebKit's own executables.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Paths and settings every part of the spec is written against. Everything
 * generated lives under `<buildDir>/deps/WebKit/` with cmake's layout, so
 * `<JavaScriptCore/X.h>` and DerivedSources paths read as in a WebKit build.
 */
interface WebKitBuild {
  cfg: Config;
  q: (p: string) => string;
  /** The WebKit tree (vendor/WebKit or a --local-deps clone) and its Source/{JavaScriptCore,WTF,bmalloc}. */
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
}

/** WebKit-wide compile flags, derived once (WebKitCompilerFlags / Options*.cmake equivalents), on top of the dep globals the emitter puts underneath every group. */
interface WebKitFlags {
  /** WebKit's additions for C and C++ TUs alike. */
  common: string[];
  /** C++-only additions (-std, the <iostream> ban). */
  cxx: string[];
  /** -D set every WebKit TU carries. */
  commonDefines: string[];
  /** ICU: ours (static, -I into deps/icu) or, on macOS, the SDK's libicucore with WebKit's bundled headers. */
  icuFlags: string[];
  appleIcuHeaders: string;
  /** <bmalloc/X.h> and the bare "X.h" siblings bmalloc's own headers include. */
  bmallocConsumerIncludes: string[];
  useMimalloc: boolean;
  mimallocInclude: string;
}

const ruby = "ruby";
const perl = "perl";

const inTree = (base: string, rel: readonly string[]): string[] => rel.map(p => join(base, p));

/** One generator step; cwd defaults to DerivedSources (several generators write there implicitly). */
function gen(
  wk: WebKitBuild,
  opts: {
    outputs: string[];
    cmd: string[];
    inputs: string[];
    desc: string;
    cwd?: string;
    env?: Record<string, string>;
    implicitOutputs?: string[];
    stdout?: boolean;
  },
): void {
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
  };
}

function webkitBuildSpec(cfg: Config): DirectBuild {
  const wk = webkitLayout(cfg);
  const flags = webkitFlags(wk);
  const codegen = jscCodegenSteps(wk);
  // All codegen must exist before any JSC TU compiles; after that the
  // depfiles know exactly which TU reads which header.
  const codegenReady = [...codegen.headers, ...codegen.sources];
  const jsc = jscCompileFlags(wk, flags);
  const wtf = wtfGroup(wk, flags);
  const llint = llintSteps(wk, jsc, codegenReady);
  const jscSources = jscSourceList(wk);

  return {
    kind: "direct",
    sources: [],
    headers: { "cmakeconfig.h": cmakeConfigHeader(cfg), ...frameworkHeaders(wk, flags), ...jscSources.bundles },
    groups: [
      bmallocGroup(wk, flags),
      wtf.group,
      ...llint.groups,
      jscGroup(wk, jsc, jscSources.sources, [...codegenReady, ...jscSources.checked], llint.assembly),
    ],
    steps: wk.steps,
    // What a consumer's compile waits for: JSC's generated headers (bun
    // includes them through the PrivateHeaders stubs) and WTF's MIG stubs.
    consumerOutputs: [...codegen.headers, ...wtf.migHeaders],
    // Read straight out of the source tree by edges bun.ts emits: the
    // ClassInfo check script and the standalone programs' sources (testFFI,
    // the jsc shell) — declared fetch outputs so ninja knows their producer.
    treeFiles: [
      "Tools/Scripts/check-classinfo-uniqueness.py",
      ...[...jscTestFFISources, ...jscShellSources].map(f => `Source/JavaScriptCore/${f}`),
    ],
  };
}

/** Include dirs bun compiles against — the same set the prebuilt's include/ flattens together. */
function webkitSourceIncludes(cfg: Config): string[] {
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
    // macOS: WebKit's copy of the ICU headers Apple does not ship (see webkitFlags).
    ...(cfg.darwin ? [join(wk.WTF, "icu")] : []),
  ];
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
  // ICU: ours (deps/icu.ts) everywhere but macOS; static, so consumers
  // define U_STATIC_IMPLEMENTATION like the prebuilt build does. macOS links
  // the SDK's libicucore, whose headers Apple does not ship: WebKit carries a
  // matching set in Source/WTF/icu, used with symbol renaming off
  // (OptionsJSCOnly.cmake / FindICU.cmake).
  const appleIcuHeaders = join(WTF, "icu");
  const icuFlags = buildsIcu(cfg)
    ? ["-DU_STATIC_IMPLEMENTATION=1", ...icuIncludes(cfg).map(i => `-I${q(i)}`)]
    : cfg.darwin
      ? ["-DU_DISABLE_RENAMING=1", `-I${q(appleIcuHeaders)}`]
      : [];
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
  // bmalloc.h includes "mimalloc.h" as a flattened sibling; cmake copies it in
  // from WebKit's vendored mimalloc, here it is the mimalloc bun links.
  const useMimalloc = usesMimalloc(cfg);
  const mimallocInclude = join(depSourceDir(cfg, "mimalloc"), "include");
  // Consumers see both <bmalloc/X.h> and the bare "X.h" siblings bmalloc's
  // own headers include (libpas headers, mimalloc.h) — cmake gets the latter
  // from physically flattening copies into one dir.
  const bmallocConsumerIncludes = [wk.bmallocHeaders, join(wk.bmallocHeaders, "bmalloc")];
  return {
    common,
    cxx,
    commonDefines,
    icuFlags,
    appleIcuHeaders,
    bmallocConsumerIncludes,
    useMimalloc,
    mimallocInclude,
  };
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
function frameworkHeaders(wk: WebKitBuild, flags: WebKitFlags): Record<string, string> {
  const { JSC, BM, DS, B } = wk;
  const entries: Record<string, string> = {};
  const forward = (dir: string, headers: string[]): void => {
    for (const h of headers) entries[relative(B, join(dir, basename(h)))] = `#include "${h.replaceAll("\\", "/")}"\n`;
  };
  forward(join(wk.bmallocHeaders, "bmalloc"), [
    ...inTree(BM, bmallocFrameworkHeaders),
    ...(flags.useMimalloc ? [join(flags.mimallocInclude, "mimalloc.h")] : []),
  ]);
  forward(join(wk.jscHeaders, "JavaScriptCore"), inTree(JSC, jscPublicHeaders));
  forward(join(wk.jscPrivateHeaders, "JavaScriptCore"), [
    ...inTree(JSC, jscPrivateHeaders),
    join(DS, "Bytecodes.h"),
    join(DS, "JSCBuiltins.h"),
    join(DS, "JSCWebPreferenceOptions.h"),
    join(DS, "WasmOps.h"),
    join(DS, "inspector", "InspectorAlternateBackendDispatchers.h"),
    join(DS, "inspector", "InspectorBackendDispatchers.h"),
    join(DS, "inspector", "InspectorFrontendDispatchers.h"),
    join(DS, "inspector", "InspectorProtocolObjects.h"),
  ]);
  return entries;
}

// ─── bmalloc ───

function bmallocGroup(wk: WebKitBuild, flags: WebKitFlags): SourceGroup {
  const { cfg, B, BM } = wk;
  return {
    name: "bmalloc",
    // bmalloc_SOURCES lists a few libpas .c files that cmake compiles as C++;
    // the rest of libpas is C.
    sources: [
      ...inTree(BM, bmallocSources).map(path => (path.endsWith(".c") ? { path, lang: "cxx" as const } : path)),
      ...inTree(BM, bmallocCSources),
    ],
    includes: [
      B,
      BM,
      join(BM, "bmalloc"),
      join(BM, "libpas", "src", "libpas"),
      ...(flags.useMimalloc ? [flags.mimallocInclude] : []),
    ],
    cflags: [
      ...flags.common,
      ...flags.commonDefines,
      "-DBUILDING_bmalloc",
      "-D_GNU_SOURCE",
      ...(flags.useMimalloc ? ["-DUSE_MIMALLOC=1"] : []),
      // bmalloc's own TUs never see cmakeconfig.h (BPlatform.h reads -D's), so
      // what cmakeconfig.h tells every consumer — heap breakdown means system
      // malloc, no libpas — has to be said here too (bmalloc/CMakeLists.txt's
      // `if (USE_SYSTEM_MALLOC) add_definitions(-DUSE_SYSTEM_MALLOC=1)`).
      ...(usesMallocHeapBreakdown(cfg) ? ["-DBENABLE_MALLOC_HEAP_BREAKDOWN=1", "-DUSE_SYSTEM_MALLOC=1"] : []),
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

function wtfGroup(wk: WebKitBuild, flags: WebKitFlags): { group: SourceGroup; migHeaders: string[] } {
  const { cfg, W, B, WTF, WTF_DS } = wk;
  // macOS: WTF's signal handling (wasm fault trapping, VM traps) speaks Mach
  // exceptions through MIG-generated RPC stubs (PlatformJSCOnly.cmake's APPLE
  // branch). On a Mac that is Xcode's `mig`; cross-compiling from Linux it is
  // the fork's macos-cross/mig driver around Apple's migcom built for the
  // host (deps/bootstrap-cmds.ts), preprocessing with the target compiler
  // against the SDK — what Dockerfile.macos does.
  const migOutputs: string[] = [];
  const migSources: string[] = [];
  if (cfg.darwin) {
    assert(cfg.osxSysroot !== undefined, "darwin target without a macOS SDK path");
    const defs = join(WTF, "wtf", "mac", "MachExceptions.defs");
    migOutputs.push(
      join(WTF_DS, "MachExceptionsServer.h"),
      join(WTF_DS, "mach_exc.h"),
      join(WTF_DS, "mach_excServer.c"),
      join(WTF_DS, "mach_excUser.c"),
    );
    migSources.push(join(WTF_DS, "mach_excServer.c"), join(WTF_DS, "mach_excUser.c"));
    const migArgs = [
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
    ];
    if (cfg.host.os === "darwin") {
      gen(wk, {
        outputs: migOutputs,
        inputs: [defs],
        cwd: WTF_DS,
        cmd: ["xcrun", "mig", ...migArgs],
        desc: "mig MachExceptions.defs",
      });
    } else {
      const migDriver = join(W, "macos-cross", "mig");
      const migcom = migcomPath(cfg);
      gen(wk, {
        outputs: migOutputs,
        inputs: [defs, migcom, migDriver],
        cwd: WTF_DS,
        env: {
          MIGCC: [cfg.cc, "-E", `--target=${cfg.crossTarget}`, "-isysroot", cfg.osxSysroot].join(" "),
          MIGCOM: migcom,
        },
        cmd: ["bash", migDriver, ...migArgs],
        desc: "mig MachExceptions.defs",
      });
    }
  }
  return {
    group: {
      name: "WTF",
      sources: [...inTree(join(WTF, "wtf"), [...wtfSourcesCommon, ...wtfSourcesFor(cfg)]), ...migSources],
      includes: [
        B,
        ...(cfg.darwin ? [WTF_DS] : []),
        ...inTree(join(WTF, "wtf"), wtfIncludeDirs),
        ...flags.bmallocConsumerIncludes,
      ],
      cflags: [
        ...flags.common,
        ...flags.commonDefines,
        "-DBUILDING_WTF",
        "-DSTATICALLY_LINKED_WITH_bmalloc",
        ...flags.icuFlags,
      ],
      cxxflags: flags.cxx,
      orderOnly: migOutputs,
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
function jscCodegenSteps(wk: WebKitBuild): { headers: string[]; sources: string[] } {
  const { cfg, JSC, WTF, DS, python } = wk;
  const headers: string[] = [];
  const sources: string[] = [];

  // LUT tables (create_hash_table, perl).
  const hashLut = join(JSC, "create_hash_table");
  for (const src of inTree(JSC, jscLutSources)) {
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
    inputs: [
      join(JSC, "bytecode", "BytecodeList.rb"),
      join(JSC, "wasm", "wasm.json"),
      ...inTree(JSC, jscGeneratorRuby),
    ],
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
      inputs: [script, join(JSC, "yarr", "hasher.py"), ...inTree(JSC, jscUcdFiles)],
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
    const builtins = inTree(JSC, jscBuiltinsSources);
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
      inputs: [...builtins, ...inTree(JSC, jscBuiltinsScripts)],
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
    const domains = inTree(JSC, jscInspectorDomains);
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
      inputs: [combined, ...inTree(JSC, jscInspectorScripts)],
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

function jscCompileFlags(wk: WebKitBuild, flags: WebKitFlags): JSCCompileFlags {
  const { cfg, B, JSC, WTF, DS } = wk;
  // clang-cl only maps a subset of GNU -f options; the rest go through /clang:.
  const clangOpt = (f: string) => (cfg.windows ? `/clang:${f}` : f);
  return {
    includes: [
      ...new Set([
        wk.jscHeaders,
        wk.jscPrivateHeaders,
        B,
        join(wk.jscPrivateHeaders, "JavaScriptCore"),
        ...inTree(JSC, jscIncludeDirs),
        DS,
        join(DS, "inspector"),
        join(DS, "runtime"),
        join(DS, "yarr"),
        WTF, // <wtf/X.h> straight from the source tree (cmake copies to WTF/Headers)
        ...flags.bmallocConsumerIncludes,
      ]),
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
  // Hooks bun's runtime provides to WTF/JSC (RunLoopBun.cpp, ErrorInstance,
  // JSMicrotask). WebKit's own executables leave them undefined: ld64 needs
  // that spelled out per symbol (WebKitCompilerFlags.cmake, USE_BUN_EVENT_LOOP).
  const bunHooks = [
    "WTFTimer__create",
    "WTFTimer__update",
    "WTFTimer__deinit",
    "WTFTimer__isActive",
    "WTFTimer__secondsUntilTimer",
    "WTFTimer__cancel",
    "Bun__errorInstance__finalize",
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
  codegenReady: string[],
): { groups: SourceGroup[]; assembly: string } {
  const { cfg, JSC, DS, binDir } = wk;
  const offlineasm = join(JSC, "offlineasm");
  const llintAsmFiles = inTree(JSC, llintAsm);
  const offlineAsmRb = inTree(JSC, jscOfflineasmRuby);
  const lowLevelInterpreterAsm = join(JSC, "llint", "LowLevelInterpreter.asm");
  const backend = offlineAsmBackend(cfg);
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
  // asm.rb leaves an existing output untouched when the "input hash" trailer
  // matches, and that hash covers the .asm inputs, the offsets and
  // --platform but not --binary-format. Reusing one build dir for another
  // --os (ELF directives on/off) would keep a stale header, so a change in
  // the invocation discards it here.
  const llintAssemblyCmd = [
    ruby,
    join(offlineasm, "asm.rb"),
    `-I${DS}/`,
    lowLevelInterpreterAsm,
    offsetsExe,
    llintAssembly,
    buildVariants,
    ...offlineAsmFormatArgs,
  ];
  mkdirSync(DS, { recursive: true });
  if (writeIfChanged(join(DS, "LLIntAssembly.h.cmd"), llintAssemblyCmd.join("\n") + "\n")) {
    rmSync(llintAssembly, { force: true });
  }
  gen(wk, {
    outputs: [llintAssembly],
    cmd: llintAssemblyCmd,
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
 * JSC's translation units: the unified bundles (each a generated file that
 * #includes up to eight Sources.txt entries — webkit-jsc-sources.ts lists
 * them), the @no-unify entries, and
 * JavaScriptCore_SOURCES. The bundle files themselves are `headers` entries
 * written at configure.
 */
function jscSourceList(wk: WebKitBuild): { sources: string[]; bundles: Record<string, string>; checked: string[] } {
  const { cfg, JSC, DS, B } = wk;
  // The bundle and @no-unify lists are kept by hand; this step fails the
  // build, before any JSC compile, if a fetched Sources.txt names a file they
  // don't (or vice versa) — a WebKit bump that moved a TU.
  const checked = join(B, ".jsc-sources-checked");
  const checkScript = join(import.meta.dirname, "webkit-check-sources.ts");
  gen(wk, {
    outputs: [checked],
    cmd: [...cfg.jsRuntimeArgv, checkScript, JSC, checked],
    inputs: [
      join(JSC, "Sources.txt"),
      join(JSC, "inspector", "remote", "SourcesSocket.txt"),
      checkScript,
      join(import.meta.dirname, "webkit-jsc-sources.ts"),
    ],
    desc: "check Sources.txt against webkit-jsc-sources.ts",
  });
  // Same idea for the generators: every gen() in this file transcribes an
  // add_custom_command from WebKit's CMake. webkit-check-cmake.ts renders
  // those statements (and the variables feeding them) from the fetched tree
  // and compares them with webkit-cmake.snapshot; a bump that changes one
  // fails here with the diff until webkit.ts and the snapshot are updated.
  const cmakeChecked = join(B, ".cmake-checked");
  const cmakeCheckScript = join(import.meta.dirname, "webkit-check-cmake.ts");
  gen(wk, {
    outputs: [cmakeChecked],
    cmd: [...cfg.jsRuntimeArgv, cmakeCheckScript, wk.W, cmakeChecked],
    inputs: [
      ...cmakeWatchedFiles.map(f => join(wk.W, f)),
      cmakeCheckScript,
      join(import.meta.dirname, "..", "cmake.ts"),
      join(import.meta.dirname, "webkit-cmake.snapshot"),
    ],
    desc: "check WebKit's CMake against webkit-cmake.snapshot",
  });
  const bundleDir = join(DS, "unified-sources");
  const bundles: Record<string, string> = {};
  for (const [bundle, members] of jscUnifiedBundles) {
    bundles[relative(B, join(bundleDir, bundle))] = members.map(m => `#include "${m}"\n`).join("");
  }
  const sources = [
    ...jscUnifiedBundles.map(([bundle]) => join(bundleDir, bundle)),
    ...jscNonUnifiedSources.map(s =>
      s.startsWith("DerivedSources/") ? join(DS, s.slice("DerivedSources/".length)) : join(JSC, s),
    ),
    join(DS, "JSCBuiltins.cpp"),
    ...inTree(JSC, jscExtraSourcesFor(cfg)),
  ];
  return { sources, bundles, checked: [checked, cmakeChecked] };
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
    implicitInputs: [join(wk.B, "cmakeconfig.h")],
  };
}

// ─── testFFI ───

/** Standalone JSC programs' sources (relative to Source/JavaScriptCore); also fetch outputs via treeFiles. */
const jscTestFFISources = ["ffi/tests/testFFI.cpp"];
const jscShellSources = ["jsc.cpp", "tools/JSDollarVMShell.cpp"];

/**
 * JSC's bun:ffi C++/ABI test program (ffi/tests/testFFI.cpp), run by
 * test/js/bun/jsc-stress/testFFI.test.ts. It is one of WebKit's own
 * executables (built like jsc/testapi against JSC's private headers), but
 * bun's build links it — next to bun, from the same dep objects — so this
 * only says how: the source, the flags a JSC-family TU compiles with, and
 * the link flags a standalone JSC executable needs.
 */
export function jscTestFFI(cfg: Config): JSCProgram {
  return jscProgram(cfg, "testFFI", jscTestFFISources, []);
}

/**
 * JSC's `jsc` shell (shell/CMakeLists.txt: jsc.cpp + the $vm shell helpers,
 * libedit for its REPL on macOS). Not a default target: bun.ts emits it so
 * `bun run build --target=jsc` / `ninja jsc` build it on demand.
 */
export function jscShell(cfg: Config): JSCProgram {
  return jscProgram(cfg, "jsc", jscShellSources, cfg.darwin ? ["-ledit"] : []);
}

export interface JSCProgram {
  sources: string[];
  cxxflags: string[];
  ldflags: string[];
}

/** A standalone JSC executable compiled the way shell/CMakeLists.txt compiles them: JSC's flags, statically linked with the framework. */
function jscProgram(cfg: Config, name: string, sources: string[], ldflags: string[]): JSCProgram {
  const wk = webkitLayout(cfg);
  const jsc = jscCompileFlags(wk, webkitFlags(wk));
  const { cxx } = groupCompileFlags(cfg, wk.W, {
    includes: jsc.includes,
    cflags: [...jsc.targetFlags, `-DBUILDING_${name}`, "-DSTATICALLY_LINKED_WITH_JavaScriptCore"],
    cxxflags: jsc.cxx,
  });
  return { sources: inTree(wk.JSC, sources), cxxflags: cxx, ldflags: [...standaloneExeLinkFlags(cfg), ...ldflags] };
}

// ───────────────────────────────────────────────────────────────────────────
// The Dependency
// ───────────────────────────────────────────────────────────────────────────

export const webkit: Dependency = {
  name: "WebKit",
  versionMacro: "WEBKIT",
  // The direct build compiles against the mimalloc bun links
  // (USE_EXTERNAL_MIMALLOC) and, off macOS, the ICU built by deps/icu.ts.
  fetchDeps: cfg =>
    cfg.webkit === "source"
      ? [
          "mimalloc",
          ...(buildsIcu(cfg) ? ["icu"] : []),
          ...(cfg.darwin && cfg.host.os !== "darwin" ? ["bootstrap_cmds"] : []),
        ]
      : [],

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

    return { kind: "github", repo: "oven-sh/WebKit", commit: cfg.webkitVersion, sparse: sourceSparse };
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
    return { libs: [], includes: webkitSourceIncludes(cfg) };
  },
};
