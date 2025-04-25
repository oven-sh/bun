#include "root.h"
#include "helpers.h"

#include <JavaScriptCore/JSBigInt.h>

using namespace JSC;
using namespace Bun;

extern "C" JSBigInt* JSC__JSBigInt__fromJS(EncodedJSValue encodedValue)
{
    JSValue value = JSValue::decode(encodedValue);
    ASSERT(!value.isEmpty());
    if (auto* bigInt = jsDynamicCast<JSBigInt*>(value)) {
        return bigInt;
    }
    return nullptr;
}

extern "C" int8_t JSC__JSBigInt__orderDouble(JSBigInt* bigInt, double num)
{
    ASSERT(!std::isnan(num));
    JSBigInt::ComparisonResult result = JSBigInt::compareToDouble(bigInt, num);

    switch (result) {
    case JSBigInt::ComparisonResult::Equal:
        return 0;
    case JSBigInt::ComparisonResult::GreaterThan:
        return 1;
    case JSBigInt::ComparisonResult::LessThan:
        return -1;
    case JSBigInt::ComparisonResult::Undefined:
        UNREACHABLE();
    }
}

extern "C" int8_t JSC__JSBigInt__orderUint64(JSBigInt* bigInt, uint64_t num)
{
    JSBigInt::ComparisonResult result = JSBigInt::compare(bigInt, num);

    switch (result) {
    case JSBigInt::ComparisonResult::Equal:
        return 0;
    case JSBigInt::ComparisonResult::GreaterThan:
        return 1;
    case JSBigInt::ComparisonResult::LessThan:
        return -1;
    case JSBigInt::ComparisonResult::Undefined:
        UNREACHABLE();
    }
}

extern "C" int8_t JSC__JSBigInt__orderInt64(JSBigInt* bigInt, int64_t num)
{
    JSBigInt::ComparisonResult result = JSBigInt::compare(bigInt, num);

    switch (result) {
    case JSBigInt::ComparisonResult::Equal:
        return 0;
    case JSBigInt::ComparisonResult::GreaterThan:
        return 1;
    case JSBigInt::ComparisonResult::LessThan:
        return -1;
    case JSBigInt::ComparisonResult::Undefined:
        UNREACHABLE();
    }
}

extern "C" int64_t JSC__JSBigInt__toInt64(JSBigInt* bigInt)
{
    return JSBigInt::toBigInt64(bigInt);
}

extern "C" BunString JSC__JSBigInt__toString(JSBigInt* bigInt, JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    String result = bigInt->toString(globalObject, 10);
    RETURN_IF_EXCEPTION(scope, {});

    return toStringRef(result);
}
