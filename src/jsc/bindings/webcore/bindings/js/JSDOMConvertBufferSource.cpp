/*
 * Copyright (C) 2026 Apple Inc. All rights reserved.
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
#include "JSDOMConvertBufferSource.h"

#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>

namespace WebCore {

RefPtr<JSC::Int8Array> toPossiblySharedInt8Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::Int8Adaptor>(vm, value); }
RefPtr<JSC::Int16Array> toPossiblySharedInt16Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::Int16Adaptor>(vm, value); }
RefPtr<JSC::Int32Array> toPossiblySharedInt32Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::Int32Adaptor>(vm, value); }
RefPtr<JSC::Uint8Array> toPossiblySharedUint8Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::Uint8Adaptor>(vm, value); }
RefPtr<JSC::Uint8ClampedArray> toPossiblySharedUint8ClampedArray(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::Uint8ClampedAdaptor>(vm, value); }
RefPtr<JSC::Uint16Array> toPossiblySharedUint16Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::Uint16Adaptor>(vm, value); }
RefPtr<JSC::Uint32Array> toPossiblySharedUint32Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::Uint32Adaptor>(vm, value); }
RefPtr<JSC::Float16Array> toPossiblySharedFloat16Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::Float16Adaptor>(vm, value); }
RefPtr<JSC::Float32Array> toPossiblySharedFloat32Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::Float32Adaptor>(vm, value); }
RefPtr<JSC::Float64Array> toPossiblySharedFloat64Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::Float64Adaptor>(vm, value); }
RefPtr<JSC::BigInt64Array> toPossiblySharedBigInt64Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::BigInt64Adaptor>(vm, value); }
RefPtr<JSC::BigUint64Array> toPossiblySharedBigUint64Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toPossiblySharedNativeTypedView<JSC::BigUint64Adaptor>(vm, value); }

RefPtr<JSC::Int8Array> toUnsharedInt8Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::Int8Adaptor>(vm, value); }
RefPtr<JSC::Int16Array> toUnsharedInt16Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::Int16Adaptor>(vm, value); }
RefPtr<JSC::Int32Array> toUnsharedInt32Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::Int32Adaptor>(vm, value); }
RefPtr<JSC::Uint8Array> toUnsharedUint8Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::Uint8Adaptor>(vm, value); }
RefPtr<JSC::Uint8ClampedArray> toUnsharedUint8ClampedArray(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::Uint8ClampedAdaptor>(vm, value); }
RefPtr<JSC::Uint16Array> toUnsharedUint16Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::Uint16Adaptor>(vm, value); }
RefPtr<JSC::Uint32Array> toUnsharedUint32Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::Uint32Adaptor>(vm, value); }
RefPtr<JSC::Float16Array> toUnsharedFloat16Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::Float16Adaptor>(vm, value); }
RefPtr<JSC::Float32Array> toUnsharedFloat32Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::Float32Adaptor>(vm, value); }
RefPtr<JSC::Float64Array> toUnsharedFloat64Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::Float64Adaptor>(vm, value); }
RefPtr<JSC::BigInt64Array> toUnsharedBigInt64Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::BigInt64Adaptor>(vm, value); }
RefPtr<JSC::BigUint64Array> toUnsharedBigUint64Array(JSC::VM& vm, JSC::JSValue value) { return JSC::toUnsharedNativeTypedView<JSC::BigUint64Adaptor>(vm, value); }

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, JSC::ArrayBuffer& buffer)
{
    if (auto result = getCachedWrapper(globalObject->world(), buffer))
        return result;

    // The JSArrayBuffer::create function will register the wrapper in finishCreation.
    return JSC::JSArrayBuffer::create(JSC::getVM(lexicalGlobalObject), lexicalGlobalObject->arrayBufferStructure(buffer.sharingMode()), &buffer);
}

}
