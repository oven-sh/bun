#pragma once
#include "BunIDLConvertBase.h"
#include "ErrorCode.h"
#include <JavaScriptCore/Operations.h>
#include <optional>
#include <wtf/text/MakeString.h>

namespace Bun::Bindgen {

namespace Detail {

template<typename Derived>
struct ContextBase : Bun::IDLConversionContextBase<Derived> {
    template<typename String>
    void throwGenericTypeError(
        JSC::JSGlobalObject& global,
        JSC::ThrowScope& scope,
        String&& message) const
    {
        Bun::throwError(
            &global,
            scope,
            ErrorCode::ERR_INVALID_ARG_TYPE,
            std::forward<String>(message));
    }

    template<typename String>
    void throwGenericRangeError(
        JSC::JSGlobalObject& global,
        JSC::ThrowScope& scope,
        String&& message) const
    {
        Bun::throwError(&global, scope, ErrorCode::ERR_OUT_OF_RANGE, std::forward<String>(message));
    }
};

template<typename Parent>
struct ElementOf : ContextBase<ElementOf<Parent>> {
    using ElementContext = ElementOf<ElementOf<Parent>>;

    explicit ElementOf(Parent parent)
        : m_parent(WTF::move(parent))
    {
    }

    auto source() const
    {
        return WTF::makeString("element of "_s, m_parent.source());
    }

private:
    Parent m_parent;
};

}

// Whether a call threw, from what it returned: false, null or empty. As WebCore's ConversionResult::hasException.
ALWAYS_INLINE bool hasException(JSC::ThrowScope& scope, bool succeeded)
{
    EXCEPTION_ASSERT_UNUSED(scope, !!scope.exception() == !succeeded);
    return !succeeded;
}

// Conversion context where the name of the value being converted is specified as an
// ASCIILiteral. Calls Bun::throwError.
struct LiteralConversionContext : Detail::ContextBase<LiteralConversionContext> {
    using ElementContext = Detail::ElementOf<LiteralConversionContext>;

    explicit consteval LiteralConversionContext(WTF::ASCIILiteral name)
        : m_name(name)
    {
    }

    auto source() const
    {
        return m_name;
    }

private:
    const WTF::ASCIILiteral m_name;
};

// For a context made in the argument list of the conversion that takes it.
template<typename Ctx>
Ctx& asLvalue(Ctx&& ctx LIFETIME_BOUND) { return static_cast<Ctx&>(ctx); }

struct NodeArgument {
    WTF::ASCIILiteral name;
    std::span<const WTF::ASCIILiteral> expected;
};

// A value of the wrong type throws Node's `ERR_INVALID_ARG_TYPE(name, expected, actual)`.
struct NodeArgumentContext : Detail::ContextBase<NodeArgumentContext> {
    using ElementContext = Detail::ElementOf<NodeArgumentContext>;

    NodeArgumentContext(const NodeArgument& argument LIFETIME_BOUND, JSC::JSValue actual)
        : m_argument(argument)
        , m_actual(actual)
    {
    }

    auto source() const
    {
        return m_argument.name;
    }

    template<typename String>
    void throwGenericTypeError(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, String&&) const
    {
        Bun::ERR::INVALID_ARG_TYPE(scope, &global, m_argument.name, m_argument.expected, m_actual);
    }

private:
    const NodeArgument& m_argument;
    const JSC::JSValue m_actual;
};

// A value of the wrong type throws `ERR_INVALID_ARG_TYPE` with the schema's own message, which says nothing of the value.
struct ArgumentMessageContext : Detail::ContextBase<ArgumentMessageContext> {
    using ElementContext = Detail::ElementOf<ArgumentMessageContext>;

    consteval ArgumentMessageContext(WTF::ASCIILiteral name, WTF::ASCIILiteral message)
        : m_name(name)
        , m_message(message)
    {
    }

    auto source() const
    {
        return m_name;
    }

    template<typename String>
    void throwGenericTypeError(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, String&&) const
    {
        Bun::throwError(&global, scope, ErrorCode::ERR_INVALID_ARG_TYPE, m_message);
    }

private:
    const WTF::ASCIILiteral m_name;
    const WTF::ASCIILiteral m_message;
};

// A value of the wrong type throws what src/runtime/node/util/validators.rs does: `The "name" property must be of type string, got number`.
struct ValidatorArgumentContext : Detail::ContextBase<ValidatorArgumentContext> {
    using ElementContext = Detail::ElementOf<ValidatorArgumentContext>;

    ValidatorArgumentContext(WTF::ASCIILiteral name, WTF::ASCIILiteral expected, JSC::JSValue actual, std::optional<size_t> index = std::nullopt)
        : m_name(name)
        , m_expected(expected)
        , m_actual(actual)
        , m_index(index)
    {
    }

    auto source() const
    {
        return m_name;
    }

    template<typename String>
    NEVER_INLINE void throwGenericTypeError(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, String&&) const
    {
        // `JSValue::type_name` in src/jsc/JSValue.rs.
        bool isArray = m_actual.isCell() && (m_actual.asCell()->type() == JSC::ArrayType || m_actual.asCell()->type() == JSC::DerivedArrayType);
        WTF::String actual = isArray ? WTF::String("array"_s) : JSC::jsTypeStringForValue(&global, m_actual)->value(&global).data;
        WTF::String index = m_index ? WTF::makeString('[', *m_index, ']') : WTF::emptyString();
        Bun::throwError(&global, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
            WTF::makeString("The \""_s, m_name, index, "\" property must be of type "_s, m_expected, ", got "_s, actual));
    }

private:
    const WTF::ASCIILiteral m_name;
    const WTF::ASCIILiteral m_expected;
    const JSC::JSValue m_actual;
    const std::optional<size_t> m_index;
};

}
