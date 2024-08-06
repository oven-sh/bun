#pragma once

#include "JavaScriptCore/SubspaceAccess.h"
#include "v8.h"
#include "v8/Context.h"
#include "v8/Local.h"
#include "v8/Isolate.h"
#include "v8/FunctionTemplate.h"
#include "v8/MaybeLocal.h"
#include "v8/Object.h"
#include "v8/Template.h"

namespace v8 {

class ObjectTemplate : public Template, public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    DECLARE_INFO;

    BUN_EXPORT static Local<ObjectTemplate> New(Isolate* isolate, Local<FunctionTemplate> constructor = Local<FunctionTemplate>());
    BUN_EXPORT MaybeLocal<Object> NewInstance(Local<Context> context);
    BUN_EXPORT void SetInternalFieldCount(int value);
    BUN_EXPORT int InternalFieldCount() const;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<ObjectTemplate, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForObjectTemplate.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForObjectTemplate = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForObjectTemplate.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForObjectTemplate = std::forward<decltype(space)>(space); });
    }

    DECLARE_VISIT_CHILDREN;

private:
    class Internals {
        int internalFieldCount = 0;
        JSC::LazyProperty<ObjectTemplate, JSC::Structure> objectStructure;
        friend class ObjectTemplate;
    };

    // do not use directly inside exported V8 functions, use internals()
    Internals __internals;

    ObjectTemplate* localToObjectPointer()
    {
        ASSERT(this == static_cast<Data*>(this));
        return Data::localToObjectPointer<ObjectTemplate>();
    }

    const ObjectTemplate* localToObjectPointer() const
    {
        ASSERT(this == static_cast<const Data*>(this));
        return Data::localToObjectPointer<ObjectTemplate>();
    }

    Internals& internals()
    {
        ASSERT(this == static_cast<Data*>(this));
        return localToObjectPointer()->__internals;
    }

    const Internals& internals() const
    {
        ASSERT(this == static_cast<const Data*>(this));
        return localToObjectPointer()->__internals;
    }

    ObjectTemplate(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, DummyCallback, DummyCallback)
    {
    }

    void finishCreation(JSC::VM& vm);
};

}
