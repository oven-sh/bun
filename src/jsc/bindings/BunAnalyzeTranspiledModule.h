struct bun_ModuleInfoDeserialized;
extern "C" void zig__ModuleInfoDeserialized__deinit(bun_ModuleInfoDeserialized* info);

namespace JSC {
class VM;
class JSValue;
}
namespace Zig {
class GlobalObject;
}
namespace Bun {
// Frees the module_info of every transpiled module reachable from the root of
// a linked load; JSC does not ask for those records again (except under --isolate).
void releaseModuleInfoAfterLink(JSC::VM&, Zig::GlobalObject*, JSC::JSValue moduleRecordValue);
}
