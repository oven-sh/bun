#pragma once

#include "v8/Data.h"
#include "root.h"

namespace v8 {

class Value : public Data {
public:
    JSC::JSValue toJSValue() const
    {
        return JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(this));
    }
};

}
