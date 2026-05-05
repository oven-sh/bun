/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

#include <wtf/Vector.h>

#if ENABLE(WEB_CRYPTO)

// FIXME: <rdar://problem/31618371>
// The following constants and functions are for customized DER implementations.
// They are not intended to be used outside Crypto codes, and should be removed
// once the above bug is fixed.
namespace WebCore {

// Per X.690 08/2015: https://www.itu.int/rec/T-REC-X.680-X.693/en
static const unsigned char BitStringMark = 0x03;
static const unsigned char IntegerMark = 0x02;
static const unsigned char OctetStringMark = 0x04;
static const unsigned char SequenceMark = 0x30;
// Version 0. Per https://tools.ietf.org/html/rfc5208#section-5
static const unsigned char Version[] = { 0x02, 0x01, 0x00 };

static const unsigned char InitialOctet = 0x00;
static const size_t MaxLengthInOneByte = 128;

size_t bytesUsedToEncodedLength(uint8_t);
size_t extraBytesNeededForEncodedLength(size_t);
void addEncodedASN1Length(Vector<uint8_t>&, size_t);
size_t bytesNeededForEncodedLength(size_t);

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
