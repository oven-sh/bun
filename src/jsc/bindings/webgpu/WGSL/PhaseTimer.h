/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

#include "ASTStringDumper.h"
#include <wtf/DataLog.h>
#include <wtf/MonotonicTime.h>
#include <wtf/Seconds.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace WGSL {

class ShaderModule;

static constexpr bool dumpASTBeforeEachPass = false;
static constexpr bool dumpASTAfterParsing = false;
static constexpr bool dumpASTAtEnd = false;
static constexpr bool alwaysDumpPassFailures = false;
static constexpr bool dumpPassFailure = dumpASTBeforeEachPass || dumpASTAfterParsing || dumpASTAtEnd || alwaysDumpPassFailures;
static constexpr bool dumpPhaseTimes = false;

static inline bool dumpASTIfNeeded(bool shouldDump, ShaderModule& program, const char* message)
{
    if (shouldDump) [[unlikely]] {
        dataLogLn(message);
        AST::dumpAST(program);
        return true;
    }

    return false;
}

static inline bool dumpASTAfterParsingIfNeeded(ShaderModule& program)
{
    return dumpASTIfNeeded(dumpASTAfterParsing, program, "AST after parsing");
}

static inline bool dumpASTBetweenEachPassIfNeeded(ShaderModule& program, const char* message)
{
    return dumpASTIfNeeded(dumpASTBeforeEachPass, program, message);
}

static inline bool dumpASTAtEndIfNeeded(ShaderModule& program)
{
    return dumpASTIfNeeded(dumpASTAtEnd, program, "AST at end");
}

using PhaseTimes = Vector<std::pair<const char*, Seconds>>;

static inline void logPhaseTimes(PhaseTimes& phaseTimes)
{
    if (!dumpPhaseTimes) [[likely]]
        return;

    for (auto& entry : phaseTimes)
        dataLogLn(entry.first, ": ", entry.second.milliseconds(), " ms");
}

class PhaseTimer {
public:
    PhaseTimer(const char* phaseName, PhaseTimes& phaseTimes)
        : m_phaseTimes(phaseTimes)
    {
        if (dumpPhaseTimes) {
            m_phaseName = phaseName;
            m_start = MonotonicTime::now();
        }
    }

    ~PhaseTimer()
    {
        if (dumpPhaseTimes) {
            auto totalTime = MonotonicTime::now() - m_start;
            m_phaseTimes.append({ m_phaseName, totalTime });
        }
    }

private:
    const char* m_phaseName { nullptr };
    PhaseTimes& m_phaseTimes;
    MonotonicTime m_start;
};

} // namespace WGSL
