/*
 * Copyright (C) 2010 Google, Inc. All rights reserved.
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
#include "DocumentParser.h"

#include "Document.h"
#include "EventTarget.h"
#include <wtf/Assertions.h>

namespace WebCore {

DocumentParser::DocumentParser(Document& document)
    : m_state(ParserState::Parsing)
    , m_document(document)
{
}

DocumentParser::~DocumentParser()
{
    // Document is expected to call detach() before releasing its ref.
    // This ASSERT is slightly awkward for parsers with a fragment case
    // as there is no Document to release the ref.
    ASSERT(!m_document);
}

void DocumentParser::prepareToStopParsing()
{
    ASSERT(m_state == ParserState::Parsing);
    m_state = ParserState::Stopping;
}

void DocumentParser::stopParsing()
{
    m_state = ParserState::Stopped;
}

void DocumentParser::detach()
{
    m_state = ParserState::Detached;
    m_document = nullptr;
}

} // namespace WebCore
