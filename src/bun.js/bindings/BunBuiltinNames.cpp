#include "BunBuiltinNames.h"

namespace WebCore {

// FIXME: Remove the __attribute__((nodebug)) when <rdar://68246686> is fixed.
#if COMPILER(CLANG)
__attribute__((nodebug))
#endif
BunBuiltinNames::BunBuiltinNames(JSC::VM& vm)
    : m_vm(vm)
          BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(INITIALIZE_BUILTIN_NAMES)
{
#define EXPORT_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(EXPORT_NAME)
#undef EXPORT_NAME
}

BunBuiltinNames::~BunBuiltinNames() = default;

} // namespace WebCore
