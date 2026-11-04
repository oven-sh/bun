#include "root.h"
#include "BunPythonMemory.h"
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/PyBuffer.h>

namespace Bun {
using namespace JSC;

JSValue copyOfPythonMemory(JSGlobalObject* globalObject, JSValue value)
{
    if (!Python::exportsMemoryToHost(value))
        return value;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    Python::BufferHolder holder(globalObject);
    bool ok = holder.get(value);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT_UNUSED(ok, ok);
    auto bytes = holder.buffer.span();
    auto* copy = JSUint8Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypeUint8>(), bytes.size());
    RETURN_IF_EXCEPTION(scope, {});
    if (!bytes.empty())
        memcpy(copy->typedVector(), bytes.data(), bytes.size());
    return copy;
}

std::optional<std::span<const uint8_t>> bytesOfPythonMemory(JSGlobalObject* globalObject, JSValue value, PythonMemoryAccess access)
{
    if (!Python::exportsMemoryToHost(value))
        return std::nullopt;
    if (access == PythonMemoryAccess::RunsNoCode && Python::getBufferRunsCode(value))
        return std::nullopt;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue holder = Python::memoryForHost(globalObject, value);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    if (auto* view = dynamicDowncast<JSArrayBufferView>(holder))
        return view->span();
    Python::HostMemory memory;
    Python::locateMemoryForHost(holder.asCell(), memory);
    return std::span<const uint8_t> { memory.data, memory.length };
}

}
