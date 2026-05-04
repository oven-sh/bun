/*
 * Copyright (C) 2016 Apple Inc. All Rights Reserved.
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

#pragma once

#include "DOMJITHelpers.h"

#if ENABLE(JIT)

// #include "Document.h"
// #include "Element.h"
#include "Event.h"
#include "Node.h"

namespace WebCore {
namespace DOMJIT {

template<typename DOMInterface>
struct TypeChecker {
};

template<>
struct TypeChecker<Node> {
    static CCallHelpers::Jump branchIfFail(CCallHelpers& jit, GPRReg dom)
    {
        return DOMJIT::branchIfNotNode(jit, dom);
    }
};

// template<>
// struct TypeChecker<Document> {
//     static CCallHelpers::Jump branchIfFail(CCallHelpers& jit, GPRReg dom)
//     {
//         return DOMJIT::branchIfNotDocumentWrapper(jit, dom);
//     }
// };

// template<>
// struct TypeChecker<DocumentFragment> {
//     static CCallHelpers::Jump branchIfFail(CCallHelpers& jit, GPRReg dom)
//     {
//         return DOMJIT::branchIfNotDocumentFragment(jit, dom);
//     }
// };

template<>
struct TypeChecker<Event> {
    static CCallHelpers::Jump branchIfFail(CCallHelpers& jit, GPRReg dom)
    {
        return DOMJIT::branchIfNotEvent(jit, dom);
    }
};

// template<>
// struct TypeChecker<Element> {
//     static CCallHelpers::Jump branchIfFail(CCallHelpers& jit, GPRReg dom)
//     {
//         return DOMJIT::branchIfNotElement(jit, dom);
//     }
// };

template<typename DOMInterface>
Ref<JSC::Snippet> checkDOM()
{
    Ref<JSC::Snippet> snippet = JSC::Snippet::create();
    snippet->setGenerator([=](CCallHelpers& jit, JSC::SnippetParams& params) {
        return TypeChecker<DOMInterface>::branchIfFail(jit, params[0].gpr());
    });
    return snippet;
}

}
}

#endif
