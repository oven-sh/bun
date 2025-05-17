#include "JSHTTPParserPrototype.h"

namespace Bun {

using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_wat);

const ClassInfo JSHTTPParserPrototype::s_info = { "HTTPParser"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHTTPParserPrototype) };

static const HashTableValue JSHTTPParserPrototypeTableValues[] = {
    { "wat"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_wat, 0 } },
};

void JSHTTPParserPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, info(), JSHTTPParserPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_wat, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    return JSValue::encode(jsUndefined());
}

} // namespace Bun
