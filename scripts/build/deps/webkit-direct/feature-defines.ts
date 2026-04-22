/**
 * Generates the header WebKit's source expects at `cmakeconfig.h` (the name
 * is hardcoded in Source/{WTF,JavaScriptCore}/config.h). It's WebKit's
 * config.h equivalent — ENABLE_X / HAVE_X / USE_X feature flags. cmake would
 * fill it via WebKitFeatures.cmake + OptionsJSCOnly.cmake probes; we
 * hand-write the answers per target like libarchive/cares.
 *
 * ENABLE_X are feature toggles (mostly WebCore-irrelevant for us, but JSC
 * reads ENABLE_JIT/DFG_JIT/FTL_JIT/WEBASSEMBLY). HAVE_X are libc probes.
 * USE_X are backend selections.
 *
 * Explicit-0 entries matter: PlatformEnable*.h supplies fallback defaults
 * (e.g. `#ifndef ENABLE_OFFSCREEN_CANVAS → 1`), so omitting a disabled
 * feature can silently turn it on. ENABLE_DISABLED mirrors the prebuilt's
 * cmakeconfig.h.
 */

import type { Config } from "../../config.ts";

const def = (entries: Record<string, 0 | 1>) =>
  Object.entries(entries)
    .map(([k, v]) => `#define ${k} ${v}`)
    .join("\n");

// Feature toggles that are the same on every target. The =1 set is what
// JSCOnly + USE_BUN_JSC_ADDITIONS turns on; the =0 set is WebCore/platform
// features cmake explicitly emits as 0.
const ENABLE_ALWAYS = def({
  ALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS: 1,
  BUN_SKIP_FAILING_ASSERTIONS: 1,
  ENABLE_BUN_SKIP_FAILING_ASSERTIONS: 1,
  ENABLE_API_TESTS: 1,
  ENABLE_CONTEXT_MENUS: 1,
  ENABLE_DFG_JIT: 1,
  ENABLE_FTL_JIT: 1,
  ENABLE_FTPDIR: 1,
  ENABLE_FULLSCREEN_API: 1,
  ENABLE_GEOLOCATION: 1,
  ENABLE_IMAGE_DIFF: 1,
  ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS: 1,
  ENABLE_JAVASCRIPT_SHELL: 1,
  ENABLE_JIT: 1,
  ENABLE_MATHML: 1,
  ENABLE_NOTIFICATIONS: 1,
  ENABLE_REMOTE_INSPECTOR: 1,
  ENABLE_RESOURCE_USAGE: 1,
  ENABLE_SAMPLING_PROFILER: 1,
  ENABLE_SMOOTH_SCROLLING: 1,
  ENABLE_STATIC_JSC: 1,
  ENABLE_UNIFIED_BUILDS: 1,
  ENABLE_USER_MESSAGE_HANDLERS: 1,
  ENABLE_VIDEO: 1,
  ENABLE_VIDEO_USES_ELEMENT_FULLSCREEN: 1,
  ENABLE_WEBASSEMBLY: 1,
  ENABLE_WEBASSEMBLY_BBQJIT: 1,
  ENABLE_WEBASSEMBLY_OMGJIT: 1,
  ENABLE_WEB_AUDIO: 1,
  ENABLE_WEB_CRYPTO: 1,
  ENABLE_XSLT: 1,
  USE_ALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS: 1,
  USE_BUN_EVENT_LOOP: 1,
  USE_BUN_JSC_ADDITIONS: 1,
  // PlatformUse.h falls back to USE_GENERIC_EVENT_LOOP unless told the
  // event-loop choice is already made. cmake sets this alongside
  // USE_BUN_EVENT_LOOP in OptionsJSCOnly.cmake.
  WTF_DEFAULT_EVENT_LOOP: 0,
  USE_INSPECTOR_SOCKET_SERVER: 1,
  USE_ISO_MALLOC: 1,
  // WebCore-only image codecs etc. — irrelevant for JSC but cmake emits
  // them so headers that probe both ways stay consistent.
  USE_AVIF: 1,
  USE_JPEGXL: 1,
  USE_LCMS: 1,
  USE_WOFF2: 1,
  ENABLE_WKC_INDEXEDDB: 0,
  // bmalloc backend selection — both must be 0 for bun (bmalloc + libpas).
  // PlatformUse.h defaults USE_TZONE_MALLOC to 1 on darwin if unset, which
  // then trips TZoneMalloc.h's "enabled in WTF, not in bmalloc" check.
  BUSE_TZONE: 0,
  USE_TZONE_MALLOC: 0,
  USE_SYSTEM_MALLOC: 0,
  USE_MIMALLOC: 0,
  // Backends/options cmake explicitly emits as 0 — most are WebCore-only,
  // listed so PlatformUse.h fallbacks don't surprise.
  USE_64KB_PAGE_BLOCK: 0,
  USE_LIBBACKTRACE: 0,
  USE_PGO_PROFILE: 0,
  USE_SKIA: 0,
  USE_SKIA_ENCODERS: 0,
  USE_SYSTEM_UNIFDEF: 0,
});

