#pragma once
#include <cstddef>
#include <cstring>
#include <memory>
#include <new>
#include <type_traits>
#include <wtf/Vector.h>
#include <MimallocWTFMalloc.h>

#if ASAN_ENABLED && __has_include(<sanitizer/asan_interface.h>)
#include <sanitizer/asan_interface.h>
#endif

namespace Bun::Bindgen {

template<typename T>
struct ExternTraits;

template<typename T>
struct ExternVector {
    T* data;
    // WTF::Vector stores the length and capacity as `unsigned`. We can save space by using that
    // instead of `size_t` here.
    unsigned length;
    unsigned capacity;
};

namespace Detail {
template<typename T>
void asanSetBufferSizeToFullCapacity(T* buffer, size_t length, size_t capacity)
{
#if ASAN_ENABLED
    // Without this, ASan will complain if the Rust side touches memory in the range
    // [storage + length, storage + capacity), which happens when freeing the memory.
    __sanitizer_annotate_contiguous_container(
        buffer, // beg
        buffer + capacity, // end
        buffer + length, // old_mid
        buffer + capacity // new_mid
    );
#endif
}
}

template<typename T, typename OverflowHandler, size_t minCapacity>
struct ExternTraits<WTF::Vector<T, 0, OverflowHandler, minCapacity, MimallocMalloc>> {
private:
    using CPPType = WTF::Vector<T, 0, OverflowHandler, minCapacity, MimallocMalloc>;
    using ExternElement = ExternTraits<T>::ExternType;

public:
    using ExternType = ExternVector<ExternElement>;

    static ExternType convertToExtern(CPPType&& cppValue)
    {
        if constexpr (std::is_same_v<T, ExternElement>) {
            unsigned capacity = cppValue.capacity();
            auto span = cppValue.releaseBuffer().leakSpan();
            return ExternType {
                .data = span.data(),
                .length = static_cast<unsigned>(span.size()),
                .capacity = capacity,
            };
        } else {
            static_assert(sizeof(ExternElement) <= sizeof(T) && alignof(ExternElement) <= MimallocMalloc::maxAlign);

            // We can reuse the allocation, but we still need to convert the elements.
            alignas(CPPType) std::byte cppStorage[sizeof(CPPType)];
            // Prevent the memory from being freed.
            CPPType* const vec = new (cppStorage) CPPType { WTF::move(cppValue) };
            const size_t length = vec->size();
            const size_t capacity = vec->capacity();

            T* const buffer = vec->mutableSpan().data();
            Detail::asanSetBufferSizeToFullCapacity(buffer, length, capacity);
            std::byte* storage = reinterpret_cast<std::byte*>(buffer);

            // Convert the elements.
            for (size_t i = 0; i < length; ++i) {
                T* oldPtr = std::launder(reinterpret_cast<T*>(storage + i * sizeof(T)));
                ExternElement newElem { ExternTraits<T>::convertToExtern(WTF::move(*oldPtr)) };
                oldPtr->~T();
                new (storage + i * sizeof(ExternElement)) ExternElement { WTF::move(newElem) };
            }

#if __cpp_lib_start_lifetime_as >= 202207L
            ExternElement* data = std::start_lifetime_as_array<ExternElement>(storage, length);
#else
            // We need to start the lifetime of an object of type "array of `length`
            // `ExternElement`" without invalidating the object representation. Without
            // `std::start_lifetime_as_array`, one way to do this is to use a no-op `memmove`,
            // which implicitly creates objects, plus `std::launder` to obtain a pointer to
            // the created object.
            std::memmove(storage, storage, length * sizeof(ExternElement));
            ExternElement* data = std::launder(reinterpret_cast<ExternElement*>(storage));
#endif
            return ExternType {
                .data = data,
                .length = static_cast<unsigned>(length),
                // Rust converts these elements into a Vec of its own and frees this buffer without a size.
                .capacity = static_cast<unsigned>(length),
            };
        }
    }
};

}
