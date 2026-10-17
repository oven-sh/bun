/*
 * Copyright (C) 2016 Apple, Inc. All rights reserved.
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
#include "JSDOMIterator.h"

#include <JavaScriptCore/ArrayPrototype.h>
#include <JavaScriptCore/BuiltinNames.h>

namespace WebCore {

void addValueIterableMethods(JSC::JSGlobalObject& globalObject, JSC::JSObject& prototype)
{
    JSC::ArrayPrototype* arrayPrototype = globalObject.arrayPrototype();
    ASSERT(arrayPrototype);

    JSC::JSGlobalObject* lexicalGlobalObject = &globalObject;
    ASSERT(lexicalGlobalObject);
    JSC::VM& vm = lexicalGlobalObject->vm();

    auto copyProperty = [&] (const JSC::Identifier& arrayIdentifier, const JSC::Identifier& otherIdentifier, unsigned attributes = 0) {
        JSC::JSValue value = arrayPrototype->getDirect(vm, arrayIdentifier);
        ASSERT(value);
        prototype.putDirect(vm, otherIdentifier, value, attributes);
    };

    copyProperty(vm.propertyNames->builtinNames().entriesPrivateName(), vm.propertyNames->builtinNames().entriesPublicName());
    copyProperty(vm.propertyNames->builtinNames().forEachPrivateName(), vm.propertyNames->builtinNames().forEachPublicName());
    copyProperty(vm.propertyNames->builtinNames().keysPrivateName(), vm.propertyNames->builtinNames().keysPublicName());
    copyProperty(vm.propertyNames->builtinNames().valuesPrivateName(), vm.propertyNames->builtinNames().valuesPublicName());
}

}
