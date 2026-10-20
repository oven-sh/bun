/*
 * Copyright (C) 2016-2019 Apple Inc. All rights reserved.
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

#include "ExceptionOr.h"
#include "QualifiedName.h"
#include "ScriptWrappable.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class SVGElement;

// The tokens of a content attribute of an element: `requiredExtensions` or `systemLanguage`.
class SVGStringList final : public ScriptWrappable, public RefCounted<SVGStringList> {
    WTF_MAKE_TZONE_ALLOCATED(SVGStringList);
public:
    static Ref<SVGStringList> create(SVGElement&, StaticQualifiedName attributeName, char delimiter);
    ~SVGStringList();

    unsigned length() const { return numberOfItems(); }
    unsigned numberOfItems() const { return items().size(); }

    void clear();
    ExceptionOr<String> getItem(unsigned index);
    String initialize(String&& newItem);
    String insertItemBefore(String&& newItem, unsigned index);
    ExceptionOr<String> replaceItem(String&& newItem, unsigned index);
    ExceptionOr<String> removeItem(unsigned index);
    String appendItem(String&& newItem);
    ExceptionOr<void> setItem(unsigned index, String&& newItem);

    bool isSupportedPropertyIndex(unsigned index) const { return index < numberOfItems(); }

private:
    SVGStringList(SVGElement&, StaticQualifiedName attributeName, char delimiter);

    Vector<String> items() const;
    void setItems(const Vector<String>&);

    const Ref<SVGElement> m_contextElement;
    const StaticQualifiedName m_attributeName;
    const char m_delimiter;
};

} // namespace WebCore
