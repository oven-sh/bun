#pragma once

#include "JSBuffer.h"
#include "ZigGlobalObject.h"

namespace WebCore {

// JSC takes the view's mode from the ArrayBuffer and its Structure from the caller, and checks that the two agree only in assertion builds.
ALWAYS_INLINE JSC::JSUint8Array* createBuffer(Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, RefPtr<JSC::ArrayBuffer>&& buffer, size_t byteOffset, size_t length)
{
    auto* structure = buffer->isResizableOrGrowableShared() ? globalObject->JSResizableOrGrowableSharedBufferSubclassStructure() : globalObject->JSBufferSubclassStructure();
    return JSC::JSUint8Array::create(lexicalGlobalObject, structure, WTF::move(buffer), byteOffset, length);
}

} // namespace WebCore
