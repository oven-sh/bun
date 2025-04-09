#include "JSPrivateKeyObjectPrototype.h"
#include "JSPrivateKeyObject.h"
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

// Declare host function prototypes
// JSC_DECLARE_HOST_FUNCTION(JSPrivateKeyObjectUpdate);

const JSC::ClassInfo JSPrivateKeyObjectPrototype::s_info = { "PrivateKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPrivateKeyObjectPrototype) };

static const JSC::HashTableValue JSPrivateKeyObjectPrototypeTableValues[] = {
    // { "update"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, JSPrivateKeyObjectUpdate, 2 } },
};

void JSPrivateKeyObjectPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSPrivateKeyObjectPrototype::info(), JSPrivateKeyObjectPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSC_DEFINE_HOST_FUNCTION(JSPrivateKeyObjectUpdate, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
// {
//     return JSValue::encode(jsUndefined());
// }
