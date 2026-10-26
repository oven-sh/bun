/*
 * Copyright (C) 2025 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "DOMException.h"
#include "ExceptionOr.h"
#include "QuotaExceededErrorOptions.h"
#include <wtf/Markable.h>

namespace WebCore {

// https://webidl.spec.whatwg.org/#quotaexceedederror
// WebKit names this class QuotaExceededError. Here that name is an enumerator of the unscoped ExceptionCode.
class DOMQuotaExceededError final : public DOMException {
public:
    // The constructor steps of the interface: a RangeError for a negative member or for requested < quota.
    static ExceptionOr<Ref<DOMQuotaExceededError>> create(const String& message = {}, QuotaExceededErrorOptions&& = {});
    // For a native thrower and for the structured clone reader. Neither has values to validate.
    static Ref<DOMQuotaExceededError> createUnchecked(const String& message = {}, QuotaExceededErrorOptions&& = {});

    std::optional<double> quota() const { return m_quota; }
    std::optional<double> requested() const { return m_requested; }

private:
    DOMQuotaExceededError(const String& message, QuotaExceededErrorOptions&&);

    const Markable<double> m_quota;
    const Markable<double> m_requested;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::DOMQuotaExceededError)
static bool isType(const WebCore::DOMException& exception) { return exception.type() == WebCore::DOMException::Type::QuotaExceededError; }
SPECIALIZE_TYPE_TRAITS_END()
