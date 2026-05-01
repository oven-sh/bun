#pragma once

#include <root.h>
#include "Map.h"

namespace v8 {
namespace shim {

struct ObjectLayout {
    // this field must be at the start so that V8 can find the map
    TaggedPointer m_taggedMap;
    union {
        JSC::WriteBarrier<JSC::JSCell> cell;
        double number;
    } m_contents;

    ObjectLayout()
        // using a smi value for map is most likely to catch bugs as almost every access will expect
        // map to be a pointer (and even if the assertion is bypassed, it'll be a null pointer)
        : m_taggedMap(0)
        , m_contents({ .cell = {} })
    {
    }

    ObjectLayout(const Map* map_ptr, JSC::JSCell* cell, JSC::VM& vm, const JSC::JSCell* owner)
        : m_taggedMap(const_cast<Map*>(map_ptr))
        , m_contents({ .cell = JSC::WriteBarrier<JSC::JSCell>(vm, owner, cell) })
    {
    }

    ObjectLayout(double number)
        : m_taggedMap(const_cast<Map*>(&Map::heap_number_map()))
        , m_contents({ .number = number })
    {
    }

    const Map* map() const { return m_taggedMap.getPtr<Map>(); }

    double asDouble() const { return m_contents.number; }

    JSC::JSCell* asCell() const { return m_contents.cell.get(); }
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
    Handle(const Map* map, JSC::JSCell* cell, JSC::VM& vm, const JSC::JSCell* owner);

    Handle(double number);

    Handle(int32_t smi);

    Handle(const Handle& that);

    Handle(const ObjectLayout* that);

    Handle()
        : m_toV8Object(0)
        , m_object()
    {
    }

    Handle& operator=(const Handle& that);

    bool isCell() const
    {
        if (m_toV8Object.tag() == TaggedPointer::Tag::Smi) {
            return false;
        }
        const Map* map_ptr = m_object.map();
        // TODO(@190n) exhaustively switch on InstanceType
        if (map_ptr == &Map::object_map() || map_ptr == &Map::string_map()) {
            return true;
        } else if (map_ptr == &Map::map_map() || map_ptr == &Map::oddball_map()
            || map_ptr == &Map::heap_number_map()) {
            return false;
        } else {
            RELEASE_ASSERT_NOT_REACHED("unknown Map at %p with instance type %" PRIx16,
                map_ptr, map_ptr->m_instanceType);
        }
    }

    TaggedPointer* slot()
    {
        return &m_toV8Object;
    }

    JSC::WriteBarrier<JSC::JSCell> asCell() const
    {
        return m_object.m_contents.cell;
    }

    // if not SMI, holds &this->map so that V8 can see what kind of object this is
    TaggedPointer m_toV8Object;
    ObjectLayout m_object;
};

} // namespace shim
} // namespace v8
