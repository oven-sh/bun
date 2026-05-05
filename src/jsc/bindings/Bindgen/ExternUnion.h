#pragma once
#include <cstddef>
#include <cstdint>
#include <type_traits>
#include <variant>
#include "Macros.h"

#define BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0, ...)                    \
    template<typename T0 __VA_OPT__(                                       \
        BUN_BINDGEN_DETAIL_FOREACH(                                        \
            BUN_BINDGEN_DETAIL_EXTERN_UNION_TEMPLATE_PARAM,                \
            __VA_ARGS__))>                                                 \
    union ExternUnion<T0 __VA_OPT__(, ) __VA_ARGS__> {                     \
        BUN_BINDGEN_DETAIL_FOREACH(                                        \
            BUN_BINDGEN_DETAIL_EXTERN_UNION_FIELD,                         \
            T0 __VA_OPT__(, ) __VA_ARGS__)                                 \
        ExternUnion(std::variant<T0 __VA_OPT__(, ) __VA_ARGS__>&& variant) \
        {                                                                  \
            using This = std::decay_t<decltype(*this)>;                    \
            static_assert(std::is_trivially_copyable_v<This>);             \
            const std::size_t index = variant.index();                     \
            std::visit([this, index](auto&& arg) {                         \
                using Arg = std::decay_t<decltype(arg)>;                   \
                BUN_BINDGEN_DETAIL_FOREACH(                                \
                    BUN_BINDGEN_DETAIL_EXTERN_UNION_VISIT,                 \
                    T0 __VA_OPT__(, ) __VA_ARGS__)                         \
            },                                                             \
                std::move(variant));                                       \
        }                                                                  \
    }

#define BUN_BINDGEN_DETAIL_EXTERN_UNION_TEMPLATE_PARAM(Type) , typename Type
#define BUN_BINDGEN_DETAIL_EXTERN_UNION_FIELD(Type) Type alternative##Type;
#define BUN_BINDGEN_DETAIL_EXTERN_UNION_VISIT(Type)           \
    if constexpr (std::is_same_v<Arg, Type>) {                \
        if (index == ::Bun::Bindgen::Detail::indexOf##Type) { \
            alternative##Type = std::move(arg);               \
            return;                                           \
        }                                                     \
    }

namespace Bun::Bindgen {
namespace Detail {
// For use in macros.
static constexpr std::size_t indexOfT0 = 0;
static constexpr std::size_t indexOfT1 = 1;
static constexpr std::size_t indexOfT2 = 2;
static constexpr std::size_t indexOfT3 = 3;
static constexpr std::size_t indexOfT4 = 4;
static constexpr std::size_t indexOfT5 = 5;
static constexpr std::size_t indexOfT6 = 6;
static constexpr std::size_t indexOfT7 = 7;
static constexpr std::size_t indexOfT8 = 8;
static constexpr std::size_t indexOfT9 = 9;
static constexpr std::size_t indexOfT10 = 10;
static constexpr std::size_t indexOfT11 = 11;
static constexpr std::size_t indexOfT12 = 12;
static constexpr std::size_t indexOfT13 = 13;
static constexpr std::size_t indexOfT14 = 14;
static constexpr std::size_t indexOfT15 = 15;
}

template<typename... Args>
union ExternUnion;

BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0, T1);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0, T1, T2);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0, T1, T2, T3);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0, T1, T2, T3, T4);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0, T1, T2, T3, T4, T5);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0, T1, T2, T3, T4, T5, T6);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0, T1, T2, T3, T4, T5, T6, T7);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0, T1, T2, T3, T4, T5, T6, T7, T8);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(T0, T1, T2, T3, T4, T5, T6, T7, T8, T9);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(
    T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(
    T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(
    T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(
    T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(
    T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14);
BUN_BINDGEN_DETAIL_DEFINE_EXTERN_UNION(
    T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15);
}
