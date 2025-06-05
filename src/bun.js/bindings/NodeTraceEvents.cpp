#include "root.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSString.h"
#include "BunClientData.h"

namespace Bun {

using namespace JSC;

// Store the trace event categories from command line
static WTF::String* g_traceEventCategories = nullptr;

void setTraceEventCategories(const char* categories)
{
    if (categories && *categories) {
        g_traceEventCategories = new WTF::String(categories);
    }
}

extern "C" void Bun__setTraceEventCategories(const char* categories)
{
    setTraceEventCategories(categories);
}

static JSC_DECLARE_HOST_FUNCTION(getTraceEventCategoriesCallback);

static JSC_DEFINE_HOST_FUNCTION(getTraceEventCategoriesCallback, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    if (g_traceEventCategories && !g_traceEventCategories->isEmpty()) {
        return JSValue::encode(jsString(globalObject->vm(), *g_traceEventCategories));
    }
    return JSValue::encode(jsEmptyString(globalObject->vm()));
}

void setupNodeTraceEvents(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    
    // Add $getTraceEventCategories function
    globalObject->putDirect(
        vm,
        Identifier::fromString(vm, "$getTraceEventCategories"_s),
        JSFunction::create(vm, globalObject, 0, "$getTraceEventCategories"_s, getTraceEventCategoriesCallback, ImplementationVisibility::Public),
        PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly
    );
}

} // namespace Bun