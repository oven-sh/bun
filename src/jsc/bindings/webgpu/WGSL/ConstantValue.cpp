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
#include "ConstantValue.h"

#include <wtf/PrintStream.h>
#include <wtf/text/WTFString.h>

namespace WGSL {

ConstantValue ConstantArray::operator[](unsigned index) const
{
    return elements[index];
}

ConstantValue ConstantVector::operator[](unsigned index) const
{
    return elements[index];
}

ConstantVector ConstantMatrix::operator[](unsigned index) const
{
    ConstantVector result(rows);
    for (unsigned i = 0; i < rows; ++i)
        result.elements[i] = elements[index * rows + i];
    return result;
}

void ConstantValue::dump(PrintStream& out) const
{
    WTF::switchOn(*this,
        [&](double d) {
            out.print(String::number(d));
        },
        [&](float f) {
            out.print(String::number(f));
            if (std::isfinite(f))
                out.print("f");
        },
        [&](half h) {
            out.print(String::number(h));
            if (std::isfinite(static_cast<double>(h)))
                out.print("h");
        },
        [&](int64_t i) {
            out.print(String::number(i));
        },
        [&](int32_t i) {
            out.print(String::number(i), "i");
        },
        [&](uint32_t u) {
            out.print(String::number(u), "u");
        },
        [&](bool b) {
            out.print(b ? "true" : "false");
        },
        [&](const ConstantArray& a) {
            out.print("array(");
            bool first = true;
            for (const auto& element : a.elements) {
                if (!first)
                    out.print(", ");
                first = false;
                out.print(element);
            }
            out.print(")");
        },
        [&](const ConstantVector& v) {
            out.print("vec", v.elements.size(), "(");
            bool first = true;
            for (const auto& element : v.elements) {
                if (!first)
                    out.print(", ");
                first = false;
                out.print(element);
            }
            out.print(")");
        },
        [&](const ConstantMatrix& m) {
            out.print("mat", m.columns, "x", m.rows, "(");
            bool first = true;
            for (const auto& element : m.elements) {
                if (!first)
                    out.print(", ");
                first = false;
                out.print(element);
            }
            out.print(")");
        },
        [&](const ConstantStruct& s) {
            out.print("struct { ");
            bool first = true;
            for (const auto& entry : s.fields) {
                if (!first)
                    out.print(", ");
                first = false;
                out.print(entry.key, ": ", entry.value);
            }
            out.print(" }");
        });
}

} // namespace WGSL
