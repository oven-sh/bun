#pragma once

// What names a property: an atom or a symbol.

#include "engine/api/Value.h"

extern "C" const WTF::StaticStringImpl engine_static_atoms[Engine::StaticAtom::COUNT];
extern "C" const WTF::SymbolImpl::StaticSymbolImpl engine_symbols[Engine::WellKnownSymbol::COUNT];
extern "C" const WTF::SymbolImpl::StaticSymbolImpl engine_private_names[Engine::PrivateName::COUNT];

namespace JSC {

template<typename Character> std::optional<uint32_t> parseIndex(std::span<const Character> characters)
{
    if (characters.empty() || characters.size() > 10 || (characters[0] == '0' && characters.size() > 1))
        return std::nullopt;
    uint64_t value = 0;
    for (auto character : characters) {
        if (!isASCIIDigit(character))
            return std::nullopt;
        value = value * 10 + (character - '0');
    }
    if (value > MAX_ARRAY_INDEX)
        return std::nullopt;
    return static_cast<uint32_t>(value);
}

inline std::optional<uint32_t> parseIndex(const StringImpl& string)
{
    return string.is8Bit() ? parseIndex(string.span8()) : parseIndex(string.span16());
}

class PrivateName {
public:
    enum PrivateSymbolTag { PrivateSymbol };

    PrivateName(PrivateSymbolTag, const String& description)
        : m_uid(PrivateSymbolImpl::create(*description.impl()))
    {
    }

    SymbolImpl& uid() const { return m_uid.get(); }

private:
    Ref<SymbolImpl> m_uid;
};

class Identifier {
public:
    Identifier() = default;

    static Identifier adopt(UniquedStringImpl* uid) { return Identifier(AtomString(adoptRef(static_cast<AtomStringImpl*>(uid)))); }

    static Identifier fromString(VM&, ASCIILiteral);
    static Identifier fromString(VM&, std::span<const Latin1Character> characters) { return Identifier(characters.empty() ? AtomString(StringImpl::empty()) : AtomString(characters)); }
    static Identifier fromString(VM&, std::span<const char16_t> characters) { return Identifier(characters.empty() ? AtomString(StringImpl::empty()) : AtomString(characters)); }
    static Identifier fromString(VM&, const String& string) { return Identifier(AtomString(string.isNull() ? StringImpl::empty() : string.impl())); }
    static Identifier fromString(VM&, const AtomString& atom) { return Identifier(AtomString(atom)); }
    static Identifier fromUid(VM&, UniquedStringImpl* uid) { return Identifier(AtomString(static_cast<AtomStringImpl*>(uid))); }
    static Identifier fromUid(SymbolImpl& symbol) { return Identifier(AtomString(static_cast<AtomStringImpl*>(static_cast<UniquedStringImpl*>(&symbol)))); }
    static Identifier fromUid(const PrivateName& name) { return fromUid(name.uid()); }
    static Identifier from(VM&, unsigned);

    // Of a symbol, the description.
    const AtomString& string() const LIFETIME_BOUND { return m_string; }
    UniquedStringImpl* impl() const { return m_string.impl(); }
    RefPtr<AtomStringImpl> releaseImpl() { return m_string.releaseImpl(); }
    int length() const { return m_string.length(); }
    auto utf8() const { return m_string.string().utf8(); }

    bool isNull() const { return m_string.isNull(); }
    bool isEmpty() const { return m_string.isEmpty(); }
    bool isSymbol() const { return !isNull() && impl()->isSymbol(); }
    bool isPrivateName() const { return isSymbol() && static_cast<const SymbolImpl*>(impl())->isPrivate(); }

    friend bool operator==(const Identifier& a, const Identifier& b) { return a.impl() == b.impl(); }
    friend bool operator==(const Identifier& a, ASCIILiteral b) { return !a.isSymbol() && WTF::equal(a.impl(), b); }

private:
    explicit Identifier(AtomString&& string)
        : m_string(WTF::move(string))
    {
    }

    AtomString m_string;
};

class PropertyName {
public:
    PropertyName(UniquedStringImpl* uid)
        : m_uid(uid)
    {
    }
    PropertyName(const Identifier& identifier LIFETIME_BOUND)
        : m_uid(identifier.impl())
    {
    }
    PropertyName(const PrivateName& name LIFETIME_BOUND)
        : m_uid(&name.uid())
    {
    }

