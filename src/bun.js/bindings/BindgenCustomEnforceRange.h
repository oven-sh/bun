#pragma once
#include "root.h"
#include "IDLTypes.h"
#include "JSDOMConvertBase.h"

namespace Bun {

enum class BindgenCustomEnforceRangeKind {
    Node,
    Web,
};

// This type implements conversion for:
// - t.*.validateInteger()
// - t.*.enforceRange(a, b) when A, B is not the integer's ABI size.
// - t.i32.validateInt32()
// - t.u32.validateUInt32()
template<
    typename NumericType,
    NumericType Min,
    NumericType Max,
    BindgenCustomEnforceRangeKind Kind>
struct BindgenCustomEnforceRange : WebCore::IDLType<NumericType> {
};

}

namespace WebCore {

template<
    typename NumericType,
    NumericType Min,
    NumericType Max,
    Bun::BindgenCustomEnforceRangeKind Kind
> struct Converter<Bun::BindgenCustomEnforceRange<NumericType, Min, Max, Kind>>
: DefaultConverter<Bun::BindgenCustomEnforceRange<NumericType, Min, Max, Kind>> {
    template<typename ExceptionThrower = DefaultExceptionThrower>
    static inline NumericType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject.vm());
        ASSERT(!scope.exception());
        double unrestricted;
        if constexpr (Kind == Bun::BindgenCustomEnforceRangeKind::Node) {
            // In Node.js, `validateNumber`, `validateInt32`, `validateUint32`,
            // and `validateInteger` all start with the following
            //
            //     if (typeof value !== 'number')
            //         throw new ERR_INVALID_ARG_TYPE(name, 'number', value);
            //
            if (!value.isNumber()) {
                exceptionThrower(lexicalGlobalObject, scope);
                return 0;
            }
            unrestricted = value.asNumber();
            ASSERT(!scope.exception());

            // Node also validates that integer types are integers
            if constexpr (std::is_integral_v<NumericType>) {
                if (unrestricted != std::round(unrestricted)) {
                    // ERR_OUT_OF_RANGE "an integer"
                    exceptionThrower(lexicalGlobalObject, scope);
                    return 0;
                }
            } else {
                // When a range is specified (what this template is implementing),
                // Node also throws on NaN being out of range
                if (std::isnan(unrestricted)) {
                    // ERR_OUT_OF_RANGE `>= ${min} && <= ${max}` (omit upper bound if infinite)
                    exceptionThrower(lexicalGlobalObject, scope);
                    return 0;
                }
            }
        } else {
            // WebIDL uses toNumber before applying range restrictions. This
            // allows something like `true` to pass for `t.f64.enforceRange(-10, 10)`,
            // but this behavior does not appear Node's validators.
            unrestricted = value.toNumber(&lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, 0);

        }

        bool inRange = unrestricted >= Min && unrestricted <= Max;
        if (!inRange) {
            if constexpr (Kind == Bun::BindgenCustomEnforceRangeKind::Node) {
                // ERR_OUT_OF_RANGE ">= ${min} && <= ${max}"
                exceptionThrower(lexicalGlobalObject, scope);
            } else {
                // WebKit range exception
                exceptionThrower(lexicalGlobalObject, scope);
            }
            return 0;
        }

        return static_cast<NumericType>(unrestricted);
    }
};

}