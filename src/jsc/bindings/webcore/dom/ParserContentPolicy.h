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

#pragma once

#include <wtf/OptionSet.h>

namespace WebCore {

enum class ParserContentPolicy : uint8_t {
    AllowScriptingContent = 1 << 0,
    DoNotMarkAlreadyStarted = 1 << 1,
    AllowDeclarativeShadowRoots = 1 << 2,
    AlwaysParseAsHTML = 1 << 3
};

constexpr OptionSet<ParserContentPolicy> DefaultParserContentPolicy = { ParserContentPolicy::AllowScriptingContent, ParserContentPolicy::AllowDeclarativeShadowRoots };

static inline bool scriptingContentIsAllowed(OptionSet<ParserContentPolicy> parserContentPolicy) 
{
    return parserContentPolicy.contains(ParserContentPolicy::AllowScriptingContent);
}

static inline OptionSet<ParserContentPolicy> disallowScriptingContent(OptionSet<ParserContentPolicy> parserContentPolicy)
{
    parserContentPolicy.remove(ParserContentPolicy::AllowScriptingContent);
    return parserContentPolicy;
}

} // namespace WebCore
