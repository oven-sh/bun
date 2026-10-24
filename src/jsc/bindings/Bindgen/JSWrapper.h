#pragma once
#include "root.h"
#include "BunClientData.h"
#include "Bindgen/ExternTraits.h"
#include "Bindgen/IDLConvert.h"
#include "ErrorCode.h"
#include "JSDOMWrapper.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/Lookup.h>

namespace Bun::Bindgen {

// A cell whose type is JSDOMWrapperType is a JSDestructibleObject, so its ClassInfo is in the cell: no Structure load.
template<typename To>
struct InheritsTraits {
    static constexpr std::optional<JSC::JSTypeRange> typeRange { std::nullopt };
    template<typename From>
    static inline bool inherits(From* from)
    {
        if (from->type() != static_cast<JSC::JSType>(WebCore::JSDOMWrapperType)) {
            ASSERT(!from->JSCell::inheritsSlow(To::info()));
            return false;
        }
        const JSC::ClassInfo* classInfo = uncheckedDowncast<const JSC::JSDestructibleObject>(from)->classInfo();
        ASSERT(classInfo == from->JSCell::classInfo());
        return classInfo == To::info();
    }
};

// The bound `this` of `value` as a `T`, or null if `value` is not a function bound to one.
template<typename T>
inline T* boundThisAs(JSC::JSValue value)
{
    auto* function = dynamicDowncast<JSC::JSBoundFunction>(value);
    return function ? dynamicDowncast<T>(function->boundThis()) : nullptr;
}

JSC::GCClient::IsoSubspace* createSubspaceForClass(JSC::VM&, unsigned classIndex, size_t cellSize);

inline JSC::GCClient::IsoSubspace* subspaceForClass(JSC::VM& vm, unsigned classIndex, size_t cellSize)
{
    if (auto* space = downcast<WebCore::JSVMClientData>(vm.clientData)->clientSubspaces().m_clientSubspaceForBindgenClass[classIndex]) [[likely]]
        return space;
    return createSubspaceForClass(vm, classIndex, cellSize);
}

// Reports a field that holds a cell to a heap snapshot, as a property of that name.
void analyzeInternalField(JSC::JSCell*, JSC::HeapAnalyzer&, JSC::JSValue field, WTF::ASCIILiteral name);

// The constructor object of every generated class that has one.
class JSClassConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static JSClassConstructor* create(JSC::VM&, JSC::JSGlobalObject*, WTF::ASCIILiteral name, JSC::NativeFunction call, JSC::NativeFunction construct, unsigned length, std::span<const JSC::HashTableValue>, JSC::JSObject* prototype);

private:
    JSClassConstructor(JSC::VM&, JSC::Structure*, JSC::NativeFunction call, JSC::NativeFunction construct);
};

// A class called without `new`.
JSC_DECLARE_HOST_FUNCTION(callJSClassConstructor);

// `new` on a class that only native code makes.
JSC_DECLARE_HOST_FUNCTION(illegalConstructor);

// A plain object with the properties of the table, that inherits from `prototypeBase`.
JSC::JSObject* createClassPrototype(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototypeBase, const JSC::ClassInfo*, std::span<const JSC::HashTableValue>);

JSC::Structure* structureForClass(JSC::JSGlobalObject*, unsigned classIndex);
JSC::JSObject* prototypeForClass(JSC::JSGlobalObject*, unsigned classIndex);
JSC::JSObject* constructorForClass(JSC::JSGlobalObject*, unsigned classIndex);
template<typename T> JSC::Structure* structureForClass(JSC::JSGlobalObject* globalObject) { return structureForClass(globalObject, T::classIndex); }
template<typename T> JSC::JSObject* prototypeForClass(JSC::JSGlobalObject* globalObject) { return prototypeForClass(globalObject, T::classIndex); }
template<typename T> JSC::JSObject* constructorForClass(JSC::JSGlobalObject* globalObject) { return constructorForClass(globalObject, T::classIndex); }
// A new instance of a `refCounted` class. Takes the caller's ref on `wrapped`.
template<typename T> T* createWrapper(JSC::JSGlobalObject* globalObject, void* wrapped) { return T::create(JSC::getVM(globalObject), structureForClass<T>(globalObject), wrapped); }
// The class's own, or one for `new.target` (a subclass, Reflect.construct). May throw.
JSC::Structure* structureForNewTarget(JSC::JSGlobalObject*, JSC::CallFrame*, unsigned classIndex);

}
