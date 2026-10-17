#include "config.h"
#include "JSDOMClassSetup.h"

#include "JSDOMBindingFacade.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/StructureCreateInlines.h>

namespace WebCore {
using namespace JSC;

Structure* createDOMStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype, TypeInfo typeInfo, const ClassInfo* classInfo, IndexingType indexingType)
{
    return Structure::create(vm, globalObject, prototype, typeInfo, classInfo, indexingType);
}

void finishCreatingDOMPrototype(VM& vm, JSObject& prototype, const ClassInfo* wrapperClassInfo, std::span<const HashTableValue> values)
{
    reifyStaticProperties(vm, wrapperClassInfo, values, prototype);
    WebCore::putDirectWithoutTransition(&prototype, vm, vm.propertyNames->toStringTagSymbol, jsNontrivialString(vm, prototype.classInfo()->className), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
}

EncodedJSValue constructorOfDOMPrototype(JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, const ClassInfo* prototypeClassInfo, JSValue (*getConstructor)(VM&, const JSGlobalObject*))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto prototype = JSValue::decode(thisValue);
    if (!prototype.inherits(prototypeClassInfo)) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(getConstructor(vm, asObject(prototype)->realm()));
}

} // namespace WebCore
