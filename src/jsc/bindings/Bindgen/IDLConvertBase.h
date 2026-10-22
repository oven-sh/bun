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
        String&& message)
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
        String&& message)
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

    auto source()
    {
        return WTF::makeString("element of "_s, m_parent.source());
    }

private:
    Parent m_parent;
};

}

// Conversion context where the name of the value being converted is specified as an
// ASCIILiteral. Calls Bun::throwError.
struct LiteralConversionContext : Detail::ContextBase<LiteralConversionContext> {
    using ElementContext = Detail::ElementOf<LiteralConversionContext>;

    explicit consteval LiteralConversionContext(WTF::ASCIILiteral name)
        : m_name(name)
    {
    }

    auto source()
    {
        return m_name;
    }

private:
    const WTF::ASCIILiteral m_name;
};

// A value of the wrong type throws Node's `ERR_INVALID_ARG_TYPE(name, expected, actual)`.
struct NodeArgumentContext : Detail::ContextBase<NodeArgumentContext> {
    using ElementContext = Detail::ElementOf<NodeArgumentContext>;

    NodeArgumentContext(WTF::ASCIILiteral name, std::span<const WTF::ASCIILiteral> expected, JSC::JSValue actual)
        : m_name(name)
        , m_expected(expected)
        , m_actual(actual)
    {
    }

    auto source()
    {
        return m_name;
    }

    template<typename String>
    void throwGenericTypeError(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, String&&)
    {
        Bun::ERR::INVALID_ARG_TYPE(scope, &global, m_name, m_expected, m_actual);
    }

private:
    const WTF::ASCIILiteral m_name;
    const std::span<const WTF::ASCIILiteral> m_expected;
    const JSC::JSValue m_actual;
};

// A value of the wrong type throws what src/runtime/node/util/validators.rs does: `The "name" property must be of type string, got number`.
// With an index, the value is one of the arguments that `name` stands for: `The "name[2]" property ..`.
struct ValidatorArgumentContext : Detail::ContextBase<ValidatorArgumentContext> {
    using ElementContext = Detail::ElementOf<ValidatorArgumentContext>;

    ValidatorArgumentContext(WTF::ASCIILiteral name, WTF::ASCIILiteral expected, JSC::JSValue actual, std::optional<size_t> index = std::nullopt)
        : m_name(name)
        , m_expected(expected)
        , m_actual(actual)
        , m_index(index)
    {
    }

    auto source()
    {
        return m_name;
    }

    template<typename String>
    NEVER_INLINE void throwGenericTypeError(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, String&&)
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
