#pragma once

#include "root.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include "JSDOMWrapperCache.h"

extern "C" JSC_DECLARE_HOST_FUNCTION(functionImportMeta__resolveSync);
extern "C" JSC::EncodedJSValue Bun__resolve(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool is_esm);
extern "C" JSC::EncodedJSValue Bun__resolveSync(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool is_esm);
extern "C" JSC::EncodedJSValue Bun__resolveSyncWithSource(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, ZigString* from, bool is_esm);

namespace Zig {

using namespace JSC;
using namespace WebCore;

class ImportMetaObject final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static ImportMetaObject* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        ImportMetaObject* ptr = new (NotNull, JSC::allocateCell<ImportMetaObject>(vm)) ImportMetaObject(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    static JSC::Structure* createResolveFunctionStructure(JSC::VM& vm, Zig::GlobalObject* globalObject);
    static JSValue createResolveFunctionPrototype(JSC::VM& vm, Zig::GlobalObject* globalObject);
    static JSObject* createRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString);

    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSC::JSValue key);

    static inline Zig::ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSC::JSString* keyString)
    {
        // TODO: optimize this by reusing the same JSC::Structure object and using putDirectOffset
        auto& vm = globalObject->vm();
        auto view = keyString->value(globalObject);
        JSC::Structure* structure = WebCore::getDOMStructure<Zig::ImportMetaObject>(vm, *reinterpret_cast<Zig::GlobalObject*>(globalObject));
        Zig::ImportMetaObject* metaProperties = Zig::ImportMetaObject::create(vm, globalObject, structure);
        if (UNLIKELY(!metaProperties)) {
            return nullptr;
        }

        auto clientData = WebCore::clientData(vm);
        auto& builtinNames = clientData->builtinNames();

        auto index = view.reverseFind('/', view.length());
        if (index != WTF::notFound) {
            metaProperties->putDirect(vm, builtinNames.dirPublicName(),
                JSC::jsSubstring(globalObject, keyString, 0, index));
            metaProperties->putDirect(
                vm, builtinNames.filePublicName(),
                JSC::jsSubstring(globalObject, keyString, index + 1, view.length() - index - 1));
        } else {
            metaProperties->putDirect(vm, builtinNames.filePublicName(), keyString);
        }
        metaProperties->putDirect(
            vm,
            builtinNames.pathPublicName(),
            keyString,
            0);

        metaProperties->putDirect(
            vm,
            builtinNames.requirePublicName(),
            Zig::ImportMetaObject::createRequireFunction(vm, globalObject, view),
            PropertyAttribute::Builtin | PropertyAttribute::Function | 0);

        if (view.startsWith('/')) {
            metaProperties->putDirect(vm, builtinNames.urlPublicName(), JSC::JSValue(JSC::jsString(vm, WTF::URL::fileURLWithFileSystemPath(view).string())));
        } else {
            if (view.startsWith("node:"_s) || view.startsWith("bun:"_s)) {
                metaProperties->putDirect(globalObject->vm(), JSC::Identifier::fromString(globalObject->vm(), "primordials"_s), reinterpret_cast<Zig::GlobalObject*>(globalObject)->primordialsObject());
            }
            metaProperties->putDirect(vm, builtinNames.urlPublicName(), keyString);
        }

        return metaProperties;
    }

    DECLARE_INFO;

    static constexpr bool needsDestruction = true;

    template<typename CellType, SubspaceAccess>
    static CompleteSubspace* subspaceFor(VM& vm)
    {
        return &vm.destructibleObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* createPrototype(VM& vm, JSDOMGlobalObject& globalObject);
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

private:
    ImportMetaObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(ImportMetaObject, ImportMetaObject::Base);

}