    UniquedStringImpl* uid() const { return m_uid; }
    AtomStringImpl* publicName() const { return isSymbol() ? nullptr : static_cast<AtomStringImpl*>(m_uid); }
    bool isNull() const { return !m_uid; }
    bool isSymbol() const { return m_uid && m_uid->isSymbol(); }
    bool isPrivateName() const { return isSymbol() && static_cast<const SymbolImpl*>(m_uid)->isPrivate(); }

private:
    UniquedStringImpl* m_uid;
};

inline bool operator==(PropertyName a, PropertyName b) { return a.uid() == b.uid(); }
inline bool operator==(PropertyName a, const Identifier& b) { return a.uid() == b.impl(); }

ALWAYS_INLINE std::optional<uint32_t> parseIndex(PropertyName name)
{
    if (!name.uid() || !name.uid()->isArrayIndexAtom()) [[likely]]
        return std::nullopt;
    return parseIndex(*name.uid());
}

ALWAYS_INLINE std::optional<uint32_t> parseIndex(const Identifier& identifier) { return parseIndex(PropertyName(identifier)); }

bool isCanonicalNumericIndexString(UniquedStringImpl*);
JSValue identifierToJSValue(VM&, const Identifier&);
// A private name is given as the string of its description.
JSValue identifierToSafePublicJSValue(VM&, const Identifier&);

struct IdentifierRepHash : PtrHash<RefPtr<UniquedStringImpl>> {
    static unsigned hash(const RefPtr<UniquedStringImpl>& key) { return key->existingSymbolAwareHash(); }
    static unsigned hash(const UniquedStringImpl* key) { return key->existingSymbolAwareHash(); }
};

using IdentifierSet = UncheckedKeyHashSet<RefPtr<UniquedStringImpl>, IdentifierRepHash>;

// Names, keywords, well-known symbols and private names.
// clang-format off
#define ENGINE_FOR_EACH_COMMON_NAME(N, K, S, P) \
    N(Loader) N(__esModule) N(arguments) N(byteLength) N(byteOffset) N(caller) N(cause) N(column) \
    N(constructor) N(detail) N(done) N(entries) N(error) N(errors) N(from) N(get) N(id) N(input) N(length) \
    N(line) N(message) N(name) N(next) N(origin) N(parse) N(prototype) N(resolve) N(set) N(size) N(sourceURL) \
    N(stack) N(stackTraceLimit) N(target) N(then) N(toJSON) N(toString) N(type) N(value) N(values) K(default) \
    K(delete) K(private) K(public) K(return) K(throw) K(undefined) S(asyncDispose) S(asyncIterator) S(dispose) \
    S(iterator) S(species) S(toPrimitive) S(toStringTag) P(moduleLoader) P(starDefault) \
    P(starNamespace) P(then)
// clang-format on

class BuiltinNames;

// Never constructed: a view of Engine::commonNames.
class CommonIdentifiers {
public:
    CommonIdentifiers() = delete;

    const BuiltinNames& builtinNames() const { return *reinterpret_cast<const BuiltinNames*>(this); }

    const Identifier emptyIdentifier;
    const Identifier underscoreProto;
#define ENGINE_NAME(text) const Identifier text;
#define ENGINE_KEYWORD(text) const Identifier text##Keyword;
#define ENGINE_SYMBOL_NAME(text) const Identifier text##Symbol;
#define ENGINE_PRIVATE_NAME(text) const Identifier text##PrivateName;
    ENGINE_FOR_EACH_COMMON_NAME(ENGINE_NAME, ENGINE_KEYWORD, ENGINE_SYMBOL_NAME, ENGINE_PRIVATE_NAME)
#undef ENGINE_NAME
#undef ENGINE_KEYWORD
#undef ENGINE_SYMBOL_NAME
#undef ENGINE_PRIVATE_NAME
};

class BuiltinNames {
public:
    const Identifier& entriesPublicName() const { return m_names.entries; }
    const Identifier& valuesPublicName() const { return m_names.values; }
    const Identifier& moduleLoaderPrivateName() const { return m_names.moduleLoaderPrivateName; }
    const Identifier& thenPrivateName() const { return m_names.thenPrivateName; }

private:
    CommonIdentifiers m_names;
};

} // namespace JSC

namespace Engine {

inline constexpr const void* commonNames[] = {
    &engine_empty_string,
    &engine_static_atoms[StaticAtom::__proto___],
#define ENGINE_ATOM(text) &engine_static_atoms[StaticAtom::text##_],
#define ENGINE_SYMBOL_NAME(text) &engine_symbols[WellKnownSymbol::text##_],
#define ENGINE_PRIVATE_NAME(text) &engine_private_names[PrivateName::text##_],
    ENGINE_FOR_EACH_COMMON_NAME(ENGINE_ATOM, ENGINE_ATOM, ENGINE_SYMBOL_NAME, ENGINE_PRIVATE_NAME)
#undef ENGINE_ATOM
#undef ENGINE_SYMBOL_NAME
#undef ENGINE_PRIVATE_NAME
};
static_assert(sizeof(commonNames) == sizeof(JSC::CommonIdentifiers));

// The same for every VM, and known when linking.
struct CommonNamesPointer {
    ALWAYS_INLINE const JSC::CommonIdentifiers* operator->() const { return reinterpret_cast<const JSC::CommonIdentifiers*>(commonNames); }
    ALWAYS_INLINE const JSC::CommonIdentifiers& operator*() const { return *operator->(); }
};

} // namespace Engine

namespace WTF {

template<> struct VectorTraits<JSC::Identifier> : SimpleClassVectorTraits {};

} // namespace WTF
