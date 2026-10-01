#include "root.h"
#include "BunBuiltinNames.h"
#include <JavaScriptCore/StaticHeap.h>
#include <mutex>

namespace WebCore {

static constexpr ASCIILiteral builtinNameStrings[BunBuiltinNames::count] = {
#define BUN_BUILTIN_NAME_STRING(name) #name ""_s,
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(BUN_BUILTIN_NAME_STRING)
#undef BUN_BUILTIN_NAME_STRING
};

// The private names are static symbols, like JavaScriptCore's own builtin names: one immortal SymbolImpl per name shared
// by every VM, whose hash is its contents' hash rather than the next value of the process-wide symbol counter -- so the
// bytecode generated for a builtin does not depend on how many symbols the process made before this VM's names. And they
// are where JavaScriptCore's are: at an address that is the same in every process, so that what `bun build --compile`
// makes ahead of time (JSC::StaticHeap) can refer to them.
static_assert(BunBuiltinNames::count * sizeof(WTF::SymbolImpl::StaticSymbolImpl) <= JSC::StaticHeap::sizeForEmbedderSymbols);
static WTF::SymbolImpl::StaticSymbolImpl* builtinPrivateNames()
{
    auto* names = static_cast<WTF::SymbolImpl::StaticSymbolImpl*>(JSC::StaticHeap::addressOfEmbedderSymbols());
    static std::once_flag once;
    std::call_once(once, [&] {
        for (size_t i = 0; i < BunBuiltinNames::count; ++i)
            new (NotNull, &names[i]) WTF::SymbolImpl::StaticSymbolImpl { builtinNameStrings[i], WTF::SymbolImpl::s_flagIsPrivate };
    });
    return names;
}

BunBuiltinNames::BunBuiltinNames(JSC::VM& vm)
    : m_vm(vm)
{
    auto* privateNames = builtinPrivateNames();
    for (size_t i = 0; i < count; ++i) {
        m_publicNames[i] = JSC::Identifier::fromString(vm, builtinNameStrings[i]);
        m_privateNames[i] = JSC::Identifier::fromUid(privateNames[i]);
    }
    for (size_t i = 0; i < count; ++i)
        m_vm.propertyNames->appendExternalName(m_publicNames[i], m_privateNames[i]);
}

BunBuiltinNames::~BunBuiltinNames() = default;

} // namespace WebCore
