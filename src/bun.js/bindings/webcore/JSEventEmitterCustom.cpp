/*
 * Copyright (C) 2008-2021 Apple Inc. All Rights Reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "JSEventEmitter.h"

#include "EventEmitter.h"
#include "JSDOMWrapperCache.h"
#include "JSEventListener.h"

namespace WebCore {
using namespace JSC;

JSValue toJSNewlyCreated(JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<EventEmitter>&& value)
{
    return createWrapper<EventEmitter>(globalObject, WTFMove(value));
}

EventEmitter* JSEventEmitter::toWrapped(VM& vm, JSValue value)
{
    if (value.inherits<JSEventEmitter>())
        return &jsCast<JSEventEmitter*>(asObject(value))->wrapped();
    return nullptr;
}

std::unique_ptr<JSEventEmitterWrapper> jsEventEmitterCast(VM& vm, JSValue thisValue)
{
    if (auto* target = jsDynamicCast<JSEventEmitter*>(thisValue))
        return makeUnique<JSEventEmitterWrapper>(target->wrapped(), *target);
    return nullptr;
}

template<typename Visitor>
void JSEventEmitter::visitAdditionalChildren(Visitor& visitor)
{
    wrapped().visitJSEventListeners(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSEventEmitter);

} // namespace WebCore
