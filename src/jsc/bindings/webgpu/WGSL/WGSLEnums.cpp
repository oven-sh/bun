/*
 * Copyright (c) 2023 Apple Inc. All rights reserved.
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
#include "WGSLEnums.h"

#include <wtf/PrintStream.h>
#include <wtf/SortedArrayMap.h>

namespace WGSL {

#define COMMA ,
#define LPAREN (
#define RPAREN )
#define CONTINUATION(args...) args RPAREN
#define EXPAND(x) x

#define ENUM_DEFINE_TO_STRING_CASE_(__type, __name, __string, ...) \
    case __type::__name: \
        return #__string##_s; \
        break;

#define ENUM_DEFINE_TO_STRING_CASE(__name) \
    ENUM_DEFINE_TO_STRING_CASE_ LPAREN __name, CONTINUATION

#define ENUM_DEFINE_TO_STRING(__name) \
    ASCIILiteral toString(__name __value) \
    { \
        switch (__value) { \
            EXPAND(ENUM_##__name(ENUM_DEFINE_TO_STRING_CASE LPAREN __name RPAREN)) \
        } \
    }

#define ENUM_DEFINE_PRINT_INTERNAL(__name) \
    void printInternal(PrintStream& out, __name __value) \
    { \
        out.print(toString(__value)); \
    }

#define ENUM_DEFINE_PARSE_ENTRY_(__type, __name, __string, ...) \
    { #__string##_s, __type::__name },

#define ENUM_DEFINE_PARSE_ENTRY(__name) \
    ENUM_DEFINE_PARSE_ENTRY_ LPAREN __name, CONTINUATION

#define ENUM_DEFINE_PARSE(__name) \
    const __name* parse##__name(const String& __string) \
    { \
        static constexpr SortedArrayMap __map { WTF::toArray<std::pair<ComparableASCIILiteral, __name>>({ \
            EXPAND(ENUM_##__name(ENUM_DEFINE_PARSE_ENTRY LPAREN __name RPAREN)) \
        }) }; \
        return __map.tryGet(__string); \
    }

#define ENUM_DEFINE(__name) \
    ENUM_DEFINE_TO_STRING(__name) \
    ENUM_DEFINE_PRINT_INTERNAL(__name) \
    ENUM_DEFINE_PARSE(__name)

ENUM_DEFINE(AddressSpace);
ENUM_DEFINE(AccessMode);
ENUM_DEFINE(TexelFormat);
ENUM_DEFINE(InterpolationType);
ENUM_DEFINE(InterpolationSampling);
ENUM_DEFINE(ShaderStage);
ENUM_DEFINE(SeverityControl);
ENUM_DEFINE(TriggeringRule);
ENUM_DEFINE(Builtin);
ENUM_DEFINE(Extension);
ENUM_DEFINE(LanguageFeature);

#undef ENUM_DEFINE
#undef ENUM_DEFINE_PARSE
#undef ENUM_DEFINE_PARSE_ENTRY
#undef ENUM_DEFINE_PARSE_ENTRY_
#undef ENUM_DEFINE_PRINT_INTERNAL
#undef ENUM_DEFINE_TO_STRING
#undef ENUM_DEFINE_TO_STRING_CASE
#undef ENUM_DEFINE_TO_STRING_CASE_
#undef EXPAND
#undef CONTINUATION
#undef RPAREN
#undef LPAREN
#undef COMMA

AccessMode defaultAccessModeForAddressSpace(AddressSpace addressSpace)
{
    // Default access mode based on address space
    // https://www.w3.org/TR/WGSL/#address-space
    switch (addressSpace) {
    case AddressSpace::Function:
    case AddressSpace::Private:
    case AddressSpace::Workgroup:
        return AccessMode::ReadWrite;
    case AddressSpace::Uniform:
    case AddressSpace::Storage:
    case AddressSpace::Handle:
        return AccessMode::Read;
    }
}

} // namespace WGSL
