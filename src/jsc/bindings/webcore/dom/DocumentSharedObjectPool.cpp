/*
 * Copyright (C) 2012, 2013 Apple Inc. All rights reserved.
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
 *
 */

#include "config.h"
#include "DocumentSharedObjectPool.h"

#include "Element.h"
#include "ElementData.h"
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(DocumentSharedObjectPool);

struct DocumentSharedObjectPool::ShareableElementDataHash {
    static unsigned LEGACY_NODELETE hash(const Ref<ShareableElementData>& data)
    {
        return computeHash(data->attributes());
    }
    static bool equal(const Ref<ShareableElementData>& a, const Ref<ShareableElementData>& b)
    {
        // We need to disable type checking because std::has_unique_object_representations_v<Attribute>
        // return false. Attribute contains pointers but memcmp() is safe because those pointers were
        // atomized.
        return equalSpans<WTF::IgnoreTypeChecks::Yes>(a->attributes(), b->attributes());
    }
    static constexpr bool safeToCompareToEmptyOrDeleted = false;
};

struct AttributeSpanTranslator {
    static unsigned LEGACY_NODELETE hash(std::span<const Attribute> attributes)
    {
        return computeHash(attributes);
    }

    static bool equal(const Ref<ShareableElementData>& a, std::span<const Attribute> b)
    {
        // We need to disable type checking because std::has_unique_object_representations_v<Attribute>
        // return false. Attribute contains pointers but memcmp() is safe because those pointers were
        // atomized.
        return equalSpans<WTF::IgnoreTypeChecks::Yes>(a->attributes(), b);
    }

    static void translate(Ref<ShareableElementData>& location, std::span<const Attribute> attributes, unsigned /*hash*/)
    {
        location = ShareableElementData::createWithAttributes(attributes);
    }
};

DocumentSharedObjectPool::DocumentSharedObjectPool() = default;
DocumentSharedObjectPool::~DocumentSharedObjectPool() = default;

Ref<ShareableElementData> DocumentSharedObjectPool::cachedShareableElementDataWithAttributes(std::span<const Attribute> attributes)
{
    ASSERT(!attributes.empty());

    return m_shareableElementDataCache.add<AttributeSpanTranslator>(attributes).iterator->get();
}

} // namespace WebCore
