// Route ICU's heap (uprv_malloc / uprv_realloc / uprv_free, which also back
// ICU's `UMemory::operator new/delete`) through mimalloc, like libuv, c-ares
// and BoringSSL already are. Otherwise ICU is on plain `malloc`, which on
// Windows is the static UCRT heap: it returns NULL on the first commit-limit
// refusal, with none of the retry mimalloc applies (`mi_option_retry_on_oom`),
// and `ubrk_clone` turns that NULL into "failed to initialize Segments" or a
// null dereference in RuleBasedBreakIterator.

#include "root.h"

#include "bun_icu_malloc.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <atomic>

// Under ASAN, keep ICU on the allocator the sanitizer tracks (same reason
// BoringSSL's hooks are off there). On macOS ICU is the system libicucore,
// shared with frameworks that may have allocated from it before main().
#if USE(BUN_MIMALLOC) && !ASAN_ENABLED && !OS(DARWIN)

#include "mimalloc.h"
#include <unicode/uclean.h>

namespace Bun {
namespace ICUMalloc {

static bool s_installed = false;
static std::atomic<size_t> s_allocations { 0 };

static void* U_CALLCONV icuAlloc(const void*, size_t size)
{
    s_allocations.fetch_add(1, std::memory_order_relaxed);
    return mi_malloc(size);
}

static void* U_CALLCONV icuRealloc(const void*, void* p, size_t size)
{
    // A block ICU allocated before install() would be from another heap.
    ASSERT_WITH_MESSAGE(!p || mi_is_in_heap_region(p), "ICU realloc of a non-mimalloc pointer %p", p);
    return mi_realloc(p, size);
}

static void U_CALLCONV icuFree(const void*, void* p)
{
    ASSERT_WITH_MESSAGE(!p || mi_is_in_heap_region(p), "ICU free of a non-mimalloc pointer %p", p);
    mi_free(p);
}

// Must run before ICU allocates anything: u_setMemoryFunctions only swaps the
// function pointers, so an earlier block would later reach mi_free.
static void install()
{
    UErrorCode status = U_ZERO_ERROR;
    u_setMemoryFunctions(nullptr, icuAlloc, icuRealloc, icuFree, &status);
    RELEASE_ASSERT(U_SUCCESS(status));
    s_installed = true;
}

} // namespace ICUMalloc
} // namespace Bun

extern "C" void Bun__useMimallocForICU()
{
    Bun::ICUMalloc::install();
}

#else

extern "C" void Bun__useMimallocForICU()
{
}

#endif

namespace Bun {

BUN_DEFINE_HOST_FUNCTION(Bun__icuAllocatorForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto* object = JSC::constructEmptyObject(globalObject);
#if USE(BUN_MIMALLOC) && !ASAN_ENABLED && !OS(DARWIN)
    bool installed = ICUMalloc::s_installed;
    size_t allocations = ICUMalloc::s_allocations.load(std::memory_order_relaxed);
#else
    bool installed = false;
    size_t allocations = 0;
#endif
    object->putDirect(vm, JSC::Identifier::fromString(vm, "installed"_s), JSC::jsBoolean(installed));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "allocations"_s), JSC::jsNumber(allocations));
    return JSC::JSValue::encode(object);
}

} // namespace Bun
