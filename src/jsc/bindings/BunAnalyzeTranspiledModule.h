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
// Frees a linked module's record from its evaluate hook (JSC runs that hook
// once per module); a provider shared across globals (--isolate) keeps it.
void releaseModuleInfoAfterLink(JSC::VM&, Zig::GlobalObject*, JSC::JSValue moduleRecordValue);
}
