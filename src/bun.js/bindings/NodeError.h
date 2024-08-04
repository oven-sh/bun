#pragma once

#include "AbortSignal.h"
#include "JavaScriptCore/WriteBarrier.h"
#include "ZigGlobalObject.h"
#include "root.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include "BunClientData.h"

namespace Bun {

// clang-format off
#define FOR_EACH_NODE_ERROR_WITH_CODE(macro) \
    macro(TypeError, TypeError, ERR_INVALID_ARG_TYPE) \
    macro(RangeError, RangeError, ERR_OUT_OF_RANGE) \
    macro(Error, Error, ERR_IPC_DISCONNECTED) \
    macro(Error, Error, ERR_SERVER_NOT_RUNNING) \
    macro(TypeError, TypeError, ERR_MISSING_ARGS) \
    macro(Error, Error, ERR_IPC_CHANNEL_CLOSED) \
    macro(TypeError, TypeError, ERR_SOCKET_BAD_TYPE) \
    macro(Error, AbortError, ABORT_ERR)


#define COUNT_ERROR_WITH_CODE_ENUM(E, name, code) +1
static constexpr size_t NODE_ERROR_COUNT = 0 FOR_EACH_NODE_ERROR_WITH_CODE(COUNT_ERROR_WITH_CODE_ENUM);
#undef COUNT_ERROR_WITH_CODE_ENUM
using namespace JSC;
// clang-format on

enum NodeErrorCode : uint8_t {
#define DECLARE_ERROR_WITH_CODE_ENUM(E, name, code) code,
    FOR_EACH_NODE_ERROR_WITH_CODE(DECLARE_ERROR_WITH_CODE_ENUM)
#undef DECLARE_ERROR_WITH_CODE_ENUM
};

class NodeErrorCache : public JSC::JSInternalFieldObjectImpl<NODE_ERROR_COUNT> {
public:
    using Base = JSInternalFieldObjectImpl<NODE_ERROR_COUNT>;
    using Field = NodeErrorCode;

    DECLARE_EXPORT_INFO;

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(NodeErrorCache);
    }

    template<typename, SubspaceAccess mode>
    static GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NodeErrorCache, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNodeErrors.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeErrors = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNodeErrors.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeErrors = std::forward<decltype(space)>(space); });
    }

    static NodeErrorCache* create(VM& vm, Structure* structure);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

    JSObject* createError(VM& vm, Zig::GlobalObject* globalObject, NodeErrorCode code, JSValue message, JSValue options);

    CacheableAbortReason m_cacheableAbortReason { 0, CommonAbortReason::None };
    mutable WriteBarrier<Unknown> m_cachedReason;

private:
    JS_EXPORT_PRIVATE NodeErrorCache(VM&, Structure*);
    DECLARE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE);
    void finishCreation(VM&);
};

JSC::JSObject* createError(Zig::GlobalObject* globalObject, NodeErrorCode code, const WTF::String& message);
JSC::JSObject* createError(JSC::JSGlobalObject* globalObject, NodeErrorCode code, const WTF::String& message);
JSC::JSObject* createError(Zig::GlobalObject* globalObject, NodeErrorCode code, JSC::JSValue message);
JSC::JSObject* createError(VM& vm, Zig::GlobalObject* globalObject, NodeErrorCode code, JSValue message, JSValue options = jsUndefined());
JSC::JSValue toJS(JSC::JSGlobalObject*, NodeErrorCode);

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_INVALID_ARG_TYPE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_OUT_OF_RANGE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_IPC_DISCONNECTED, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*));
JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_SERVER_NOT_RUNNING, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*));
JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_IPC_CHANNEL_CLOSED, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*));
JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_SOCKET_BAD_TYPE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*));

}