// Explicit-0 ENABLE_* — PlatformEnable*.h supplies fallback defaults for
// many of these (e.g. OFFSCREEN_CANVAS → 1), so they MUST be emitted to
// suppress the default. Mirrors the prebuilt's cmakeconfig.h.
// prettier-ignore
const ENABLE_DISABLED = [
  "ACCESSIBILITY_ISOLATED_TREE", "APPLE_PAY", "APPLICATION_MANIFEST",
  "ASYNC_SCROLLING", "ATTACHMENT_ELEMENT", "AUTOCAPITALIZE", "AVF_CAPTIONS",
  "BREAKPAD", "BUBBLEWRAP_SANDBOX", "CACHE_PARTITIONING", "CONTENT_EXTENSIONS",
  "CONTENT_FILTERING", "CSS_TAP_HIGHLIGHT_COLOR", "CURSOR_VISIBILITY", "C_LOOP",
  "DARK_MODE_CSS", "DATACUE_VALUE", "DEVICE_ORIENTATION", "DRAG_SUPPORT",
  "ENCRYPTED_MEDIA", "EXPERIMENTAL_FEATURES", "FUZZILLI", "GAMEPAD",
  "GPU_PROCESS", "INSPECTOR_EXTENSIONS", "INSPECTOR_TELEMETRY",
  "IOS_GESTURE_EVENTS", "IOS_TOUCH_EVENTS", "JSC_GLIB_API", "LAYOUT_TESTS",
  "LEGACY_CUSTOM_PROTOCOL_MANAGER", "LEGACY_ENCRYPTED_MEDIA",
  "LLVM_PROFILE_GENERATION", "MALLOC_HEAP_BREAKDOWN", "MEDIA_CAPTURE",
  "MEDIA_CONTROLS_CONTEXT_MENUS", "MEDIA_RECORDER", "MEDIA_SESSION",
  "MEDIA_SESSION_COORDINATOR", "MEDIA_SESSION_PLAYLIST", "MEDIA_SOURCE",
  "MEDIA_STATISTICS", "MEDIA_STREAM", "MEMORY_SAMPLER", "MHTML", "MINIBROWSER",
  "MOUSE_CURSOR_SCALE", "NAVIGATOR_STANDALONE", "OFFSCREEN_CANVAS",
  "OFFSCREEN_CANVAS_IN_WORKERS", "ORIENTATION_EVENTS", "PAYMENT_REQUEST",
  "PDFJS", "PDFKIT_PLUGIN", "PERIODIC_MEMORY_MONITOR", "PICTURE_IN_PICTURE_API",
  "POINTER_LOCK", "REFTRACKER", "RELEASE_LOG", "SANDBOX_EXTENSIONS",
  "SERVICE_CONTROLS", "SHAREABLE_RESOURCE", "SPEECH_SYNTHESIS", "SPELLCHECK",
  "SWIFT_DEMO_URI_SCHEME", "TELEPHONE_NUMBER_DETECTION", "TEXT_AUTOSIZING",
  "THUNDER", "TOUCH_EVENTS", "VARIATION_FONTS", "VIDEO_PRESENTATION_MODE",
  "WEBDRIVER", "WEBDRIVER_BIDI", "WEBDRIVER_KEYBOARD_GRAPHEME_CLUSTERS",
  "WEBDRIVER_KEYBOARD_INTERACTIONS", "WEBDRIVER_MOUSE_INTERACTIONS",
  "WEBDRIVER_TOUCH_INTERACTIONS", "WEBDRIVER_WHEEL_INTERACTIONS", "WEBGL",
  "WEBGPU", "WEBKIT_OVERFLOW_SCROLLING_CSS_PROPERTY", "WEBXR", "WEBXR_HIT_TEST",
  "WEBXR_LAYERS", "WEB_API_STATISTICS", "WEB_AUTHN", "WEB_CODECS", "WEB_RTC",
  "WIRELESS_PLAYBACK_TARGET", "WK_WEB_EXTENSIONS",
].map(n => `#define ENABLE_${n} 0`).join("\n");

