#pragma once

#include "engine/text/StringImpl.h"

extern "C" {
using EngineFreeExternalBuffer = void (*)(void* context, void* buffer, size_t byteLength);
WTF::ExternalStringImpl* engine_text_external_latin1(const WTF::Latin1Character*, size_t length, void* context, EngineFreeExternalBuffer) RETURNS_NONNULL;
WTF::ExternalStringImpl* engine_text_external_utf16(const char16_t*, size_t length, void* context, EngineFreeExternalBuffer) RETURNS_NONNULL;
}

namespace WTF {

// A string whose characters belong to the embedder.
class ExternalStringImpl final : public StringImpl {
public:
    // The thread that gives up the last reference calls `free(context, buffer, byteLength)`.
    static Ref<ExternalStringImpl> create(std::span<const Latin1Character> characters, void* context, auto&& free) { return createWithCallable(characters, context, std::forward<decltype(free)>(free)); }
    static Ref<ExternalStringImpl> create(std::span<const char16_t> characters, void* context, auto&& free) { return createWithCallable(characters, context, std::forward<decltype(free)>(free)); }

private:
    template<typename Callable> struct Closure {
        WTF_MAKE_STRUCT_TZONE_ALLOCATED(Closure);
        Callable free;
        void* context;
    };

    static Ref<ExternalStringImpl> createWithFunction(std::span<const Latin1Character> characters, void* context, EngineFreeExternalBuffer free)
    {
        return adoptRef(*engine_text_external_latin1(characters.data(), characters.size(), context, free));
    }

    static Ref<ExternalStringImpl> createWithFunction(std::span<const char16_t> characters, void* context, EngineFreeExternalBuffer free)
    {
        return adoptRef(*engine_text_external_utf16(characters.data(), characters.size(), context, free));
    }

    template<typename T, typename Free> static Ref<ExternalStringImpl> createWithCallable(std::span<const T> characters, void* context, Free&& free)
    {
        using Callable = std::decay_t<Free>;
        if constexpr (std::is_convertible_v<Callable, EngineFreeExternalBuffer>)
            return createWithFunction(characters, context, free);
        else if constexpr (std::is_empty_v<Callable>)
            return createWithFunction(characters, context, [](void* context, void* buffer, size_t byteLength) { Callable {}(context, buffer, byteLength); });
        else {
            return createWithFunction(characters, new Closure<Callable> { std::forward<Free>(free), context }, [](void* opaque, void* buffer, size_t byteLength) {
                std::unique_ptr<Closure<Callable>> closure { static_cast<Closure<Callable>*>(opaque) };
                closure->free(closure->context, buffer, byteLength);
            });
        }
    }
};

}
