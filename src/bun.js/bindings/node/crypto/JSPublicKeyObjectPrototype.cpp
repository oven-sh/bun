#include "JSPublicKeyObjectPrototype.h"
#include "JSPublicKeyObject.h"
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
// JSC_DECLARE_HOST_FUNCTION(jsPublicKeyObjectUpdate);

const JSC::ClassInfo JSPublicKeyObjectPrototype::s_info = { "PublicKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPublicKeyObjectPrototype) };

static const JSC::HashTableValue JSPublicKeyObjectPrototypeTableValues[] = {
    // { "update"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { HashTableValue::NativeFunctionType, JSPublicKeyObjectUpdate, 2 } },
};

void JSPublicKeyObjectPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSPublicKeyObjectPrototype::info(), JSPublicKeyObjectPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSC_DEFINE_HOST_FUNCTION(jsPublicKeyObjectUpdate, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
// {
//     return JSValue::encode(jsUndefined());
// }
