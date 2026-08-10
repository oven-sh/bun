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
// Once a module has linked, JSC never asks for its record again unless the
// provider is shared across globals (--isolate). Free it before evaluation so a
// plain `bun run` does not carry one per loaded module.
void releaseModuleInfoAfterLink(JSC::VM&, Zig::GlobalObject*, JSC::JSValue moduleRecordValue);
}
