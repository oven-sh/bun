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
    // instead of `std::size_t` here.
    unsigned length;
    unsigned capacity;
};

namespace Detail {
template<typename T>
void asanSetBufferSizeToFullCapacity(T* buffer, std::size_t length, std::size_t capacity)
{
#if ASAN_ENABLED
    // Without this, ASan will complain if Zig touches memory in the range
    // [storage + length, storage + capacity), which will always happen when freeing the
    // memory in Debug mode when Zig writes 0xaa to it.
    __sanitizer_annotate_contiguous_container(
        buffer, // beg
        buffer + capacity, // end
        buffer + length, // old_mid
        buffer + capacity // new_mid
    );
#endif
}
}

template<typename T, typename OverflowHandler, std::size_t minCapacity>
struct ExternTraits<WTF::Vector<T, 0, OverflowHandler, minCapacity, MimallocMalloc>> {
private:
    using CPPType = WTF::Vector<T, 0, OverflowHandler, minCapacity, MimallocMalloc>;
    using ExternElement = ExternTraits<T>::ExternType;

public:
    using ExternType = ExternVector<ExternElement>;

    static ExternType convertToExtern(CPPType&& cppValue)
    {
        if constexpr (std::is_same_v<T, ExternElement>) {
            // We can reuse the allocation.
            alignas(CPPType) std::byte cppStorage[sizeof(CPPType)];
            // This prevents the contents from being freed or destructed.
            CPPType* const vec = new (cppStorage) CPPType { std::move(cppValue) };
            T* const buffer = vec->mutableSpan().data();
            const std::size_t length = vec->size();
            const std::size_t capacity = vec->capacity();
            Detail::asanSetBufferSizeToFullCapacity(buffer, length, capacity);

            return ExternType {
                .data = vec->mutableSpan().data(),
                .length = static_cast<unsigned>(length),
                .capacity = static_cast<unsigned>(capacity),
            };
        } else if constexpr (sizeof(ExternElement) <= sizeof(T)
            && alignof(ExternElement) <= MimallocMalloc::maxAlign) {

            // We can reuse the allocation, but we still need to convert the elements.
            alignas(CPPType) std::byte cppStorage[sizeof(CPPType)];
            // Prevent the memory from being freed.
            CPPType* const vec = new (cppStorage) CPPType { std::move(cppValue) };
            const std::size_t length = vec->size();
            const std::size_t capacity = vec->capacity();
            const std::size_t allocSize = capacity * sizeof(T);

            T* const buffer = vec->mutableSpan().data();
            Detail::asanSetBufferSizeToFullCapacity(buffer, length, capacity);
            std::byte* storage = reinterpret_cast<std::byte*>(buffer);

            // Convert the elements.
            for (std::size_t i = 0; i < length; ++i) {
                T* oldPtr = std::launder(reinterpret_cast<T*>(storage + i * sizeof(T)));
                ExternElement newElem { ExternTraits<T>::convertToExtern(std::move(*oldPtr)) };
                oldPtr->~T();
                new (storage + i * sizeof(ExternElement)) ExternElement { std::move(newElem) };
            }

            std::size_t newCapacity {};
            std::size_t newAllocSize {};

            static constexpr bool newSizeIsMultiple = sizeof(T) % sizeof(ExternElement) == 0;
            if (newSizeIsMultiple) {
                newCapacity = capacity * (sizeof(T) / sizeof(ExternElement));
                newAllocSize = allocSize;
            } else {
                newCapacity = allocSize / sizeof(ExternElement);
                newAllocSize = newCapacity * sizeof(ExternElement);
                if (newAllocSize != allocSize) {
                    static_assert(std::is_trivially_copyable_v<ExternElement>);
                    storage = static_cast<std::byte*>(
                        MimallocMalloc::realloc(storage, newCapacity * sizeof(ExternElement)));
                }
            }

#if __cpp_lib_start_lifetime_as >= 202207L
            ExternElement* data = std::start_lifetime_as_array<ExternElement>(storage, newCapacity);
#else
            // We need to start the lifetime of an object of type "array of `capacity`
            // `ExternElement`" without invalidating the object representation. Without
            // `std::start_lifetime_as_array`, one way to do this is to use a no-op `memmove`,
            // which implicitly creates objects, plus `std::launder` to obtain a pointer to
            // the created object.
            std::memmove(storage, storage, newAllocSize);
            ExternElement* data = std::launder(reinterpret_cast<ExternElement*>(storage));
#endif
            return ExternType {
                .data = data,
                .length = static_cast<unsigned>(length),
                .capacity = static_cast<unsigned>(newCapacity),
            };
        }

        const std::size_t length = cppValue.size();
        const std::size_t newAllocSize = sizeof(ExternElement) * length;
        ExternElement* memory = reinterpret_cast<ExternElement*>(
            alignof(ExternElement) > MimallocMalloc::maxAlign
                ? MimallocMalloc::alignedMalloc(newAllocSize, alignof(ExternElement))
                : MimallocMalloc::malloc(newAllocSize));
        for (std::size_t i = 0; i < length; ++i) {
            new (memory + i) ExternElement {
                ExternTraits<T>::convertToExtern(std::move(cppValue[i])),
            };
        }
        return ExternType {
            .data = memory,
            .length = static_cast<unsigned>(length),
            .capacity = static_cast<unsigned>(length),
        };
    }
};

}
