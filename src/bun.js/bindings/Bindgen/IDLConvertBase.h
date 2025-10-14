#pragma once
#include <BunIDLConvertBase.h>
#include <ErrorCode.h>
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
        : m_parent(std::move(parent))
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

}
