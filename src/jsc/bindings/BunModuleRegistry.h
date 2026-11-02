#pragma once

#include "root.h"
#include <JavaScriptCore/CyclicModuleRecord.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/ModuleRegistryEntry.h>

namespace Bun {

inline bool isModuleEvaluated(JSC::AbstractModuleRecord* record)
{
    if (!record)
        return false;
    if (auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record))
        return cyclic->status() == JSC::CyclicModuleRecord::Status::Evaluated && !cyclic->evaluationError();
    // SyntheticModuleRecord is "evaluated" once linked (it has an environment).
    return record->moduleEnvironmentMayBeNull() != nullptr;
}

// No load of this entry is in flight: it evaluated (maybe with an error) or its load failed.
inline bool isModuleLoadSettled(JSC::ModuleRegistryEntry* entry)
{
    switch (entry->status()) {
    case JSC::ModuleRegistryEntry::Status::New:
    case JSC::ModuleRegistryEntry::Status::Fetching:
        return false;
    case JSC::ModuleRegistryEntry::Status::FetchFailed:
    case JSC::ModuleRegistryEntry::Status::InstantiationFailed:
    case JSC::ModuleRegistryEntry::Status::EvaluationFailed:
        return true;
    case JSC::ModuleRegistryEntry::Status::Fetched:
        break;
    }
    auto* record = entry->record();
    if (!record)
        return false;
    if (auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record))
        return cyclic->status() == JSC::CyclicModuleRecord::Status::Evaluated;
    return record->moduleEnvironmentMayBeNull() != nullptr;
}

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
