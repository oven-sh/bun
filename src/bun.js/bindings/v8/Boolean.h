#pragma once

#include "v8/Primitive.h"

namespace v8 {

class Boolean : public Primitive {
public:
    BUN_EXPORT bool Value() const;
};

}
