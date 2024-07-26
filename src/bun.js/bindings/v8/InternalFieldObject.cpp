#include "InternalFieldObject.h"

namespace v8 {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo InternalFieldObject::s_info = {
    "InternalFieldObject"_s,
    &JSC::JSDestructibleObject::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(InternalFieldObject)
};

InternalFieldObject* InternalFieldObject::create()
{
    return nullptr;
}

}
