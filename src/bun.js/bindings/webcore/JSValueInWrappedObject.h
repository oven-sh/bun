/*
 * Copyright (C) 2018-2021 Apple Inc. All rights reserved.

 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "DOMWrapperWorld.h"
#include "JSDOMWrapper.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/SlotVisitor.h>
#include <JavaScriptCore/WeakInlines.h>
#include <variant>

namespace WebCore {

// This class includes a lot of GC related subtle things, and changing this class easily causes GC crashes.
// Any changes on this class must be reviewed by JavaScriptCore reviewers too.
class JSValueInWrappedObject {
    // It must be neither copyable nor movable. Changing this will break concurrent GC.
    WTF_MAKE_NONCOPYABLE(JSValueInWrappedObject);
    WTF_MAKE_NONMOVABLE(JSValueInWrappedObject);

public:
    JSValueInWrappedObject(JSC::JSValue = {});

    explicit operator bool() const;
    template<typename Visitor> void visit(Visitor&) const;
    void clear();

    void set(JSC::VM&, const JSC::JSCell* owner, JSC::JSValue);
    void setWeakly(JSC::JSValue);
    JSC::JSValue getValue(JSC::JSValue nullValue = JSC::jsUndefined()) const;

private:
    // Keep in mind that all of these fields are accessed concurrently without lock from concurrent GC thread.
    JSC::JSValue m_nonCell {};
    JSC::Weak<JSC::JSCell> m_cell {};
};

JSC::JSValue cachedPropertyValue(JSC::ThrowScope&, JSC::JSGlobalObject&, const JSDOMObject& owner, JSValueInWrappedObject& cacheSlot, const auto&);

inline JSValueInWrappedObject::JSValueInWrappedObject(JSC::JSValue value)
{
    setWeakly(value);
}

inline JSC::JSValue JSValueInWrappedObject::getValue(JSC::JSValue nullValue) const
{
    if (m_nonCell)
        return m_nonCell;
    return m_cell ? m_cell.get() : nullValue;
}

inline JSValueInWrappedObject::operator bool() const
{
    return m_nonCell || m_cell;
}

template<typename Visitor>
inline void JSValueInWrappedObject::visit(Visitor& visitor) const
{
    visitor.append(m_cell);
}

template void JSValueInWrappedObject::visit(JSC::AbstractSlotVisitor&) const;
template void JSValueInWrappedObject::visit(JSC::SlotVisitor&) const;

inline void JSValueInWrappedObject::setWeakly(JSC::JSValue value)
{
    if (!value.isCell()) {
        m_nonCell = value;
        m_cell.clear();
        return;
    }
    m_nonCell = {};
    JSC::Weak weak { value.asCell() };
    WTF::storeStoreFence();
    m_cell = WTF::move(weak);
}

inline void JSValueInWrappedObject::set(JSC::VM& vm, const JSC::JSCell* owner, JSC::JSValue value)
{
    setWeakly(value);
    vm.writeBarrier(owner, value);
}

inline void JSValueInWrappedObject::clear()
{
    m_nonCell = {};
    m_cell.clear();
}

inline JSC::JSValue cachedPropertyValue(JSC::ThrowScope& throwScope, JSC::JSGlobalObject& lexicalGlobalObject, const JSDOMObject& owner, JSValueInWrappedObject& cachedValue, const auto& function)
{
    if (cachedValue && isWorldCompatible(lexicalGlobalObject, cachedValue.getValue()))
        return cachedValue.getValue();

    auto value = function(throwScope);
    RETURN_IF_EXCEPTION(throwScope, {});

    cachedValue.set(lexicalGlobalObject.vm(), &owner, cloneAcrossWorlds(lexicalGlobalObject, owner, value));
    ASSERT(isWorldCompatible(lexicalGlobalObject, cachedValue.getValue()));
    return cachedValue.getValue();
}

} // namespace WebCore
