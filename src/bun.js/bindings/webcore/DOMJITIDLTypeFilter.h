/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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

#include "IDLTypes.h"
#include <JavaScriptCore/SpeculatedType.h>

namespace WebCore {
namespace DOMJIT {

template<typename IDLType>
struct IDLArgumentTypeFilter;

template<> struct IDLArgumentTypeFilter<IDLBoolean> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecBoolean;
};
template<> struct IDLArgumentTypeFilter<IDLByte> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecInt32Only;
};
template<> struct IDLArgumentTypeFilter<IDLOctet> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecInt32Only;
};
template<> struct IDLArgumentTypeFilter<IDLShort> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecInt32Only;
};
template<> struct IDLArgumentTypeFilter<IDLUnsignedShort> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecInt32Only;
};
template<> struct IDLArgumentTypeFilter<IDLLong> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecInt32Only;
};
template<> struct IDLArgumentTypeFilter<IDLDOMString> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecString;
};
template<> struct IDLArgumentTypeFilter<IDLAtomStringAdaptor<IDLDOMString>> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecString;
};
template<> struct IDLArgumentTypeFilter<IDLRequiresExistingAtomStringAdaptor<IDLDOMString>> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecString;
};
template<> struct IDLArgumentTypeFilter<IDLUint8Array> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecUint8Array;
};

template<typename IDLType>
struct IDLResultTypeFilter {
    static const constexpr JSC::SpeculatedType value = JSC::SpecFullTop;
};

template<> struct IDLResultTypeFilter<IDLAny> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecHeapTop;
};
template<> struct IDLResultTypeFilter<IDLBoolean> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecBoolean;
};
template<> struct IDLResultTypeFilter<IDLByte> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecInt32Only;
};
template<> struct IDLResultTypeFilter<IDLOctet> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecInt32Only;
};
template<> struct IDLResultTypeFilter<IDLShort> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecInt32Only;
};
template<> struct IDLResultTypeFilter<IDLUnsignedShort> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecInt32Only;
};
template<> struct IDLResultTypeFilter<IDLLong> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecInt32Only;
};
template<> struct IDLResultTypeFilter<IDLUnsignedLong> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecBytecodeNumber;
};
template<> struct IDLResultTypeFilter<IDLLongLong> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecBytecodeNumber;
};
template<> struct IDLResultTypeFilter<IDLUnsignedLongLong> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecBytecodeNumber;
};
template<> struct IDLResultTypeFilter<IDLFloat> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecBytecodeNumber;
};
template<> struct IDLResultTypeFilter<IDLUnrestrictedFloat> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecBytecodeNumber;
};
template<> struct IDLResultTypeFilter<IDLDouble> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecBytecodeNumber;
};
template<> struct IDLResultTypeFilter<IDLUnrestrictedDouble> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecBytecodeNumber;
};
template<> struct IDLResultTypeFilter<IDLDOMString> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecString;
};
template<> struct IDLResultTypeFilter<IDLByteString> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecString;
};
template<> struct IDLResultTypeFilter<IDLUSVString> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecString;
};
template<> struct IDLResultTypeFilter<IDLAtomStringAdaptor<IDLDOMString>> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecString;
};
template<> struct IDLResultTypeFilter<IDLRequiresExistingAtomStringAdaptor<IDLDOMString>> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecString;
};
template<> struct IDLResultTypeFilter<IDLUint8Array> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecUint8Array;
};
template<> struct IDLResultTypeFilter<IDLObject> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecBytecodeTop;
};

template<typename T>
struct IDLResultTypeFilter<IDLNullable<T>> {
    static const constexpr JSC::SpeculatedType value = JSC::SpecOther | IDLResultTypeFilter<T>::value;
};

}
}
