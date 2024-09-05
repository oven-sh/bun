#pragma once

#include "V8Map.h"

namespace v8 {

class ObjectLayout {
private:
    // these two fields are laid out so that V8 can find the map
    TaggedPointer tagged_map;
    union {
        JSC::WriteBarrier<JSC::JSCell> cell;
        double number;
        void* raw;
    } contents;

public:
    ObjectLayout()
        // using a smi value for map is most likely to catch bugs as almost every access will expect
        // map to be a pointer (and even if the assertion is bypassed, it'll be a null pointer)
        : tagged_map(0)
        , contents({ .raw = nullptr })
    {
    }

    ObjectLayout(const Map* map_ptr, JSC::JSCell* cell, JSC::VM& vm, const JSC::JSCell* owner)
        : tagged_map(const_cast<Map*>(map_ptr))
        , contents({ .cell = JSC::WriteBarrier<JSC::JSCell>(vm, owner, cell) })
    {
    }

    ObjectLayout(double number)
        : tagged_map(const_cast<Map*>(&Map::heap_number_map))
        , contents({ .number = number })
    {
    }

    ObjectLayout(void* raw)
        : tagged_map(const_cast<Map*>(&Map::raw_ptr_map))
        , contents({ .raw = raw })
    {
    }

    const Map* map() const { return tagged_map.getPtr<Map>(); }

    double asDouble() const { return contents.number; }

    JSC::JSCell* asCell() const { return contents.cell.get(); }

    void* asRaw() const { return contents.raw; }

    friend class Handle;
    friend class HandleScopeBuffer;
};

// A handle stored in a HandleScope with layout suitable for V8's inlined functions:
// - The first field is a V8 tagged pointer. If it's a SMI (int32), it holds the numeric value
//   directly and the other fields don't matter.
// - Otherwise, if the first field is a pointer value, V8 treats that as a pointer to an object with
//   V8 layout. V8 objects have a tagged pointer to their map (which describes their structure) as
//   the first field. Therefore, in the object case, the first field is a pointer to the second
//   field.
// - V8 will inspect the instance type of the map to determine if it can take fast paths for some
//   functions (notably, Value::IsUndefined()/IsNull() and Object::GetInternalField()). For objects,
//   we use a map with an instance type that makes V8 think it must call SlowGetInternalField(),
//   which we can control. That function (and all other functions that are called on Locals) uses
//   the third field to get the actual object (either a JSCell* or a void*, depending on whether map
//   points to Map::object_map or Map::raw_ptr_map).
struct Handle {
    static_assert(offsetof(ObjectLayout, tagged_map) == 0, "ObjectLayout is wrong");
    static_assert(offsetof(ObjectLayout, contents) == 8, "ObjectLayout is wrong");
    static_assert(sizeof(ObjectLayout) == 16, "ObjectLayout is wrong");

    Handle(const Map* map, JSC::JSCell* cell, JSC::VM& vm, const JSC::JSCell* owner)
        : to_v8_object(&this->object)
        , object(map, cell, vm, owner)
    {
    }

    Handle(double number)
        : to_v8_object(&this->object)
        , object(number)
    {
    }

    Handle(void* raw)
        : to_v8_object(&this->object)
        , object(raw)
    {
    }

    Handle(int32_t smi)
        : to_v8_object(smi)
        , object()
    {
    }

    Handle(const Handle& that)
    {
        *this = that;
    }

    Handle(const ObjectLayout* that)
        : to_v8_object(&this->object)
    {
        object = *that;
    }

    Handle& operator=(const Handle& that)
    {
        object = that.object;
        if (that.to_v8_object.type() == TaggedPointer::Type::Smi) {
            to_v8_object = that.to_v8_object;
        } else {
            to_v8_object = &this->object;
        }
        return *this;
    }

    Handle()
        : to_v8_object(0)
        , object()
    {
    }

    bool isCell() const
    {
        if (to_v8_object.type() == TaggedPointer::Type::Smi) {
            return false;
        }
        const Map* map_ptr = object.map();
        // TODO(@190n) exhaustively switch on InstanceType
        if (map_ptr == &Map::object_map || map_ptr == &Map::string_map) {
            return true;
        } else if (map_ptr == &Map::map_map || map_ptr == &Map::raw_ptr_map || map_ptr == &Map::oddball_map
            || map_ptr == &Map::boolean_map || map_ptr == &Map::heap_number_map) {
            return false;
        } else {
            RELEASE_ASSERT_NOT_REACHED("unknown Map at %p with instance type %" PRIx16,
                map_ptr, map_ptr->instance_type);
        }
    }

    // if not SMI, holds &this->map so that V8 can see what kind of object this is
    TaggedPointer to_v8_object;
    ObjectLayout object;
};

}
