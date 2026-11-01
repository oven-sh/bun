#pragma once

#include "root.h"

#include "JSDOMWrapper.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/Identifier.h>
#include <span>

inline bool mayBeAsymmetricMatcher(JSC::JSValue value)
{
    return value.isCell() && !value.isEmpty() && value.asCell()->type() == JSC::JSType(WebCore::JSDOMWrapperType);
}

namespace Bun {

// Runs `format` with each asymmetric matcher put over the property it passed on, then puts the properties back.
// `targetsAndMatchers` holds the object and the matcher for each of `keys`.
void formatWithPassedMatchers(JSC::JSGlobalObject*, JSC::ThrowScope&, std::span<const JSC::Identifier> keys, const JSC::MarkedArgumentBuffer& targetsAndMatchers, void* ctx, void (*format)(void* ctx, bool));

} // namespace Bun
