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
// provider is shared across globals (--isolate). JSC runs the evaluate hook
// once per module body, so freeing the record there leaves a plain `bun run`
// with none per loaded module.
void releaseModuleInfoAfterLink(JSC::VM&, Zig::GlobalObject*, JSC::JSValue moduleRecordValue);
}
