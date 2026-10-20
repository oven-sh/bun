/*
 * Copyright (C) 2016-2024 Apple Inc. All rights reserved.
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
#include "JSDocument.h"

#if ENABLE(JIT)

#include "DOMJITAbstractHeapRepository.h"
#include "DOMJITCheckDOM.h"
#include "DOMJITHelpers.h"
#include "Document.h"
#include "JSDOMWrapper.h"
#include "JSElement.h"
#include "JSHTMLElement.h"
#include <JavaScriptCore/DOMJITCallDOMGetterSnippet.h>
#include <JavaScriptCore/HeapCellInlines.h>
#include <JavaScriptCore/Snippet.h>
#include <JavaScriptCore/SnippetParams.h>

IGNORE_WARNINGS_BEGIN("frame-address");

namespace WebCore {
using namespace JSC;

Ref<JSC::Snippet> checkSubClassSnippetForJSDocument()
{
    return DOMJIT::checkDOM<Document>();
}

Ref<JSC::DOMJIT::CallDOMGetterSnippet> compileDocumentDocumentElementAttribute()
{
    Ref<JSC::DOMJIT::CallDOMGetterSnippet> snippet = JSC::DOMJIT::CallDOMGetterSnippet::create();
    snippet->numGPScratchRegisters = 1;
    snippet->setGenerator([=](CCallHelpers& jit, JSC::SnippetParams& params) {
        GPRReg result = params[0].gpr();
        GPRReg document = params[1].gpr();
        GPRReg globalObject = params[2].gpr();
        JSValue globalObjectValue = params[2].value();
        GPRReg scratch = params.gpScratch(0);

        jit.loadPtr(CCallHelpers::Address(document, JSDocument::offsetOfWrapped()), scratch);
        static_assert(!JSDocument::hasCustomPtrTraits(), "Optimized JSDocument wrapper access should not be using RawPtrTraits");

        DOMJIT::loadDocumentElement(jit, scratch, scratch);
        auto nullCase = jit.branchTestPtr(CCallHelpers::Zero, scratch);
        DOMJIT::toWrapper<Element>(jit, params, scratch, globalObject, result, DOMJIT::operationToJSElement, globalObjectValue);
        auto done = jit.jump();

        nullCase.link(&jit);
        jit.moveValue(jsNull(), result);
        done.link(&jit);

        return CCallHelpers::JumpList();
    });
    snippet->effect = JSC::DOMJIT::Effect::forDef(DOMJIT::AbstractHeapRepository::Document_documentElement);
    return snippet;
}

namespace DOMJIT {

JSC_DEFINE_JIT_OPERATION(operationToJSElement, JSC::EncodedJSValue, (JSC::JSGlobalObject* globalObject, void* result))
{
    ASSERT(result);
    ASSERT(globalObject);
    JSC::VM& vm = globalObject->vm();
    JSC::CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    auto scope = DECLARE_THROW_SCOPE(vm);
    OPERATION_RETURN(scope, DOMJIT::toWrapperSlowImpl<Element>(globalObject, result));
}

JSC_DEFINE_JIT_OPERATION(operationToJSHTMLElement, JSC::EncodedJSValue, (JSC::JSGlobalObject* globalObject, void* result))
{
    ASSERT(result);
    ASSERT(globalObject);
    JSC::VM& vm = globalObject->vm();
    JSC::CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    auto scope = DECLARE_THROW_SCOPE(vm);
    OPERATION_RETURN(scope, DOMJIT::toWrapperSlowImpl<HTMLElement>(globalObject, result));
}

JSC_DEFINE_JIT_OPERATION(operationToJSDocument, JSC::EncodedJSValue, (JSC::JSGlobalObject* globalObject, void* result))
{
    ASSERT(result);
    ASSERT(globalObject);
    JSC::VM& vm = globalObject->vm();
    JSC::CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    auto scope = DECLARE_THROW_SCOPE(vm);
    OPERATION_RETURN(scope, DOMJIT::toWrapperSlowImpl<Document>(globalObject, result));
}

JSC_DEFINE_JIT_OPERATION(operationToJSNode, JSC::EncodedJSValue, (JSC::JSGlobalObject* globalObject, void* result))
{
    ASSERT(result);
    ASSERT(globalObject);
    JSC::VM& vm = globalObject->vm();
    JSC::CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    auto scope = DECLARE_THROW_SCOPE(vm);
    OPERATION_RETURN(scope, DOMJIT::toWrapperSlowImpl<Node>(globalObject, result));
}

JSC_DEFINE_JIT_OPERATION(operationToJSContainerNode, JSC::EncodedJSValue, (JSC::JSGlobalObject* globalObject, void* result))
{
    ASSERT(result);
    ASSERT(globalObject);
    JSC::VM& vm = globalObject->vm();
    JSC::CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    auto scope = DECLARE_THROW_SCOPE(vm);
    OPERATION_RETURN(scope, DOMJIT::toWrapperSlowImpl<ContainerNode>(globalObject, result));
}

} } // namespace WebCore::DOMJIT

IGNORE_WARNINGS_END

#endif // ENABLE(JIT)
