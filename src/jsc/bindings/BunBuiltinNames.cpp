#include "root.h"
#include "BunBuiltinNames.h"

namespace WebCore {

static constexpr ASCIILiteral builtinNameStrings[BunBuiltinNames::count] = {
#define BUN_BUILTIN_NAME_STRING(name) #name ""_s,
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(BUN_BUILTIN_NAME_STRING)
#undef BUN_BUILTIN_NAME_STRING
};

BunBuiltinNames::BunBuiltinNames(JSC::VM& vm)
    : m_vm(vm)
{
    for (size_t i = 0; i < count; ++i) {
        m_publicNames[i] = JSC::Identifier::fromString(vm, builtinNameStrings[i]);
        m_privateNames[i] = JSC::Identifier::fromUid(JSC::PrivateName(JSC::PrivateName::PrivateSymbol, builtinNameStrings[i]));
    }
    for (size_t i = 0; i < count; ++i)
        m_vm.propertyNames->appendExternalName(m_publicNames[i], m_privateNames[i]);
}

BunBuiltinNames::~BunBuiltinNames() = default;

} // namespace WebCore
