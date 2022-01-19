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
    macro(dir) \
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
    macro(process) \
    macro(map) \
    macro(addEventListener) \
    macro(removeEventListener) \
    macro(prependEventListener) \
    macro(write) \
    macro(end) \
    macro(close) \
    macro(destroy) \
    macro(cork) \
    macro(uncork) \
    macro(isPaused) \
    macro(read) \
    macro(pipe) \
    macro(unpipe) \
    macro(once) \
    macro(on) \
    macro(unshift) \
    macro(resume) \
    macro(pause) \
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

