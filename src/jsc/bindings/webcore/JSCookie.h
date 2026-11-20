#pragma once

#include "JSDOMInterface.h"
#include "Cookie.h"
#include <JavaScriptCore/DateInstance.h>
namespace WebCore {

class JSCookie final : public JSDOMInterface<JSCookie, Cookie> {
public:
    using JSDOMInterface::JSDOMInterface;

    DECLARE_INFO;
    static constexpr auto subspaceSlots = BUN_SUBSPACE_SLOTS(m_clientSubspaceForCookie, m_subspaceForCookie);
    static constexpr uint8_t jsType = JSAsJSONType;

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);

    DECLARE_VISIT_CHILDREN;

    mutable WriteBarrier<JSC::DateInstance> m_expires;

    static size_t estimatedSize(JSC::JSCell* cell, JSC::VM& vm);
};

JSC::JSValue getInternalProperties(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSCookie* castedThis);

template<> struct JSDOMWrapperConverterTraits<Cookie> {
    using WrapperClass = JSCookie;
};

} // namespace WebCore
