/*
 * Copyright (C) 2016-2021 Apple Inc. All rights reserved.
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

#include "AbstractRange.h"
#include "SimpleRange.h"

namespace JSC {

class AbstractSlotVisitor;

}

namespace WebCore {

template<typename> class ExceptionOr;

class StaticRange final : public AbstractRange, public SimpleRange {
    WTF_MAKE_TZONE_ALLOCATED(StaticRange);
public:
    struct Init {
        Ref<Node> startContainer;
        unsigned startOffset { 0 };
        Ref<Node> endContainer;
        unsigned endOffset { 0 };
    };

    static ExceptionOr<Ref<StaticRange>> create(Init&&);
    WEBCORE_EXPORT static Ref<StaticRange> create(const SimpleRange&);
    WEBCORE_EXPORT static Ref<StaticRange> create(SimpleRange&&);

    Node& startContainer() const final { return SimpleRange::startContainer(); }
    unsigned startOffset() const final { return SimpleRange::startOffset(); }
    Node& endContainer() const final { return SimpleRange::endContainer(); }
    unsigned endOffset() const final { return SimpleRange::endOffset(); }
    bool collapsed() const final { return SimpleRange::collapsed(); }

    // https://dom.spec.whatwg.org/#staticrange-valid
    WEBCORE_EXPORT bool computeValidity() const;

    void visitNodesInGCThread(JSC::AbstractSlotVisitor&) const;

private:
    explicit StaticRange(SimpleRange&&);

    bool isLiveRange() const final { return false; }
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::StaticRange)
    static bool isType(const WebCore::AbstractRange& range) { return !range.isLiveRange(); }
SPECIALIZE_TYPE_TRAITS_END()
