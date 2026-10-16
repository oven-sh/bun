/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

namespace WebCore {

class DeferredPromise;

template <typename IDLType> class DOMPromiseDeferred;
template <typename IDLType> class DOMPromiseProxy;

struct IDLUnsupportedType;
struct IDLNull;
struct IDLAny;
struct IDLUndefined;
struct IDLBoolean;
struct IDLByte;
struct IDLOctet;
struct IDLShort;
struct IDLUnsignedShort;
struct IDLLong;
struct IDLUnsignedLong;
struct IDLLongLong;
struct IDLUnsignedLongLong;
struct IDLFloat;
struct IDLUnrestrictedFloat;
struct IDLDouble;
struct IDLUnrestrictedDouble;
struct IDLDOMString;
struct IDLByteString;
struct IDLUSVString;
struct IDLObject;

template<typename> struct IDLInterface;
template<typename> struct IDLCallbackInterface;
template<typename> struct IDLCallbackFunction;
template<typename> struct IDLDictionary;
template<typename> struct IDLEnumeration;
template<typename> struct IDLNullable;
template<typename, size_t = 0> struct IDLSequence;
template<typename, size_t = 0> struct IDLFrozenArray;
template<typename, typename> struct IDLRecord;
template<typename> struct IDLPromise;
template<typename> struct IDLPromiseIgnoringSuspension;

struct IDLError;
struct IDLDOMException;

template<typename...> struct IDLUnion;
template<typename> struct IDLBufferSourceBase;

struct IDLArrayBuffer;
struct IDLArrayBufferView;
struct IDLDataView;
struct IDLDate;
struct IDLJSON;
struct IDLScheduledAction;
struct IDLIDBKey;
struct IDLIDBKeyData;
struct IDLIDBValue;

#if ENABLE(WEBGL)
struct IDLWebGLAny;
struct IDLWebGLExtensionAny;
#endif

}
