#pragma once

#include "DOMClientData.h"
#include <wtf/TZoneMalloc.h>
#include <wtf/text/AtomString.h>

namespace WebCore {

// The names forms return by reference. An AtomString belongs to its thread, so each VM has its own set.
struct FormAtomStrings {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(FormAtomStrings);

    const AtomString checkbox { "checkbox"_s };
    const AtomString color { "color"_s };
    const AtomString date { "date"_s };
    const AtomString datetimeLocal { "datetime-local"_s };
    const AtomString decimal { "decimal"_s };
    const AtomString file { "file"_s };
    const AtomString hidden { "hidden"_s };
    const AtomString image { "image"_s };
    const AtomString month { "month"_s };
    const AtomString number { "number"_s };
    const AtomString numeric { "numeric"_s };
    const AtomString password { "password"_s };
    const AtomString radio { "radio"_s };
    const AtomString range { "range"_s };
    const AtomString selectMultiple { "select-multiple"_s };
    const AtomString selectOne { "select-one"_s };
    const AtomString time { "time"_s };
    const AtomString week { "week"_s };
};

inline const FormAtomStrings& formAtomStrings()
{
    return domClientData().formAtomStrings();
}

} // namespace WebCore
