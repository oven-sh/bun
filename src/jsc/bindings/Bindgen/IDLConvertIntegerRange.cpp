#include "root.h"
#include "Bindgen/IDLConvertIntegerRange.h"
#include "ErrorCode.h"
#include <JavaScriptCore/Operations.h>

namespace Bun::Bindgen {
using namespace JSC;

std::optional<int64_t> validateIntegerRangeSlow(JSGlobalObject& globalObject, JSValue value, ASCIILiteral name, int64_t min, int64_t max, std::optional<int64_t> nan)
{
    auto& vm = getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto throwMustBeOfType = [&](ASCIILiteral type) {
        auto received = jsTypeStringForValue(&globalObject, value)->value(&globalObject);
        throwError(&globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, makeString("The \""_s, name, "\" property must be of type "_s, type, ". Received "_s, received.data));
    };

    if (!value.isNumber()) {
        throwMustBeOfType("number"_s);
        return std::nullopt;
    }
    double number = value.asNumber();
    if (nan && std::isnan(number))
        return nan;
    if (std::floor(number) != number) {
        throwMustBeOfType("integer"_s);
        return std::nullopt;
    }
    if (number < static_cast<double>(min) || number > static_cast<double>(max)) {
        throwError(&globalObject, scope, ErrorCode::ERR_OUT_OF_RANGE, makeString("The value of \""_s, name, "\" is out of range. It must be >= "_s, min, " and <= "_s, max, ". Received "_s, number));
        return std::nullopt;
    }
    return static_cast<int64_t>(number);
}

}
