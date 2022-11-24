#pragma once

#include "root.h"
#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

extern "C" JSC::EncodedJSValue jsFunctionGetOnigurumaRegExpConstructor(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName attributeName);

namespace Zig {

using namespace JSC;
using namespace WebCore;

class OnigurumaRegEx final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static OnigurumaRegEx* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        OnigurumaRegEx* ptr = new (NotNull, JSC::allocateCell<OnigurumaRegEx>(vm)) OnigurumaRegEx(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    static OnigurumaRegEx* create(JSC::JSGlobalObject* globalObject, WTF::String&& pattern, WTF::String&& flags)
    {
        auto* structure = reinterpret_cast<Zig::GlobalObject*>(globalObject)->OnigurumaRegExpStructure();
        auto* object = create(globalObject->vm(), globalObject, structure);
        object->m_flagsString = WTFMove(flags);
        object->m_patternString = WTFMove(pattern);

        return object;
    }

    DECLARE_EXPORT_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<OnigurumaRegEx, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForOnigurumaRegExp.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForOnigurumaRegExp = WTFMove(space); },
            [](auto& spaces) { return spaces.m_subspaceForOnigurumaRegExp.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForOnigurumaRegExp = WTFMove(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(RegExpObjectType, StructureFlags), info());
    }

    // static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    const WTF::String& flagsString() const { return m_flagsString; }
    void setFlagsString(const WTF::String& flagsString) { m_flagsString = flagsString; }
    const WTF::String& patternString() const { return m_patternString; }
    void setPatternString(const WTF::String& patternString) { m_patternString = patternString; }

    int32_t m_lastIndex = 0;

private:
    OnigurumaRegEx(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&)
    {
        Base::finishCreation(vm());
    }

    WTF::String m_patternString = {};
    WTF::String m_flagsString = {};
};

class OnigurumaRegExpConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static OnigurumaRegExpConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSValue prototype);

    // Must be defined for each specialization class.
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    DECLARE_EXPORT_INFO;

    static JSC::Structure* createClassStructure(JSC::JSGlobalObject*, JSC::JSValue prototype);
    static JSC::JSObject* createPrototype(JSC::JSGlobalObject*);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    OnigurumaRegExpConstructor(JSC::VM& vm, JSC::Structure* structure, JSC::NativeFunction nativeFunction)
        : Base(vm, structure, nativeFunction, nativeFunction)

    {
    }

    void finishCreation(JSC::VM&, JSValue prototype);
};

}