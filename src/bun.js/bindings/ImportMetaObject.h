#pragma once

#include "root.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include "JSDOMWrapperCache.h"

extern "C" JSC_DECLARE_HOST_FUNCTION(functionImportMeta__resolveSync);
extern "C" JSC::EncodedJSValue Bun__resolve(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool is_esm);
extern "C" JSC::EncodedJSValue Bun__resolveSync(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool is_esm);
extern "C" JSC::EncodedJSValue Bun__resolveSyncWithSource(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, BunString* from, bool is_esm);

namespace Zig {

using namespace JSC;
using namespace WebCore;

JSC_DECLARE_CUSTOM_GETTER(jsRequireCacheGetter);
JSC_DECLARE_CUSTOM_SETTER(jsRequireCacheSetter);

class ImportMetaObject final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static ImportMetaObject* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        ImportMetaObject* ptr = new (NotNull, JSC::allocateCell<ImportMetaObject>(vm)) ImportMetaObject(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    static JSC::Structure* createRequireFunctionStructure(JSC::VM& vm, JSGlobalObject* globalObject);
    static JSObject* createRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString);

    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSC::JSString* keyString);
    static ImportMetaObject* create(JSC::JSGlobalObject* globalObject, JSValue keyString);

    DECLARE_INFO;

    static constexpr bool needsDestruction = true;

    template<typename CellType, SubspaceAccess>
    static CompleteSubspace* subspaceFor(VM& vm)
    {
        return &vm.destructibleObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
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