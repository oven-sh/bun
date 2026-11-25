#pragma once

#include "JSDOMIterator.h"
#include "JSDOMInterface.h"
#include "CookieMap.h"

namespace WebCore {

class JSCookieMap final : public JSDOMInterface<JSCookieMap, CookieMap> {
public:
    using JSDOMInterface::JSDOMInterface;

    DECLARE_INFO;
    static constexpr auto subspaceSlots = BUN_SUBSPACE_SLOTS(m_clientSubspaceForCookieMap, m_subspaceForCookieMap);
    static constexpr uint8_t jsType = JSAsJSONType;

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);

    static size_t estimatedSize(JSC::JSCell* cell, JSC::VM& vm);
};
JSC::JSValue getInternalProperties(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSCookieMap* castedThis);

template<> struct JSDOMWrapperConverterTraits<CookieMap> {
    using WrapperClass = JSCookieMap;
};

struct CookieMapIteratorTraits;
using CookieMapIteratorBase = JSDOMIteratorBase<JSCookieMap, CookieMapIteratorTraits>;
template<> const JSC::ClassInfo CookieMapIteratorBase::s_info;
JSC::JSObject* cookieMapIteratorPrototype(JSDOMGlobalObject&);

} // namespace WebCore
