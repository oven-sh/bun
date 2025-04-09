#include "JSKeyObjectHandleConstructor.h"
#include "JSKeyObjectHandle.h"
#include "ErrorCode.h"
#include "JSBufferEncodingType.h"
#include "NodeValidator.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include "CryptoUtil.h"
#include "openssl/dh.h"
#include "openssl/bn.h"
#include "openssl/err.h"
#include "ncrypto.h"
#include "KeyObject2.h"

using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

namespace Bun {

const JSC::ClassInfo JSKeyObjectHandleConstructor::s_info = { "KeyObjectHandle"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSKeyObjectHandleConstructor) };

JSC_DEFINE_HOST_FUNCTION(callKeyObjectHandle, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(lexicalGlobalObject, scope, "Cannot call KeyObjectHandle class constructor without |new|"_s);
    return JSValue::encode({});
}

JSC_DEFINE_HOST_FUNCTION(constructKeyObjectHandle, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    (void)globalObject;

    JSValue typeValue = callFrame->argument(0);

    if (!typeValue.isNumber()) {
        return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "type"_s, "number"_s, typeValue);
    }

    auto typeNumber = typeValue.asNumber();

    KeyObject::Type type;
    if (typeNumber == 0) {
        type = KeyObject::Type::Secret;
    } else if (typeNumber == 1) {
        type = KeyObject::Type::Public;
    } else if (typeNumber == 2) {
        type = KeyObject::Type::Private;
    } else {
        return ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "type"_s, typeValue, "0, 1, or 2"_s);
    }

    JSValue dataValue = callFrame->argument(1);

    switch (type) {
    case KeyObject::Type::Secret: {
        WTF::Vector<uint8_t> symmetricKey;

        // should already be a validated buffer
        if (JSArrayBufferView* view = jsDynamicCast<JSArrayBufferView*>(dataValue)) {
            if (!symmetricKey.tryAppend(view->span())) {
                throwOutOfMemoryError(lexicalGlobalObject, scope);
                return JSValue::encode({});
            }

            // auto* structure = globalObject->m_JSKeyObjectHandleClassStructure.get(lexicalGlobalObject);
            // // JSKeyObjectHandle* instance = JSKeyObjectHandle::create(vm, structure, lexicalGlobalB)
        }

        break;
    }
    case KeyObject::Type::Public:
    case KeyObject::Type::Private: {
        break;
    }
    }

    return JSValue::encode(jsUndefined());
}

} // namespace Bun
