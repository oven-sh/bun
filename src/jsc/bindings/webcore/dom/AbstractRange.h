/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
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

#include "PlatformExportMacros.h"
#include "ScriptWrappable.h"
#include <optional>
#include <wtf/Forward.h>
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class Node;

struct SimpleRange;

class AbstractRange : public ScriptWrappable, public RefCounted<AbstractRange> {
    WTF_MAKE_TZONE_ALLOCATED(AbstractRange);
public:
    virtual ~AbstractRange() = default;

    virtual Node& startContainer() const = 0;
    virtual unsigned startOffset() const = 0;
    virtual Node& endContainer() const = 0;
    virtual unsigned endOffset() const = 0;
    virtual bool collapsed() const = 0;

    virtual bool isLiveRange() const = 0;
};

WEBCORE_EXPORT SimpleRange makeSimpleRange(const AbstractRange&);
WEBCORE_EXPORT SimpleRange makeSimpleRange(const Ref<AbstractRange>&);
std::optional<SimpleRange> makeSimpleRange(const AbstractRange*);
std::optional<SimpleRange> makeSimpleRange(const RefPtr<AbstractRange>&);

}
