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

#include "config.h"
#include "DOMQuotaExceededError.h"

namespace WebCore {

ExceptionOr<Ref<DOMQuotaExceededError>> DOMQuotaExceededError::create(const String& message, QuotaExceededErrorOptions&& options)
{
    if (options.quota && *options.quota < 0)
        return Exception { ExceptionCode::RangeError, "options.quota must not be negative"_s };
    if (options.requested && *options.requested < 0)
        return Exception { ExceptionCode::RangeError, "options.requested must not be negative"_s };
    if (options.quota && options.requested && *options.requested < *options.quota)
        return Exception { ExceptionCode::RangeError, "options.requested must not be less than options.quota"_s };
    return createUnchecked(message, WTF::move(options));
}

Ref<DOMQuotaExceededError> DOMQuotaExceededError::createUnchecked(const String& message, QuotaExceededErrorOptions&& options)
{
    return adoptRef(*new DOMQuotaExceededError(message, WTF::move(options)));
}

DOMQuotaExceededError::DOMQuotaExceededError(const String& message, QuotaExceededErrorOptions&& options)
    : DOMException(description(ExceptionCode::QuotaExceededError).legacyCode, description(ExceptionCode::QuotaExceededError).name, message, Type::QuotaExceededError)
    , m_quota(options.quota)
    , m_requested(options.requested)
{
}

} // namespace WebCore
