#include "root.h"
#include "headers-handwritten.h"

namespace Zig {
class GlobalObject;
}
namespace JSC {
class SourceCode;
}

namespace Bun {

JSC::Structure* createCommonJSModuleStructure(
    Zig::GlobalObject* globalObject);

JSC::SourceCode createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source);

} // namespace Bun
