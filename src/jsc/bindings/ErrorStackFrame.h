#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"

namespace Bun {

ZigStackFramePosition getPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

} // namespace Bun
