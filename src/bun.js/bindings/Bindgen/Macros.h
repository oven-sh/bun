#pragma once
#include <type_traits>
#include <utility>

#define BUN_BINDGEN_DETAIL_FOREACH(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH2(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH2(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH3(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH3(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH4(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH4(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH5(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH5(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH6(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH6(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH7(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH7(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH8(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH8(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH9(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH9(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH10(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH10(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH11(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH11(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH12(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH12(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH13(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH13(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH14(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH14(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH15(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH15(macro, arg, ...) macro(arg) \
    __VA_OPT__(BUN_BINDGEN_DETAIL_FOREACH16(macro, __VA_ARGS__))
#define BUN_BINDGEN_DETAIL_FOREACH16(macro, arg, ...) macro(arg) \
    __VA_OPT__(static_assert(false, "Bindgen/Macros.h: too many items"))
