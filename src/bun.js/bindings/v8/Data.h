#pragma once

#include "v8.h"

namespace v8 {

class Data {
public:
    JSC::JSValue toJSValue() const
    {
        return JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(this));
    }
};

}
