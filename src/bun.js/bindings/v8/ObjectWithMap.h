#pragma once

#include "root.h"
#include "v8/TaggedPointer.h"

namespace v8 {

class Map;

template<class T>
class ObjectWithMap {
public:
    const Map* mapPtr() const
    {
        return map.getPtr<Map>();
    }

    JSCell* innerPtr()
    {
        return &inner;
    }

private:
    TaggedPointer map;
    T inner;
};

}
