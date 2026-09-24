#pragma once

#include <JavaScriptCore/Identifier.h>

namespace Bun {

// clang-format off
#define BUN_NODE_VM_OPTION_NAMES_EACH(macro) \
    macro(breakOnSigint) \
    macro(cachedData) \
    macro(codeGeneration) \
    macro(columnOffset) \
    macro(contextCodeGeneration) \
    macro(contextExtensions) \
    macro(contextName) \
    macro(contextOrigin) \
    macro(displayErrors) \
    macro(importModuleDynamically) \
    macro(lineOffset) \
    macro(microtaskMode) \
    macro(parsingContext) \
    macro(produceCachedData) \
    macro(strings) \
    macro(timeout) \
    macro(wasm)
// clang-format on

// node:vm option names, atomized on first use and kept per VM, so a lookup does not add and remove an atom.
class NodeVMOptionNames {
public:
#define BUN_NODE_VM_OPTION_NAME_ACCESSOR(name)                      \
    const JSC::Identifier& name(JSC::VM& vm)                        \
    {                                                               \
        if (m_##name.isNull()) [[unlikely]]                         \
            m_##name = JSC::Identifier::fromString(vm, #name ""_s); \
        return m_##name;                                            \
    }
    BUN_NODE_VM_OPTION_NAMES_EACH(BUN_NODE_VM_OPTION_NAME_ACCESSOR)
#undef BUN_NODE_VM_OPTION_NAME_ACCESSOR

private:
#define BUN_NODE_VM_OPTION_NAME_MEMBER(name) JSC::Identifier m_##name;
    BUN_NODE_VM_OPTION_NAMES_EACH(BUN_NODE_VM_OPTION_NAME_MEMBER)
#undef BUN_NODE_VM_OPTION_NAME_MEMBER
};

} // namespace Bun
