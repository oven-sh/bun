#include "JSKeyObjectHandlePrototype.h"
#include "JSKeyObjectHandle.h"
#include "ErrorCode.h"
#include "CryptoUtil.h"
#include "BunProcess.h"
#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>

using namespace Bun;
using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

const JSC::ClassInfo JSKeyObjectHandlePrototype::s_info = { "KeyObjectHandle"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSKeyObjectHandlePrototype) };

static const JSC::HashTableValue JSKeyObjectHandlePrototypeTableValues[] = {
    // { "equals"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsKeyObjectHandlePrototype_equals, 1 } },
};

void JSKeyObjectHandlePrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSKeyObjectHandlePrototype::info(), JSKeyObjectHandlePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSC_DEFINE_HOST_FUNCTION(jsKeyObjectHandleUpdate, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
// {
//     return JSValue::encode(jsUndefined());
// }
