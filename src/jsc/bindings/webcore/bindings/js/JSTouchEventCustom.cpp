#include "config.h"
#include "JSTouchEvent.h"

#include "TouchEvent.h"
#include <JavaScriptCore/JSArray.h>

namespace WebCore {

static JSC::JSValue touchListOrEmptyArray(JSC::JSGlobalObject& lexicalGlobalObject, const JSTouchEvent& wrapper, JSValueInWrappedObject& list)
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject.vm());
    return cachedPropertyValue(throwScope, lexicalGlobalObject, wrapper, list, [&wrapper](JSC::ThrowScope&) -> JSC::JSValue {
        return JSC::constructEmptyArray(wrapper.realm(), nullptr);
    });
}

JSC::JSValue JSTouchEvent::touches(JSC::JSGlobalObject& lexicalGlobalObject) const
{
    return touchListOrEmptyArray(lexicalGlobalObject, *this, wrapped().touches());
}

JSC::JSValue JSTouchEvent::targetTouches(JSC::JSGlobalObject& lexicalGlobalObject) const
{
    return touchListOrEmptyArray(lexicalGlobalObject, *this, wrapped().targetTouches());
}

JSC::JSValue JSTouchEvent::changedTouches(JSC::JSGlobalObject& lexicalGlobalObject) const
{
    return touchListOrEmptyArray(lexicalGlobalObject, *this, wrapped().changedTouches());
}

template<typename Visitor>
void JSTouchEvent::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    wrapped().touches().visit(visitor);
    wrapped().targetTouches().visit(visitor);
    wrapped().changedTouches().visit(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSTouchEvent);

} // namespace WebCore
