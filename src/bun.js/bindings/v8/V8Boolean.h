#pragma once

#include "V8Primitive.h"

namespace v8 {

class Boolean : public Primitive {
public:
    BUN_EXPORT bool Value() const;
};

}
