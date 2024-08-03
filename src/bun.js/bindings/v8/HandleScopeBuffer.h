#pragma once

#include "v8.h"
#include "v8/TaggedPointer.h"
#include "v8/Map.h"

namespace v8 {

class HandleScopeBuffer : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static HandleScopeBuffer* create(JSC::VM& vm, JSC::Structure* structure);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), 0, 0);
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<HandleScopeBuffer, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForHandleScopeBuffer.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForHandleScopeBuffer = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForHandleScopeBuffer.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForHandleScopeBuffer = std::forward<decltype(space)>(space); });
    }

    TaggedPointer* createHandle(JSCell* address);
    TaggedPointer* createSmiHandle(int32_t smi);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    struct Handle {
        Handle(const Map* map_, JSCell* object_)
            : to_object(&this->map)
            , map(const_cast<Map*>(map_))
            , object(object_)
        {
        }

        Handle(int32_t smi)
            : to_object(smi)
        {
        }

        Handle(const Handle& that)
        {
            *this = that;
        }

        Handle& operator=(const Handle& that)
        {
            map = that.map;
            object = that.object;
            if (that.to_object.type() == TaggedPointer::Type::Smi) {
                to_object = that.to_object;
            } else {
                to_object = &this->map;
            }
            return *this;
        }

        Handle() {}

        // either smi or points to this->map
        TaggedPointer to_object;
        // these two fields are laid out so that V8 can find the map
        TaggedPointer map;
        JSCell* object;
    };

private:
    // TODO make resizable
    static constexpr int capacity = 64;

    Handle storage[capacity];
    int size = 0;

    Handle& createUninitializedHandle();

    HandleScopeBuffer(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

}
