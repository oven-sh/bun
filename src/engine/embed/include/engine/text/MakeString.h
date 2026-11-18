#pragma once

#include "engine/text/StringConcatenate.h"

namespace WTF {

namespace Detail {

template<typename T> ALWAYS_INLINE RefPtr<StringImpl> tryConcatenateAs(size_t length, auto&... adapters)
{
    std::span<T> characters;
    auto string = StringImpl::tryCreateUninitialized(length, characters);
    if (characters.data()) [[likely]]
        writeAll(characters.data(), adapters...);
    return string;
}

NEVER_INLINE RefPtr<StringImpl> tryConcatenate16(size_t length, auto&... adapters)
{
    return tryConcatenateAs<char16_t>(length, adapters...);
}

inline RefPtr<StringImpl> tryConcatenate(auto&&... adapters)
{
    size_t length = totalLength(adapters...);
    if (are8Bit(adapters...)) [[likely]]
        return tryConcatenateAs<Latin1Character>(length, adapters...);
    return tryConcatenate16(length, adapters...);
}

// The atom may be there already, so what is short is put together on the stack.
inline AtomString tryConcatenateToAtom(auto&&... adapters)
{
    Latin1Character buffer[64];
    size_t length = totalLength(adapters...);
    if (length > std::size(buffer) || !are8Bit(adapters...))
        return AtomStringImpl::add(tryConcatenate(adapters...));
    if (length)
        writeAll(buffer, adapters...);
    return std::span<const Latin1Character> { buffer, length };
}

}

// Null if the result is too long or there is no memory.
template<typename... Types> ALWAYS_INLINE String tryMakeString(const Types&... values)
{
    return Detail::tryConcatenate(Detail::AdapterFor<Types>(values)...);
}

template<typename... Types> ALWAYS_INLINE String makeString(const Types&... values)
{
    auto string = tryMakeString(values...);
    if (!string) [[unlikely]]
        Support__outOfMemory();
    return string;
}

template<typename... Types> ALWAYS_INLINE AtomString makeAtomString(const Types&... values)
{
    auto string = Detail::tryConcatenateToAtom(Detail::AdapterFor<Types>(values)...);
    if (string.isNull()) [[unlikely]]
        Support__outOfMemory();
    return string;
}

}

using WTF::makeAtomString;
using WTF::makeString;
using WTF::tryMakeString;
