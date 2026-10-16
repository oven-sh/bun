/*
 * Copyright (C) 2021 Alexey Shvayka <shvaikalesh@gmail.com>.
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
#include "JSHTMLAllCollection.h"

#include "CachedHTMLCollectionInlines.h"
#include "Element.h"
#include "HTMLCollection.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertUnion.h"
#include "JSElement.h"
#include "JSHTMLCollection.h"

namespace WebCore {
using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(callJSHTMLAllCollection);

// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#HTMLAllCollection-call
JSC_DEFINE_HOST_FUNCTION(callJSHTMLAllCollection, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* castedThis = downcast<JSHTMLAllCollection>(callFrame->jsCallee());
    ASSERT(castedThis);
    auto& impl = castedThis->wrapped();
    if (callFrame->argument(0).isUndefined())
        return JSValue::encode(jsNull());

    AtomString nameOrIndex = callFrame->uncheckedArgument(0).toString(lexicalGlobalObject)->toAtomString(lexicalGlobalObject).data;
    RETURN_IF_EXCEPTION(scope, { });
    RELEASE_AND_RETURN(scope, JSValue::encode(toJS<IDLNullable<IDLUnion<IDLInterface<HTMLCollection>, IDLInterface<Element>>>>(*lexicalGlobalObject, *castedThis->realm(), impl.namedOrIndexedItemOrItems(WTF::move(nameOrIndex)))));
}

CallData LEGACY_NODELETE JSHTMLAllCollection::getCallData(JSCell*)
{
    CallData callData;
    callData.type = CallData::Type::Native;
    callData.native.function = callJSHTMLAllCollection;
    callData.native.isBoundFunction = false;
    callData.native.isWasm = false;
    return callData;
}

} // namespace WebCore
