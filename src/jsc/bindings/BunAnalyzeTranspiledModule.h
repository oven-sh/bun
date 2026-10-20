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
// Once a graph has linked, JSC never asks for its records again unless the
// providers are shared across globals (--isolate). Called with the root of a
// load before it evaluates: frees the record of every transpiled module the
// root reaches, so a plain `bun run` does not carry one per loaded module.
void releaseModuleInfoAfterLink(JSC::VM&, Zig::GlobalObject*, JSC::JSValue moduleRecordValue);
}
