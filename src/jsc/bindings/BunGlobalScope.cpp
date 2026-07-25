
#include "root.h"
#include "ZigGlobalObject.h"
#include "BunGlobalScope.h"
#include "JavaScriptCore/IntlObject.h"
#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/VMTraps.h"
#include "JavaScriptCore/VMTrapsInlines.h"
#include "JavaScriptCore/LazyClassStructure.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "BunClientData.h"
#include <unicode/utypes.h>

// Apple's SDK has no <unicode/uloc.h>; utypes.h supplies U_CAPI + renaming.
U_CAPI const char* U_EXPORT2 uloc_getDefault(void);

namespace Bun {

using namespace JSC;

// Ports V8's Isolate::DefaultLocale(). Leaving this hook null makes
// JSC::defaultLocale() consult WTF::platformUserPreferredLanguages(), which
// short-circuits to "en-US" before JSC's own uloc_getDefault() fallback runs.
String GlobalScope::defaultLanguage()
{
    const char* localeID = uloc_getDefault();
    if (!strcmp(localeID, "en_US_POSIX") || !strcmp(localeID, "c") || !strcmp(localeID, "C"))
        return "en-US"_s;
    String tag = JSC::languageTagForLocaleID(localeID);
    return tag.isEmpty() ? "und"_s : tag;
}

void GlobalScope::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_encodeIntoObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            auto& vm = init.vm;
            auto& globalObject = *init.owner;
            Structure* structure = globalObject.structureCache().emptyObjectStructureForPrototype(&globalObject, globalObject.objectPrototype(), 2);
            PropertyOffset offset;
            auto clientData = WebCore::clientData(vm);
            structure = Structure::addPropertyTransition(vm, structure, clientData->builtinNames().readPublicName(), 0, offset);
            RELEASE_ASSERT(offset == 0);
            structure = Structure::addPropertyTransition(vm, structure, clientData->builtinNames().writtenPublicName(), 0, offset);
            RELEASE_ASSERT(offset == 1);
            init.set(structure);
        });
}

DEFINE_VISIT_CHILDREN(GlobalScope);

template<typename Visitor>
void GlobalScope::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    GlobalScope* thisObject = uncheckedDowncast<GlobalScope>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    thisObject->m_encodeIntoObjectStructure.visit(visitor);
}

const JSC::ClassInfo GlobalScope::s_info = { "GlobalScope"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(GlobalScope) };

}