// libc probes — same shape as libarchive's POSIX/DARWIN/WINDOWS split.
const HAVE_POSIX = def({
  HAVE_ERRNO_H: 1,
  HAVE_INT128_T: 1,
  HAVE_LANGINFO_H: 1,
  HAVE_LOCALTIME_R: 1,
  HAVE_MMAP: 1,
  HAVE_REGEX_H: 1,
  HAVE_SIGNAL_H: 1,
  HAVE_STD_FILESYSTEM: 1,
  HAVE_SYS_PARAM_H: 1,
  HAVE_SYS_TIME_H: 1,
  HAVE_TIMEGM: 1,
  HAVE_TM_GMTOFF: 1,
  HAVE_TM_ZONE: 1,
  HAVE_VASPRINTF: 1,
  USE_UNIX_DOMAIN_SOCKETS: 1,
});

const HAVE_LINUX = def({
  HAVE_FEATURES_H: 1,
  HAVE_LINUX_MEMFD_H: 1,
  HAVE_MALLOC_TRIM: 1,
  HAVE_STATX: 1,
  HAVE_SYS_TIMEB_H: 1,
  HAVE_TIMERFD: 1,
  HAVE_PTHREAD_NP_H: 0,
});

const HAVE_DARWIN = def({
  HAVE_PTHREAD_MAIN_NP: 1,
  HAVE_SYS_TIMEB_H: 1,
  HAVE_FEATURES_H: 0,
  HAVE_LINUX_MEMFD_H: 0,
  HAVE_MALLOC_TRIM: 0,
  HAVE_STATX: 0,
  HAVE_TIMERFD: 0,
});

const HAVE_WINDOWS = def({
  HAVE_ERRNO_H: 1,
  HAVE_INT128_T: 1,
  HAVE_SIGNAL_H: 1,
  HAVE_STD_FILESYSTEM: 1,
  HAVE_SYS_TIMEB_H: 1,
  HAVE_LOCALTIME_R: 0,
  HAVE_MMAP: 0,
  HAVE_TIMEGM: 0,
  HAVE_TM_GMTOFF: 0,
  HAVE_TM_ZONE: 0,
  HAVE_VASPRINTF: 0,
  USE_UNIX_DOMAIN_SOCKETS: 0,
});

export function cmakeconfigH(cfg: Config): string {
  let platform: string;
  if (cfg.windows) platform = HAVE_WINDOWS;
  else if (cfg.darwin) platform = `${HAVE_POSIX}\n${HAVE_DARWIN}`;
  else platform = `${HAVE_POSIX}\n${HAVE_LINUX}`;

  return `/* Generated by scripts/build/deps/webkit-direct/cmakeconfig.ts for ${cfg.os}-${cfg.arch} */
#ifndef CMAKECONFIG_H
#define CMAKECONFIG_H

${ENABLE_ALWAYS}

${ENABLE_DISABLED}

${platform}

#endif
`;
}
