/*
 * Copyright (C) 2006-2021 Apple Inc. All rights reserved.
 * Copyright (C) Research In Motion Limited 2009-2010. All rights reserved.
 * Copyright (C) 2015 Canon Inc. All rights reserved.
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
#include "SharedBuffer.h"

#include <JavaScriptCore/ArrayBuffer.h>
#include <algorithm>
#include <wtf/HexNumber.h>
#include <wtf/persistence/PersistentCoders.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/unicode/UTF8Conversion.h>
#include "headers-handwritten.h"

namespace WebCore {

Ref<FragmentedSharedBuffer> FragmentedSharedBuffer::create()
{
    return adoptRef(*new FragmentedSharedBuffer);
}

Ref<FragmentedSharedBuffer> FragmentedSharedBuffer::create(const uint8_t* data, size_t size)
{
    return adoptRef(*new FragmentedSharedBuffer(data, size));
}

Ref<FragmentedSharedBuffer> FragmentedSharedBuffer::create(FileSystem::MappedFileData&& mappedFileData)
{
    return adoptRef(*new FragmentedSharedBuffer(WTFMove(mappedFileData)));
}

Ref<FragmentedSharedBuffer> FragmentedSharedBuffer::create(Ref<SharedBuffer>&& buffer)
{
    return adoptRef(*new FragmentedSharedBuffer(WTFMove(buffer)));
}

Ref<FragmentedSharedBuffer> FragmentedSharedBuffer::create(Vector<uint8_t>&& vector)
{
    return adoptRef(*new FragmentedSharedBuffer(WTFMove(vector)));
}

Ref<FragmentedSharedBuffer> FragmentedSharedBuffer::create(DataSegment::Provider&& provider)
{
    return adoptRef(*new FragmentedSharedBuffer(WTFMove(provider)));
}

FragmentedSharedBuffer::FragmentedSharedBuffer() = default;

FragmentedSharedBuffer::FragmentedSharedBuffer(FileSystem::MappedFileData&& fileData)
    : m_size(fileData.size())
{
    m_segments.append({ 0, DataSegment::create(WTFMove(fileData)) });
}

FragmentedSharedBuffer::FragmentedSharedBuffer(DataSegment::Provider&& provider)
    : m_size(provider.size())
{
    m_segments.append({ 0, DataSegment::create(WTFMove(provider)) });
}

FragmentedSharedBuffer::FragmentedSharedBuffer(Ref<SharedBuffer>&& buffer)
{
    append(WTFMove(buffer));
}

#if USE(GSTREAMER)
Ref<FragmentedSharedBuffer> FragmentedSharedBuffer::create(GstMappedOwnedBuffer& mappedBuffer)
{
    return adoptRef(*new FragmentedSharedBuffer(mappedBuffer));
}

FragmentedSharedBuffer::FragmentedSharedBuffer(GstMappedOwnedBuffer& mappedBuffer)
    : m_size(mappedBuffer.size())
{
    m_segments.append({ 0, DataSegment::create(&mappedBuffer) });
}
#endif

static Vector<uint8_t> combineSegmentsData(const FragmentedSharedBuffer::DataSegmentVector& segments, size_t size)
{
    Vector<uint8_t> combinedData;
    combinedData.reserveInitialCapacity(size);
    for (auto& segment : segments)
        combinedData.append(std::span { segment.segment->data(), segment.segment->size() });
    ASSERT(combinedData.size() == size);
    return combinedData;
}

Ref<SharedBuffer> FragmentedSharedBuffer::makeContiguous() const
{
    if (m_contiguous)
        return Ref { *static_cast<SharedBuffer*>(const_cast<FragmentedSharedBuffer*>(this)) };
    if (!m_segments.size())
        return SharedBuffer::create();
    if (m_segments.size() == 1)
        return SharedBuffer::create(m_segments[0].segment.copyRef());
    auto combinedData = combineSegmentsData(m_segments, m_size);
    return SharedBuffer::create(WTFMove(combinedData));
}

Vector<uint8_t> FragmentedSharedBuffer::copyData() const
{
    Vector<uint8_t> data;
    data.reserveInitialCapacity(size());
    forEachSegment([&data](auto& span) {
        data.unsafeAppendWithoutCapacityCheck(span.data(), span.size());
    });
    return data;
}

Vector<uint8_t> FragmentedSharedBuffer::takeData()
{
    if (m_segments.isEmpty())
        return {};

    Vector<uint8_t> combinedData;
    if (hasOneSegment() && std::holds_alternative<Vector<uint8_t>>(m_segments[0].segment->m_immutableData) && m_segments[0].segment->hasOneRef())
        combinedData = std::exchange(std::get<Vector<uint8_t>>(const_cast<DataSegment&>(m_segments[0].segment.get()).m_immutableData), Vector<uint8_t>());
    else
        combinedData = combineSegmentsData(m_segments, m_size);

    clear();
    return combinedData;
}

SharedBufferDataView FragmentedSharedBuffer::getSomeData(size_t position) const
{
    const DataSegmentVectorEntry* element = getSegmentForPosition(position);
    return { element->segment.copyRef(), position - element->beginPosition };
}

Ref<SharedBuffer> FragmentedSharedBuffer::getContiguousData(size_t position, size_t length) const
{
    if (position >= m_size)
        return SharedBuffer::create();
    length = std::min(m_size - position, length);
    const DataSegmentVectorEntry* element = getSegmentForPosition(position);
    size_t offsetInSegment = position - element->beginPosition;
    ASSERT(element->segment->size() > offsetInSegment);
    if (element->segment->size() - offsetInSegment >= length)
        return SharedBufferDataView { element->segment.copyRef(), offsetInSegment, length }.createSharedBuffer();
    Vector<uint8_t> combinedData;
    combinedData.reserveInitialCapacity(length);
    combinedData.append(std::span { element->segment->data() + offsetInSegment, element->segment->size() - offsetInSegment });
    for (++element; combinedData.size() < length && element != m_segments.end(); element++) {
        auto canCopy = std::min(length - combinedData.size(), element->segment->size());
        combinedData.append(std::span { element->segment->data(), canCopy });
    }
    return SharedBuffer::create(WTFMove(combinedData));
}

const FragmentedSharedBuffer::DataSegmentVectorEntry* FragmentedSharedBuffer::getSegmentForPosition(size_t position) const
{
    RELEASE_ASSERT(position < m_size);
    auto comparator = [](const size_t& position, const DataSegmentVectorEntry& entry) {
        return position < entry.beginPosition;
    };
    const DataSegmentVectorEntry* element = std::upper_bound(m_segments.begin(), m_segments.end(), position, comparator);
    element--; // std::upper_bound gives a pointer to the element that is greater than position. We want the element just before that.
    return element;
}

String FragmentedSharedBuffer::toHexString() const
{
    StringBuilder stringBuilder;
    forEachSegment([&](auto& segment) {
        for (unsigned i = 0; i < segment.size(); ++i)
            stringBuilder.append(pad('0', 2, hex(segment[i])));
    });
    return stringBuilder.toString();
}

RefPtr<ArrayBuffer> FragmentedSharedBuffer::tryCreateArrayBuffer() const
{
    auto arrayBuffer = ArrayBuffer::tryCreateUninitialized(static_cast<unsigned>(size()), 1);
    if (!arrayBuffer) {
        WTFLogAlways("SharedBuffer::tryCreateArrayBuffer Unable to create buffer. Requested size was %zu\n", size());
        return nullptr;
    }

    size_t position = 0;
    for (const auto& segment : m_segments) {
        memcpy(static_cast<uint8_t*>(arrayBuffer->data()) + position, segment.segment->data(), segment.segment->size());
        position += segment.segment->size();
    }

    ASSERT(position == m_size);
    ASSERT(internallyConsistent());
    return arrayBuffer;
}

void FragmentedSharedBuffer::append(const FragmentedSharedBuffer& data)
{
    ASSERT(!m_contiguous);
    m_segments.reserveCapacity(m_segments.size() + data.m_segments.size());
    for (const auto& element : data.m_segments) {
        m_segments.unsafeAppendWithoutCapacityCheck(DataSegmentVectorEntry { m_size, element.segment.copyRef() });
        m_size += element.segment->size();
    }
    ASSERT(internallyConsistent());
}

void FragmentedSharedBuffer::append(const uint8_t* data, size_t length)
{
    ASSERT(!m_contiguous);
    m_segments.append({ m_size, DataSegment::create(Vector(std::span { data, length })) });
    m_size += length;
    ASSERT(internallyConsistent());
}

void FragmentedSharedBuffer::append(Vector<uint8_t>&& data)
{
    ASSERT(!m_contiguous);
    auto dataSize = data.size();
    m_segments.append({ m_size, DataSegment::create(WTFMove(data)) });
    m_size += dataSize;
    ASSERT(internallyConsistent());
}

void FragmentedSharedBuffer::clear()
{
    m_size = 0;
    m_segments.clear();
    ASSERT(internallyConsistent());
}

Ref<FragmentedSharedBuffer> FragmentedSharedBuffer::copy() const
{
    if (m_contiguous)
        return m_segments.size() ? SharedBuffer::create(m_segments[0].segment.copyRef()) : SharedBuffer::create();
    Ref<FragmentedSharedBuffer> clone = adoptRef(*new FragmentedSharedBuffer);
    clone->m_size = m_size;
    clone->m_segments.reserveInitialCapacity(m_segments.size());
    for (const auto& element : m_segments)
        clone->m_segments.unsafeAppendWithoutCapacityCheck(DataSegmentVectorEntry { element.beginPosition, element.segment.copyRef() });
    ASSERT(clone->internallyConsistent());
    ASSERT(internallyConsistent());
    return clone;
}

void FragmentedSharedBuffer::forEachSegment(const Function<void(const std::span<const uint8_t>&)>& apply) const
{
    auto segments = m_segments;
    for (auto& segment : segments)
        segment.segment->iterate(apply);
}

void DataSegment::iterate(const Function<void(const std::span<const uint8_t>&)>& apply) const
{
#if USE(FOUNDATION)
    if (auto* data = std::get_if<RetainPtr<CFDataRef>>(&m_immutableData))
        return iterate(data->get(), apply);
#endif
    apply({ data(), size() });
}

void FragmentedSharedBuffer::forEachSegmentAsSharedBuffer(const Function<void(Ref<SharedBuffer>&&)>& apply) const
{
    auto protectedThis = Ref { *this };
    for (auto& segment : m_segments)
        apply(SharedBuffer::create(segment.segment.copyRef()));
}

bool FragmentedSharedBuffer::startsWith(const std::span<const uint8_t>& prefix) const
{
    if (prefix.empty())
        return true;

    if (size() < prefix.size())
        return false;

    const uint8_t* prefixPtr = prefix.data();
    size_t remaining = prefix.size();
    for (auto& segment : m_segments) {
        size_t amountToCompareThisTime = std::min(remaining, segment.segment->size());
        if (memcmp(prefixPtr, segment.segment->data(), amountToCompareThisTime))
            return false;
        remaining -= amountToCompareThisTime;
        if (!remaining)
            return true;
        prefixPtr += amountToCompareThisTime;
    }
    return false;
}

Vector<uint8_t> FragmentedSharedBuffer::read(size_t offset, size_t length) const
{
    Vector<uint8_t> data;
    if (offset >= size())
        return data;
    auto remaining = std::min(length, size() - offset);
    if (!remaining)
        return data;

    data.reserveInitialCapacity(remaining);
    auto* currentSegment = getSegmentForPosition(offset);
    size_t offsetInSegment = offset - currentSegment->beginPosition;
    size_t availableInSegment = std::min(currentSegment->segment->size() - offsetInSegment, remaining);
    data.append(std::span { currentSegment->segment->data() + offsetInSegment, availableInSegment });

    remaining -= availableInSegment;

    auto* afterLastSegment = end();

    while (remaining && ++currentSegment != afterLastSegment) {
        size_t lengthInSegment = std::min(currentSegment->segment->size(), remaining);
        data.append(std::span { currentSegment->segment->data(), lengthInSegment });
        remaining -= lengthInSegment;
    }
    return data;
}

void FragmentedSharedBuffer::copyTo(void* destination, size_t length) const
{
    return copyTo(destination, 0, length);
}

void FragmentedSharedBuffer::copyTo(void* destination, size_t offset, size_t length) const
{
    ASSERT(length + offset <= size());
    if (offset >= size())
        return;
    auto remaining = std::min(length, size() - offset);
    if (!remaining)
        return;

    auto segment = begin();
    if (offset >= segment->segment->size()) {
        auto comparator = [](const size_t& position, const DataSegmentVectorEntry& entry) {
            return position < entry.beginPosition;
        };
        segment = std::upper_bound(segment, end(), offset, comparator);
        segment--; // std::upper_bound gives a pointer to the segment that is greater than offset. We want the segment just before that.
    }
    auto destinationPtr = static_cast<uint8_t*>(destination);

    size_t positionInSegment = offset - segment->beginPosition;
    size_t amountToCopyThisTime = std::min(remaining, segment->segment->size() - positionInSegment);
    memcpy(destinationPtr, segment->segment->data() + positionInSegment, amountToCopyThisTime);
    remaining -= amountToCopyThisTime;
    if (!remaining)
        return;
    destinationPtr += amountToCopyThisTime;

    // If we reach here, there must be at least another segment available as we have content left to be fetched.
    for (++segment; segment != end(); ++segment) {
        size_t amountToCopyThisTime = std::min(remaining, segment->segment->size());
        memcpy(destinationPtr, segment->segment->data(), amountToCopyThisTime);
        remaining -= amountToCopyThisTime;
        if (!remaining)
            return;
        destinationPtr += amountToCopyThisTime;
    }
}

#if ASSERT_ENABLED
bool FragmentedSharedBuffer::internallyConsistent() const
{
    size_t position = 0;
    for (const auto& element : m_segments) {
        if (element.beginPosition != position)
            return false;
        position += element.segment->size();
    }
    return position == m_size;
}
#endif // ASSERT_ENABLED

#if !USE(CF)
void FragmentedSharedBuffer::hintMemoryNotNeededSoon() const
{
}
#endif

bool FragmentedSharedBuffer::operator==(const FragmentedSharedBuffer& other) const
{
    if (this == &other)
        return true;

    if (m_size != other.m_size)
        return false;

    auto thisIterator = begin();
    size_t thisOffset = 0;
    auto otherIterator = other.begin();
    size_t otherOffset = 0;

    while (thisIterator != end() && otherIterator != other.end()) {
        auto& thisSegment = thisIterator->segment.get();
        auto& otherSegment = otherIterator->segment.get();

        if (&thisSegment == &otherSegment && !thisOffset && !otherOffset) {
            ++thisIterator;
            ++otherIterator;
            continue;
        }

        ASSERT(thisOffset <= thisSegment.size());
        ASSERT(otherOffset <= otherSegment.size());

        size_t thisRemaining = thisSegment.size() - thisOffset;
        size_t otherRemaining = otherSegment.size() - otherOffset;
        size_t remaining = std::min(thisRemaining, otherRemaining);

        if (memcmp(thisSegment.data() + thisOffset, otherSegment.data() + otherOffset, remaining))
            return false;

        thisOffset += remaining;
        otherOffset += remaining;

        if (thisOffset == thisSegment.size()) {
            ++thisIterator;
            thisOffset = 0;
        }

        if (otherOffset == otherSegment.size()) {
            ++otherIterator;
            otherOffset = 0;
        }
    }
    return true;
}

SharedBuffer::SharedBuffer()
{
    m_contiguous = true;
}

SharedBuffer::SharedBuffer(Ref<const DataSegment>&& segment)
{
    m_size = segment->size();
    m_segments.append({ 0, WTFMove(segment) });
    m_contiguous = true;
}

SharedBuffer::SharedBuffer(Ref<FragmentedSharedBuffer>&& contiguousBuffer)
{
    ASSERT(contiguousBuffer->hasOneSegment() || contiguousBuffer->isEmpty());
    m_size = contiguousBuffer->size();
    if (contiguousBuffer->hasOneSegment())
        m_segments.append({ 0, contiguousBuffer->m_segments[0].segment.copyRef() });
    m_contiguous = true;
}

SharedBuffer::SharedBuffer(FileSystem::MappedFileData&& data)
    : FragmentedSharedBuffer(WTFMove(data))
{
    m_contiguous = true;
}

RefPtr<SharedBuffer> SharedBuffer::createWithContentsOfFile(const String& filePath, FileSystem::MappedFileMode mappedFileMode, MayUseFileMapping mayUseFileMapping)
{
    if (mayUseFileMapping == MayUseFileMapping::Yes) {
        bool mappingSuccess;
        FileSystem::MappedFileData mappedFileData(filePath, mappedFileMode, mappingSuccess);
        if (mappingSuccess)
            return adoptRef(new SharedBuffer(WTFMove(mappedFileData)));
    }

    auto buffer = FileSystem::readEntireFile(filePath);
    if (!buffer)
        return nullptr;

    return SharedBuffer::create(WTFMove(*buffer));
}

const uint8_t* SharedBuffer::data() const
{
    if (m_segments.isEmpty())
        return nullptr;
    return m_segments[0].segment->data();
}

WTF::Persistence::Decoder SharedBuffer::decoder() const
{
    return { { data(), size() } };
}

Ref<DataSegment> DataSegment::create(Vector<uint8_t>&& data)
{
    data.shrinkToFit();
    return adoptRef(*new DataSegment(WTFMove(data)));
}

#if USE(CF)
Ref<DataSegment> DataSegment::create(RetainPtr<CFDataRef>&& data)
{
    return adoptRef(*new DataSegment(WTFMove(data)));
}
#endif

#if USE(GLIB)
Ref<DataSegment> DataSegment::create(GRefPtr<GBytes>&& data)
{
    return adoptRef(*new DataSegment(WTFMove(data)));
}
#endif

#if USE(GSTREAMER)
Ref<DataSegment> DataSegment::create(RefPtr<GstMappedOwnedBuffer>&& data)
{
    return adoptRef(*new DataSegment(WTFMove(data)));
}
#endif

Ref<DataSegment> DataSegment::create(FileSystem::MappedFileData&& data)
{
    return adoptRef(*new DataSegment(WTFMove(data)));
}

Ref<DataSegment> DataSegment::create(Provider&& provider)
{
    return adoptRef(*new DataSegment(WTFMove(provider)));
}

const uint8_t* DataSegment::data() const
{
    auto visitor = WTF::makeVisitor(
        [](const Vector<uint8_t>& data) -> const uint8_t* { return data.data(); },
#if USE(CF)
        [](const RetainPtr<CFDataRef>& data) -> const uint8_t* { return CFDataGetBytePtr(data.get()); },
#endif
#if USE(GLIB)
        [](const GRefPtr<GBytes>& data) -> const uint8_t* { return static_cast<const uint8_t*>(g_bytes_get_data(data.get(), nullptr)); },
#endif
#if USE(GSTREAMER)
        [](const RefPtr<GstMappedOwnedBuffer>& data) -> const uint8_t* { return data->data(); },
#endif
        [](const FileSystem::MappedFileData& data) -> const uint8_t* { return static_cast<const uint8_t*>(data.span().data()); },
        [](const Provider& provider) -> const uint8_t* { return provider.data(); });
    return std::visit(visitor, m_immutableData);
}

bool DataSegment::containsMappedFileData() const
{
    return std::holds_alternative<FileSystem::MappedFileData>(m_immutableData);
}

size_t DataSegment::size() const
{
    auto visitor = WTF::makeVisitor(
        [](const Vector<uint8_t>& data) -> size_t { return data.size(); },
#if USE(CF)
        [](const RetainPtr<CFDataRef>& data) -> size_t { return CFDataGetLength(data.get()); },
#endif
#if USE(GLIB)
        [](const GRefPtr<GBytes>& data) -> size_t { return g_bytes_get_size(data.get()); },
#endif
#if USE(GSTREAMER)
        [](const RefPtr<GstMappedOwnedBuffer>& data) -> size_t { return data->size(); },
#endif
        [](const FileSystem::MappedFileData& data) -> size_t { return data.span().size(); },
        [](const Provider& provider) -> size_t { return provider.size(); });
    return std::visit(visitor, m_immutableData);
}

SharedBufferBuilder::SharedBufferBuilder(RefPtr<FragmentedSharedBuffer>&& buffer)
{
    if (!buffer)
        return;
    initialize(buffer.releaseNonNull());
}

SharedBufferBuilder& SharedBufferBuilder::operator=(RefPtr<FragmentedSharedBuffer>&& buffer)
{
    if (!buffer) {
        m_buffer = nullptr;
        return *this;
    }
    m_buffer = nullptr;
    initialize(buffer.releaseNonNull());
    return *this;
}

void SharedBufferBuilder::initialize(Ref<FragmentedSharedBuffer>&& buffer)
{
    ASSERT(!m_buffer);
    // We do not want to take a reference to the SharedBuffer as all SharedBuffer should be immutable
    // once created.
    if (buffer->hasOneRef() && !buffer->isContiguous()) {
        m_buffer = WTFMove(buffer);
        return;
    }
    append(buffer);
}

RefPtr<ArrayBuffer> SharedBufferBuilder::tryCreateArrayBuffer() const
{
    return m_buffer ? m_buffer->tryCreateArrayBuffer() : ArrayBuffer::tryCreate({});
}

Ref<FragmentedSharedBuffer> SharedBufferBuilder::take()
{
    return m_buffer ? m_buffer.releaseNonNull() : FragmentedSharedBuffer::create();
}

Ref<SharedBuffer> SharedBufferBuilder::takeAsContiguous()
{
    return take()->makeContiguous();
}

RefPtr<ArrayBuffer> SharedBufferBuilder::takeAsArrayBuffer()
{
    if (!m_buffer)
        return ArrayBuffer::tryCreate({});
    return take()->tryCreateArrayBuffer();
}

void SharedBufferBuilder::ensureBuffer()
{
    if (!m_buffer)
        m_buffer = FragmentedSharedBuffer::create();
}

SharedBufferDataView::SharedBufferDataView(Ref<const DataSegment>&& segment, size_t positionWithinSegment, std::optional<size_t> size)
    : m_segment(WTFMove(segment))
    , m_positionWithinSegment(positionWithinSegment)
    , m_size(size ? *size : m_segment->size() - positionWithinSegment)
{
    RELEASE_ASSERT(m_positionWithinSegment < m_segment->size());
    RELEASE_ASSERT(m_size <= m_segment->size() - m_positionWithinSegment);
}

SharedBufferDataView::SharedBufferDataView(const SharedBufferDataView& other, size_t newSize)
    : SharedBufferDataView(other.m_segment.copyRef(), other.m_positionWithinSegment, newSize)
{
}

Ref<SharedBuffer> SharedBufferDataView::createSharedBuffer() const
{
    const Ref<const DataSegment> segment = m_segment;
    return SharedBuffer::create(DataSegment::Provider {
        [segment, data = data()]() { return data; },
        [size = size()]() { return size; } });
}

RefPtr<SharedBuffer> utf8Buffer(const String& string)
{
    // Allocate a buffer big enough to hold all the characters.
    const size_t length = string.length();
    if constexpr (String::MaxLength > std::numeric_limits<size_t>::max() / 3) {
        if (length > std::numeric_limits<size_t>::max() / 3)
            return nullptr;
    }

    Vector<uint8_t> buffer(length * 3);
    WTF::Unicode::ConversionResult<char8_t> result;
    if (length) {
        if (string.is8Bit())
            result = WTF::Unicode::convert(string.span8(), spanReinterpretCast<char8_t>(buffer.mutableSpan()));
        else
            result = WTF::Unicode::convert(string.span16(), spanReinterpretCast<char8_t>(buffer.mutableSpan()));
    }

    buffer.shrink(result.buffer.size());
    return SharedBuffer::create(WTFMove(buffer));
}

} // namespace WebCore
