#pragma once

#include <JavaScriptCore/AOTRemovableFeature.h>
#include "BunRemovableFeatures.h"
#include "ErrorCode+List.h"

extern "C" JSC::EncodedJSValue Bun__createStandInForRemovedBinding(JSC::JSGlobalObject*, uint16_t feature);

namespace Bun {

template<JSC::RemovableFeature feature, auto function, uint32_t builtin, typename Realm>
ALWAYS_INLINE std::invoke_result_t<decltype(function), Realm> createRemovableBinding(Realm realm)
{
    if (JSC::isFeatureRemoved(feature)) [[unlikely]] {
        JSC::EncodedJSValue standIn = Bun__createStandInForRemovedBinding(realm, static_cast<uint16_t>(feature));
        if constexpr (std::is_same_v<std::invoke_result_t<decltype(function), Realm>, JSC::EncodedJSValue>)
            return standIn;
        else
            return JSC::JSValue::decode(standIn);
    }
    return JSC::callRemovableBuiltin<feature, function, builtin>(realm);
}

}

#define BUN_BEGIN_REMOVABLE_ENTRY_POINT(feature, stub, ...) \
    return ::JSC::callRemovableBody<::Bun::Feature::feature, ::JSC::RemovedFeatureStub::stub, __VA_ARGS__>(nullptr, [&]() ALWAYS_INLINE_LAMBDA WTF_IGNORES_THREAD_SAFETY_ANALYSIS -> __VA_ARGS__ {
#define BUN_END_REMOVABLE_ENTRY_POINT \
    });
#define BUN_REMOVABLE_DEFINITION(feature, ...) ::JSC::recordRemovableDefinition<::Bun::Feature::feature, __VA_ARGS__>()
#define BUN_REMOVABLE_HOST_FUNCTION_DEFINITION(feature, function) ::JSC::recordRemovableDefinition<::Bun::Feature::feature, function, ::JSC::RemovedFeatureStub::Throw>()
#define BUN_REMOVABLE_BUILTIN_HOST_FUNCTION_DEFINITION(feature, builtin, function) ::JSC::recordRemovableDefinition<::Bun::Feature::feature, function, ::JSC::RemovedFeatureStub::Throw, builtin>()

extern "C" bool Bun__throwIfModuleIsRemoved(JSC::JSGlobalObject*, uint16_t feature, const char* specifier, size_t length, Bun::ErrorCode = Bun::ErrorCode::ERR_MODULE_NOT_FOUND);
extern "C" void Bun__prepareTrimmedExecutable();
extern "C" [[noreturn]] void Bun__abortForRemovedLocaleData();
