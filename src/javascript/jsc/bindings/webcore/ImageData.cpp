/*
 * Copyright (C) 2008-2021 Apple Inc. All rights reserved.
 * Copyright (C) 2014 Adobe Systems Incorporated. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "ImageData.h"

#include "JavaScriptCore/JSGenericTypedArrayViewInlines.h"
#include "JavaScriptCore/GenericTypedArrayViewInlines.h"

#include "wtf/text/TextStream.h"

namespace WebCore {
using namespace JSC;

static CheckedUint32 computeDataSize(int width, int height)
{
    CheckedUint32 checkedDataSize = 4;
    checkedDataSize *= static_cast<unsigned>(width);
    checkedDataSize *= static_cast<unsigned>(height);
    return checkedDataSize;
}

// PredefinedColorSpace ImageData::computeColorSpace(std::optional<ImageDataSettings> settings, PredefinedColorSpace defaultColorSpace)
// {
//     if (settings && settings->colorSpace)
//         return *settings->colorSpace;
//     return defaultColorSpace;
// }

// Ref<ImageData> ImageData::create(PixelBuffer&& pixelBuffer)
// {
//     auto colorSpace = toPredefinedColorSpace(pixelBuffer.format().colorSpace);
//     return adoptRef(*new ImageData(pixelBuffer.size(), pixelBuffer.takeData(), *colorSpace));
// }

// RefPtr<ImageData> ImageData::create(std::optional<PixelBuffer>&& pixelBuffer)
// {
//     if (!pixelBuffer)
//         return nullptr;
//     return create(WTFMove(*pixelBuffer));
// }

ExceptionOr<Ref<ImageData>> ImageData::create(unsigned int sw, unsigned int sh)
{
    if (!sw || !sh)
        return Exception { IndexSizeError };

    auto dataSize = computeDataSize(static_cast<unsigned>(sw), static_cast<unsigned>(sh));
    if (dataSize.hasOverflowed())
        return Exception { RangeError, "Cannot allocate a buffer of this size"_s };

    auto byteArray = Uint8ClampedArray::tryCreateUninitialized(dataSize);
    if (!byteArray) {
        // FIXME: Does this need to be a "real" out of memory error with setOutOfMemoryError called on it?
        return Exception { RangeError, "Out of memory"_s };
    }
    byteArray->zeroFill();

    // auto colorSpace = computeColorSpace(settings);
    return adoptRef(*new ImageData(sw, sh, byteArray.releaseNonNull()));
}

ExceptionOr<Ref<ImageData>> ImageData::create(Ref<Uint8ClampedArray>&& byteArray, unsigned sw, std::optional<unsigned> sh)
{
    unsigned length = byteArray->length();
    if (!length || length % 4)
        return Exception { InvalidStateError, "Length is not a non-zero multiple of 4"_s };

    length /= 4;
    if (!sw || length % sw)
        return Exception { IndexSizeError, "Length is not a multiple of sw"_s };

    unsigned height = length / sw;
    if (sh && sh.value() != height)
        return Exception { IndexSizeError, "sh value is not equal to height"_s };

    int width = sw;

    auto dataSize = computeDataSize(width, height);
    if (dataSize.hasOverflowed() || dataSize != byteArray->length())
        return Exception { RangeError };

    // auto colorSpace = computeColorSpace(settings);
    return adoptRef(*new ImageData(width, height, WTFMove(byteArray)));
}

ImageData::ImageData(int width, int height, Ref<JSC::Uint8ClampedArray>&& data)
    : m_data(WTFMove(data))
// , m_colorSpace(colorSpace)
{
    m_width = width;
    m_height = height;
}

ImageData::~ImageData() = default;

TextStream& operator<<(TextStream& ts, const ImageData& imageData)
{
    // Print out the address of the pixel data array
    return ts << &imageData.data();
}

}
