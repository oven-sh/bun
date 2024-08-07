#pragma once

#include "v8/Map.h"

namespace v8 {

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
    Handle(const Map* map_, void* ptr_)
        : to_v8_object(&this->map)
        , map(const_cast<Map*>(map_))
        , ptr(ptr_)
    {
    }

    Handle(int32_t smi)
        : to_v8_object(smi)
    {
    }

    Handle(const Handle& that)
    {
        *this = that;
    }

    Handle& operator=(const Handle& that)
    {
        map = that.map;
        ptr = that.ptr;
        if (that.to_v8_object.type() == TaggedPointer::Type::Smi) {
            to_v8_object = that.to_v8_object;
        } else {
            to_v8_object = &this->map;
        }
        return *this;
    }

    Handle() {}

    // if not SMI, holds &this->map so that V8 can see what kind of object this is
    TaggedPointer to_v8_object;
    // these two fields are laid out so that V8 can find the map
    TaggedPointer map;
    void* ptr;
};

}
