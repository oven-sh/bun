#include "root.h"

#include "JSNodeSQLiteDatabaseSync.h"
#include "JSNodeSQLiteDatabaseSyncPrototype.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

using namespace JSC;


const ClassInfo JSNodeSQLiteDatabaseSyncPrototype::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteDatabaseSyncPrototype) };

void JSNodeSQLiteDatabaseSyncPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}


} // namespace Bun