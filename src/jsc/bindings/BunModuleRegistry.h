#pragma once

#include "root.h"
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/ModuleRegistryEntry.h>

namespace Bun {

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
