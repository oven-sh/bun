#pragma once
#include "root.h"
#include "IDLTypes.h"
#include "JSDOMConvertBase.h"
#include "ErrorCode.h"

namespace Bun {

enum class BindgenCustomEnforceRangeKind {
    Node,
    Web,
};

// `.validateInteger(min, max)` and `.enforceRange(min, max)`.
template<
    std::integral NumericType,
    NumericType Min,
    NumericType Max,
    BindgenCustomEnforceRangeKind Kind>
struct BindgenCustomEnforceRange : WebCore::IDLType<NumericType> {
};

}

static String rangeErrorString(double value, double min, double max)
{
    return makeString("Value "_s, value, " is outside the range ["_s, min, ", "_s, max, ']');
}

namespace WebCore {

template<
    std::integral NumericType,
    NumericType Min,
    NumericType Max,
    Bun::BindgenCustomEnforceRangeKind Kind>
struct Converter<Bun::BindgenCustomEnforceRange<NumericType, Min, Max, Kind>>
    : DefaultConverter<Bun::BindgenCustomEnforceRange<NumericType, Min, Max, Kind>> {
    template<typename ExceptionThrower = DefaultExceptionThrower>
    static inline NumericType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject.vm());
        double unrestricted;
        if constexpr (Kind == Bun::BindgenCustomEnforceRangeKind::Node) {
            // In Node.js, `validateNumber`, `validateInt32`, `validateUint32`,
            // and `validateInteger` all start with the following
            //
            //     if (typeof value !== 'number')
            //         throw new ERR_INVALID_ARG_TYPE(name, 'number', value);
            //
            if (!value.isNumber()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, &lexicalGlobalObject, exceptionThrower(), "number"_s, value);
                return 0;
            }
            unrestricted = value.asNumber();

            if (unrestricted != std::round(unrestricted)) {
                // ERR_OUT_OF_RANGE "an integer"
                Bun::ERR::OUT_OF_RANGE(scope, &lexicalGlobalObject, exceptionThrower(), "an integer"_s, value);
                return 0;
            }
        } else {
            // WebIDL uses toNumber before applying range restrictions, so `true` passes. Node's validators refuse it.
            unrestricted = value.toNumber(&lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, 0);

            if (std::isnan(unrestricted) || std::isinf(unrestricted)) {
                throwTypeError(&lexicalGlobalObject, scope, rangeErrorString(unrestricted, Min, Max));
                return 0;
            }

            // IDL uses trunc to convert the double to an integer.
            unrestricted = trunc(unrestricted);
        }

        bool inRange = unrestricted >= Min && unrestricted <= Max;
        if (!inRange) {
            if constexpr (Kind == Bun::BindgenCustomEnforceRangeKind::Node) {
                Bun::ERR::OUT_OF_RANGE(scope, &lexicalGlobalObject, exceptionThrower(), Min, Max, value);
            } else {
                // WebKit range exception
                throwTypeError(&lexicalGlobalObject, scope, rangeErrorString(unrestricted, Min, Max));
            }
            return 0;
        }

        return static_cast<NumericType>(unrestricted);
    }
};

}
