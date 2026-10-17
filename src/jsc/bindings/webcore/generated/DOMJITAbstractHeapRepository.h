/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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
// Auto-generated file. Do not modify.

#pragma once

#include <JavaScriptCore/DOMJITHeapRange.h>

namespace WebCore { namespace DOMJIT { namespace AbstractHeapRepository {
/* DOMJIT Abstract Heap Tree.
DOM<0,8>:
    Tree<0,8>:
        Node<0,6>:
            Node_firstChild<0,1>
            Node_lastChild<1,2>
            Node_parentNode<2,3>
            Node_nextSibling<3,4>
            Node_previousSibling<4,5>
            Node_ownerDocument<5,6>
        Document<6,8>:
            Document_documentElement<6,7>
            Document_body<7,8>
*/
constexpr JSC::DOMJIT::HeapRange DOM(JSC::DOMJIT::HeapRange::ConstExpr, 0, 8);
constexpr JSC::DOMJIT::HeapRange Tree(JSC::DOMJIT::HeapRange::ConstExpr, 0, 8);
constexpr JSC::DOMJIT::HeapRange Node(JSC::DOMJIT::HeapRange::ConstExpr, 0, 6);
constexpr JSC::DOMJIT::HeapRange Node_firstChild(JSC::DOMJIT::HeapRange::ConstExpr, 0, 1);
constexpr JSC::DOMJIT::HeapRange Node_lastChild(JSC::DOMJIT::HeapRange::ConstExpr, 1, 2);
constexpr JSC::DOMJIT::HeapRange Node_parentNode(JSC::DOMJIT::HeapRange::ConstExpr, 2, 3);
constexpr JSC::DOMJIT::HeapRange Node_nextSibling(JSC::DOMJIT::HeapRange::ConstExpr, 3, 4);
constexpr JSC::DOMJIT::HeapRange Node_previousSibling(JSC::DOMJIT::HeapRange::ConstExpr, 4, 5);
constexpr JSC::DOMJIT::HeapRange Node_ownerDocument(JSC::DOMJIT::HeapRange::ConstExpr, 5, 6);
constexpr JSC::DOMJIT::HeapRange Document(JSC::DOMJIT::HeapRange::ConstExpr, 6, 8);
constexpr JSC::DOMJIT::HeapRange Document_documentElement(JSC::DOMJIT::HeapRange::ConstExpr, 6, 7);
constexpr JSC::DOMJIT::HeapRange Document_body(JSC::DOMJIT::HeapRange::ConstExpr, 7, 8);
} } }
