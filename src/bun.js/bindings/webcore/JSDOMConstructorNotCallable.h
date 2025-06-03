/*
 * Copyright (C) 2021 Alexey Shvayka <shvaikalesh@gmail.com>
 * Copyright (C) 2021-2022 Apple Inc. All rights reserved.
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

#include "JSDOMWrapper.h"
#include "WebCoreJSClientData.h"

namespace WebCore {

template<typename JSClass> class JSDOMConstructorNotCallable : public JSDOMObject {
public:
    using Base = JSDOMObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = DoesNotNeedDestruction;
    static JSDOMConstructorNotCallable* create(JSC::VM&, JSC::Structure*, JSDOMGlobalObject&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject&, JSC::JSValue prototype);

    DECLARE_INFO;

    static JSC::JSValue prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        static_assert(sizeof(CellType) == sizeof(JSDOMConstructorNotCallable));
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(CellType, JSDOMConstructorNotCallable);
        static_assert(CellType::destroy == JSC::JSCell::destroy, "JSDOMConstructorNotCallable<JSClass> is not destructible actually");
        return &static_cast<JSVMClientData*>(vm.clientData)->domNamespaceObjectSpace();
    }

private:
    JSDOMConstructorNotCallable(JSC::Structure* structure, JSDOMGlobalObject& globalObject)
        : Base(structure, globalObject)
    {
    }

    void finishCreation(JSC::VM&, JSDOMGlobalObject&);
    void initializeProperties(JSC::VM&, JSDOMGlobalObject&) {}
};

template<typename JSClass> inline JSDOMConstructorNotCallable<JSClass>* JSDOMConstructorNotCallable<JSClass>::create(JSC::VM& vm, JSC::Structure* structure, JSDOMGlobalObject& globalObject)
{
    JSDOMConstructorNotCallable* constructor = new (NotNull, JSC::allocateCell<JSDOMConstructorNotCallable>(vm)) JSDOMConstructorNotCallable(structure, globalObject);
    constructor->finishCreation(vm, globalObject);
    return constructor;
}

template<typename JSClass> inline JSC::Structure* JSDOMConstructorNotCallable<JSClass>::createStructure(JSC::VM& vm, JSC::JSGlobalObject& globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, &globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

template<typename JSClass> inline void JSDOMConstructorNotCallable<JSClass>::finishCreation(JSC::VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    initializeProperties(vm, globalObject);
}

} // namespace WebCore
