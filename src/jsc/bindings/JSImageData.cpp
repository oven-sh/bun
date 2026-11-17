// The C++ of `ImageData` in ImageData.bind.ts.
#include "root.h"

#include "GeneratedImageData.h"
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>

namespace Bun::Bindgen::Generated {

using namespace JSC;

void JSImageData::setData(JSValue data)
{
    auto& vm = this->vm();
    m_data.set(vm, this, data);
    // Also an own property, as in Chrome and Safari: `image.data[i]` in a loop is 3x slower through the getter.
    putDirect(vm, WebCore::builtinNames(vm).dataPublicName(), data, static_cast<unsigned>(PropertyAttribute::ReadOnly));
}

void JSImageData::allocateData(JSGlobalObject* globalObject, bool isFloat16, uint64_t length)
{
    auto scope = DECLARE_THROW_SCOPE(vm());
    JSArrayBufferView* data;
    if (isFloat16)
        data = JSFloat16Array::create(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypeFloat16>(), length);
    else
        data = JSUint8ClampedArray::create(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypeUint8Clamped>(), length);
    RETURN_IF_EXCEPTION(scope, );
    setData(data);
}

} // namespace Bun::Bindgen::Generated
