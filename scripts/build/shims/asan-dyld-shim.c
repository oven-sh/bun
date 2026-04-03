// Workaround for macOS 26.4 + ASAN deadlock.
// https://github.com/llvm/llvm-project/issues/182943
//
// macOS 26.4's Dyld.framework reimplemented dyld_shared_cache_iterate_text as
// a tail-call to a Swift version that allocates via _Block_copy. ASAN's
// get_dyld_hdr() calls this during InitializeShadowMemory() — before the
// malloc interceptor is ready. The allocation re-enters AsanInitFromRtl(),
// which spins on its own init lock forever.
//
// The upstream fix (merged to LLVM main, not yet released) switches to
// _dyld_get_dyld_header() which is a plain getter that doesn't allocate.
// We do the same: interpose the iterate function to synthesize what ASAN
// needs using the non-allocating API.
//
// Build:
//   clang -dynamiclib -o asan-dyld-shim.dylib asan-dyld-shim.c
//
// Use:
//   DYLD_INSERT_LIBRARIES=.../asan-dyld-shim.dylib ./bun-debug
//
// Remove once compiler-rt with the fix ships — LLVM 22.1.3+ via
// https://github.com/llvm/llvm-project/pull/188913 backport, or an Xcode
// update.

#include <dlfcn.h>
#include <mach-o/dyld.h>
#include <stdint.h>
#include <string.h>
#include <uuid/uuid.h>

// ASAN's GetDyldImageHeaderViaSharedCache (sanitizer_procmaps_mac.cpp)
// iterates, computes hdr = cacheStart + info->textSegmentOffset for each
// entry, and keeps the one where IsDyldHdr(hdr) matches. We give it exactly
// one entry with the offset that lands on dyld's header — obtained via the
// non-allocating _dyld_get_dyld_header() that the upstream fix uses.
// That symbol is private — present in libdyld at runtime but absent from
// the SDK's .tbd stubs — so a direct extern fails to link. dlsym it.
extern const void* _dyld_get_shared_cache_range(size_t* length);

// Layout must match compiler-rt's copy of the struct. Fields ASAN reads:
// version (CHECK_GE 2) and textSegmentOffset. Rest unused but kept for size.
struct dyld_shared_cache_dylib_text_info {
  uint64_t version;
  uint64_t loadAddressUnslid;
  uint64_t textSegmentSize;
  uuid_t   dylibUuid;
  const char* path;
  uint64_t textSegmentOffset;
};
typedef void (^dsc_callback)(const struct dyld_shared_cache_dylib_text_info*);

// Forward-declare the real symbol so the interpose table can reference it.
extern int dyld_shared_cache_iterate_text(const uuid_t, dsc_callback);

static int shim_iterate(const uuid_t uuid, dsc_callback cb) {
  (void)uuid;
  typedef const struct mach_header* (*get_hdr_fn)(void);
  get_hdr_fn get_hdr = (get_hdr_fn)dlsym(RTLD_DEFAULT, "_dyld_get_dyld_header");
  const struct mach_header* hdr = get_hdr ? get_hdr() : NULL;
  size_t len;
  const void* cacheStart = _dyld_get_shared_cache_range(&len);
  if (!hdr || !cacheStart || !cb) return -1;

  struct dyld_shared_cache_dylib_text_info info;
  memset(&info, 0, sizeof(info));
  info.version = 2;
  info.textSegmentOffset = (uint64_t)((uintptr_t)hdr - (uintptr_t)cacheStart);
  info.path = "/usr/lib/dyld";
  cb(&info);
  return 0;
}

// DYLD_INTERPOSE: tells dyld to redirect calls to the original symbol (from
// any image, including the ASAN runtime) to our replacement. The original
// pointer here is linker-resolved to the system's symbol; we never call it.
__attribute__((used, section("__DATA,__interpose")))
static struct { const void* replacement; const void* original; } interpose_tbl[] = {
  { (const void*)(uintptr_t)&shim_iterate,
    (const void*)(uintptr_t)&dyld_shared_cache_iterate_text },
};
