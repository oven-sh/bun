#include "ConstantsObject.h"
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

using namespace JSC;

JSObject* createConstantsObject(VM& vm, JSGlobalObject* globalObject, JSValue prototype, std::span<const HashTableValue> rows)
{
    unsigned inlineCapacity = std::min<size_t>(rows.size(), JSFinalObject::maxInlineCapacity);
    JSObject* object = constructEmptyObject(vm, JSFinalObject::createStructure(vm, globalObject, prototype, inlineCapacity));
    for (const auto& row : rows) {
        Identifier name = Identifier::fromString(vm, row.m_key);
        if (row.m_attributes & PropertyAttribute::ConstantInteger)
            object->putDirect(vm, name, jsNumber(row.constantInteger()));
        else if (row.m_attributes & PropertyAttribute::PropertyCallback)
            object->putDirect(vm, name, row.lazyPropertyCallback()(vm, object));
        else {
            ASSERT(row.m_attributes & PropertyAttribute::Function);
            object->putDirectNativeFunction(vm, globalObject, name, row.functionLength(), row.function(), ImplementationVisibility::Public, NoIntrinsic, 0);
        }
    }
    return object;
}

} // namespace Bun
