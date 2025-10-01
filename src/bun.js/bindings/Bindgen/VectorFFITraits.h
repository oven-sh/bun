#pragma once
#include <cstddef>
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
struct FFITraits;

template<typename T>
struct FFIVector {
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
struct FFITraits<WTF::Vector<T, 0, OverflowHandler, minCapacity, MimallocMalloc>> {
private:
    using CPPType = WTF::Vector<T, 0, OverflowHandler, minCapacity, MimallocMalloc>;
    using FFIElement = FFITraits<T>::FFIType;

public:
    using FFIType = FFIVector<FFIElement>;

    static FFIType convertToFFI(CPPType&& cppValue)
    {
        if constexpr (std::is_same_v<T, FFIElement>) {
            // We can reuse the allocation.
            alignas(CPPType) std::byte cppStorage[sizeof(CPPType)];
            // This prevents the contents from being freed or destructed.
            CPPType* const vec = new (cppStorage) CPPType { std::move(cppValue) };
            T* const buffer = vec->mutableSpan().data();
            const std::size_t length = vec->size();
            const std::size_t capacity = vec->capacity();
            Detail::asanSetBufferSizeToFullCapacity(buffer, length, capacity);

            return FFIType {
                .data = vec->mutableSpan().data(),
                .length = static_cast<unsigned>(length),
                .capacity = static_cast<unsigned>(capacity),
            };
        } else if constexpr (
            sizeof(FFIElement) <= sizeof(T) && alignof(FFIElement) <= MimallocMalloc::maxAlign) {

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

            std::size_t newCapacity = capacity;
            std::size_t newAllocSize = allocSize;
            static constexpr bool newSizeIsMultiple = sizeof(T) % sizeof(FFIElement) == 0;
            if (!newSizeIsMultiple) {
                newCapacity = allocSize / sizeof(FFIElement);
                newAllocSize = newCapacity * sizeof(FFIElement);
                if (newAllocSize != allocSize) {
                    // Allocation isn't a multiple of `sizeof(FFIElement)`; we have to resize it.
                    storage = reinterpret_cast<std::byte*>(
                        MimallocMalloc::realloc(storage, newCapacity * sizeof(FFIElement)));
                }
            }

            // Convert the elements.
            for (std::size_t i = 0; i < length; ++i) {
                T* oldPtr = std::launder(reinterpret_cast<T*>(storage + i * sizeof(T)));
                FFIElement newElem { FFITraits<T>::convertToFFI(std::move(*oldPtr)) };
                oldPtr->~T();
                new (storage + i * sizeof(FFIElement)) FFIElement { std::move(newElem) };
            }
#if __cpp_lib_start_lifetime_as >= 202207L
            FFIElement* data = std::start_lifetime_as_array<FFIElement*>(storage, newCapacity);
#else
            // We need to start the lifetime of an object of type "array of `capacity`
            // `FFIElement`" without invalidating the object representation. Without
            // `std::start_lifetime_as_array`, one way to do this is to use a no-op `memmove`,
            // which implicitly creates objects, plus `std::launder` to obtain a pointer to
            // the created object.
            std::memmove(storage, storage, newAllocSize);
            FFIElement* data = std::launder(reinterpret_cast<FFIElement*>(storage));
#endif
            return FFIType {
                .data = data,
                .length = static_cast<unsigned>(length),
                .capacity = static_cast<unsigned>(newCapacity),
            };
        }

        const std::size_t length = cppValue.size();
        const std::size_t newAllocSize = sizeof(FFIElement) * length;
        FFIElement* memory = reinterpret_cast<FFIElement*>(
            alignof(FFIElement) > MimallocMalloc::maxAlign
                ? MimallocMalloc::alignedMalloc(newAllocSize, alignof(FFIElement))
                : MimallocMalloc::malloc(newAllocSize));
        for (std::size_t i = 0; i < cppValue.size(); ++i) {
            new (memory + i) FFIElement { FFITraits<T>::convertToFFI(std::move(cppValue[i])) };
        }
        return FFIType {
            .data = memory,
            .length = static_cast<unsigned>(length),
            .capacity = static_cast<unsigned>(length),
        };
    }
};

}
