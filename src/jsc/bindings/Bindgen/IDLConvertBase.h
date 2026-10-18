#pragma once
#include "BunIDLConvertBase.h"
#include "ErrorCode.h"
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

// For a context made in the argument list of the conversion that takes it.
template<typename Ctx>
Ctx& asLvalue(Ctx&& ctx LIFETIME_BOUND) { return static_cast<Ctx&>(ctx); }

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

// A value of the wrong type throws `ERR_INVALID_ARG_TYPE` with the schema's own message, which says nothing of the value.
struct ArgumentMessageContext : Detail::ContextBase<ArgumentMessageContext> {
    using ElementContext = Detail::ElementOf<ArgumentMessageContext>;

    consteval ArgumentMessageContext(WTF::ASCIILiteral name, WTF::ASCIILiteral message)
        : m_name(name)
        , m_message(message)
    {
    }

    auto source()
    {
        return m_name;
    }

    template<typename String>
    void throwGenericTypeError(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, String&&)
    {
        Bun::throwError(&global, scope, ErrorCode::ERR_INVALID_ARG_TYPE, m_message);
    }

private:
    const WTF::ASCIILiteral m_name;
    const WTF::ASCIILiteral m_message;
};

}
