/*
 * Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 * Copyright (C) 2003-2006, 2008-2009, 2013, 2016 Apple Inc. All rights reserved.
 * Copyright (C) 2007 Samuel Weinig <sam@webkit.org>
 * Copyright (C) 2009 Google, Inc. All rights reserved.
 * Copyright (C) 2012 Ericsson AB. All rights reserved.
 * Copyright (C) 2013 Michael Pruett <michael@68k.org>
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

#include "JSDOMGlobalObject.h"

namespace WebCore {

enum class CastedThisErrorBehavior : uint8_t {
    Throw,
    ReturnEarly,
    RejectPromise,
    Assert,
};

template<class JSClass>
JSClass* castThisValue(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue thisValue)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    if constexpr (std::is_base_of_v<JSDOMGlobalObject, JSClass>)
        return toJSDOMGlobalObject<JSClass>(vm, thisValue.isUndefinedOrNull() ? &lexicalGlobalObject : thisValue);
    else
        return JSC::jsDynamicCast<JSClass*>(thisValue);
}

}
