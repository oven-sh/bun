#include "root.h"
#include "BunBuiltinNames.h"
#include <algorithm>
#include <string_view>

namespace WebCore {

static constexpr ASCIILiteral builtinNameStrings[BunBuiltinNames::count] = {
#define BUN_BUILTIN_NAME_STRING(name) #name ""_s,
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(BUN_BUILTIN_NAME_STRING)
#undef BUN_BUILTIN_NAME_STRING
};

static constexpr std::string_view namesThatPassThroughProxies[] = {
#define BUN_MODULE_PRIVATE_NAME_STRING(name) #name,
    BUN_MODULE_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(BUN_MODULE_PRIVATE_NAME_STRING)
#undef BUN_MODULE_PRIVATE_NAME_STRING
};

static consteval bool passesThroughProxies(std::string_view name)
{
    return std::ranges::find(namesThatPassThroughProxies, name) != std::end(namesThatPassThroughProxies);
}

static consteval WTF::SymbolImpl::Flags flagsOfPrivateName(std::string_view name)
{
    return WTF::SymbolImpl::s_flagIsPrivate | (passesThroughProxies(name) ? WTF::SymbolImpl::s_flagPassesThroughProxies : WTF::SymbolImpl::s_flagDefault);
}

#define BUN_COUNT_NAME_THAT_PASSES(name) +passesThroughProxies(#name)
static_assert(std::size(namesThatPassThroughProxies) == 0 BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(BUN_COUNT_NAME_THAT_PASSES));
#undef BUN_COUNT_NAME_THAT_PASSES

// The private names are static symbols, like JavaScriptCore's own builtin names: one immortal SymbolImpl per name shared
// by every VM, whose hash is its contents' hash rather than the next value of the process-wide symbol counter -- so the
// bytecode generated for a builtin does not depend on how many symbols the process made before this VM's names.
#define BUN_BUILTIN_PRIVATE_NAME(name) static WTF::SymbolImpl::StaticSymbolImpl name##PrivateName { #name ""_s, flagsOfPrivateName(#name) };
BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(BUN_BUILTIN_PRIVATE_NAME)
#undef BUN_BUILTIN_PRIVATE_NAME
static WTF::SymbolImpl::StaticSymbolImpl* const builtinPrivateNames[BunBuiltinNames::count] = {
#define BUN_BUILTIN_PRIVATE_NAME(name) &name##PrivateName,
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(BUN_BUILTIN_PRIVATE_NAME)
#undef BUN_BUILTIN_PRIVATE_NAME
};

BunBuiltinNames::BunBuiltinNames(JSC::VM& vm)
    : m_vm(vm)
{
    for (size_t i = 0; i < count; ++i) {
        m_publicNames[i] = JSC::Identifier::fromString(vm, builtinNameStrings[i]);
        m_privateNames[i] = JSC::Identifier::fromUid(*builtinPrivateNames[i]);
    }
    for (size_t i = 0; i < count; ++i)
        m_vm.propertyNames->appendExternalName(m_publicNames[i], m_privateNames[i]);
}

BunBuiltinNames::~BunBuiltinNames() = default;

} // namespace WebCore
