#pragma once

#include "v8/ObjectTemplate.h"

namespace v8 {

class InternalFieldObject : public JSC::JSDestructibleObject {
public:
    DECLARE_INFO;

    struct InternalField {
        union {
            JSC::JSValue js_value;
            void* raw;
        } data;
        bool is_js_value;

        InternalField(JSC::JSValue js_value)
            : data({ .js_value = js_value })
            , is_js_value(true)
        {
        }

        InternalField(void* raw)
            : data({ .raw = raw })
            , is_js_value(false)
        {
        }

        InternalField()
            : data({ .js_value = JSC::jsUndefined() })
            , is_js_value(true)
        {
        }
    };

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<InternalFieldObject, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForInternalFieldObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForInternalFieldObject = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForInternalFieldObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForInternalFieldObject = std::forward<decltype(space)>(space); });
    }

    using FieldContainer = WTF::Vector<InternalField, 2>;

    FieldContainer* internalFields() { return &fields; }
    static InternalFieldObject* create(JSC::VM& vm, JSC::Structure* structure, ObjectTemplate* objectTemplate);

protected:
    InternalFieldObject(JSC::VM& vm, JSC::Structure* structure, int internalFieldCount)
        : JSC::JSDestructibleObject(vm, structure)
        , fields(internalFieldCount)
    {
    }

private:
    // TODO(@190n) use template with fixed size array for small counts
    FieldContainer fields;
};

}
