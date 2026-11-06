#pragma once

#include "root.h"
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/ModuleRegistryEntry.h>
#include <JavaScriptCore/ScriptFetchParameters.h>

namespace Bun {

// Every import type a specifier can be registered under. JavaScript first: nearly every entry is one.
inline constexpr JSC::ScriptFetchParameters::Type moduleTypes[] = {
    JSC::ScriptFetchParameters::Type::JavaScript,
    JSC::ScriptFetchParameters::Type::HostDefined,
    JSC::ScriptFetchParameters::Type::JSON,
    JSC::ScriptFetchParameters::Type::Text,
    JSC::ScriptFetchParameters::Type::WebAssembly,
    JSC::ScriptFetchParameters::Type::CSS,
    JSC::ScriptFetchParameters::Type::None,
};
static_assert(static_cast<unsigned>(JSC::ScriptFetchParameters::Type::CSS) == 6, "every Type is listed above");

// The registry has one entry per (specifier, import attribute type); `registryEntry` picks the one that stands for a specifier.
template<typename Each>
void forEachModuleRegistrySpecifier(JSC::JSModuleLoader* loader, const Each& each)
{
    auto& vm = loader->vm();
    for (auto& [key, entry] : loader->moduleMap()) {
        if (!key.first || !entry)
            continue;
        if (key.second != JSC::ScriptFetchParameters::Type::JavaScript && loader->registryEntry(JSC::Identifier::fromUid(vm, key.first)) != entry.get())
            continue;
        each(key.first, entry.get());
    }
}

} // namespace Bun
