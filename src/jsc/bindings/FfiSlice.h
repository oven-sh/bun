#pragma once

#include <span>
#include <stddef.h>
#include <stdint.h>

namespace Bun {

/// `bun_core::ffi::FfiSlice<'_, T>` — a borrowed Rust `&[T]` passed by value
/// (`struct { const T* ptr; size_t len; }`). Valid for the duration of the call.
template<typename T = uint8_t>
struct FfiSlice {
    const T* ptr;
    size_t len;

    std::span<const T> span() const { return { ptr, len }; }
};

} // namespace Bun
