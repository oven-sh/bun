#include "engine/Engine.h"

namespace JSC {

JSArrayBufferView* ArrayBufferView::wrap(JSGlobalObject* lexicalGlobalObject, JSGlobalObject* globalObject)
{
    auto* structure = globalObject->typedArrayStructure(m_type, isResizableOrGrowableShared());
    if (m_type == TypeDataView)
        return JSDataView::create(lexicalGlobalObject, structure, m_buffer.ptr(), m_byteOffset, m_byteLength);
    return Engine::view_recreate_on_buffer(globalObject, structure, m_buffer, m_byteOffset, byteLengthRaw() >> logElementSize(m_type), !isAutoLength());
}

RefPtr<ArrayBufferView> JSArrayBufferView::possiblySharedImpl()
{
    switch (type()) {
#define ENGINE_CASE(name) \
    case name##ArrayType: \
        return wrappedAs<name##Array>();
        FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW(ENGINE_CASE)
#undef ENGINE_CASE
    default:
        return wrappedAs<DataView>();
    }
}

} // namespace JSC
