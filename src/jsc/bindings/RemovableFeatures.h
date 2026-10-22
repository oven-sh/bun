#pragma once

#include <JavaScriptCore/AOTRemovableFeature.h>
#include "BunRemovableFeatures.h"
#include "ErrorCode+List.h"

namespace Bun {

ASCIILiteral textOfRemovableFeature(JSC::RemovableFeature);
ASCIILiteral trimFeatureNameOf(JSC::RemovableFeature);

}

#define BUN_BEGIN_REMOVABLE_ENTRY_POINT(feature, stub, ...) \
    return ::JSC::callRemovableBody<::Bun::Feature::feature, ::JSC::RemovedFeatureStub::stub, __VA_ARGS__>(nullptr, [&]() ALWAYS_INLINE_LAMBDA WTF_IGNORES_THREAD_SAFETY_ANALYSIS -> __VA_ARGS__ {
#define BUN_END_REMOVABLE_ENTRY_POINT });
#define BUN_REMOVABLE_DEFINITION(feature, ...) ::JSC::recordRemovableDefinition<::Bun::Feature::feature, __VA_ARGS__>()
#define BUN_REMOVABLE_HOST_FUNCTION_DEFINITION(feature, function) ::JSC::recordRemovableDefinition<::Bun::Feature::feature, function, ::JSC::RemovedFeatureStub::Throw>()
#define BUN_REMOVABLE_BUILTIN_HOST_FUNCTION_DEFINITION(feature, builtin, function) ::JSC::recordRemovableDefinition<::Bun::Feature::feature, function, ::JSC::RemovedFeatureStub::Throw, builtin>()

extern "C" bool Bun__throwIfModuleIsRemoved(JSC::JSGlobalObject*, uint16_t feature, const char* specifier, size_t length, Bun::ErrorCode = Bun::ErrorCode::ERR_MODULE_NOT_FOUND);
extern "C" void Bun__prepareTrimmedExecutable();
extern "C" [[noreturn]] void Bun__abortForRemovedLocaleData();
