#include "NodeSQLiteModule.h"

namespace Zig {

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeSQLiteBackup, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    // TODO: Implement backup function
    throwException(globalObject, scope, createError(globalObject, "backup function not implemented"_s));
    return {};
}

} // namespace Zig