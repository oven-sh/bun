#include "config.h"
#include "JSHistory.h"

#include "JSValueInWrappedObjectInlines.h"
#include "SerializedScriptValue.h"

namespace WebCore {
using namespace JSC;

JSValue JSHistory::state(JSGlobalObject& lexicalGlobalObject) const
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject.vm());
    return cachedPropertyValue(throwScope, lexicalGlobalObject, *this, wrapped().cachedState(), [this, &lexicalGlobalObject](JSC::ThrowScope&) {
        RefPtr serialized = wrapped().state();
        return serialized ? serialized->deserialize(lexicalGlobalObject, realm()) : jsNull();
    });
}

template<typename Visitor>
void JSHistory::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    wrapped().cachedState().visitInGCThread(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSHistory);

} // namespace WebCore
