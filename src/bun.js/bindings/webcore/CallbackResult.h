/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

#include <wtf/Expected.h>

namespace WebCore {

enum class CallbackResultType {
    Success,
    ExceptionThrown,
    UnableToExecute
};

template<typename ReturnType> class CallbackResult {
public:
    CallbackResult(CallbackResultType);
    CallbackResult(ReturnType&&);

    CallbackResultType type() const;
    ReturnType&& releaseReturnValue();

private:
    Expected<ReturnType, CallbackResultType> m_value;
};

template<> class CallbackResult<void> {
public:
    CallbackResult() = default;
    CallbackResult(CallbackResultType);

    CallbackResultType type() const;

private:
    CallbackResultType m_type = CallbackResultType::Success;
};

template<typename ReturnType> inline CallbackResult<ReturnType>::CallbackResult(CallbackResultType type)
    : m_value(makeUnexpected(type))
{
}

template<typename ReturnType> inline CallbackResult<ReturnType>::CallbackResult(ReturnType&& returnValue)
    : m_value(WTFMove(returnValue))
{
}

template<typename ReturnType> inline CallbackResultType CallbackResult<ReturnType>::type() const
{
    return m_value.has_value() ? CallbackResultType::Success : m_value.error();
}

template<typename ReturnType> inline auto CallbackResult<ReturnType>::releaseReturnValue() -> ReturnType&&
{
    ASSERT(m_value.has_value());
    return WTFMove(m_value.value());
}

// Void specialization

inline CallbackResult<void>::CallbackResult(CallbackResultType type)
    : m_type(type)
{
}

inline CallbackResultType CallbackResult<void>::type() const
{
    return m_type;
}

}
