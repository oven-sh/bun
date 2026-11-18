#pragma once

#include "engine/text/AtomStringImpl.h"

namespace WTF {
class PrivateSymbolImpl;
}

extern "C" {
WTF::PrivateSymbolImpl* engine_text_private_symbol(const WTF::StringImpl& description) RETURNS_NONNULL;
WTF::RegisteredSymbolImpl* engine_text_registered_symbol(const WTF::StringImpl& key) RETURNS_NONNULL;
}

namespace WTF {

// The identity of a symbol. Its characters are the description.
class SymbolImpl : public UniquedStringImpl {
public:
    using Flags = unsigned;
    static constexpr Flags s_flagDefault = 0;
    static constexpr Flags s_flagIsNullSymbol = Engine::Layout::symbolHasNoDescription;
    static constexpr Flags s_flagIsRegistered = Engine::Layout::symbolIsRegistered;
    static constexpr Flags s_flagIsPrivate = Engine::Layout::symbolIsPrivate;
    static constexpr Flags s_flagPassesThroughProxies = Engine::Layout::symbolPassesThroughProxies;

    unsigned hashForSymbol() const { return m_hash; }
    bool isNullSymbol() const { return m_flags & s_flagIsNullSymbol; }
    bool isRegistered() const { return m_flags & s_flagIsRegistered; }
    bool isPrivate() const { return m_flags & s_flagIsPrivate; }

    // `bun_engine_text::StaticSymbol`.
    class StaticSymbolImpl final {
        WTF_MAKE_NONCOPYABLE(StaticSymbolImpl);

    public:
        consteval StaticSymbolImpl(ASCIILiteral description, Flags flags = s_flagDefault)
            : m_string(staticDescription(description))
            , m_hash(StringHasher::computeLiteralHash(description.span()))
            , m_flags(flags)
        {
        }

        operator SymbolImpl&() const { return *reinterpret_cast<SymbolImpl*>(const_cast<StaticSymbolImpl*>(this)); }

    private:
        StaticStringImpl m_string;
        [[maybe_unused]] StringImpl* m_owner { nullptr };
        [[maybe_unused]] unsigned m_hash;
        [[maybe_unused]] Flags m_flags;
    };

private:
    static consteval StaticStringImpl staticDescription(ASCIILiteral description) { return { description, s_isSymbol }; }
    static void checkLayout();

    [[maybe_unused]] StringImpl* m_owner;
    unsigned m_hash;
    Flags m_flags;
};

inline void SymbolImpl::checkLayout()
{
    static_assert(sizeof(SymbolImpl) == Engine::Layout::sizeOfStaticSymbol && sizeof(StaticSymbolImpl) == sizeof(SymbolImpl));
    static_assert(OBJECT_OFFSETOF(SymbolImpl, m_hash) == Engine::Layout::SymbolImpl_hash);
    static_assert(OBJECT_OFFSETOF(SymbolImpl, m_flags) == Engine::Layout::SymbolImpl_flags);
}

class PrivateSymbolImpl final : public SymbolImpl {
public:
    static Ref<PrivateSymbolImpl> create(StringImpl& description) { return adoptRef(*engine_text_private_symbol(description)); }
};

class RegisteredSymbolImpl final : public SymbolImpl {
};

inline unsigned StringImpl::existingSymbolAwareHash() const
{
    return isSymbol() ? static_cast<const SymbolImpl*>(this)->hashForSymbol() : existingHash();
}

}

using WTF::PrivateSymbolImpl;
