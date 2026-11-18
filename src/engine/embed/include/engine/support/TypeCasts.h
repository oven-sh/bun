#pragma once

#include "engine/support/Assertions.h"

#include <concepts>
#include <type_traits>

namespace WTF {

// Specialized for each class that can be cast down to.
template<typename Target, typename Source, bool isBaseType = std::is_base_of_v<Target, Source>>
struct TypeCastTraits {
    static bool isOfType(Source&)
    {
        static_assert(false, "The class lacks SPECIALIZE_TYPE_TRAITS_BEGIN");
        return false;
    }
};

template<typename Target, typename Source>
struct TypeCastTraits<Target, Source, true> {
    static bool isOfType(Source&) { return true; }
};

template<typename Source, typename Target>
using match_constness_t = std::conditional_t<std::is_const_v<Source>, const Target, std::remove_const_t<Target>>;

template<typename Target, typename Source>
inline bool is(const Source& source)
{
    static_assert(std::derived_from<Target, Source>);
    return TypeCastTraits<const Target, const Source>::isOfType(source);
}

template<typename Target, typename Source>
inline bool is(Source* source)
{
    return source && is<Target>(*source);
}

template<typename Target, typename Source>
inline match_constness_t<Source, Target>& uncheckedDowncast(Source& source LIFETIME_BOUND)
{
    static_assert(std::derived_from<Target, Source>);
    ASSERT_WITH_SECURITY_IMPLICATION(is<Target>(source));
    return static_cast<match_constness_t<Source, Target>&>(source);
}

template<typename Target, typename Source>
inline match_constness_t<Source, Target>* uncheckedDowncast(Source* source LIFETIME_BOUND)
{
    static_assert(std::derived_from<Target, Source>);
    ASSERT_WITH_SECURITY_IMPLICATION(!source || is<Target>(*source));
    return static_cast<match_constness_t<Source, Target>*>(source);
}

template<typename Target, typename Source>
inline match_constness_t<Source, Target>& downcast(Source& source LIFETIME_BOUND)
{
    RELEASE_ASSERT(is<Target>(source));
    return static_cast<match_constness_t<Source, Target>&>(source);
}

template<typename Target, typename Source>
inline match_constness_t<Source, Target>* downcast(Source* source LIFETIME_BOUND)
{
    RELEASE_ASSERT(!source || is<Target>(*source));
    return static_cast<match_constness_t<Source, Target>*>(source);
}

template<typename Target, typename Source>
inline match_constness_t<Source, Target>* dynamicDowncast(Source& source LIFETIME_BOUND)
{
    return is<Target>(source) ? &static_cast<match_constness_t<Source, Target>&>(source) : nullptr;
}

template<typename Target, typename Source>
inline match_constness_t<Source, Target>* dynamicDowncast(Source* source LIFETIME_BOUND)
{
    return is<Target>(source) ? static_cast<match_constness_t<Source, Target>*>(source) : nullptr;
}

}

using WTF::downcast;
using WTF::dynamicDowncast;
using WTF::is;
using WTF::TypeCastTraits;
using WTF::uncheckedDowncast;

// Between the two go the overloads of `static bool isType(const Base&)`.
#define SPECIALIZE_TYPE_TRAITS_BEGIN(Class)                             \
    namespace WTF {                                                     \
    template<typename Source>                                           \
    struct TypeCastTraits<const Class, Source, false> {                 \
        static bool isOfType(Source& source) { return isType(source); } \
                                                                        \
    private:

#define SPECIALIZE_TYPE_TRAITS_END() \
    }                                \
    ;                                \
    }
