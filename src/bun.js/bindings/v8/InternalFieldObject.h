#pragma once

#include "v8.h"

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
    };

    using FieldContainer = WTF::Vector<InternalField, 2>;

    FieldContainer* internalFields() { return &fields; }
    static InternalFieldObject* create();

protected:
    InternalFieldObject(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSDestructibleObject(vm, structure)
    {
    }

private:
    // TODO(@190n) use template with fixed size array for small counts
    FieldContainer fields;
};

}
