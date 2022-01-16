// clang-format off

#pragma once

#include "helpers.h"
#include "root.h"
#include <JavaScriptCore/BuiltinUtils.h>


namespace Bun {

using namespace JSC;


#if !defined(BUN_ADDITIONAL_PRIVATE_IDENTIFIERS)
#define BUN_ADDITIONAL_PRIVATE_IDENTIFIERS(macro)
#endif




#define BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(macro) \
    macro(filePath) \
    macro(syscall) \
    macro(errno) \
    macro(code) \
    macro(path) \
    macro(versions) \
    macro(argv) \
    macro(execArgv) \
    macro(nextTick) \
    macro(version) \
    macro(title) \
    macro(pid) \
    macro(ppid) \
    macro(chdir) \
    macro(cwd) \
    BUN_ADDITIONAL_PRIVATE_IDENTIFIERS(macro) \

class BunBuiltinNames {
public:
    // FIXME: Remove the __attribute__((nodebug)) when <rdar://68246686> is fixed.
#if COMPILER(CLANG)
    __attribute__((nodebug))
#endif
    explicit BunBuiltinNames(JSC::VM& vm)
        : m_vm(vm)
        BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(INITIALIZE_BUILTIN_NAMES)
    {
#define EXPORT_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
        BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(EXPORT_NAME)
#undef EXPORT_NAME
    }


    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

private:
    JSC::VM& m_vm;
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(DECLARE_BUILTIN_NAMES)
};

} // namespace Bun

