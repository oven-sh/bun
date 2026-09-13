#include "root.h"
#include "BunBuiltinNames.h"

namespace WebCore {

static constexpr ASCIILiteral builtinNameStrings[BunBuiltinNames::count] = {
#define BUN_BUILTIN_NAME_STRING(name) #name ""_s,
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(BUN_BUILTIN_NAME_STRING)
#undef BUN_BUILTIN_NAME_STRING
};

// The private names are static symbols, like JavaScriptCore's own builtin names: one immortal SymbolImpl per name shared
// by every VM, whose hash is its contents' hash rather than the next value of the process-wide symbol counter -- so the
// bytecode generated for a builtin does not depend on how many symbols the process made before this VM's names.
#define BUN_BUILTIN_PRIVATE_NAME(name) static WTF::SymbolImpl::StaticSymbolImpl name##PrivateName { #name ""_s, WTF::SymbolImpl::s_flagIsPrivate };
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
