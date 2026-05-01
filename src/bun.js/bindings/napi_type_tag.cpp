#include "napi_type_tag.h"

#include "ZigGlobalObject.h"

namespace Bun {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo NapiTypeTag::s_info = {
    "NapiTypeTag"_s,
    nullptr,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(NapiTypeTag)
};

NapiTypeTag* NapiTypeTag::create(JSC::VM& vm,
    JSC::Structure* structure,
    const napi_type_tag& c_tag)
{
    NapiTypeTag* tag = new (NotNull, JSC::allocateCell<NapiTypeTag>(vm))
        NapiTypeTag(vm, structure, c_tag);
    tag->finishCreation(vm);
    return tag;
}

} // namespace Bun
