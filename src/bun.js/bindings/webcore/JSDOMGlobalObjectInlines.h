/*
 * Copyright (C) 2021 Apple Inc. All Rights Reserved.
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
 *
 */

#pragma once

#include "DOMConstructors.h"
#include "JSDOMGlobalObject.h"

namespace WebCore {

template<class ConstructorClass, DOMConstructorID constructorID>
inline JSC::JSObject* getDOMConstructor(JSC::VM& vm, const Zig::GlobalObject& globalObject)
{
    // No locking is necessary unless we need to add a new constructor to Zig::GlobalObject::constructors().
    if (JSC::JSObject* constructor = globalObject.constructors().array()[static_cast<unsigned>(constructorID)].get())
        return constructor;
    JSC::JSObject* constructor = ConstructorClass::create(vm, ConstructorClass::createStructure(vm, const_cast<Zig::GlobalObject&>(globalObject), ConstructorClass::prototypeForStructure(vm, globalObject)), const_cast<Zig::GlobalObject&>(globalObject));
    ASSERT(!globalObject.constructors().array()[static_cast<unsigned>(constructorID)].get());
    Zig::GlobalObject& mutableGlobalObject = const_cast<Zig::GlobalObject&>(globalObject);
    mutableGlobalObject.constructors().array()[static_cast<unsigned>(constructorID)].set(vm, &globalObject, constructor);
    return constructor;
}

} // namespace WebCore
