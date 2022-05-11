// clang-format off

#pragma once

#include "root.h"


#include "helpers.h"

#include "JavaScriptCore/BuiltinUtils.h"


namespace WebCore {

using namespace JSC;


#if !defined(BUN_ADDITIONAL_PRIVATE_IDENTIFIERS)
#define BUN_ADDITIONAL_PRIVATE_IDENTIFIERS(macro)
#endif




#define BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(macro) \
    macro(addEventListener) \
    macro(argv) \
    macro(basename) \
    macro(chdir) \
    macro(close) \
    macro(code) \
    macro(connect) \
    macro(cork) \
    macro(cwd) \
    macro(delimiter) \
    macro(whenSignalAborted) \
    macro(destroy) \
    macro(dir) \
    macro(dirname) \
    macro(end) \
    macro(errno) \
    macro(execArgv) \
    macro(extname) \
    macro(file) \
    macro(filePath) \
    macro(format) \
    macro(get) \
    macro(hash) \
    macro(host) \
    macro(hostname) \
    macro(href) \
    macro(isAbsolute) \
    macro(isPaused) \
    macro(isWindows) \
    macro(join) \
    macro(map) \
    macro(nextTick) \
    macro(normalize) \
    macro(on) \
    macro(once) \
    macro(options) \
    macro(origin) \
    macro(parse) \
    macro(password) \
    macro(patch) \
    macro(path) \
    macro(pathname) \
    macro(pause) \
    macro(pid) \
    macro(pipe) \
    macro(port) \
    macro(post) \
    macro(ppid) \
    macro(prependEventListener) \
    macro(process) \
    macro(protocol) \
    macro(put) \
    macro(read) \
    macro(relative) \
    macro(require) \
    macro(resolveSync) \
    macro(removeEventListener) \
    macro(resolve) \
    macro(resume) \
    macro(search) \
    macro(searchParams) \
    macro(sep) \
    macro(syscall) \
    macro(title) \
    macro(toNamespacedPath) \
    macro(trace) \
    macro(uncork) \
    macro(unpipe) \
    macro(unshift) \
    macro(url) \
    macro(username) \
    macro(version) \
    macro(versions) \
    macro(write) \
    macro(dataView) \
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

} // namespace WebCore

