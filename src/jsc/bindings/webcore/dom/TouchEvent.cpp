/*
 * Copyright 2008, The Android Open Source Project
 * Copyright (C) 2012 Research In Motion Limited. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ``AS IS'' AND ANY
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
#include "TouchEvent.h"

#include "JSDOMExceptionHandling.h"
#include "Window.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArray.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TouchEvent);

TouchEvent::TouchEvent()
    : UIEventWithKeyState(EventInterfaceType::TouchEvent)
{
}

TouchEvent::TouchEvent(const AtomString& type, const Init& initializer)
    : UIEventWithKeyState(EventInterfaceType::TouchEvent, type, initializer)
    , m_touches(initializer.touches)
    , m_targetTouches(initializer.targetTouches)
    , m_changedTouches(initializer.changedTouches)
{
}

TouchEvent::~TouchEvent() = default;

// What converting to `sequence<any>` and back to JavaScript gives.
static JSC::JSValue copyTouchList(JSC::JSGlobalObject& globalObject, JSC::JSValue list, ASCIILiteral memberName)
{
    auto& vm = globalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (list.isUndefined())
        return { };
    if (!list.isObject()) {
        throwSequenceTypeError(globalObject, scope, "TouchEvent constructor"_s, memberName);
        return { };
    }

    JSC::MarkedArgumentBuffer items;
    JSC::forEachInIterable(&globalObject, list, [&items](JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue item) {
        items.append(item);
    });
    RETURN_IF_EXCEPTION(scope, { });
    if (items.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(&globalObject, scope);
        return { };
    }
    RELEASE_AND_RETURN(scope, JSC::constructArray(&globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), items));
}

ExceptionOr<Ref<TouchEvent>> TouchEvent::create(JSC::JSGlobalObject& globalObject, JSC::MarkedArgumentBuffer& arrays, const AtomString& type, Init&& initializer)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject.vm());

    auto copy = [&](JSC::JSValue& list, ASCIILiteral memberName) {
        list = copyTouchList(globalObject, list, memberName);
        RETURN_IF_EXCEPTION(scope, false);
        if (list)
            arrays.append(list);
        return true;
    };
    if (!copy(initializer.changedTouches, "eventInitDict.changedTouches"_s) || !copy(initializer.targetTouches, "eventInitDict.targetTouches"_s) || !copy(initializer.touches, "eventInitDict.touches"_s))
        return Exception { ExceptionCode::ExistingExceptionError };

    return adoptRef(*new TouchEvent(type, initializer));
}

} // namespace WebCore
